import { Injectable, NgZone } from '@angular/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { Option } from '../../models/Option.model';
import { Quiz } from '../../models/Quiz.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { QuestionType } from '../../models/question-type.enum';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { QuizStateService } from '../state/quizstate.service';
import { ExplanationTextService } from '../features/explanation/explanation-text.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from '../features/selection-message/selection-message.service';
import { QuizQuestionDataService } from './quiz-question-data.service';
import { QuizQuestionLoaderService } from './quizquestionloader.service';
import { QuizScoringService } from './quiz-scoring.service';

/**
 * Result from fetchAndSetQuestionData preparation.
 */
export interface FetchQuestionResult {
  success: boolean;
  question: QuizQuestion | null;
  currentQuestion: QuizQuestion | null;
  trimmedText: string;
  clonedOptions: Option[];
  finalOptions: Option[];
  explanationText: string;
  isAnswered: boolean;
  questionPayload: QuestionPayload | null;
  shouldStartTimer: boolean;
}

/**
 * Result from loadQuestionByRouteIndex preparation.
 */
export interface RouteQuestionResult {
  success: boolean;
  question: QuizQuestion | null;
  questionText: string;
  optionsWithIds: Option[];
  questionIndex: number;
  totalCount: number;
}

/**
 * Result from syncQuestionSnapshotFromSession.
 */
export interface SessionSnapshotResult {
  isEmpty: boolean;
  normalizedIndex: number;
  question: QuizQuestion | null;
  trimmedQuestionText: string;
  normalizedOptions: Option[];
  trimmedExplanation: string;
}

/**
 * Result from updateQuestionStateAndExplanation.
 */
export interface QuestionStateResult {
  handled: boolean;
  explanationText: string;
  showExplanation: boolean;
  shouldLockExplanation: boolean;
  shouldDisableExplanation: boolean;
}

/**
 * Result from loadQuestionFromRouteChange.
 */
export interface RouteChangeQuestionResult {
  success: boolean;
  question: QuizQuestion | null;
  options: Option[];
  explanation: string;
  totalQuestions: number;
  hasValidSelections: boolean;
}

