import { Injectable } from '@angular/core';
import {
  BehaviorSubject, combineLatest, Observable, of
} from 'rxjs';
import {
  distinctUntilChanged, filter, map, shareReplay, startWith, switchMap
} from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuizService } from '../../data/quiz.service';
import { QuizNavigationService } from '../../flow/quiz-navigation.service';
import { QuizQuestionManagerService } from '../../flow/quizquestionmgr.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { ExplanationTextService, FETPayload } from '../explanation/explanation-text.service';

@Injectable({ providedIn: 'root' })
export class QuizContentDisplayService {
  // ═══════════════════════════════════════════════════════════════════════
  // FET State
  // ═══════════════════════════════════════════════════════════════════════

  // Lock flag to prevent displayText$ from overwriting FET
  _fetLocked = false;
  _lockedForIndex = -1;

  // Session-based tracking: which questions have had FET displayed this session
  _fetDisplayedThisSession = new Set<number>();

  _lastQuestionTextByIndex = new Map<number, string>();

  // ═══════════════════════════════════════════════════════════════════════
  // Reactive Observables (initialized via setup methods)
  // ═══════════════════════════════════════════════════════════════════════

  displayText$!: Observable<string>;
  shouldShowFet$!: Observable<boolean>;
  fetToDisplay$!: Observable<string>;

