import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, map, take, timeout } from 'rxjs/operators';

import { Option } from '../../models/Option.model';
import { FormattedExplanation } from '../../models/FormattedExplanation.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionState } from '../../models/QuestionState.model';
import { ExplanationTextService } from './explanation-text.service';
import { QuizService } from '../data/quiz.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { QuizQuestionManagerService } from '../flow/quizquestionmgr.service';
import { QqcExplanationManagerService } from './qqc-explanation-manager.service';
import { firstValueFrom } from '../../utils/rxjs-compat';

/**
 * Manages explanation display, formatted explanation text (FET) resolution,
 * and explanation UI state for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcExplanationDisplayService {

  constructor(
    private explanationTextService: ExplanationTextService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private explanationManager: QqcExplanationManagerService
  ) {}

  /**
   * Resolves and formats the explanation text for a given question index.
   * Returns the formatted explanation text string.
   */
  async updateExplanationText(params: {
    index: number;
    normalizeIndex: (idx: number) => number;
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    options: Option[];
  }): Promise<string> {
    const svc = this.explanationTextService;
    const quizSvc = this.quizService;
    const i0 = params.normalizeIndex(params.index);

    // Step 1: Resolve the question object and raw text
    let q: QuizQuestion | null = null;
    try {
      if (params.questionsArray && params.questionsArray.length > i0) {
        q = params.questionsArray[i0];
      }

      if (!q && params.currentQuestionIndex === i0 && params.currentQuestion) {
        q = { ...params.currentQuestion } as QuizQuestion;
      }

      if (!q) {
        const svcQuestions = (quizSvc as any).shuffledQuestions || quizSvc.questions || [];
        q = svcQuestions[i0];
      }
    } catch (err) {
      console.warn(`[QQC] Error resolving question for Q${i0 + 1}`, err);
    }

    if (!q) {
      console.error(`[QQC] FAILED to resolve question object for Q${i0 + 1}. FET generation aborted.`);
      return '';
    }

    const baseRaw = (q?.explanation ?? '').toString().trim();

    try {
      svc.purgeAndDefer(i0);
    } catch { }

    await new Promise(res => requestAnimationFrame(res));

    // Step 2: Format explanation safely using authoritative indices
    let formatted = '';
    try {
      let visualOpts: Option[] = [];

      if (i0 === params.currentQuestionIndex && params.optionsToDisplay?.length) {
        visualOpts = params.optionsToDisplay;
      } else {
        try {
          const questions = (quizSvc as any).shuffledQuestions?.length
            ? (quizSvc as any).shuffledQuestions
            : quizSvc.questions || [];
          const targetQ = questions[i0];
          if (targetQ?.options?.length) {
            visualOpts = targetQ.options;
          }
        } catch { }
      }

      if (!visualOpts?.length && params.options?.length) visualOpts = params.options;
      if (!visualOpts?.length && q.options?.length) visualOpts = q.options;

      if (!visualOpts?.length && quizSvc) {
        try {
          const fetchedOpts = await firstValueFrom(quizSvc.getOptions(i0));
          if (fetchedOpts?.length) visualOpts = fetchedOpts;
        } catch { }
      }

      const correctIndices = svc.getCorrectOptionIndices(q, visualOpts, i0);

      if (correctIndices.length > 0) {
        formatted = typeof svc.formatExplanation === 'function'
          ? svc.formatExplanation(q, correctIndices, baseRaw, i0)
          : (baseRaw.includes('correct because') ? baseRaw : `Option ${correctIndices[0]} is correct because ${baseRaw}`);
      } else {
        const findCorrect = visualOpts
          .map((opt, idx) => (opt.correct === true || (opt as any).correct === 'true' ? idx + 1 : null))
          .filter((n): n is number => n !== null);

        if (findCorrect.length > 0) {
          formatted = svc.formatExplanation(q, findCorrect, baseRaw, i0);
        } else {
          formatted = baseRaw;
        }
      }
    } catch (e) {
      console.warn('[updateExplanationText] formatter threw; using raw', e);
      formatted = baseRaw;
    }

    const clean = (formatted ?? '').trim();

    // Step 3: Cache
    try {
      svc.formattedExplanations[i0] = {
        questionIndex: i0,
        explanation: clean || baseRaw,
      };
      if (typeof (svc as any).fetByIndex?.set === 'function') {
        (svc as any).fetByIndex.set(i0, clean || baseRaw);
      }
    } catch { }

    // Step 4: Emit only if we're still on this index
    const nextText = (clean || baseRaw).trim();
    if (!nextText) return clean || baseRaw;

    const stillActive = i0 === params.currentQuestionIndex;

    if (stillActive) {
      svc.setExplanationText(nextText, { index: i0 });
      svc.setShouldDisplayExplanation(true);
      svc.latestExplanation = nextText;
    }

    return nextText;
  }

  /**
   * Displays explanation text in the service and quiz state.
   */
  displayExplanationText(
    explanationText: string,
    lastAllCorrect: boolean
  ): void {
    this.explanationTextService.setExplanationText(explanationText);
    this.explanationTextService.setShouldDisplayExplanation(true);

    this.quizStateService.setDisplayState({
      mode: lastAllCorrect ? 'explanation' : 'question',
      answered: true
    });
  }

  /**
   * Validates and emits explanation text if the question index matches.
   */
  emitExplanationIfValid(
    explanationText: string,
    questionIndex: number,
    currentIndex: number
  ): boolean {
    if (currentIndex !== questionIndex) {
      console.warn(`[Explanation index mismatch]`, { currentIndex, questionIndex });
      return false;
    }

    this.explanationTextService.setExplanationText(explanationText);
    this.explanationTextService.setShouldDisplayExplanation(true);

    this.quizStateService.setDisplayState({
      mode: 'explanation',
      answered: true,
    });

    return true;
  }

  /**
   * Handles the formatted explanation result.
   */
  handleFormattedExplanation(
    formattedExplanation: FormattedExplanation,
    isAnswered: boolean,
    shouldDisplayExplanation: boolean
  ): { explanationToDisplay: string; shouldEmit: boolean } {
    if (!formattedExplanation) {
      console.error('Error: formatExplanationText returned void');
      return { explanationToDisplay: '', shouldEmit: false };
    }

    const explanationText =
      typeof formattedExplanation === 'string'
        ? formattedExplanation
        : formattedExplanation.explanation || 'No explanation available';

    return {
      explanationToDisplay: explanationText,
      shouldEmit: isAnswered && shouldDisplayExplanation
    };
  }

  /**
   * Updates explanation UI after question rendering.
   */
  async updateExplanationUI(params: {
    questionIndex: number;
    explanationText: string;
    questionsArray: QuizQuestion[];
    shouldDisplayExplanation: boolean;
    isAnyOptionSelected: (idx: number) => Promise<boolean>;
    updateCombinedQuestionData: (q: QuizQuestion, text: string) => void;
  }): Promise<{
    explanationToDisplay: string;
    shouldEmit: boolean;
  } | null> {
    if (!params.questionsArray || params.questionsArray.length === 0) {
      console.warn('Questions not loaded yet. Skipping explanation update.');
      return null;
    }

    const adjustedIndex = Math.max(
      0,
      Math.min(params.questionIndex, params.questionsArray.length - 1)
    );
    const currentQuestion = params.questionsArray[adjustedIndex];

    if (!currentQuestion) {
      console.error(`Question not found at index: ${adjustedIndex}`);
      return null;
    }

    this.quizService.setCurrentQuestion(currentQuestion);

    // Wait for rendering
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (
      params.shouldDisplayExplanation &&
      await params.isAnyOptionSelected(adjustedIndex)
    ) {
      params.updateCombinedQuestionData(currentQuestion, params.explanationText);
      return {
        explanationToDisplay: params.explanationText,
        shouldEmit: true,
      };
    }

    return null;
  }

  /**
   * Handles explanation display update based on shouldDisplay flag.
   * Returns the state changes for the component to apply.
   */
  async handleExplanationDisplayUpdate(
    shouldDisplay: boolean,
    currentQuestionIndex: number
  ): Promise<{
    explanationToDisplay?: string;
    displayExplanation: boolean;
  }> {
    if (shouldDisplay) {
      this.explanationTextService.setResetComplete(true);
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.explanationTextService.lockExplanation();

      try {
        let explanationText = 'No explanation available';

        if (this.explanationTextService.explanationsInitialized) {
          const fetched = await firstValueFrom(
            this.explanationTextService.getFormattedExplanationTextForQuestion(
              currentQuestionIndex
            )
          );
          explanationText = fetched?.trim() || explanationText;
        }

        this.explanationTextService.setExplanationText(explanationText);

        return {
          explanationToDisplay: explanationText,
          displayExplanation: true,
        };
      } catch (error) {
        console.error('[updateExplanationDisplay] Error fetching explanation:', error);
        return {
          explanationToDisplay: 'Error loading explanation.',
          displayExplanation: true,
        };
      }
    } else {
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setExplanationText('');
        this.explanationTextService.setResetComplete(false);
        this.explanationTextService.setShouldDisplayExplanation(false);
        return {
          explanationToDisplay: '',
          displayExplanation: false,
        };
      }
      return { displayExplanation: false };
    }
  }

  /**
   * Computes the display-state flags for transitioning to explanation mode.
   * Returns null if the transition should be skipped.
   */
  computeExplanationModeTransition(
    shouldDisplayExplanation: boolean,
    currentDisplayMode: 'question' | 'explanation'
  ): {
    displayState: { mode: 'question' | 'explanation'; answered: boolean };
    displayMode: 'explanation';
    explanationFlags: {
      shouldDisplayExplanation: true;
      explanationVisible: true;
      isExplanationTextDisplayed: true;
      forceQuestionDisplay: false;
      readyForExplanationDisplay: true;
      isExplanationReady: true;
      isExplanationLocked: false;
    };
  } | null {
    const isAnswered = this.selectedOptionService.isAnsweredSubject.getValue();

    if (!isAnswered || !shouldDisplayExplanation) return null;
    if (currentDisplayMode === 'explanation') return null;

    return {
      displayState: { mode: 'explanation', answered: isAnswered },
      displayMode: 'explanation',
      explanationFlags: {
        shouldDisplayExplanation: true,
        explanationVisible: true,
        isExplanationTextDisplayed: true,
        forceQuestionDisplay: false,
        readyForExplanationDisplay: true,
        isExplanationReady: true,
        isExplanationLocked: false,
      },
    };
  }

  /**
   * Resets explanation state (service-level).
   * Returns whether the reset was blocked by a lock.
   */
  resetExplanation(
    force: boolean,
    fixedQuestionIndex: number,
    currentQuestionIndex: number
  ): boolean {
    this.explanationTextService.resetExplanationText();

    const qIndex = fixedQuestionIndex ?? currentQuestionIndex ?? 0;
    const locked = this.explanationTextService.isExplanationLocked?.();
    if (!force && locked) {
      console.log('[resetExplanation] Blocked — lock is active.', { qIndex });
      return true; // blocked
    }

    this.explanationTextService.setShouldDisplayExplanation(false);

    this.quizStateService.setDisplayState({
      mode: 'question',
      answered: false,
    });
    this.quizStateService.setAnswerSelected(false);

    this.explanationTextService.setResetComplete?.(true);

    return false; // not blocked
  }

  /**
   * Marks explanation as answered/displayed in quiz state.
   */
  markExplanationDisplayed(
    quizId: string,
    questionIndex: number,
    lastAllCorrect: boolean
  ): void {
    this.quizStateService.setDisplayState({
      mode: lastAllCorrect ? 'explanation' : 'question',
      answered: true,
    });
  }

  /**
   * Handles error state for explanation fetching.
   */
  handleExplanationError(): string {
    return 'Error fetching explanation. Please try again.';
  }

  /**
   * Manages the full explanation display lifecycle for a question.
   * Fetches question data, processes explanation, updates state, returns values for component.
   */
  async manageExplanationDisplay(params: {
    currentQuestionIndex: number;
    quizId: string;
    lastAllCorrect: boolean;
  }): Promise<{
    explanationToDisplay: string;
    displayExplanation: boolean;
    explanationText?: string;
    questionState?: QuestionState;
  }> {
    const { currentQuestionIndex, quizId, lastAllCorrect } = params;

    try {
      if (currentQuestionIndex === null || currentQuestionIndex === undefined) {
        throw new Error('Current question index is not set');
      }

      const questionData: any = await firstValueFrom(
        this.quizService.getQuestionByIndex(currentQuestionIndex)
      );

      if (!this.quizQuestionManagerService.isValidQuestionData(questionData!)) {
        throw new Error('Invalid question data');
      }

      let explanationText =
        questionData?.explanation ?? 'No explanation available';

      const processedExplanation = await this.explanationManager.processExplanationText(
        questionData!,
        currentQuestionIndex
      );

      if (processedExplanation && processedExplanation.explanation) {
        explanationText = processedExplanation.explanation;
      }

      // Update service state
      this.explanationTextService.updateFormattedExplanation(explanationText);
      this.explanationTextService.setResetComplete(true);
      this.explanationTextService.setShouldDisplayExplanation(lastAllCorrect);
      if (lastAllCorrect) {
        this.explanationTextService.lockExplanation();
      }

      // Update quiz state
      const questionState = this.quizStateService.getQuestionState(
        quizId,
        currentQuestionIndex
      );
      if (questionState) {
        questionState.explanationText = explanationText;
        questionState.explanationDisplayed = true;
        this.quizStateService.setQuestionState(
          quizId,
          currentQuestionIndex,
          questionState
        );
      }

      return {
        explanationToDisplay: explanationText,
        displayExplanation: true,
        explanationText,
        questionState,
      };
    } catch (error) {
      console.error('Error managing explanation display:', error);

      // Ensure flags are always set
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setResetComplete(true);
        this.explanationTextService.setShouldDisplayExplanation(true);
        this.explanationTextService.lockExplanation();
      }

      return {
        explanationToDisplay: 'Error loading explanation. Please try again.',
        displayExplanation: true,
      };
    }
  }

  /**
   * Handles question data to determine if explanation should be shown.
   * Returns the explanation text and display flags.
   */
  async handleQuestionData(params: {
    questionsArray: QuizQuestion[];
    questionIndex: number;
    quizId: string;
    shouldDisplayExplanation: boolean;
    getExplanationText: (idx: number) => Promise<string>;
  }): Promise<{
    explanationText: string;
    shouldShowExplanation: boolean;
  }> {
    const { questionsArray, questionIndex, quizId, shouldDisplayExplanation, getExplanationText } = params;

    if (!questionsArray || questionsArray.length === 0) {
      console.warn('[handleQuestionData] Questions array is not initialized or empty.');
      return { explanationText: '', shouldShowExplanation: false };
    }

    if (questionIndex < 0 || questionIndex >= questionsArray.length) {
      console.error(`[handleQuestionData] Invalid questionIndex: ${questionIndex}`);
      return { explanationText: '', shouldShowExplanation: false };
    }

    const questionState = this.quizStateService.getQuestionState(quizId, questionIndex);
    const isAnswered = questionState?.isAnswered;
    const shouldShow = isAnswered && shouldDisplayExplanation;

    if (shouldShow) {
      try {
        const explanationText = await getExplanationText(questionIndex);

        this.explanationTextService.setResetComplete(true);
        this.explanationTextService.setExplanationText(explanationText);
        this.explanationTextService.setShouldDisplayExplanation(true);
        this.explanationTextService.lockExplanation();

        return { explanationText, shouldShowExplanation: true };
      } catch (error) {
        console.error('[handleQuestionData] Error fetching explanation text:', error);
        return { explanationText: 'Error loading explanation.', shouldShowExplanation: true };
      }
    } else {
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setExplanationText('');
        this.explanationTextService.setShouldDisplayExplanation(false);
        this.explanationTextService.setResetComplete(false);
      }
      return { explanationText: '', shouldShowExplanation: false };
    }
  }

  /**
   * Restores explanation state after a navigation reset.
   * Handles service-level state and quiz state updates, returns display flags for component.
   */
  restoreExplanationAfterReset(params: {
    questionIndex: number;
    explanationText: string;
    questionState?: QuestionState;
    quizId: string | null;
  }): {
    explanationToDisplay: string;
    displayMode: 'explanation';
    displayState: { mode: 'explanation'; answered: true };
    forceQuestionDisplay: false;
    readyForExplanationDisplay: true;
    isExplanationReady: true;
    isExplanationLocked: false;
    explanationLocked: true;
    explanationVisible: true;
    displayExplanation: true;
    shouldDisplayExplanation: true;
    isExplanationTextDisplayed: true;
  } | null {
    const normalized = (params.explanationText ?? '').trim();
    if (!normalized) return null;

    // Service-level state
    this.explanationTextService.setExplanationText(normalized);
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.explanationTextService.setResetComplete(true);
    this.explanationTextService.lockExplanation();

    // Quiz state update
    if (params.quizId && params.questionState) {
      params.questionState.isAnswered = true;
      params.questionState.explanationDisplayed = true;
      this.quizStateService.setQuestionState(
        params.quizId, params.questionIndex, params.questionState
      );
    }

    return {
      explanationToDisplay: normalized,
      displayMode: 'explanation',
      displayState: { mode: 'explanation', answered: true },
      forceQuestionDisplay: false,
      readyForExplanationDisplay: true,
      isExplanationReady: true,
      isExplanationLocked: false,
      explanationLocked: true,
      explanationVisible: true,
      displayExplanation: true,
      shouldDisplayExplanation: true,
      isExplanationTextDisplayed: true,
    };
  }

  /**
   * Handles explanation display update with shouldDisplay flag.
   * Manages lock/unlock, fetches explanation text, returns state for component.
   */
  async performUpdateExplanationDisplay(params: {
    shouldDisplay: boolean;
    currentQuestionIndex: number;
  }): Promise<{
    explanationToDisplay: string;
    displayExplanation: boolean;
    shouldEmitExplanation: boolean;
    shouldResetQuestionState: boolean;
  }> {
    const { shouldDisplay, currentQuestionIndex } = params;

    if (shouldDisplay) {
      this.explanationTextService.setResetComplete(true);
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.explanationTextService.lockExplanation();

      try {
        let explanationText = 'No explanation available';

        if (this.explanationTextService.explanationsInitialized) {
          const fetched = await firstValueFrom(
            this.explanationTextService.getFormattedExplanationTextForQuestion(
              currentQuestionIndex
            )
          );
          explanationText = fetched?.trim() || explanationText;
        } else {
          console.warn(
            `[updateExplanationDisplay] Explanations not initialized for Q${currentQuestionIndex}`
          );
        }

        this.explanationTextService.setExplanationText(explanationText);

        return {
          explanationToDisplay: explanationText,
          displayExplanation: true,
          shouldEmitExplanation: true,
          shouldResetQuestionState: false,
        };
      } catch (error) {
        console.error('[updateExplanationDisplay] Error fetching explanation:', error);
        return {
          explanationToDisplay: 'Error loading explanation.',
          displayExplanation: true,
          shouldEmitExplanation: true,
          shouldResetQuestionState: false,
        };
      }
    } else {
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setExplanationText('');
        this.explanationTextService.setResetComplete(false);
        this.explanationTextService.setShouldDisplayExplanation(false);

        return {
          explanationToDisplay: '',
          displayExplanation: false,
          shouldEmitExplanation: true,
          shouldResetQuestionState: true,
        };
      } else {
        console.warn('[updateExplanationDisplay] Blocked reset — explanation is locked');
        return {
          explanationToDisplay: '',
          displayExplanation: false,
          shouldEmitExplanation: true,
          shouldResetQuestionState: false,
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FORMATTED EXPLANATION RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resolves and returns a formatted explanation text for a given question index.
   * Uses cache when available and falls back to the observable stream.
   * Preserves all original logic and comments from QQC.
   */
  async resolveFormatted(
    index: number,
    opts: { useCache?: boolean; setCache?: boolean; timeoutMs?: number } = {},
    context: {
      normalizeIndex: (idx: number) => number;
      formattedByIndex: Map<number, string>;
      questionsArray: QuizQuestion[];
      currentQuestionIndex: number;
      currentQuestion: QuizQuestion | null;
      optionsToDisplay: Option[];
      options: Option[];
    }
  ): Promise<string> {
    const i0 = context.normalizeIndex(index);
    const { useCache = true, setCache = true, timeoutMs = 1200 } = opts;

    if (useCache) {
      const hit = context.formattedByIndex.get(i0);
      if (hit) return hit;
    }

    let text = '';

    try {
      // ────────────────────────────────────────────────
      // Resolve the FET using the specific index i0
      // ────────────────────────────────────────────────

      // Try direct return first
      const out = await this.updateExplanationText({
        index: i0,
        normalizeIndex: context.normalizeIndex,
        questionsArray: context.questionsArray,
        currentQuestionIndex: context.currentQuestionIndex,
        currentQuestion: context.currentQuestion,
        optionsToDisplay: context.optionsToDisplay,
        options: context.options,
      });
      text = (out ?? '').toString().trim();

      // ────────────────────────────────────────────────
      // Fallback: formatter writes to a stream
      // ────────────────────────────────────────────────
      if ((!text || text === 'No explanation available for this question.') &&
        this.explanationTextService.formattedExplanation$) {

        const src$ = this.explanationTextService.formattedExplanation$ as Observable<string | null | undefined>;

        const formatted$: Observable<string> = src$.pipe(
          filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0),
          map(s => s.trim()),
          timeout(timeoutMs),
          take(1)
        );

        try {
          text = await firstValueFrom(formatted$);
        } catch {
          text = '';
        }
      }

      // ────────────────────────────────────────────────
      // Final check — only emit real explanation text
      // ────────────────────────────────────────────────
      if (!text || text === 'No explanation available for this question.') {
        console.log(`[QQC] 💤 Explanation not ready for Q${i0 + 1} — skipping emit.`);
        return '';
      }

      if (text && setCache) context.formattedByIndex.set(i0, text);
      return text;
    } catch (err) {
      console.warn('[resolveFormatted] failed', i0, err);
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PREPARE AND SET EXPLANATION TEXT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Prepares and sets explanation text for a given question index.
   * Returns the explanation text string.
   * Preserves all original logic and comments from QQC.
   */
  async prepareAndSetExplanationText(
    questionIndex: number,
    context: {
      processExplanationText: (q: QuizQuestion, idx: number) => Promise<FormattedExplanation | null>;
    }
  ): Promise<string> {
    if (typeof document !== 'undefined' && document.hidden) {
      return 'Explanation text not available when document is hidden.';
    }

    try {
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );

      if (this.quizQuestionManagerService.isValidQuestionData(questionData!)) {
        const formattedExplanationObservable =
          this.explanationTextService.getFormattedExplanation(questionIndex);

        try {
          const formattedExplanation = await Promise.race([
            firstValueFrom(formattedExplanationObservable),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            ),
          ]);

          if (formattedExplanation) {
            return formattedExplanation as string;
          } else {
            const processedExplanation = await context.processExplanationText(
              questionData!,
              questionIndex
            );

            if (processedExplanation) {
              this.explanationTextService.updateFormattedExplanation(
                processedExplanation.explanation
              );
              return processedExplanation.explanation;
            } else {
              return 'No explanation available...';
            }
          }
        } catch (timeoutError) {
          console.error(
            'Timeout while fetching formatted explanation:',
            timeoutError
          );
          return 'Explanation text unavailable at the moment.';
        }
      } else {
        console.error('Error: questionData is invalid');
        return 'No explanation available.';
      }
    } catch (error) {
      console.error('Error in fetching explanation text:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      return 'Error fetching explanation.';
    }
  }
}
