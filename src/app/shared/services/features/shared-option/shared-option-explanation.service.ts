import { Injectable, NgZone } from '@angular/core';
import { take } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { ExplanationTextService } from '../explanation/explanation-text.service';

/**
 * Context passed from the component for explanation resolution.
 */
export interface ExplanationContext {
  /** The resolved display index for the question */
  resolvedIndex: number;
  /** The question object (already resolved from display index) */
  question: QuizQuestion | null;
  /** The current question from the component (may be stale) */
  currentQuestion: QuizQuestion | null;
  /** The quiz ID */
  quizId: string;
  /** Option bindings currently rendered */
  optionBindings: OptionBindings[];
  /** Options to display (input property) */
  optionsToDisplay: Option[];
  /** Whether this is a multi-answer question */
  isMultiMode: boolean;
}

@Injectable({ providedIn: 'root' })
export class SharedOptionExplanationService {
  pendingExplanationIndex = -1;

  constructor(
    private explanationTextService: ExplanationTextService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private ngZone: NgZone
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Main Explanation Emission
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Resolves the question index, applies stale-call guard, builds context,
   * and delegates to emitExplanation. Called from the component's thin wrapper.
   */
  resolveAndEmitExplanation(params: {
    questionIndex: number;
    activeQuestionIndex: number;
    currentQuestion: QuizQuestion | null;
    quizId: string;
    optionBindings: OptionBindings[];
    optionsToDisplay: Option[];
    isMultiMode: boolean;
    getQuestionAtDisplayIndex: (idx: number) => QuizQuestion | null;
  }, skipGuard = false): void {
    const { questionIndex, activeQuestionIndex, currentQuestion, getQuestionAtDisplayIndex } = params;

    const resolvedIndex = Number.isFinite(activeQuestionIndex)
      ? Math.max(0, Math.trunc(activeQuestionIndex))
      : Number.isFinite(questionIndex)
        ? Math.max(0, Math.trunc(questionIndex))
        : this.resolveExplanationQuestionIndex(questionIndex, activeQuestionIndex);

    const question =
      getQuestionAtDisplayIndex(resolvedIndex)
      ?? currentQuestion
      ?? this.quizService.questions?.[resolvedIndex]
      ?? null;

    // Guard: Prevent stale deferred calls from emitting for the wrong question.
    if (currentQuestion && resolvedIndex !== questionIndex) {
      const questionAtIndex = getQuestionAtDisplayIndex(resolvedIndex)
        ?? this.quizService.questions?.[resolvedIndex];
      if (questionAtIndex && questionAtIndex.questionText !== currentQuestion.questionText) {
        console.warn(`[emitExplanation] BLOCKED: stale deferred call for index=${resolvedIndex}`);
        return;
      }
    }

    const ctx: ExplanationContext = {
      resolvedIndex,
      question,
      currentQuestion,
      quizId: params.quizId,
      optionBindings: params.optionBindings,
      optionsToDisplay: params.optionsToDisplay,
      isMultiMode: params.isMultiMode
    };

    this.emitExplanation(ctx, skipGuard);
  }

  /**
   * Evaluates whether the question is resolved, then formats and emits
   * the explanation text through all required service channels.
   */
  emitExplanation(ctx: ExplanationContext, skipGuard = false): void {
    const { resolvedIndex, question, currentQuestion } = ctx;

    console.log(`[SharedOptionExplanationService] emitExplanation checking Q${resolvedIndex + 1} skipGuard=${skipGuard}...`);

    // Guard: Emit FET only when the question is resolved correctly.
    if (!skipGuard && question && Array.isArray(question.options)) {
      const resolved = this.checkResolution(ctx);

      if (!resolved) {
        console.log(`[emitExplanation] Q${resolvedIndex + 1} NOT resolved. Skipping FET.`);
        return;
      }
    }

    const explanationText = this.resolveExplanationText(ctx)?.trim()
      || question?.explanation
      || '';

    if (!explanationText) {
      console.warn(`[emitExplanation] No explanation text resolved for Q${resolvedIndex + 1}`);
      return;
    }

    console.log(`[SharedOptionExplanationService] emitExplanation proceeding for Q${resolvedIndex + 1}: "${explanationText.substring(0, 30)}..."`);

    // Cache the resolved formatted text
    this.cacheResolvedFormattedExplanation(resolvedIndex, explanationText);

    // BRUTE FORCE: Clear locks and pulse stream
    try {
      (this.explanationTextService as any)._fetLocked = false;
      this.explanationTextService.unlockExplanation();
      this.explanationTextService.explanationText$.next('');
    } catch (e) { console.warn('[SOC] Failed to unlock/pulse FET', e); }

    // Force display flags to TRUE
    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.explanationTextService.shouldDisplayExplanationSource.next(true);

    this.pendingExplanationIndex = resolvedIndex;
    this.applyExplanationText(explanationText, resolvedIndex);
    this.scheduleExplanationVerification(resolvedIndex, explanationText);

    console.log(`[SharedOptionExplanationService] emitExplanation COMPLETED for Q${resolvedIndex + 1}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Resolution Check
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Checks whether the question is resolved (all correct answers selected).
   * Uses UI state first, falls back to service state.
   */
  private checkResolution(ctx: ExplanationContext): boolean {
    const { resolvedIndex, question, optionBindings, optionsToDisplay } = ctx;

    const correctCount = question!.options.filter(
      (o: any) => o.correct === true || String(o.correct) === 'true'
    ).length;

    const visualOptions = (Array.isArray(optionBindings) && optionBindings.length > 0)
      ? optionBindings.map((b: OptionBindings) => b.option)
      : (optionsToDisplay ?? []);

    const selectedFromUi = visualOptions
      .map((opt: any, idx: number) => {
        const bindingSelected = optionBindings?.[idx]?.isSelected === true;
        const optionSelected = opt?.selected === true || bindingSelected;
        return optionSelected
          ? ({
            optionId: opt?.optionId,
            text: opt?.text,
            correct: opt?.correct,
            displayIndex: idx
          } as any)
          : null;
      })
      .filter((opt: any) => opt != null);

    const selectedFromService =
      this.selectedOptionService.getSelectedOptionsForQuestion(resolvedIndex) ?? [];

    const isSelectionCorrect = (sel: any): boolean => {
      if (sel?.correct === true || String(sel?.correct) === 'true') return true;

      const selId = sel?.optionId;
      const selText = this.normalize(sel?.text);

      const byId = question!.options.find((o: any) =>
        o?.optionId !== undefined && o?.optionId !== null &&
        String(o.optionId) === String(selId)
      );
      if (byId) return byId.correct === true || String(byId.correct) === 'true';

      const byText = question!.options.find((o: any) =>
        this.normalize(o?.text) !== '' && this.normalize(o?.text) === selText
      );
      if (byText) return byText.correct === true || String(byText.correct) === 'true';

      return false;
    };

    const uiResolved = (() => {
      if (selectedFromUi.length === 0) return false;

      const correctSelected = selectedFromUi.filter(isSelectionCorrect).length;
      const incorrectSelected = selectedFromUi.filter(s => !isSelectionCorrect(s)).length;

      if (correctCount > 1) {
        const allCorrect = correctSelected >= correctCount;
        if (allCorrect) {
          console.log(`[emitExplanation] Multi-answer UI Resolved: correct=${correctSelected}/${correctCount}, inc=${incorrectSelected}`);
        }
        return allCorrect;
      }
      return correctSelected >= 1;
    })();

    const status = this.selectedOptionService.getResolutionStatus(
      question!,
      selectedFromService as any,
      false
    );

    let resolved = (selectedFromUi.length > 0) ? uiResolved : status.resolved;

    if (!resolved && status.resolved) {
      console.log(`[emitExplanation] Q${resolvedIndex + 1} UI check failed but Service check PASSED. Overriding to RESOLVED=true.`);
      resolved = true;
    }

    console.log(`[emitExplanation] Q${resolvedIndex + 1} | correctTotal=${correctCount} | uiResolved=${uiResolved} | serviceResolved=${status.resolved} -> FINAL=${resolved}`);

    return resolved;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Apply & Verify
  // ═══════════════════════════════════════════════════════════════════════

  applyExplanationText(
    explanationText: string,
    displayIndex: number
  ): void {
    console.log(`[SharedOptionExplanationService] applyExplanationText displaying for Q${displayIndex + 1}`);
    this.quizStateService.markUserInteracted(displayIndex);

    const contextKey = this.buildExplanationContext(displayIndex);

    this.explanationTextService._activeIndex = displayIndex;
    this.explanationTextService.latestExplanation = explanationText;
    this.explanationTextService.latestExplanationIndex = displayIndex;

    this.explanationTextService.emitFormatted(displayIndex, explanationText);

    this.explanationTextService.setExplanationText(explanationText, {
      force: true,
      context: contextKey,
      index: displayIndex
    });

    const displayOptions = { context: contextKey, force: true } as const;
    this.explanationTextService.setShouldDisplayExplanation(
      true,
      displayOptions
    );
    this.explanationTextService.setIsExplanationTextDisplayed(
      true,
      displayOptions
    );
    this.explanationTextService.setResetComplete(true);

    this.explanationTextService.lockExplanation();

    this.quizStateService.setDisplayState({
      mode: 'explanation',
      answered: true
    });
    console.log(`[SharedOptionExplanationService] DisplayState set to EXPLANATION for Q${displayIndex + 1}`);
  }

  buildExplanationContext(questionIndex: number): string {
    const normalized = Number.isFinite(questionIndex)
      ? Math.max(0, Math.floor(questionIndex))
      : 0;

    return `question:${normalized}`;
  }

  scheduleExplanationVerification(
    displayIndex: number,
    explanationText: string
  ): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        let latest: string | null = null;

        const subj = this.explanationTextService
          .formattedExplanationSubject as any;

        try {
          if (typeof subj.getValue === 'function') {
            latest = subj.getValue();
          } else {
            subj.pipe(take(1)).subscribe((val: string) => {
              latest = val;
            });
          }
        } catch {
          latest = null;
        }

        if (this.pendingExplanationIndex !== displayIndex) {
          return;
        }

        if (latest?.trim() === explanationText.trim()) {
          this.clearPendingExplanation();
          return;
        }

        this.ngZone.run(() => {
          console.warn('[Re-applying explanation text after mismatch]', {
            expected: explanationText,
            latest,
            displayIndex
          });

          this.explanationTextService.unlockExplanation();
          this.applyExplanationText(explanationText, displayIndex);
          this.clearPendingExplanation();
        });
      });
    });
  }

  resolveDisplayIndex(
    questionIndex: number,
    getActiveQuestionIndex: () => number,
    currentQuestionIndex: number,
    resolvedQuestionIndex: number | null
  ): number {
    const explicit = Number.isFinite(questionIndex)
      ? Math.max(0, Math.floor(questionIndex))
      : null;

    const resolved =
      explicit ??
      getActiveQuestionIndex() ??
      currentQuestionIndex ??
      resolvedQuestionIndex;
    return Number.isFinite(resolved) ? Math.max(0, Math.floor(resolved!)) : 0;
  }

  clearPendingExplanation(): void {
    this.pendingExplanationIndex = -1;
  }

  /**
   * Resolves a question index for explanation emission using a fallback chain:
   *   1. The provided questionIndex (if finite)
   *   2. The active question index from the component
   *   3. The service-level current question index
   *   4. Emergency fallback: 0
   */
  resolveExplanationQuestionIndex(
    questionIndex: number,
    activeQuestionIndex: number
  ): number {
    if (Number.isFinite(questionIndex)) {
      return Math.max(0, Math.trunc(questionIndex));
    }

    if (Number.isFinite(activeQuestionIndex)) {
      return Math.max(0, Math.trunc(activeQuestionIndex));
    }

    const svcIndex = this.quizService?.getCurrentQuestionIndex?.() ?? this.quizService?.currentQuestionIndex;
    if (typeof svcIndex === 'number' && Number.isFinite(svcIndex)) {
      return Math.max(0, Math.trunc(svcIndex));
    }

    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Explanation Text Resolution
  // ═══════════════════════════════════════════════════════════════════════

  cacheResolvedFormattedExplanation(index: number, formatted: string): void {
    const text = (formatted ?? '').trim();
    if (!text) return;

    this.explanationTextService.formattedExplanations[index] = {
      questionIndex: index,
      explanation: text
    };
    this.explanationTextService.fetByIndex.set(index, text);
    this.explanationTextService.updateFormattedExplanation(text);
  }

  /**
   * Resolves the formatted explanation text using visual option positions
   * for correct "Option N" labeling (shuffle-safe).
   */
  resolveExplanationText(ctx: ExplanationContext): string {
    const { resolvedIndex: displayIndex, optionBindings, optionsToDisplay, currentQuestion, quizId } = ctx;

    console.error(`🔴🔴🔴 [FET-SOC] Q${displayIndex + 1} | Resolving for display...`);

    // 1. Determine which options are ACTUALLY displayed right now
    const displayOptions = (Array.isArray(optionBindings) && optionBindings.length > 0)
      ? optionBindings.map(b => b.option)
      : (Array.isArray(optionsToDisplay) && optionsToDisplay.length > 0)
        ? optionsToDisplay
        : [];

    if (displayOptions.length === 0) {
      console.warn(`[FET-SOC] Q${displayIndex + 1} | No visual options found! Falling back to raw.`);
      return (currentQuestion?.explanation || '').trim();
    }

    // 2. Identify the authoritative canonical question
    const allCanonical = this.quizService.getCanonicalQuestions(quizId) || [];
    const currentQText = this.normalize(currentQuestion?.questionText);

    let authQ = allCanonical.find(q => this.normalize(q.questionText) === currentQText);
    authQ = authQ || (currentQuestion as QuizQuestion);

    if (!authQ) {
      console.warn(`[FET-SOC] Q${displayIndex + 1} | No auth question found. Using raw.`);
      return (currentQuestion?.explanation || '').trim();
    }

    // 3. Build sets of correct identifiers from the authoritative source
    const correctIds = new Set<number>();
    const correctTexts = new Set<string>();

    if (Array.isArray(authQ.answer)) {
      authQ.answer.forEach(a => {
        if (!a) return;
        const id = Number(a.optionId);
        if (!isNaN(id)) correctIds.add(id);
        const t = this.normalize(a.text);
        if (t) correctTexts.add(t);
      });
    }
    if (correctIds.size === 0 && Array.isArray(authQ.options)) {
      authQ.options.forEach(o => {
        if (!o || !o.correct) return;
        const id = Number(o.optionId);
        if (!isNaN(id)) correctIds.add(id);
        const t = this.normalize(o.text);
        if (t) correctTexts.add(t);
      });
    }

    // 4. Calculate indices based on VISUAL POSITIONS
    const correctIndices = displayOptions
      .map((opt, i) => {
        const id = Number(opt.optionId);
        const text = this.normalize(opt.text);
        const isCorrect = (!isNaN(id) && correctIds.has(id)) ||
          (text && correctTexts.has(text)) ||
          !!opt.correct;

        return isCorrect ? i + 1 : null;
      })
      .filter((n): n is number => n !== null);

    console.log(`[FET-SOC] Q${displayIndex + 1} | CORRECT INDICES: ${JSON.stringify(correctIndices)}`);

    // 5. Format and Emit
    const rawExplanation = (authQ.explanation || '').trim();
    const formatted = this.explanationTextService.formatExplanation(
      { ...authQ, options: displayOptions },
      correctIndices,
      rawExplanation,
      displayIndex
    );

    this.explanationTextService.storeFormattedExplanation(
      displayIndex,
      formatted,
      authQ,
      displayOptions,
      true
    );

    return formatted;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════

  private normalize(value: unknown): string {
    return String(value ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00A0/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