  constructor(
    private quizService: QuizService,
    private quizNavigationService: QuizNavigationService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private selectedOptionService: SelectedOptionService
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Formatted Explanation Observables (factory methods)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Creates the reactive FET observable that combines the current index
   * with service cache updates to guarantee latest data.
   */
  createFormattedExplanation$(
    currentIndex$: Observable<number>
  ): Observable<FETPayload> {
    return combineLatest([
      currentIndex$,
      this.explanationTextService.explanationsUpdated
    ]).pipe(
      map(([idx, explanations]) => {
        const explanation = explanations[idx]?.explanation || '';
        return { idx, text: explanation, token: 0 } as FETPayload;
      }),
      distinctUntilChanged((a, b) => a.idx === b.idx && a.text === b.text),
      shareReplay(1)
    );
  }

  /**
   * Creates the active FET text observable that resolves from
   * both fetByIndex map and formattedExplanations record.
   */
  createActiveFetText$(
    currentIndex$: Observable<number>
  ): Observable<string> {
    return combineLatest([
      currentIndex$,
      this.explanationTextService.explanationsUpdated.pipe(startWith({}))
    ]).pipe(
      map(([idx]) => {
        const safeIdx = Number.isFinite(idx) ? Number(idx) : 0;
        const fromMap = this.explanationTextService.fetByIndex?.get(safeIdx)?.trim() || '';
        const fromRecord = this.explanationTextService.formattedExplanations?.[safeIdx]?.explanation?.trim() || '';
        return fromMap || fromRecord;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Display Text Pipeline
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Builds the main displayText$ observable that switches between
   * question text and formatted explanation text based on resolution state.
   */
  initDisplayTextPipeline(
    currentIndex$: Observable<number>,
    timedOutIdx$: Observable<number>,
    displayState$: Observable<{ mode: 'question' | 'explanation'; answered: boolean }>
  ): void {
    this.displayText$ = currentIndex$.pipe(
      filter(idx => idx >= 0),
      switchMap(safeIdx => {
        return combineLatest([
          this.quizService.getQuestionByIndex(safeIdx),
          this.selectedOptionService.getSelectedOptionsForQuestion$(safeIdx).pipe(startWith([])),
          this.explanationTextService.getExplanationText$(safeIdx).pipe(startWith('')),
          timedOutIdx$.pipe(
            startWith(-1),
            map(tIdx => tIdx === safeIdx)
          ),
          displayState$.pipe(startWith({ mode: 'question', answered: false })),
          this.quizNavigationService.getIsNavigatingToPrevious().pipe(startWith(false)),
          this.quizStateService.userHasInteracted$.pipe(startWith(-1))
        ]).pipe(
          map(([qObj, selections, fetText, isTimedOut, state, isNavBack, lastInteractedIdx]) => {
            return this.resolveDisplayText(
              safeIdx, qObj, selections, fetText, isTimedOut, state, isNavBack, lastInteractedIdx
            );
          })
        );
      }),
      distinctUntilChanged()
    );
  }

  /**
   * Pure resolution logic: given all inputs for a question index,
   * determine what text to display (question text or FET).
   */
  private resolveDisplayText(
    safeIdx: number,
    qObj: QuizQuestion | null,
    selections: any[],
    fetText: string | null,
    isTimedOut: boolean,
    state: { mode: string; answered: boolean } | null,
    isNavBack: boolean,
    lastInteractedIdx: number
  ): string {
    const rawQText = qObj?.questionText || '';
    const serviceQText = (qObj?.questionText ?? '').trim();
    const effectiveQText = serviceQText || rawQText || '';

    // Build the base question text display (with multi-answer banner if applicable)
    let qDisplay = effectiveQText;
    const numCorrect = qObj?.options?.filter(o => o.correct)?.length || 0;
    if (numCorrect > 1 && qObj?.options) {
      const banner = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
        numCorrect,
        qObj.options.length
      );
      qDisplay = `${qDisplay} <span class="correct-count">${banner}</span>`;
    }

    // AUTHORITATIVE RESOLUTION FOR THIS INDEX
    const safeSelections = Array.isArray(selections) ? selections : [];
    const isResolved = qObj ? this.selectedOptionService.isQuestionResolvedLeniently(qObj, safeSelections) : false;

    const isMultipleAnswer = numCorrect > 1;

    // Allow FET if: Resolved OR TimedOut
    let shouldShowExplanation = isResolved || isTimedOut;

    // CRITICAL GUARD: Only show FET if user has actively interacted with
    // this question in the current session.
    const hasInteracted = this.quizStateService.hasUserInteracted(safeIdx) || lastInteractedIdx === safeIdx;
    if (!hasInteracted && !isTimedOut) {
      shouldShowExplanation = false;
    }

    // When navigating backwards (Previous button), always show question text
    if (isNavBack) {
      shouldShowExplanation = false;
    }

    // DIRECT OIS BYPASS: If OIS has already confirmed all correct answers
    // are selected, trust it unconditionally.
    if (!shouldShowExplanation) {
      const perfectMap = (this.quizService as any)?._multiAnswerPerfect as Map<number, boolean> | undefined;
      if (perfectMap?.get(safeIdx) === true && hasInteracted) {
        shouldShowExplanation = true;
        console.log(`[displayText$] Q${safeIdx + 1} OIS bypass: _multiAnswerPerfect=true → forcing SHOW`);
      }
    }

    if (!shouldShowExplanation && state?.mode === 'explanation' && safeSelections.length > 0 && hasInteracted) {
      // Only show FET when the question is actually resolved (correct answer selected).
      shouldShowExplanation = isResolved;
    }

    const finalFet = (fetText ?? '').trim();
    const hasFet = finalFet.length > 0;
    const hasRaw = !!qObj?.explanation;

    const isFetForThisQuestion = hasFet && (
      this.explanationTextService.latestExplanationIndex === safeIdx ||
      (this.explanationTextService.formattedExplanations[safeIdx]?.explanation ?? '').trim() === finalFet ||
      (this.explanationTextService as any).fetByIndex?.get(safeIdx)?.trim() === finalFet ||
      finalFet.toLowerCase().includes('correct because')
    );

    if (shouldShowExplanation) {
      console.log(`[displayText$] Q${safeIdx + 1} DISPLAY: hasFet=${hasFet}, isValid=${isFetForThisQuestion}, hasRaw=${hasRaw}`);
      if (isFetForThisQuestion) {
        console.log(`[displayText$] Q${safeIdx + 1} showing FET: "${finalFet.slice(0, 40)}..."`);
        return finalFet;
      }
      // Before falling back to raw explanation, check formatted caches directly.
      // The reactive stream (fetText) may not have the formatted text yet due to
      // timing (e.g. resetExplanationState cleared _byIndex subjects), but the
      // formattedExplanations cache or fetByIndex may still have it.
      const cachedFet = (this.explanationTextService.formattedExplanations[safeIdx]?.explanation ?? '').trim()
        || ((this.explanationTextService as any).fetByIndex?.get(safeIdx) ?? '').trim();
      if (cachedFet && cachedFet.toLowerCase().includes('correct because')) {
        console.log(`[displayText$] Q${safeIdx + 1} showing CACHED FET: "${cachedFet.slice(0, 40)}..."`);
        return cachedFet;
      }
      if (hasRaw) {
        // Last resort: format the raw explanation on-the-fly with option #s
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(
          qObj, qObj.options, safeIdx
        );
        if (correctIndices.length > 0) {
          const formatted = this.explanationTextService.formatExplanation(
            qObj, correctIndices, qObj.explanation
          );
          console.log(`[displayText$] Q${safeIdx + 1} ON-THE-FLY FET: "${formatted.slice(0, 40)}..."`);
          return formatted;
        }
        console.warn(`[displayText$] Q${safeIdx + 1} falling back to RAW: FET mismatch or missing`);
        return qObj.explanation || '';
      }
    }

    return qDisplay;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Should Show FET
  // ═══════════════════════════════════════════════════════════════════════

  setupShouldShowFet(currentIndex$: Observable<number>): void {
    this.shouldShowFet$ = currentIndex$.pipe(
      filter(idx => idx >= 0),
      distinctUntilChanged(),
      switchMap((idx) =>
        combineLatest([
          this.quizService.getQuestionByIndex(idx).pipe(startWith(null)),
          this.selectedOptionService.getSelectedOptionsForQuestion$(idx).pipe(
            startWith([])
          )
        ]).pipe(
          map(([question, selected]: [QuizQuestion | null, any[]]) => {
            const resolved = question
              ? this.selectedOptionService.isQuestionResolvedCorrectly(
                question,
                selected ?? []
              )
              : false;

            console.log(`[shouldShowFet] Idx: ${idx}, Resolved: ${resolved}, Selected: ${selected?.length}`);
            return resolved;
          })
        )
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FET To Display
  // ═══════════════════════════════════════════════════════════════════════

  setupFetToDisplay(
    currentIndex$: Observable<number>,
    timedOutIdx$: Observable<number>,
    activeFetText$: Observable<string>,
    currentQuestion: BehaviorSubject<QuizQuestion | null>
  ): void {
    const showOnTimeout$ = combineLatest([
      currentIndex$.pipe(startWith(-1)),
      timedOutIdx$.pipe(startWith(-1))
    ]).pipe(
      map(([idx, timedOutIdx]) => idx >= 0 && idx === timedOutIdx),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.fetToDisplay$ = combineLatest([
      activeFetText$.pipe(startWith('')),
      this.shouldShowFet$.pipe(startWith(false)),
      showOnTimeout$.pipe(startWith(false)),
      currentQuestion.pipe(startWith(null))
    ]).pipe(
      map(([fet, resolved, timedOut, question]) => {
        const text = (fet ?? '').trim();
        console.log(`[fetToDisplay$] Resolved: ${resolved}, TimedOut: ${timedOut}, FET len: ${text.length}`);

        // Allow display if: Resolved OR TimedOut
        if (resolved || timedOut) {
          if (text.length > 0) {
            return text;
          }
          // Fallback if formatted text is missing
          if (question && question.explanation) {
            console.warn('[fetToDisplay$] Using fallback raw explanation');
            return question.explanation;
          }
        }
        return '';
      }),

      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FET Regeneration
  // ═══════════════════════════════════════════════════════════════════════

  regenerateFetForIndex(idx: number): string {
    try {
      const displayQuestions = this.quizService.getQuestionsInDisplayOrder?.() ?? [];
      const question = displayQuestions[idx] ?? this.quizService.questions?.[idx];
      if (!question || !Array.isArray(question.options) || question.options.length === 0) {
        return '';
      }

      const rawExplanation = (question.explanation ?? '').trim();
      if (!rawExplanation) return '';

      this.explanationTextService.storeFormattedExplanation(
        idx,
        rawExplanation,
        question,
        question.options,
        true
      );

      return this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';
    } catch {
      return '';
    }
  }
}
