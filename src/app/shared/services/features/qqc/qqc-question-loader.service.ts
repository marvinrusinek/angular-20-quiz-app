import { Injectable } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { SharedOptionConfig } from '../../../models/SharedOptionConfig.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuestionPayload } from '../../../models/QuestionPayload.model';
import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { NextButtonStateService } from '../../state/next-button-state.service';
import { ExplanationTextService } from '../explanation/explanation-text.service';
import { SelectionMessageService } from '../selection-message/selection-message.service';
import { TimerService } from '../timer/timer.service';
import { QqcQlFetchService } from './qqc-ql-fetch.service';
import { QqcQlOptionBuildService } from './qqc-ql-option-build.service';

/**
 * Manages question loading pipeline, quiz data fetching, and question initialization for QQC.
 * Delegates to 2 extracted sub-services; retains load-pipeline orchestration inline.
 */
@Injectable({ providedIn: 'root' })
export class QqcQuestionLoaderService {

  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private nextButtonStateService: NextButtonStateService,
    private explanationTextService: ExplanationTextService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService,
    private fetch: QqcQlFetchService,
    private optionBuild: QqcQlOptionBuildService
  ) {}

  // ─── Fetch (delegated) ───────────────────────────────────────

  async loadQuizData(quizId: string | null | undefined): Promise<QuizQuestion[] | null> {
    return this.fetch.loadQuizData(quizId);
  }

  async ensureQuestionsLoaded(
    questionsArray: QuizQuestion[],
    quizId: string | null | undefined
  ): Promise<{ loaded: boolean; questions: QuizQuestion[] | null }> {
    return this.fetch.ensureQuestionsLoaded(questionsArray, quizId);
  }

  async fetchQuestionsIfNeeded(
    questionsArray: QuizQuestion[] | null
  ): Promise<QuizQuestion[]> {
    return this.fetch.fetchQuestionsIfNeeded(questionsArray);
  }

  checkEndOfQuiz(params: {
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
    quizId: string;
  }): { shouldRedirect: boolean; trueTotal: number } {
    return this.fetch.checkEndOfQuiz(params);
  }

  canRenderQuestionInstantly(
    questionsArray: QuizQuestion[],
    index: number
  ): boolean {
    return this.fetch.canRenderQuestionInstantly(questionsArray, index);
  }

  async initializeComponentState(params: {
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
  }): Promise<{
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
    currentQuestion: QuizQuestion;
  } | null> {
    return this.fetch.initializeComponentState(params);
  }

  async fetchAndProcessQuizQuestions(params: {
    quizId: string;
    prepareQuestion: (quizId: string, question: QuizQuestion, index: number) => Promise<void>;
  }): Promise<QuizQuestion[]> {
    return this.fetch.fetchAndProcessQuizQuestions(params);
  }

  async ensureQuestionIsFullyLoaded(
    index: number,
    questionsArray: QuizQuestion[],
    quizId: string | null | undefined
  ): Promise<void> {
    return this.fetch.ensureQuestionIsFullyLoaded(index, questionsArray, quizId);
  }

  async loadCurrentQuestion(params: {
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
    quizId: string | null | undefined;
  }): Promise<{
    success: boolean;
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    questions: QuizQuestion[];
  }> {
    return this.fetch.loadCurrentQuestion(params);
  }

  async waitForQuestionData(params: {
    currentQuestionIndex: number;
    quizId: string;
  }): Promise<{
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    currentQuestionIndex: number;
  }> {
    return this.fetch.waitForQuestionData(params);
  }

  async performQuizDataAndRoutingInit(params: {
    quizId: string | null | undefined;
  }): Promise<{
    questions: QuizQuestion[];
    quiz: any;
  } | null> {
    return this.fetch.performQuizDataAndRoutingInit(params);
  }

  // ─── Option Build (delegated) ────────────────────────────────

  buildFreshOptions(
    question: QuizQuestion,
    currentQuestionIndex: number
  ): Option[] {
    return this.optionBuild.buildFreshOptions(question, currentQuestionIndex);
  }

  enrichOptionsForDisplay(question: QuizQuestion): Option[] {
    return this.optionBuild.enrichOptionsForDisplay(question);
  }

  computeQuestionSignature(question: QuizQuestion): string {
    return this.optionBuild.computeQuestionSignature(question);
  }

  populateOptionsToDisplay(
    currentQuestion: QuizQuestion | null,
    currentOptionsToDisplay: Option[],
    lastSignature: string | null
  ): { options: Option[]; signature: string | null } {
    return this.optionBuild.populateOptionsToDisplay(currentQuestion, currentOptionsToDisplay, lastSignature);
  }

  buildOptionBindings(
    clonedOptions: Option[],
    isMultipleAnswer: boolean
  ): OptionBindings[] {
    return this.optionBuild.buildOptionBindings(clonedOptions, isMultipleAnswer);
  }

  buildSharedOptionConfig(params: {
    question: QuizQuestion;
    clonedOptions: Option[];
    isMultipleAnswer: boolean;
    currentQuestionIndex: number;
    defaultConfig?: SharedOptionConfig | null;
  }): SharedOptionConfig {
    return this.optionBuild.buildSharedOptionConfig(params);
  }

  prepareOptionsForQuestion(params: {
    question: QuizQuestion;
    currentOptionsLength: number;
  }): {
    enrichedOptions: Option[];
    shouldClearFirst: boolean;
  } {
    return this.optionBuild.prepareOptionsForQuestion(params);
  }

  configureDynamicInstance(params: {
    instance: any;
    componentRef?: any;
    question: any;
    options: Option[];
    isMultipleAnswer: boolean;
    currentQuestionIndex: number;
    navigatingBackwards: boolean;
    defaultConfig: any;
    onOptionClicked: (...args: any[]) => any;
  }): {
    clonedOptions: Option[];
    questionData: any;
    sharedOptionConfig: SharedOptionConfig | null;
  } {
    return this.optionBuild.configureDynamicInstance(params);
  }

  buildInitialData(
    question: QuizQuestion,
    options: Option[]
  ): {
    questionText: string;
    explanationText: string;
    correctAnswersText: string;
    options: Option[];
  } {
    return this.optionBuild.buildInitialData(question, options);
  }

  // ─── Remaining inline: load pipeline orchestration ───────────

  /**
   * Prepares reset state before loading a new question.
   */
  prepareQuestionLoadReset(params: {
    currentQuestionIndex: number;
    shouldPreserveVisualState: boolean;
    shouldKeepExplanationVisible: boolean;
  }): {
    shouldResetSelections: boolean;
    shouldStartLoading: boolean;
  } {
    const { shouldPreserveVisualState, shouldKeepExplanationVisible } = params;

    return {
      shouldResetSelections: !shouldKeepExplanationVisible,
      shouldStartLoading: !shouldPreserveVisualState,
    };
  }

  /**
   * Purges all selection/lock state for a fresh question load.
   */
  purgeSelectionState(): void {
    this.selectedOptionService.resetAllStates?.();
    this.selectedOptionService.selectedOptionsMap?.clear?.();
    (this.selectedOptionService as any)._lockedOptionsMap?.clear?.();
    (this.selectedOptionService as any).optionStates?.clear?.();
  }

  /**
   * Resets explanation-related state for a new question load.
   */
  resetExplanationForLoad(): void {
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setIsExplanationTextDisplayed(false);
    this.explanationTextService.setExplanationText('');
  }

  /**
   * Computes the pre-load reset flags for a question load.
   */
  computePreLoadResetActions(params: {
    shouldPreserveVisualState: boolean;
    shouldKeepExplanationVisible: boolean;
  }): {
    shouldResetSelections: boolean;
    shouldResetExplanation: boolean;
    shouldStartLoading: boolean;
    shouldSetAnsweredTrue: boolean;
  } {
    return {
      shouldResetSelections: !params.shouldKeepExplanationVisible,
      shouldResetExplanation: !params.shouldKeepExplanationVisible,
      shouldStartLoading: !params.shouldPreserveVisualState,
      shouldSetAnsweredTrue: params.shouldKeepExplanationVisible,
    };
  }

  /**
   * Post-options-load state reset.
   */
  computePostOptionsLoadState(): {
    lastLoggedIndex: number;
    lastExplanationShownIndex: number;
    explanationInFlight: boolean;
  } {
    return {
      lastLoggedIndex: -1,
      lastExplanationShownIndex: -1,
      explanationInFlight: false,
    };
  }

  /**
   * Prepares core component state for a new question: clones question,
   * builds fresh options, and computes question text.
   */
  prepareComponentStateForQuestion(params: {
    potentialQuestion: QuizQuestion;
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
  }): {
    currentQuestion: QuizQuestion;
    optionsToDisplay: Option[];
    questionToDisplay: string;
    hasSharedRefs: boolean;
  } {
    // 1️⃣ Purge all previous state before touching new data
    this.purgeSelectionState();

    // 2️⃣ Defensive clone of question data
    const currentQuestion = { ...params.potentialQuestion };

    // 3️⃣ Deep clone options to guarantee new references
    const optionsToDisplay = this.optionBuild.buildFreshOptions(params.potentialQuestion, params.currentQuestionIndex);

    console.group(`[QQC TRACE] Fresh options for Q${params.currentQuestionIndex}`);
    for (const [j, o] of optionsToDisplay.entries()) {
    }
    console.groupEnd();

    // 4️⃣ Verify no shared references
    let hasSharedRefs = false;
    if (params.questionsArray?.[params.currentQuestionIndex - 1]?.options) {
      const prev = params.questionsArray[params.currentQuestionIndex - 1].options;
      const curr = optionsToDisplay;
      hasSharedRefs = prev.some((p, i) => p === curr[i]);
    }

    // 5️⃣ Compute question text
    const questionToDisplay = currentQuestion.questionText?.trim() || '';

    return { currentQuestion, optionsToDisplay, questionToDisplay, hasSharedRefs };
  }

  /**
   * Creates the payload hydration subscription used in ngAfterViewInit.
   */
  createPayloadHydrationSubscription(params: {
    payloadSubject: BehaviorSubject<QuestionPayload | null>;
    getHydrationInProgress: () => boolean;
    setHydrationInProgress: (val: boolean) => void;
    setRenderReady: (val: boolean) => void;
    setCurrentQuestion: (q: QuizQuestion) => void;
    setExplanationToDisplay: (text: string) => void;
    setOptionsToDisplay: (opts: Option[]) => void;
    initializeOptionBindings: () => void;
    releaseBaseline: (idx: number) => void;
    getCurrentQuestionIndex: () => number;
    detectChanges: () => void;
  }): Subscription {
    return params.payloadSubject
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      )
      .subscribe((payload: QuestionPayload) => {
        if (params.getHydrationInProgress()) return;

        params.setRenderReady(false);
        params.setHydrationInProgress(true);

        // Extract and assign payload
        const { question, options, explanation } = payload;
        params.setCurrentQuestion(question);
        params.setExplanationToDisplay(explanation?.trim() || '');
        params.setOptionsToDisplay(structuredClone(options));  // ensure isolation

        // Initialize option bindings if needed
        params.initializeOptionBindings();

        // Baseline message recompute, now that options are known
        if (options && options.length > 0) {
          // Release baseline immediately
          this.selectionMessageService.releaseBaseline(params.getCurrentQuestionIndex());
        }

        // Finalize rendering state after one microtask delay
        setTimeout(() => {
          params.setRenderReady(true);
          params.setHydrationInProgress(false);
          params.detectChanges();  // trigger OnPush refresh
        }, 0);
      });
  }

  /**
   * Performs pre-load reset: sets explanation locks, resets selection/button state.
   */
  performPreLoadReset(params: {
    shouldPreserveVisualState: boolean;
    shouldKeepExplanationVisible: boolean;
    currentQuestionIndex: number;
  }): void {
    // ABSOLUTE LOCK: prevent stale FET display
    this.resetExplanationForLoad();

    if (params.shouldPreserveVisualState) {
      this.quizStateService.setLoading(false);
      this.quizStateService.setAnswerSelected(false);
    } else {
      this.quizStateService.setLoading(true);
      this.quizStateService.setAnswerSelected(false);
    }

    // Reset selection and button state before processing question
    if (!params.shouldKeepExplanationVisible) {
      this.selectedOptionService.clearSelectionsForQuestion(params.currentQuestionIndex);
      this.selectedOptionService.setAnswered(false);
      this.nextButtonStateService.reset();
    } else {
      this.selectedOptionService.setAnswered(true, true);
      this.nextButtonStateService.setNextButtonState(true);
    }
  }

  /**
   * Performs the post-load state reset when explanation should NOT be preserved.
   */
  performPostResetExplanationClear(): {
    displayState: { mode: 'question' | 'explanation'; answered: boolean };
    forceQuestionDisplay: boolean;
    readyForExplanationDisplay: boolean;
    isExplanationReady: boolean;
    isExplanationLocked: boolean;
    currentExplanationText: string;
    feedbackText: string;
  } {
    this.explanationTextService.resetExplanationState();
    this.explanationTextService.setExplanationText('');
    this.explanationTextService.setIsExplanationTextDisplayed(false);

    return {
      displayState: { mode: 'question', answered: false },
      forceQuestionDisplay: true,
      readyForExplanationDisplay: false,
      isExplanationReady: false,
      isExplanationLocked: true,
      currentExplanationText: '',
      feedbackText: '',
    };
  }

  /**
   * Emits the baseline selection message once options are fully ready after loading.
   */
  emitBaselineSelectionMessage(params: {
    optionsToDisplay: Option[];
    currentQuestionIndex: number;
    questions: QuizQuestion[];
  }): void {
    queueMicrotask(() => {
      requestAnimationFrame(async () => {
        if (params.optionsToDisplay?.length > 0) {
          const q = params.questions[params.currentQuestionIndex];
          if (q) {
            const totalCorrect = q.options.filter(o => !!o.correct).length;
            // Push the baseline immediately
            await this.selectionMessageService.enforceBaselineAtInit(params.currentQuestionIndex, q.type!, totalCorrect);
          }
        } else {
        }
      });
    });
  }

  /**
   * Performs the post-binding microtask for loadOptionsForQuestion.
   */
  performPostOptionsBindingSetup(params: {
    generateOptionBindings: () => void;
    detectChanges: () => void;
    currentQuestionIndex: number;
    emitPassiveNow: (idx: number) => void;
  }): {
    lastLoggedIndex: number;
    lastExplanationShownIndex: number;
    explanationInFlight: boolean;
    pendingPassiveRaf: number;
  } {
    params.generateOptionBindings();
    params.detectChanges();

    // UI is now interactive
    this.quizStateService.setLoading(false);
    this.quizStateService.setInteractionReady(true);

    // Reset click dedupe and explanation flight state
    const resetState = this.computePostOptionsLoadState();

    // Start with Next disabled for ALL questions until first selection
    this.quizStateService.setAnswerSelected(false);
    this.nextButtonStateService.setNextButtonState(false);

    // Emit the passive message from the same array the UI just rendered
    const pendingPassiveRaf = requestAnimationFrame(
      () => params.emitPassiveNow(params.currentQuestionIndex)
    );

    return {
      ...resetState,
      pendingPassiveRaf,
    };
  }

  /**
   * Performs the post-view-init question setup.
   */
  async performAfterViewInitQuestionSetup(params: {
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
    getFormattedExplanation: (question: QuizQuestion, index: number) => Promise<{ explanation: string }>;
    updateExplanationUI: (index: number, explanationText: string) => void;
  }): Promise<QuizQuestion | null> {
    const { questionsArray, currentQuestionIndex: index } = params;

    // Wait until questions are available
    if (!questionsArray || questionsArray.length <= index) {
      return null; // caller should retry
    }

    const question = questionsArray[index];
    if (question) {
      this.quizService.setCurrentQuestion(question);

      setTimeout(async () => {
        const formatted = await params.getFormattedExplanation(question, index);
        const explanationText = formatted?.explanation || question.explanation || 'No explanation available';
        params.updateExplanationUI(index, explanationText);
      }, 50);

      return question;
    } else {
      console.error(`[ngAfterViewInit] ❌ No question found at index ${index}`);
      return null;
    }
  }

  /**
   * Handles the core of loadQuestion after the reset/explanation-clear phase.
   */
  async performLoadQuestionPostReset(params: {
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
    quizId: string | null | undefined;
    signal?: AbortSignal;
    questions?: QuizQuestion[];
  }): Promise<{
    success: boolean;
    shouldRedirect: boolean;
    questionsArray: QuizQuestion[];
    currentQuestion: QuizQuestion;
    optionsToDisplay: Option[];
    questionToDisplay: string;
  } | null> {
    // Fetch questions if not already available
    const questionsArray = await this.fetch.fetchQuestionsIfNeeded(params.questionsArray);

    // Set totalQuestions before selection messages are computed
    if (questionsArray?.length > 0) {
      this.quizService.totalQuestions = questionsArray.length;
    }

    if (questionsArray.length === 0) return null;

    // Check end of quiz
    const { shouldRedirect } = this.fetch.checkEndOfQuiz({
      currentQuestionIndex: params.currentQuestionIndex,
      questionsArray,
      quizId: params.quizId!,
    });

    if (shouldRedirect) {
      return {
        success: false, shouldRedirect: true, questionsArray,
        currentQuestion: null as any, optionsToDisplay: [], questionToDisplay: '',
      };
    }

    // Validate current index
    if (params.currentQuestionIndex < 0 || params.currentQuestionIndex >= questionsArray.length) {
      throw new Error(`Invalid question index: ${params.currentQuestionIndex}`);
    }

    const potentialQuestion = questionsArray[params.currentQuestionIndex];
    if (!potentialQuestion) {
      throw new Error(`No question found for index ${params.currentQuestionIndex}`);
    }

    if (params.signal?.aborted) {
      this.timerService.stopTimer(undefined, { force: true });
      return null;
    }

    // Prepare core state
    const preparedState = this.prepareComponentStateForQuestion({
      potentialQuestion,
      currentQuestionIndex: params.currentQuestionIndex,
      questionsArray,
    });

    // Emit to quiz service subjects
    this.quizService.questionPayloadSubject.next({
      question: preparedState.currentQuestion!,
      options: preparedState.optionsToDisplay,
      explanation: '',
    });

    this.quizService.nextQuestionSubject.next(preparedState.currentQuestion);
    this.quizService.nextOptionsSubject.next(preparedState.optionsToDisplay);

    // Emit baseline selection message
    this.emitBaselineSelectionMessage({
      optionsToDisplay: preparedState.optionsToDisplay,
      currentQuestionIndex: params.currentQuestionIndex,
      questions: params.questions ?? questionsArray,
    });

    if (params.signal?.aborted) {
      this.timerService.stopTimer(undefined, { force: true });
      return null;
    }

    // Start the timer AFTER all setup is complete to avoid races where
    // an aborted prior load tears down the freshly-started timer.
    this.timerService.restartForQuestion(params.currentQuestionIndex);

    return {
      success: true,
      shouldRedirect: false,
      questionsArray,
      currentQuestion: preparedState.currentQuestion!,
      optionsToDisplay: preparedState.optionsToDisplay,
      questionToDisplay: preparedState.questionToDisplay,
    };
  }

  /**
   * Handles the route change update within setupRouteChangeHandler.
   */
  async performRouteChangeUpdate(params: {
    zeroBasedIndex: number;
    questionsArray: QuizQuestion[];
    loadQuestion: () => Promise<boolean>;
    isAnyOptionSelected: (idx: number) => Promise<boolean>;
    updateExplanationText: (idx: number) => Promise<string>;
    shouldDisplayExplanation: boolean;
    questionForm: any;
  }): Promise<{
    loaded: boolean;
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
  } | null> {
    this.quizService.setCurrentQuestionIndex(params.zeroBasedIndex);

    const loaded = await params.loadQuestion();
    if (!loaded) return null;

    if (params.questionForm) {
      params.questionForm.patchValue({ answer: '' });
    }

    // When shuffle is active, use shuffledQuestions as the authoritative source.
    // params.questionsArray may contain unshuffled data, causing Q&A mismatch.
    const shuffled = this.quizService.shuffledQuestions;
    const effectiveQuestions = this.quizService.isShuffleEnabled() && shuffled?.length > 0
      ? shuffled
      : params.questionsArray;
    const currentQuestion = effectiveQuestions?.[params.zeroBasedIndex] ?? null;
    if (!currentQuestion) return null;

    const optionsToDisplay = (currentQuestion.options ?? []).map((opt: Option) => ({
      ...opt,
      active: true,
      feedback: undefined,
      showIcon: false,
    }));

    const isAnswered = await params.isAnyOptionSelected(params.zeroBasedIndex);
    if (isAnswered) {
      await params.updateExplanationText(params.zeroBasedIndex);
    }

    return {
      loaded: true,
      currentQuestion,
      optionsToDisplay,
    };
  }
}