/**
 * Handles heavy data-fetching and preparation logic for quiz questions.
 * Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizContentLoaderService {

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService,
    private quizQuestionDataService: QuizQuestionDataService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizScoringService: QuizScoringService,
    private ngZone: NgZone
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // FET (Formatted Explanation Text) GATE CONTROL
  // ═══════════════════════════════════════════════════════════════

  /**
   * Locks FET gate and purges any deferred FET emissions for the
   * incoming question index. Safe to call before navigation.
   */
  lockAndPurgeFet(adjustedIndex: number): void {
    const ets = this.explanationTextService;
    try {
      ets._fetLocked = true;
      ets.purgeAndDefer(adjustedIndex);
    } catch (error: any) {
      console.warn('[lockAndPurgeFet] failed', error);
    }
  }

  /**
   * Resets visible explanation state to empty/hidden and unlocks the
   * explanation lock so the next question's text can be set fresh.
   */
  resetDisplayExplanationText(currentQuestionIndex: number): void {
    const ets = this.explanationTextService;
    ets.unlockExplanation();
    ets.setExplanationText('', { force: true, index: currentQuestionIndex });
    ets.setShouldDisplayExplanation(false, { force: true });
    ets.setIsExplanationTextDisplayed(false, { force: true });
  }

  /**
   * Re-closes the FET gate, then unlocks it after Angular has stabilized
   * (waits for ngZone.onStable + rAF + 100ms tail) only if the index is
   * still current. Caller passes a getter for the live index.
   */
  unlockFetGateAfterRender(
    adjustedIndex: number,
    getCurrentIndex: () => number,
    detectChanges: () => void
  ): void {
    const ets = this.explanationTextService;
    ets._fetLocked = true;
    ets.setShouldDisplayExplanation(false);
    ets.setIsExplanationTextDisplayed(false);
    ets.latestExplanation = '';

    setTimeout(() => {
      detectChanges();
      this.ngZone.onStable.pipe(take(1)).subscribe(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const stillCurrent =
              ets._gateToken === ets._currentGateToken &&
              adjustedIndex === getCurrentIndex();
            if (!stillCurrent) return;
            ets._fetLocked = false;
          }, 100);
        });
      });
    }, 140);
  }


  // ═══════════════════════════════════════════════════════════════
  // OPTION / DOM RESETS FOR QUESTION TRANSITION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Clears transient option flags (selected/highlight/showFeedback/showIcon)
   * across all loaded questions. Used when navigating to a new index.
   */
  clearAllOptionStates(): void {
    try {
      for (const q of this.quizService.questions ?? []) {
        for (const o of q.options ?? []) {
          o.selected = false;
          o.highlight = false;
          o.showFeedback = false;
          o.showIcon = false;
        }
      }
    } catch (error: any) {
      console.warn('[clearAllOptionStates] failed', error);
    }
  }

  /**
   * Re-enables pointer events on all option buttons in the DOM,
   * undoing any prior pointerEvents='none' lock.
   */
  enableAllOptionPointerEvents(): void {
    for (const btn of Array.from(
      document.querySelectorAll('.option-button,.mat-radio-button,.mat-checkbox')
    )) {
      (btn as HTMLElement).style.pointerEvents = 'auto';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION INDEX TRANSITION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handles service-level state transitions when the question index changes.
   * Returns the question for the new index (if found) for the component to assign.
   */
  handleQuestionIndexTransition(params: {
    idx: number;
    prevIdx: number | null;
    quizId: string;
    questionsArray: QuizQuestion[];
  }): { question: QuizQuestion | null; isNavigation: boolean } {
    const { idx, prevIdx, quizId } = params;
    const ets = this.explanationTextService;

    // Clear FET belonging to the previous question
    if (prevIdx !== null && prevIdx !== idx) {
      if (ets.latestExplanationIndex === prevIdx) {
        ets.latestExplanation = '';
        ets.latestExplanationIndex = null;
        ets.formattedExplanationSubject.next('');
        ets.shouldDisplayExplanationSource.next(false);
        ets.setIsExplanationTextDisplayed(false);
      }
    }

    // Hard reset question state flags
    const qState =
      quizId && Number.isFinite(idx)
        ? this.quizStateService.getQuestionState?.(quizId, idx)
        : null;
    if (qState) {
      qState.explanationDisplayed = false;
      qState.explanationText = '';
    }

    // Update ETS tracking
    ets._activeIndex = idx;
    ets.latestExplanationIndex = idx;
    ets._fetLocked = false;

    // Sync question from array
    const question = params.questionsArray[idx] ?? null;
    if (question) {
      this.quizStateService.updateCurrentQuestion(question);
      this.quizService.updateCurrentQuestion(question);
    }

    // Reset display mode on navigation
    const isNavigation = prevIdx !== null && prevIdx !== idx;
    if (isNavigation) {
      this.quizStateService.displayStateSubject.next({
        mode: 'question',
        answered: false
      });
    }

    return { question, isNavigation };
  }

  // ═══════════════════════════════════════════════════════════════
  // LOAD QUESTION FROM ROUTE CHANGE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handles the heavy lifting when route params change: fetches quiz meta,
   * loads question + options via loader service, resolves effective question
   * (accounting for shuffle), and checks for existing selections.
   */
  async loadQuestionFromRouteChange(params: {
    quizId: string;
    index: number;
  }): Promise<RouteChangeQuestionResult> {
    const { quizId, index } = params;
    const empty: RouteChangeQuestionResult = {
      success: false, question: null, options: [], explanation: '',
      totalQuestions: 0, hasValidSelections: false,
    };

    const currentQuiz: Quiz = await firstValueFrom(
      this.quizDataService.getQuiz(quizId).pipe(
        filter((q): q is Quiz => !!q && Array.isArray(q.questions)),
        take(1)
      )
    );
    if (!currentQuiz) return empty;

    // Only call setCurrentQuiz when switching quizzes — calling it on every
    // question navigation triggers questionsSubject emissions that cascade
    // into clearing shuffledQuestions, breaking shuffled mode for Q2+.
    const isSameQuiz = this.quizService.quizId === quizId
      || this.quizService.getCurrentQuizId() === quizId;
    if (!isSameQuiz) {
      this.quizService.setCurrentQuiz(currentQuiz);
    }
    this.quizQuestionLoaderService.activeQuizId = quizId;
    const totalQ = currentQuiz.questions?.length ?? 0;
    this.quizQuestionLoaderService.totalQuestions = totalQ;

    // Snapshot shuffled questions BEFORE any async operations that might
    // clear them through side-effects.
    const shuffledSnapshot = this.quizService.isShuffleEnabled()
      ? [...(this.quizService.shuffledQuestions ?? [])]
      : null;

    await this.quizQuestionLoaderService.loadQuestionAndOptions(index);
    await this.quizQuestionLoaderService.loadQA(index);

    // Restore shuffledQuestions if they were cleared during async operations
    if (shuffledSnapshot && shuffledSnapshot.length > 0
        && (!this.quizService.shuffledQuestions || this.quizService.shuffledQuestions.length === 0)) {
      console.warn('[loadQuestionFromRouteChange] Restoring shuffledQuestions that were cleared during async load');
      this.quizService.shuffledQuestions = shuffledSnapshot;
    }

    const shouldUseShuffled =
      this.quizService.isShuffleEnabled() &&
      this.quizService.shuffledQuestions?.length > 0;
    const effectiveQuestions = shouldUseShuffled
      ? this.quizService.shuffledQuestions : currentQuiz.questions;
    const question = effectiveQuestions?.[index] ?? null;
    if (!question) return empty;

    this.quizQuestionLoaderService.resetHeadlineStreams(index);
    this.quizService.updateCurrentQuestion(question);

    const options = question.options ?? [];
    const explanation = question.explanation ?? '';

    const optionIdSet = new Set(
      options.map((opt) => opt.optionId).filter((id): id is number => typeof id === 'number')
    );
    const validSelections =
      (this.selectedOptionService.getSelectedOptionsForQuestion(index) ?? [])
        .filter((opt) => optionIdSet.has(opt.optionId ?? -1));

    return {
      success: true,
      question,
      options,
      explanation,
      totalQuestions: totalQ,
      hasValidSelections: validSelections.length > 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FETCH AND SET QUESTION DATA
  // ═══════════════════════════════════════════════════════════════

  async fetchAndPrepareQuestion(params: {
    questionIndex: number;
    totalQuestions: number;
    quizId: string;
  }): Promise<FetchQuestionResult> {
    const { questionIndex, totalQuestions, quizId } = params;
    const empty: FetchQuestionResult = {
      success: false,
      question: null,
      currentQuestion: null,
      trimmedText: '',
      clonedOptions: [],
      finalOptions: [],
      explanationText: '',
      isAnswered: false,
      questionPayload: null,
      shouldStartTimer: false,
    };

    try {
      // Safety Checks
      if (isNaN(questionIndex) || questionIndex < 0 || questionIndex >= totalQuestions) {
        console.warn(`[Invalid index: Q${questionIndex}]`);
        return empty;
      }

      // Restore persistency from storage if service is empty
      this.restoreSessionSelections(questionIndex);

      // Parallel fetch for question and options
      const [fetchedQuestion, fetchedOptions] = await Promise.all([
        this.quizQuestionDataService.fetchQuestionDetails(questionIndex),
        firstValueFrom(
          this.quizService.getCurrentOptions(questionIndex).pipe(take(1))
        )
      ]);

      // Validate
      if (
        !fetchedQuestion ||
        !fetchedQuestion.questionText?.trim() ||
        !Array.isArray(fetchedOptions) ||
        fetchedOptions.length === 0
      ) {
        console.error(`[Q${questionIndex}] Missing question or options`);
        return empty;
      }

      // Reset explanation state
      this.explanationTextService.setResetComplete(false);
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.explanationTextService.explanationText$.next('');

      const trimmedText = (fetchedQuestion?.questionText ?? '').trim() || 'No question available';

      // Hydrate and clone options
      const hydratedOptions = fetchedOptions.map((opt, idx) => ({
        ...opt,
        optionId: opt.optionId ?? idx,
        correct: opt.correct ?? false,
        feedback: opt.feedback ?? `The correct options are: ${opt.text}`
      }));

      const finalOptions = this.quizService.assignOptionActiveStates(hydratedOptions, false);
      const clonedOptions = structuredClone?.(finalOptions) ?? JSON.parse(JSON.stringify(finalOptions));

      // Evaluate answered state
      const quizIdForState = quizId || this.quizService.quizId || 'default-quiz';
      const questionState = this.quizStateService.getQuestionState(quizIdForState, questionIndex);
      const optionIdSet = new Set(
        clonedOptions
          .map((opt: Option) => opt.optionId)
          .filter((id: any): id is number => typeof id === 'number')
      );
      const selectedOptions = this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex);
      const validSelections = (selectedOptions ?? []).filter((opt) =>
        optionIdSet.has(opt.optionId ?? -1)
      );

      let isAnswered = validSelections.length > 0;
      if (!isAnswered && questionState?.isAnswered) {
        this.quizStateService.setQuestionState(quizIdForState, questionIndex, {
          ...questionState,
          isAnswered: false,
          explanationDisplayed: false
        });
        this.selectedOptionService.clearSelectionsForQuestion(questionIndex);
        this.selectedOptionService.setAnswered(false, true);
      }

      if (isAnswered) {
        this.quizStateService.setAnswered(true);
        this.selectedOptionService.setAnswered(true, true);
      } else {
        this.quizStateService.setAnswered(false);
        this.selectedOptionService.setAnswered(false, true);
      }

      this.quizStateService.setDisplayState({
        mode: isAnswered ? 'explanation' : 'question',
        answered: isAnswered
      });

      // Build question object
      const question: QuizQuestion = {
        questionText: fetchedQuestion.questionText,
        explanation: fetchedQuestion.explanation ?? '',
        options: clonedOptions,
        type: fetchedQuestion.type ?? QuestionType.SingleAnswer
      };
      const currentQuestion = { ...question };

      // Emit Q+A
      this.quizService.emitQuestionAndOptions(currentQuestion, clonedOptions, questionIndex);

      this.quizService.questionPayloadSubject.next({
        question: currentQuestion,
        options: clonedOptions,
        explanation: currentQuestion.explanation ?? ''
      });

      this.quizStateService.qaSubject.next({
        question: currentQuestion,
        options: structuredClone(clonedOptions),
        explanation: currentQuestion.explanation ?? '',
        quizId: this.quizService.quizId ?? 'default-id',
        index: questionIndex,
        heading: currentQuestion.questionText ?? 'Untitled Question',
        selectionMessage: this.selectionMessageService.getCurrentMessage()
      });

      // Explanation/Timer logic
      let explanationText = '';
      const shouldStartTimer = !isAnswered;

      if (isAnswered) {
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(
          fetchedQuestion,
          finalOptions,
          questionIndex
        );
        const rawExplanation = fetchedQuestion.explanation?.trim() || 'No explanation available';
        explanationText = this.explanationTextService.formatExplanation(
          fetchedQuestion,
          correctIndices,
          rawExplanation
        );

        this.explanationTextService.storeFormattedExplanation(
          questionIndex,
          explanationText,
          fetchedQuestion,
          finalOptions,
          true
        );
        this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
      } else {
        this.selectionMessageService.forceBaseline(questionIndex);
        await this.selectionMessageService.setSelectionMessage(false);
      }

      // Set service state
      this.quizService.setCurrentQuestion(currentQuestion);
      this.quizService.setCurrentQuestionIndex(questionIndex);
      this.quizStateService.updateCurrentQuestion(currentQuestion);

      // Fresh-start guard
      const liveSelections = this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex) ?? [];
      const hasUserAnswersForQuestion =
        Array.isArray(this.quizService.userAnswers?.[questionIndex]) &&
        this.quizService.userAnswers[questionIndex].length > 0;
      const savedIndexRaw = localStorage.getItem('savedQuestionIndex');
      const isFreshStartAtQ1 =
        questionIndex === 0 &&
        this.quizService.questionCorrectness.size === 0 &&
        (savedIndexRaw == null || String(savedIndexRaw).trim() === '0');

      if (isFreshStartAtQ1 && liveSelections.length === 0 && !hasUserAnswersForQuestion) {
        this.quizService.questionCorrectness.delete(questionIndex);
        this.quizService.sendCorrectCountToResults(0);
      } else {
        await this.quizService.checkIfAnsweredCorrectly(questionIndex, false);
      }

      const questionPayload: QuestionPayload = {
        question: currentQuestion,
        options: clonedOptions,
        explanation: explanationText
      };

      return {
        success: true,
        question,
        currentQuestion,
        trimmedText,
        clonedOptions,
        finalOptions,
        explanationText,
        isAnswered,
        questionPayload,
        shouldStartTimer,
      };
    } catch (error: any) {
      console.error(`[fetchAndSetQuestionData] Error at Q${questionIndex}:`, error);
      return empty;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOAD QUESTION BY ROUTE INDEX
  // ═══════════════════════════════════════════════════════════════

  async loadQuestionByRoute(params: {
    routeIndex: number;
    quiz: any;
    quizId: string;
    totalQuestions: number;
  }): Promise<RouteQuestionResult> {
    const { routeIndex, quiz, quizId, totalQuestions } = params;
    const empty: RouteQuestionResult = {
      success: false,
      question: null,
      questionText: '',
      optionsWithIds: [],
      questionIndex: 0,
      totalCount: 0,
    };

    if (!quiz || !quiz.questions) {
      console.error('[loadQuestionByRouteIndex] Quiz data is missing.');
      return empty;
    }

    if (isNaN(routeIndex) || routeIndex < 1 || routeIndex > quiz.questions.length) {
      console.warn('[loadQuestionByRouteIndex] Invalid route index:', routeIndex);
      return { ...empty, questionIndex: -1 }; // signal redirect needed
    }

    const questionIndex = routeIndex - 1;

    if (questionIndex < 0 || questionIndex >= quiz.questions.length) {
      console.error('[loadQuestionByRouteIndex] Question index out of bounds:', questionIndex);
      return empty;
    }

    // Set index + badge
    this.quizService.setCurrentQuestionIndex(questionIndex);

    const totalCount = totalQuestions > 0 ? totalQuestions : (quiz.questions?.length || 0);
    if (totalCount > 0 && questionIndex >= 0) {
      this.quizService.updateBadgeText(questionIndex + 1, totalCount);
    }

    // Fetch question (respects shuffle)
    const question = await firstValueFrom(this.quizService.getQuestionByIndex(questionIndex));

    if (!question) {
      console.error(`[loadQuestionByRouteIndex] Failed to load Q${questionIndex}`);
      return empty;
    }

    // Force-update explanation
    this.quizQuestionDataService.forceRegenerateExplanation(question, questionIndex);

    const questionText = question.questionText?.trim() ?? 'No question available';

    const optionsWithIds = this.quizService.assignOptionIds(
      question.options || [],
      questionIndex
    ).map((option, index) => ({
      ...option,
      feedback: 'Loading feedback...',
      showIcon: option.showIcon ?? false,
      active: option.active ?? true,
      selected: option.selected ?? false,
      correct: !!option.correct,
      optionId:
        typeof option.optionId === 'number' && !isNaN(option.optionId)
          ? option.optionId
          : index + 1
    }));

    return {
      success: true,
      question,
      questionText,
      optionsWithIds,
      questionIndex,
      totalCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SYNC QUESTION SNAPSHOT FROM SESSION
  // ═══════════════════════════════════════════════════════════════

  syncQuestionSnapshot(params: {
    hydratedQuestions: QuizQuestion[];
    currentQuestionIndex: number;
    previousIndex: number | null;
    serviceCurrentIndex: number | undefined;
  }): SessionSnapshotResult {
    const { hydratedQuestions } = params;
    const empty: SessionSnapshotResult = {
      isEmpty: true,
      normalizedIndex: 0,
      question: null,
      trimmedQuestionText: '',
      normalizedOptions: [],
      trimmedExplanation: '',
    };

    if (!Array.isArray(hydratedQuestions) || hydratedQuestions.length === 0) {
      return empty;
    }

    const candidateIndices: Array<number | null> = [
      Number.isInteger(params.serviceCurrentIndex) ? params.serviceCurrentIndex! : null,
      Number.isInteger(params.currentQuestionIndex) ? params.currentQuestionIndex : null,
      Number.isInteger(params.previousIndex) ? params.previousIndex : null,
    ];

    const resolvedIndex = candidateIndices.find(
      (value): value is number => typeof value === 'number'
    );

    const normalizedIndex = Math.min(
      Math.max(resolvedIndex ?? 0, 0),
      hydratedQuestions.length - 1
    );

    this.quizService.setCurrentQuestionIndex(normalizedIndex);

    const selectedQuestion = hydratedQuestions[normalizedIndex];
    if (!selectedQuestion) {
      return empty;
    }

    const normalizedOptions = this.quizService
      .assignOptionIds(selectedQuestion.options ?? [], normalizedIndex)
      .map((option) => ({
        ...option,
        correct: (option.correct as any) === true || (option.correct as any) === 'true',
        selected: option.selected ?? false,
        active: option.active ?? true,
        showIcon: option.showIcon ?? false
      }));

    const trimmedQuestionText = selectedQuestion.questionText?.trim() ?? 'No question available';
    const trimmedExplanation = (selectedQuestion.explanation ?? '').trim();

    // Use already-formatted FET (with "Option X is correct because...") if available.
    // Falling back to raw explanation only if no formatted version exists yet.
    // This prevents overwriting formatted FET that was populated by
    // initializeFormattedExplanations() in applyQuestionsFromSession().
    const formattedFet = this.explanationTextService.getFormattedSync(normalizedIndex);
    this.explanationTextService.setExplanationTextForQuestionIndex(
      normalizedIndex,
      formattedFet || trimmedExplanation
    );

    if (normalizedOptions.length > 0) {
      const clonedOptions = normalizedOptions.map((option) => ({ ...option }));
      this.quizService.setOptions(clonedOptions);
      this.quizService.emitQuestionAndOptions(selectedQuestion, clonedOptions, normalizedIndex);
    }

    return {
      isEmpty: false,
      normalizedIndex,
      question: selectedQuestion,
      trimmedQuestionText,
      normalizedOptions,
      trimmedExplanation,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE QUESTION STATE AND EXPLANATION
  // ═══════════════════════════════════════════════════════════════

  async evaluateQuestionStateAndExplanation(params: {
    quizId: string;
    questionIndex: number;
  }): Promise<QuestionStateResult> {
    const { quizId, questionIndex } = params;
    const noOp: QuestionStateResult = {
      handled: false,
      explanationText: '',
      showExplanation: false,
      shouldLockExplanation: false,
      shouldDisableExplanation: false,
    };

    const questionState = this.quizStateService.getQuestionState(quizId, questionIndex);
    if (!questionState) {
      return noOp;
    }

    if (!questionState.selectedOptions) {
      questionState.selectedOptions = [];
    }

    const hasUserSelected = (questionState.selectedOptions?.length ?? 0) > 0;
    if (!hasUserSelected) {
      return noOp;
    }

    const isAnswered = questionState.isAnswered;
    const explanationAlreadyDisplayed = questionState.explanationDisplayed;
    const shouldDisableExplanation = !isAnswered && !explanationAlreadyDisplayed;

    if (isAnswered || explanationAlreadyDisplayed) {
      let explanationText = '';

      if (Number.isFinite(questionIndex) && this.explanationTextService.explanationsInitialized) {
        const explanation$ = this.explanationTextService.getFormattedExplanationTextForQuestion(questionIndex);
        explanationText = (await firstValueFrom(explanation$)) ?? '';

        if (!explanationText?.trim()) {
          explanationText = 'No explanation available';
        }
      } else {
        explanationText = 'No explanation available';
      }

      this.explanationTextService.setExplanationText(explanationText, { index: questionIndex });
      this.explanationTextService.setResetComplete(true);
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.explanationTextService.lockExplanation();

      return {
        handled: true,
        explanationText,
        showExplanation: true,
        shouldLockExplanation: true,
        shouldDisableExplanation: false,
      };
    } else if (shouldDisableExplanation) {
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setResetComplete(false);
        this.explanationTextService.setExplanationText('', { index: questionIndex });
        this.explanationTextService.setShouldDisplayExplanation(false);
      }

      return {
        handled: true,
        explanationText: '',
        showExplanation: false,
        shouldLockExplanation: false,
        shouldDisableExplanation: true,
      };
    }

    return noOp;
  }

  // ═══════════════════════════════════════════════════════════════
  // SHOW EXPLANATION FOR QUESTION
  // ═══════════════════════════════════════════════════════════════

  prepareExplanationForQuestion(params: {
    qIdx: number;
    questionsArray: QuizQuestion[];
    quiz: any;
    currentQuestionIndex: number;
    currentQuestion: QuizQuestion | null;
  }): { explanationHtml: string; question: QuizQuestion | null } {
    const { qIdx, questionsArray, quiz, currentQuestionIndex, currentQuestion } = params;

    this.explanationTextService._activeIndex = qIdx;
    this.explanationTextService.latestExplanationIndex = qIdx;

    const question =
      questionsArray?.[qIdx] ??
      quiz?.questions?.[qIdx] ??
      (currentQuestionIndex === qIdx ? currentQuestion : null);

    if (!question) {
      const fallback = '<span class="muted">No explanation available</span>';
      this.explanationTextService.setExplanationText(fallback, { index: qIdx });
      this.explanationTextService.setShouldDisplayExplanation(true);
      return { explanationHtml: fallback, question: null };
    }

    const rawExpl = (question.explanation || 'No explanation available').trim();

    let formatted = this.explanationTextService.getFormattedSync(qIdx);
    console.log(`[prepareExplanation] Q${qIdx + 1} cached=${!!formatted}, cachedSnippet="${(formatted ?? '').slice(0, 60)}"`);
    if (!formatted) {
      // Use the robust multi-strategy method for correct option indices (1-based)
      // instead of raw optionId which may be 0-based or undefined
      const correctIndices = this.explanationTextService.getCorrectOptionIndices(
        question,
        question.options,
        qIdx
      );

      console.log(`[prepareExplanation] Q${qIdx + 1} correctIndices=${JSON.stringify(correctIndices)}, optionCorrectFlags=${JSON.stringify(question.options?.map((o: any, i: number) => ({ i: i+1, correct: o.correct })))}`);

      formatted = this.explanationTextService.formatExplanation(question, correctIndices, rawExpl);
      console.log(`[prepareExplanation] Q${qIdx + 1} formatted="${formatted?.slice(0, 80)}"`);
      this.explanationTextService.setExplanationTextForQuestionIndex(qIdx, formatted);
    }

    // Ensure explanationsInitialized is true so downstream paths (e.g.
    // performUpdateExplanationDisplay) don't skip the cache and fall back
    // to raw text, which would overwrite the formatted FET.
    this.explanationTextService.explanationsInitialized = true;

    this.explanationTextService.setExplanationText(formatted, { index: qIdx });
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });

    return { explanationHtml: formatted, question };
  }

  // ═══════════════════════════════════════════════════════════════
  // RESTORE SESSION SELECTIONS
  // ═══════════════════════════════════════════════════════════════

  private restoreSessionSelections(questionIndex: number): void {
    if (!this.selectedOptionService.isQuestionAnswered(questionIndex)) {
      const storedSel = sessionStorage.getItem(`quiz_selection_${questionIndex}`);
      if (storedSel) {
        try {
          const ids = JSON.parse(storedSel);
          if (Array.isArray(ids) && ids.length > 0) {
            ids.forEach((id: any) =>
              this.selectedOptionService.addSelectedOptionIndex(questionIndex, id));
            this.selectedOptionService.updateAnsweredState(
              this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex),
              questionIndex
            );
          }
        } catch (error: any) {
          console.error('Error restoring selections:', error);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RESTORE SELECTION STATE
  // ═══════════════════════════════════════════════════════════════

  restoreSelectionState(currentQuestionIndex: number): void {
    try {
      let selectedOptions = this.selectedOptionService.getSelectedOptionIndices(currentQuestionIndex);

      if (!selectedOptions || selectedOptions.length === 0) {
        const stored = sessionStorage.getItem(`quiz_selection_${currentQuestionIndex}`);
        if (stored) {
          try {
            const ids = JSON.parse(stored);
            if (Array.isArray(ids)) {
              selectedOptions = ids;
            }
          } catch (error: any) {
            console.error('[restoreSelectionState] Error parsing stored selections', error);
          }
        }
      }

      for (const optionId of selectedOptions) {
        this.selectedOptionService.addSelectedOptionIndex(currentQuestionIndex, optionId);
      }

      const questionOptions =
        this.selectedOptionService.selectedOptionsMap.get(currentQuestionIndex) || [];
      this.selectedOptionService.updateAnsweredState(questionOptions, currentQuestionIndex);
    } catch (error) {
      console.error('[restoreSelectionState] Unhandled error:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EMIT CORRECT ANSWERS BANNER
  // ═══════════════════════════════════════════════════════════════

  emitCorrectAnswersBanner(index: number, getNumberOfCorrectAnswersText: (numCorrect: number, totalOpts: number) => string): void {
    const fresh = this.quizService.questions?.[index];
    if (!fresh || !Array.isArray(fresh.options)) {
      return;
    }

    const isMulti =
      fresh.type === QuestionType.MultipleAnswer ||
      fresh.options.filter((o: Option) => o.correct === true).length > 1;
    (fresh as any).isMulti = isMulti;

    const numCorrect = fresh.options.filter((o: Option) => o.correct).length;
    const totalOpts = fresh.options.length;
    const banner = isMulti ? getNumberOfCorrectAnswersText(numCorrect, totalOpts) : '';

    this.quizService.updateCorrectAnswersText(banner);
  }

  // ═══════════════════════════════════════════════════════════════
  // PREPARE QUIZ SESSION
  // ═══════════════════════════════════════════════════════════════

  async prepareQuizSession(params: {
    quizId: string;
    applyQuestionsFromSession: (questions: QuizQuestion[]) => void;
  }): Promise<void> {
    try {
      const questions: QuizQuestion[] = await this.quizService.fetchQuizQuestions(params.quizId);
      params.applyQuestionsFromSession(questions);

      const storedStates = this.quizStateService.getStoredState(params.quizId);

      if (storedStates) {
        for (const [questionId, state] of storedStates.entries()) {
          this.quizStateService.setQuestionState(params.quizId, questionId, state);

          if (state.isAnswered && state.explanationDisplayed) {
            const restoredIndex = Number(questionId);
            const restoredQuestion = this.quizService.questions?.[restoredIndex];

            if (!restoredQuestion) {
              continue;
            }

            const rawExplanation = (restoredQuestion.explanation ?? '').trim();
            this.explanationTextService.storeFormattedExplanation(
              restoredIndex,
              rawExplanation,
              restoredQuestion,
              restoredQuestion.options,
              true
            );
          }
        }

        const firstQuestionState = storedStates.get(0);
        if (firstQuestionState && firstQuestionState.isAnswered) {
          this.explanationTextService.setResetComplete(true);
          this.explanationTextService.setShouldDisplayExplanation(true);
        }
      } else {
        this.quizStateService.applyDefaultStates(params.quizId, questions);
      }
    } catch (error: any) {
      console.error('Error in prepareQuizSession:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ADVANCE QUESTION (snapshot + nav prep)
  // ═══════════════════════════════════════════════════════════════

  snapshotLeavingQuestion(params: {
    leavingIdx: number;
    leavingDotClass: string;
    quizId: string;
    getScoringKey: (idx: number) => number;
  }): void {
    const { leavingIdx, leavingDotClass, quizId } = params;
    const leavingStatus: 'correct' | 'wrong' | null =
      leavingDotClass.includes('correct') ? 'correct' :
      leavingDotClass.includes('wrong') ? 'wrong' : null;

    if (leavingStatus) {
      const sk = params.getScoringKey(leavingIdx);
      if (leavingStatus === 'correct' && !this.quizService.questionCorrectness.get(sk)) {
        this.quizService.questionCorrectness.set(sk, true);
      }
      // Persist into localStorage and session
      try {
        const key = `dot_status_${quizId}_${leavingIdx}`;
        localStorage.setItem(key, leavingStatus);
      } catch {}
      this.selectedOptionService.clickConfirmedDotStatus.set(leavingIdx, leavingStatus);
      try { sessionStorage.setItem('dot_confirmed_' + leavingIdx, leavingStatus); } catch {}
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION DATA PIPELINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Creates a normalized QuestionPayload observable from quizService.questionPayload$.
   * The component subscribes and assigns fields from each emission.
   */
  createNormalizedQuestionPayload$(): Observable<QuestionPayload> {
    const fallbackQuestion: QuizQuestion = {
      questionText: 'No question available',
      type: QuestionType.SingleAnswer,
      explanation: '',
      options: []
    };

    const fallbackPayload: QuestionPayload = {
      question: fallbackQuestion,
      options: [],
      explanation: ''
    };

    return this.quizService.questionPayload$.pipe(
      map((payload) => {
        const baseQuestion = payload?.question ?? fallbackQuestion;
        const safeOptions = Array.isArray(payload?.options)
          ? payload.options.map((option: Option) => ({
            ...option,
            correct: option.correct ?? false
          }))
          : [];

        const explanation = (
          payload?.explanation ??
          baseQuestion.explanation ??
          ''
        ).trim();

        const normalizedQuestion: QuizQuestion = {
          ...baseQuestion,
          options: safeOptions,
          explanation
        };

        return {
          question: normalizedQuestion,
          options: safeOptions,
          explanation
        } as QuestionPayload;
      }),
      catchError((error: Error) => {
        console.error('[Error in createNormalizedQuestionPayload$]', error);
        return of(fallbackPayload);
      })
    );
  }

  /**
   * Resolves an explanation change event into a normalized { text, index } pair.
   * Returns null if the change should be suppressed (e.g., raw text trying to
   * overwrite a formatted FET).
   */
  resolveExplanationChange(
    explanation: string | any,
    index: number | undefined,
    currentExplanation: string
  ): { text: string; index: number | undefined } | null {
    let finalExplanation: string;
    let finalIndex = index;

    if (explanation && typeof explanation === 'object' && 'payload' in explanation) {
      finalExplanation = explanation.payload;
      finalIndex = ('index' in explanation) ? explanation.index : index;
    } else {
      finalExplanation = explanation;
    }

    if (!finalExplanation) return null;

    // Guard: Don't let non-formatted text overwrite an already-formatted FET
    const currentHasPrefix = currentExplanation?.toLowerCase().includes('correct because');
    const incomingHasPrefix = finalExplanation.toLowerCase().includes('correct because');
    if (currentHasPrefix && !incomingHasPrefix) return null;

    return { text: finalExplanation, index: finalIndex };
  }

  /**
   * Restores selected options from sessionStorage by marking matching options as selected.
   * Mutates the passed options array in place.
   */
  restoreSelectedOptionsFromSession(optionsToDisplay: Option[]): void {
    const selectedOptionsData = sessionStorage.getItem('selectedOptions');
    if (!selectedOptionsData) return;

    try {
      const selectedOptions = JSON.parse(selectedOptionsData);
      if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        console.warn('[restoreSelectedOptions] No valid selected options to restore.');
        return;
      }

      for (const option of selectedOptions) {
        const restoredOption = optionsToDisplay.find(
          opt => opt.optionId === option.optionId
        );

        if (restoredOption) {
          restoredOption.selected = true;
          console.log('[restoreSelectedOptions] Restored option as selected:', restoredOption);
        } else {
          console.warn('[restoreSelectedOptions] Option not found in optionsToDisplay:', option);
        }
      }
    } catch (error: any) {
      console.error('[restoreSelectedOptions] Error parsing selected options:', error);
    }
  }

  /**
   * Fetches a question and options from the API for a given quizId and questionIndex.
   * Returns the question with options having `correct` defaults applied.
   */
  async fetchQuestionFromAPI(
    quizId: string,
    questionIndex: number
  ): Promise<QuizQuestion | null> {
    if (!quizId || quizId.trim() === '') {
      console.error('Quiz ID is required but not provided.');
      return null;
    }

    try {
      const result = await firstValueFrom(
        of(
          this.quizDataService.fetchQuestionAndOptionsFromAPI(
            quizId,
            questionIndex
          )
        )
      );

      if (!result) {
        console.error('No valid question found');
        return null;
      }

      const [question, options] = result ?? [null, null];
      if (!question) return null;

      return {
        ...question,
        options: options?.map((option: Option) => ({
          ...option,
          correct: option.correct ?? false
        })) ?? question.options
      };
    } catch (error: any) {
      console.error('Error fetching question and options:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION HYDRATION PIPELINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Hydrates a set of questions from session data: scores, explanations,
   * formatted explanations, and deep-clones questions onto quiz/selectedQuiz.
   * Returns the hydrated array and deep-cloned question arrays for quiz and selectedQuiz.
   */
  hydrateQuestionsFromSession(params: {
    questions: QuizQuestion[];
    quiz: Quiz | null;
    selectedQuiz: Quiz | null;
  }): {
    hydratedQuestions: QuizQuestion[];
    quizQuestions: QuizQuestion[] | null;
    selectedQuizQuestions: QuizQuestion[] | null;
  } {
    const hydratedQuestions = this.quizScoringService.hydrateQuestionSet(params.questions);

    if (hydratedQuestions.length === 0) {
      this.explanationTextService.initializeExplanationTexts([]);
      this.explanationTextService.initializeFormattedExplanations([]);
      return { hydratedQuestions, quizQuestions: null, selectedQuizQuestions: null };
    }

    const explanations = hydratedQuestions.map((question) =>
      (question.explanation ?? '').trim()
    );
    this.explanationTextService.initializeExplanationTexts(explanations);

    this.explanationTextService.fetByIndex.clear();
    console.log('[QuizContentLoader] Cleared FET cache (fetByIndex) before regenerating.');

    const formattedExplanations =
      this.quizQuestionDataService.formatExplanationsForQuestions(hydratedQuestions);
    this.explanationTextService.initializeFormattedExplanations(formattedExplanations);

    const deepCloneQuestions = (qs: QuizQuestion[]) =>
      qs.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option }))
      }));

    const quizQuestions = params.quiz ? deepCloneQuestions(hydratedQuestions) : null;
    const selectedQuizQuestions = params.selectedQuiz ? deepCloneQuestions(hydratedQuestions) : null;

    return { hydratedQuestions, quizQuestions, selectedQuizQuestions };
  }

  /**
   * Resets FET state before quiz initialization.
   * Called from initializeQuizFromRoute to prevent stale FET from previous sessions.
   */
  resetFetStateForInit(): void {
    try {
      const ets = this.explanationTextService;
      ets._activeIndex = -1;
      ets._fetLocked = true;
      ets.latestExplanation = '';
      ets.setShouldDisplayExplanation(false);
      ets.setIsExplanationTextDisplayed(false);
      ets.formattedExplanationSubject?.next('');
      requestAnimationFrame(() => ets.emitFormatted(-1, null));
      console.log('[INIT] Cleared old FET state before first render');
    } catch (error) {
      console.warn('[INIT] FET clear failed', error);
    }
  }

  /**
   * Seeds the first question text and unlocks FET gate after stabilization.
   * Called after quiz initialization completes.
   */
  seedFirstQuestionText(): void {
    try {
      const firstQuestion = this.quizService.questions?.[0];
      if (firstQuestion) {
        const trimmed = (firstQuestion.questionText ?? '').trim();
        if (trimmed.length > 0) {
          console.log('[QUIZ INIT] Seeded initial question text for Q1');
          setTimeout(() => {
            this.explanationTextService._fetLocked = false;
            console.log('[INIT] FET gate opened after first-question seed');
          }, 80);
        }
      }
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.explanationTextService.setIsExplanationTextDisplayed(false);
    } catch (error: any) {
      console.warn('[QUIZ INIT] Could not seed initial question text', error);
    }
  }

  /**
   * Processes a selected answer: determines correct answers, manages answer
   * arrays, syncs with QuizService, and triggers scoring.
   */
  processSelectedAnswer(params: {
    optionIndex: number;
    question: QuizQuestion | null;
    optionsToDisplay: Option[];
    currentQuestionIndex: number;
    answers: Option[];
    selectedOption$: { next: (o: Option) => void };
  }): {
    option: Option | null;
    answers: Option[];
    answerIds: number[];
  } {
    const option =
      params.question?.options?.[params.optionIndex] ?? params.optionsToDisplay?.[params.optionIndex];
    if (!option) {
      console.warn(`[selectedAnswer] No option found at index ${params.optionIndex}`);
      return { option: null, answers: params.answers, answerIds: [] };
    }

    const correctAnswers = params.question?.options.filter((opt: Option) => opt.correct) ?? [];
    let answers = [...params.answers];

    if (correctAnswers.length > 1) {
      if (!answers.includes(option)) {
        answers.push(option);
      }
    } else {
      answers = [option];
    }

    const answerIds = answers
      .map((ans: Option) => ans.optionId)
      .filter((id): id is number => typeof id === 'number');
    this.quizService.answers = [...answers];
    this.quizService.updateUserAnswer(params.currentQuestionIndex, answerIds);
    void this.quizService.checkIfAnsweredCorrectly(params.currentQuestionIndex, false);

    params.selectedOption$.next(option);

    return { option, answers, answerIds };
  }

  /**
   * Fetches question and options from the data service and updates quiz state.
   * Replaces the component's fetchQuestionAndOptions method.
   */
  fetchAndSubscribeQuestionAndOptions(quizId: string, questionIndex: number): void {
    if (document.hidden) {
      console.log('Document is hidden, not loading question');
      return;
    }

    if (!quizId || quizId.trim() === '') {
      console.error('Quiz ID is required but not provided.');
      return;
    }

    if (questionIndex < 0) {
      console.error(`Invalid question index: ${questionIndex}`);
      return;
    }

    this.quizDataService.getQuestionAndOptions(quizId, questionIndex)
      .pipe(
        map((data: any): [QuizQuestion | null, Option[] | null] => {
          return Array.isArray(data)
            ? (data as [QuizQuestion | null, Option[] | null])
            : [null, null];
        }),
        catchError(
          (error: Error): Observable<[QuizQuestion | null, Option[] | null]> => {
            console.error('Error fetching question and options:', error);
            return of<[QuizQuestion | null, Option[] | null]>([null, null]);
          }
        )
      )
      .subscribe({
        next: ([question, options]: [QuizQuestion | null, Option[] | null]) => {
          if (question && options) {
            this.quizStateService.updateCurrentQuizState(of(question));
          } else {
            console.log('Question or options not found');
          }
        },
        error: (error: Error) => {
          console.error('Subscription error:', error);
        }
      });
  }

  /**
   * Initializes FET (formatted explanation text) for quiz data, handling
   * the shuffle vs non-shuffle ordering.
   */
  initializeFetForQuizData(quizData: Quiz): void {
    const isShuffled = this.quizService.isShuffleEnabled();

    this.quizService.setSelectedQuiz(quizData);

    if (!isShuffled) {
      this.explanationTextService.initializeExplanationTexts(
        (quizData.questions ?? []).map((q: QuizQuestion) => q.explanation)
      );
    }
  }

  /**
   * Initializes FET with shuffled question order after quiz init.
   */
  initializeFetForShuffledQuiz(): void {
    if (!this.quizService.isShuffleEnabled()) return;

    const shuffledQuestions = this.quizService.questions ?? [];
    if (shuffledQuestions.length > 0) {
      this.explanationTextService.initializeExplanationTexts(
        shuffledQuestions.map((q: QuizQuestion) => q.explanation)
      );
      console.log('[resolveQuizData] FET initialized with SHUFFLED question order');
    }
  }

  /**
   * Loads quiz data (questions + metadata) for a given quizId.
   * Returns the quiz and questions, or null on failure.
   */
  async loadQuizDataFromService(quizId: string): Promise<{
    quiz: Quiz;
    questions: QuizQuestion[];
  } | null> {
    try {
      const questions = await this.quizService.fetchQuizQuestions(quizId);
      if (!questions || questions.length === 0) {
        console.error('Quiz has no questions or failed to load via QuizService.');
        return null;
      }

      const quiz = await firstValueFrom(
        this.quizDataService.getQuiz(quizId).pipe(take(1))
      );
      if (!quiz) {
        console.error('Quiz metadata not found.');
        return null;
      }

      return { quiz, questions };
    } catch (error: any) {
      console.error('Error loading quiz data:', error);
      return null;
    }
  }
}
