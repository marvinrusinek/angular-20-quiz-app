import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Subscription } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { SharedOptionConfig } from '../../../models/SharedOptionConfig.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuestionPayload } from '../../../models/QuestionPayload.model';
import { QuizService } from '../../data/quiz.service';
import { QuizDataService } from '../../data/quizdata.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { NextButtonStateService } from '../../state/next-button-state.service';
import { ExplanationTextService } from '../explanation/explanation-text.service';
import { SelectionMessageService } from '../selection-message/selection-message.service';
import { TimerService } from '../timer/timer.service';

/**
 * Manages question loading pipeline, quiz data fetching, and question initialization for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcQuestionLoaderService {

  private isLoadingInProgress = false;
  private isQuizLoaded = false;

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private nextButtonStateService: NextButtonStateService,
    private explanationTextService: ExplanationTextService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService
  ) {}

  /**
   * Loads quiz data (questions) and marks quiz as loaded.
   * Returns the loaded questions array, or null on failure.
   */
  async loadQuizData(quizId: string | null | undefined): Promise<QuizQuestion[] | null> {
    try {
      const quizIdExists = await this.quizService.ensureQuizIdExists();
      if (!quizIdExists) {
        console.error('Quiz ID is missing');
        return null;
      }

      const questions = await this.quizService.fetchQuizQuestions(quizId!);
      if (questions && questions.length > 0) {
        const activeQuiz = this.quizService.getActiveQuiz();
        if (!activeQuiz) {
          console.error('Failed to get the active quiz.');
          return null;
        }

        this.isQuizLoaded = true;
        this.quizService.setQuestionsLoaded(true);
        return questions;
      } else {
        console.error('No questions loaded.');
        return null;
      }
    } catch (error) {
      console.error('Error loading questions:', error);
      return null;
    }
  }

  /**
   * Ensures questions are loaded, waiting if a load is already in progress.
   * Returns true if questions are available.
   */
  async ensureQuestionsLoaded(
    questionsArray: QuizQuestion[],
    quizId: string | null | undefined
  ): Promise<{ loaded: boolean; questions: QuizQuestion[] | null }> {
    if (this.isLoadingInProgress) {
      console.info('Waiting for ongoing loading process...');
      while (this.isLoadingInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { loaded: this.isQuizLoaded, questions: questionsArray };
    }

    if (this.isQuizLoaded && questionsArray && questionsArray.length > 0) {
      return { loaded: true, questions: questionsArray };
    }

    this.isLoadingInProgress = true;
    const loadedQuestions = await this.loadQuizData(quizId);
    this.isLoadingInProgress = false;

    if (!loadedQuestions) {
      console.error('Failed to load questions.');
      return { loaded: false, questions: null };
    }

    return { loaded: true, questions: loadedQuestions };
  }

  /**
   * Prepares reset state before loading a new question.
   * Returns the explanation and visual state flags.
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
   * Fetches questions if not already available.
   * Returns the questions array or throws on failure.
   */
  async fetchQuestionsIfNeeded(
    questionsArray: QuizQuestion[] | null
  ): Promise<QuizQuestion[]> {
    if (questionsArray && questionsArray.length > 0) {
      return questionsArray;
    }

    const quizId = this.quizService.getCurrentQuizId();
    if (!quizId) throw new Error('No active quiz ID found.');

    const fetched = await this.quizService.fetchQuizQuestions(quizId);
    if (!fetched?.length) {
      throw new Error('Failed to fetch questions.');
    }

    return fetched;
  }

  /**
   * Validates and computes the authoritative total question count
   * and checks if we should redirect to results.
   */
  checkEndOfQuiz(params: {
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
    quizId: string;
  }): { shouldRedirect: boolean; trueTotal: number } {
    const serviceTotal = this.quizService.totalQuestions || 0;
    const localTotal = params.questionsArray.length || 0;
    const authoritativeCount = this.quizDataService.getCachedQuizById(params.quizId)?.questions?.length || 0;
    const trueTotal = Math.max(serviceTotal, localTotal, authoritativeCount);

    return {
      shouldRedirect: params.currentQuestionIndex >= trueTotal && trueTotal > 0,
      trueTotal,
    };
  }

  /**
   * Builds fresh options from a question's raw options.
   * Returns deep-cloned, enriched options with unique IDs.
   */
  buildFreshOptions(
    question: QuizQuestion,
    currentQuestionIndex: number
  ): Option[] {
    const rawOpts = Array.isArray(question.options)
      ? JSON.parse(JSON.stringify(question.options))
      : [];

    return rawOpts.map((opt: Option, i: number) => ({
      ...opt,
      optionId: (currentQuestionIndex + 1) * 100 + (i + 1),
      selected: false,
      highlight: false,
      showIcon: false,
      active: true,
      disabled: false,
      feedback: opt.feedback ?? `Default feedback for Q${currentQuestionIndex} Opt${i}`,
    }));
  }

  /**
   * Purges all selection/lock state for a fresh question load.
   */
  purgeSelectionState(): void {
    this.selectedOptionService.resetAllStates?.();
    this.selectedOptionService.selectedOptionsMap?.clear?.();
    (this.selectedOptionService as any)._lockedOptionsMap?.clear?.();
    (this.selectedOptionService as any).optionStates?.clear?.();
    console.log('[QQC LOAD] 🧹 All selection/lock state cleared');
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
   * Checks whether a question can be rendered instantly (has text + options).
   */
  canRenderQuestionInstantly(
    questionsArray: QuizQuestion[],
    index: number
  ): boolean {
    if (!Array.isArray(questionsArray) || questionsArray.length === 0) {
      return false;
    }

    if (!Number.isInteger(index) || index < 0 || index >= questionsArray.length) {
      return false;
    }

    const candidate = questionsArray[index];
    if (!candidate) {
      return false;
    }

    const hasQuestionText =
      typeof candidate.questionText === 'string' && candidate.questionText.trim().length > 0;
    const options = Array.isArray(candidate.options) ? candidate.options : [];

    return hasQuestionText && options.length > 0;
  }

  /**
   * Initializes component state: fetches questions, clamps index, sets current question.
   * Returns the initialized state or null on failure.
   */
  async initializeComponentState(params: {
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
  }): Promise<{
    questionsArray: QuizQuestion[];
    currentQuestionIndex: number;
    currentQuestion: QuizQuestion;
  } | null> {
    let { questionsArray, currentQuestionIndex } = params;

    try {
      if (!questionsArray || questionsArray.length === 0) {
        const quizId = this.quizService.getCurrentQuizId();
        if (!quizId) {
          console.error('[initializeComponent] No active quiz ID found. Aborting initialization.');
          return null;
        }

        questionsArray = await this.quizService.fetchQuizQuestions(quizId);
        if (!questionsArray || questionsArray.length === 0) {
          console.error('[initializeComponent] Failed to fetch questions. Aborting initialization.');
          return null;
        }

        console.info('[initializeComponent] Questions array successfully fetched:', questionsArray);
      }

      // Clamp currentQuestionIndex to valid range
      if (currentQuestionIndex < 0) {
        currentQuestionIndex = 0;
      }
      const lastIndex = questionsArray.length - 1;
      if (currentQuestionIndex > lastIndex) {
        console.warn(
          `[initializeComponent] Index ${currentQuestionIndex} out of range — clamping to last question (${lastIndex}).`
        );
        currentQuestionIndex = lastIndex;
      }

      const currentQuestion = questionsArray[currentQuestionIndex];
      if (!currentQuestion) {
        console.warn('[initializeComponent] Current question is missing after loading.', {
          currentQuestionIndex,
          questionsArray,
        });
        return null;
      }

      console.info('[initializeComponent] Current question set:', currentQuestion);

      return {
        questionsArray,
        currentQuestionIndex,
        currentQuestion,
      };
    } catch (error) {
      console.error('[initializeComponent] Error during initialization:', error);
      return null;
    }
  }

  /**
   * Enriches options for display from a question's raw options.
   * Returns the enriched options array.
   */
  enrichOptionsForDisplay(question: QuizQuestion): Option[] {
    if (!question || !question.options?.length) {
      console.warn('[loadOptionsForQuestion] ❌ No question or options found.');
      return [];
    }

    return [...question.options].map(option => ({
      ...option,
      feedback: option.feedback ?? 'No feedback available.',
      showIcon: option.showIcon ?? false,
      active: option.active ?? true,
      selected: option.selected ?? false,
      correct: option.correct ?? false
    }));
  }

  /**
   * Computes a question signature for deduplication.
   */
  computeQuestionSignature(question: QuizQuestion): string {
    const baseText = (question.questionText ?? '').trim();
    const optionKeys = (question.options ?? []).map((opt, idx) => {
      const optionId = opt.optionId ?? idx;
      const text = (opt.text ?? '').trim();
      const correctness = opt.correct === true ? '1' : '0';
      return `${optionId}|${text}|${correctness}`;
    });

    return `${baseText}::${optionKeys.join('||')}`;
  }

  /**
   * Populates optionsToDisplay from currentQuestion's options with deduplication.
   */
  populateOptionsToDisplay(
    currentQuestion: QuizQuestion | null,
    currentOptionsToDisplay: Option[],
    lastSignature: string | null
  ): { options: Option[]; signature: string | null } {
    if (!currentQuestion) {
      console.warn('[⚠️ populateOptionsToDisplay] currentQuestion is null or undefined. Skipping population.');
      return { options: [], signature: lastSignature };
    }

    if (!Array.isArray(currentQuestion.options) || currentQuestion.options.length === 0) {
      console.warn('[⚠️ populateOptionsToDisplay] currentQuestion.options is not a valid array. Returning empty array.');
      return { options: [], signature: lastSignature };
    }

    const signature = this.computeQuestionSignature(currentQuestion);

    const hasValidOptions =
      Array.isArray(currentOptionsToDisplay) &&
      currentOptionsToDisplay.length === currentQuestion.options.length &&
      lastSignature === signature;

    if (hasValidOptions) {
      return { options: currentOptionsToDisplay, signature };
    }

    const populated = currentQuestion.options.map((option, index) => ({
      ...option,
      optionId: option.optionId ?? index,
      correct: option.correct ?? false,
    }));

    return { options: populated, signature };
  }

  /**
   * Builds option bindings array for a dynamic component instance.
   * Extracted from QuizQuestionComponent.loadDynamicComponent().
   */
  buildOptionBindings(
    clonedOptions: Option[],
    isMultipleAnswer: boolean
  ): OptionBindings[] {
    return clonedOptions.map((opt, idx) => ({
      appHighlightOption: false,
      option: opt,
      isCorrect: opt.correct ?? false,
      feedback: opt.feedback ?? '',
      showFeedback: false,
      showFeedbackForOption: {},
      highlightCorrectAfterIncorrect: false,
      allOptions: clonedOptions,
      type: isMultipleAnswer ? 'multiple' : 'single',
      appHighlightInputType: isMultipleAnswer ? 'checkbox' : 'radio',
      appHighlightReset: false,
      appResetBackground: false,
      optionsToDisplay: clonedOptions,
      isSelected: opt.selected ?? false,
      active: opt.active ?? true,
      checked: false,
      change: (_: any) => { },
      index: idx,
      highlightIncorrect: false,
      highlightCorrect: false,
      disabled: false,
      ariaLabel: opt.text ?? `Option ${idx + 1}`,
    })) as OptionBindings[];
  }

  /**
   * Builds SharedOptionConfig for a dynamic component instance.
   * Extracted from QuizQuestionComponent.loadDynamicComponent().
   */
  buildSharedOptionConfig(params: {
    question: QuizQuestion;
    clonedOptions: Option[];
    isMultipleAnswer: boolean;
    currentQuestionIndex: number;
    defaultConfig?: SharedOptionConfig | null;
  }): SharedOptionConfig {
    return {
      ...(params.defaultConfig ?? {}),
      type: params.isMultipleAnswer ? 'multiple' : 'single',
      currentQuestion: { ...params.question },
      optionsToDisplay: params.clonedOptions,
      selectedOption: null,
      selectedOptionIndex: -1,
      showFeedback: false,
      isAnswerCorrect: false,
      showCorrectMessage: false,
      showExplanation: false,
      explanationText: '',
      highlightCorrectAfterIncorrect: false,
      shouldResetBackground: false,
      showFeedbackForOption: {},
      isOptionSelected: false,
      correctMessage: '',
      feedback: '',
      idx: params.currentQuestionIndex,
    } as SharedOptionConfig;
  }

  /**
   * Fetches and processes quiz questions for a given quiz ID.
   * Runs preparation for each question in parallel.
   * Returns the processed questions array.
   * Extracted from fetchAndProcessQuizQuestions().
   */
  async fetchAndProcessQuizQuestions(params: {
    quizId: string;
    prepareQuestion: (quizId: string, question: QuizQuestion, index: number) => Promise<void>;
  }): Promise<QuizQuestion[]> {
    const { quizId, prepareQuestion } = params;

    if (!quizId) {
      console.error('Quiz ID is not provided or is empty.');
      return [];
    }

    try {
      const questions = await this.quizService.fetchQuizQuestions(quizId);

      if (!questions || questions.length === 0) {
        console.error('No questions were loaded');
        return [];
      }

      // Run all question preparations in parallel
      await Promise.all(
        questions.map((question, index) =>
          prepareQuestion(quizId, question, index)
        )
      );

      return questions;
    } catch (error) {
      console.error('Error loading questions:', error);
      return [];
    }
  }

  /**
   * Ensures a question is fully loaded from the quiz service.
   */
  async ensureQuestionIsFullyLoaded(
    index: number,
    questionsArray: QuizQuestion[],
    quizId: string | null | undefined
  ): Promise<void> {
    if (!questionsArray || questionsArray.length === 0) {
      console.error('Questions array is not loaded yet. Loading questions...');
      const loaded = await this.loadQuizData(quizId);

      if (!loaded) {
        console.error('Questions array still not loaded after loading attempt.');
        throw new Error('Failed to load questions array.');
      }
    }

    if (index < 0 || index >= questionsArray.length) {
      console.error(`Invalid index ${index}. Must be between 0 and ${questionsArray.length - 1}.`);
      throw new Error(`Invalid index ${index}. No such question exists.`);
    }

    return new Promise((resolve, reject) => {
      const subscription = this.quizService.getQuestionByIndex(index).subscribe({
        next: (question) => {
          if (question && question.questionText) {
            console.log(`Question loaded for index ${index}:`, question);
            subscription?.unsubscribe();
            resolve();
          } else {
            reject(new Error(`No valid question at index ${index}`));
          }
        },
        error: (err) => {
          console.error(`Error loading question at index ${index}:`, err);
          subscription?.unsubscribe();
          reject(err);
        },
      });
    });
  }

  /**
   * Loads and validates the current question by index.
   * Assigns option IDs and active states.
   * Extracted from loadCurrentQuestion().
   */
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
    const result = await this.ensureQuestionsLoaded(params.questionsArray, params.quizId);
    if (!result.loaded) {
      console.error('[loadCurrentQuestion] No questions available.');
      return { success: false, currentQuestion: null, optionsToDisplay: [], questions: params.questionsArray };
    }

    const questions = result.questions || params.questionsArray;

    if (
      params.currentQuestionIndex < 0 ||
      params.currentQuestionIndex >= questions.length
    ) {
      console.error(
        `[loadCurrentQuestion] Invalid question index: ${params.currentQuestionIndex}`
      );
      return { success: false, currentQuestion: null, optionsToDisplay: [], questions };
    }

    try {
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(params.currentQuestionIndex)
      );

      if (questionData) {
        console.log(
          `[loadCurrentQuestion] Loaded data for question index: ${params.currentQuestionIndex}`
        );

        questionData.options = this.quizService.assignOptionIds(
          questionData.options,
          params.currentQuestionIndex
        );

        questionData.options = this.quizService.assignOptionActiveStates(
          questionData.options,
          false
        );

        return {
          success: true,
          currentQuestion: questionData,
          optionsToDisplay: questionData.options ?? [],
          questions,
        };
      } else {
        console.error(
          `[loadCurrentQuestion] No data found for question index: ${params.currentQuestionIndex}`
        );
        return { success: false, currentQuestion: null, optionsToDisplay: [], questions };
      }
    } catch (error) {
      console.error(
        '[loadCurrentQuestion] Error fetching question data:',
        error
      );
      return { success: false, currentQuestion: null, optionsToDisplay: [], questions };
    }
  }

  /**
   * Waits for question data to be available, clamping to last index if needed.
   * Returns the question and its options.
   * Extracted from waitForQuestionData().
   */
  async waitForQuestionData(params: {
    currentQuestionIndex: number;
    quizId: string;
  }): Promise<{
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    currentQuestionIndex: number;
  }> {
    let idx = params.currentQuestionIndex;

    if (!Number.isInteger(idx) || idx < 0) {
      idx = 0;
    }

    try {
      let question = await firstValueFrom(
        this.quizService.getQuestionByIndex(idx)
      );

      if (!question) {
        console.warn(
          `[waitForQuestionData] Index ${idx} out of range — clamping to last question`
        );

        const total: number = await firstValueFrom(
          this.quizService.getTotalQuestionsCount(params.quizId)
        );

        const lastIndex = Math.max(0, total - 1);
        idx = lastIndex;

        question = await firstValueFrom(
          this.quizService.getQuestionByIndex(idx)
        );

        if (!question) {
          console.error(
            '[waitForQuestionData] Still no question after clamping — aborting.'
          );
          return { currentQuestion: null, optionsToDisplay: [], currentQuestionIndex: idx };
        }
      }

      if (!question.options?.length) {
        console.error(
          `[waitForQuestionData] ❌ Invalid question data or options missing for index: ${idx}`
        );
        return { currentQuestion: null, optionsToDisplay: [], currentQuestionIndex: idx };
      }

      return {
        currentQuestion: question,
        optionsToDisplay: [...question.options],
        currentQuestionIndex: idx,
      };
    } catch (error) {
      console.error(
        `[waitForQuestionData] ❌ Error loading question data for index ${idx}:`,
        error
      );
      return { currentQuestion: null, optionsToDisplay: [], currentQuestionIndex: idx };
    }
  }

  /**
   * Prepares enriched options for a question and determines if the option list
   * needs clearing due to length mismatch. Returns the enriched options and
   * whether the current list should be cleared first.
   * Extracted from loadOptionsForQuestion().
   */
  prepareOptionsForQuestion(params: {
    question: QuizQuestion;
    currentOptionsLength: number;
  }): {
    enrichedOptions: Option[];
    shouldClearFirst: boolean;
  } {
    const enrichedOptions = this.enrichOptionsForDisplay(params.question);

    // If incoming list length differs, clear current list to avoid stale bleed-through
    const shouldClearFirst =
      enrichedOptions.length > 0 &&
      params.currentOptionsLength !== params.question.options.length;

    if (shouldClearFirst) {
      console.warn('[DEBUG] ❌ Clearing optionsToDisplay due to length mismatch');
    }

    return { enrichedOptions, shouldClearFirst };
  }

  /**
   * Post-options-load state reset: resets click deduplication guards,
   * explanation flight state, and Next button to disabled.
   * Returns the reset values for the component to apply.
   * Extracted from loadOptionsForQuestion().
   */
  /**
   * Prepares core component state for a new question: clones question,
   * builds fresh options, and computes question text.
   * Returns the data the component should apply.
   * Extracted from loadQuestion() "Update Component State" section.
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
    const optionsToDisplay = this.buildFreshOptions(params.potentialQuestion, params.currentQuestionIndex);

    console.group(`[QQC TRACE] Fresh options for Q${params.currentQuestionIndex}`);
    optionsToDisplay.forEach((o, j) =>
      console.log(`Opt${j}:`, o.text, '| id:', o.optionId, '| ref:', o)
    );
    console.groupEnd();

    // 4️⃣ Verify no shared references
    let hasSharedRefs = false;
    if (params.questionsArray?.[params.currentQuestionIndex - 1]?.options) {
      const prev = params.questionsArray[params.currentQuestionIndex - 1].options;
      const curr = optionsToDisplay;
      hasSharedRefs = prev.some((p, i) => p === curr[i]);
      console.log(`[QQC REF CHECK] Between Q${params.currentQuestionIndex - 1} and Q${params.currentQuestionIndex}: shared=${hasSharedRefs}`);
    }

    // 5️⃣ Compute question text
    const questionToDisplay = currentQuestion.questionText?.trim() || '';

    return { currentQuestion, optionsToDisplay, questionToDisplay, hasSharedRefs };
  }

  /**
   * Computes the pre-load reset flags for a question load.
   * Returns which resets to apply and which loading state to use.
   * Extracted from loadQuestion() pre-load state section.
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
   * Creates the payload hydration subscription used in ngAfterViewInit.
   * Hydrates component state from each distinct QuestionPayload emission.
   * Extracted from ngAfterViewInit (lines 736–770).
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
   * Performs pre-load reset: sets explanation locks, resets selection/button state,
   * and determines whether to preserve visual state or start fresh loading.
   * Extracted from loadQuestion (lines 1562–1602).
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
   * Resets explanation text service, display state, and text fields.
   * Extracted from loadQuestion (lines 1622–1641).
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
   * Extracted from loadQuestion (lines 1747–1770).
   */
  emitBaselineSelectionMessage(params: {
    optionsToDisplay: Option[];
    currentQuestionIndex: number;
    questions: QuizQuestion[];
  }): void {
    queueMicrotask(() => {
      requestAnimationFrame(async () => {
        if (params.optionsToDisplay?.length > 0) {
          console.log('[loadQuestion] Forcing baseline selection message after emit', {
            index: params.currentQuestionIndex,
            total: this.quizService.totalQuestions,
            opts: params.optionsToDisplay.map(o => ({
              text: o.text,
              correct: o.correct,
              selected: o.selected
            }))
          });
          const q = params.questions[params.currentQuestionIndex];
          if (q) {
            const totalCorrect = q.options.filter(o => !!o.correct).length;
            // Push the baseline immediately
            await this.selectionMessageService.enforceBaselineAtInit(params.currentQuestionIndex, q.type!, totalCorrect);
          }
        } else {
          console.warn('[loadQuestion] Skipped baseline recompute (no options yet)');
        }
      });
    });
  }

  /**
   * Performs the post-binding microtask for loadOptionsForQuestion:
   * flips loading→false, interactionReady→true, resets click dedupe,
   * disables Next button, and schedules passive message emit.
   * Extracted from loadOptionsForQuestion (lines 1329–1353).
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
   * Configures a dynamically loaded AnswerComponent instance with
   * cloned options, bindings, shared config, and event handlers.
   * Extracted from loadDynamicComponent (lines 1481–1513).
   */
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
    const { instance, componentRef, question, options, isMultipleAnswer, currentQuestionIndex } = params;


    // Configure instance with cloned options and bindings
    const clonedOptions =
      structuredClone?.(options) ?? JSON.parse(JSON.stringify(options));

    const builtBindings = this.buildOptionBindings(clonedOptions, isMultipleAnswer);

    try {
      console.log('[loader] configureDynamicInstance', { hasComponentRef: !!componentRef, optionsLen: clonedOptions?.length });
      if (componentRef?.setInput) {
        try { componentRef.setInput('question', { ...question }); } catch {}
        try { componentRef.setInput('optionsToDisplay', clonedOptions); } catch {}
        try { componentRef.setInput('questionData', { ...question, options: clonedOptions }); } catch {}
        try { componentRef.setInput('optionBindings', builtBindings); } catch {}
      }
      // Also set directly via signal API as a guaranteed write path.
      try { instance.question.set({ ...question }); } catch {}
      try { instance.optionsToDisplay.set(clonedOptions); } catch {}
      try { instance.optionBindings.set(builtBindings); } catch {}
      try { if (instance.questionData?.set) instance.questionData.set({ ...question, options: clonedOptions }); } catch {}
      try { componentRef?.changeDetectorRef?.markForCheck(); } catch {}
    } catch (error) {
      console.error('[❌ Assignment failed in loadDynamicComponent]', error, {
        question,
        options: clonedOptions,
      });
      try {
        instance.question.set({ ...question });
        instance.optionsToDisplay.set(clonedOptions);
        instance.optionBindings.set(builtBindings);
      } catch {}
    }

    instance.sharedOptionConfig = this.buildSharedOptionConfig({
      question,
      clonedOptions,
      isMultipleAnswer,
      currentQuestionIndex,
      defaultConfig: params.defaultConfig,
    });

    const questionData = { ...(instance as any).question(), options: clonedOptions };
    const sharedOptionConfig = instance.sharedOptionConfig;

    return { clonedOptions, questionData, sharedOptionConfig };
  }

  /**
   * Performs the post-view-init question setup: sets current question,
   * resolves formatted explanation, and updates UI.
   * Extracted from ngAfterViewInit (lines 772–791).
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
   * Builds the initial data object for the component from a question and options.
   * Extracted from initializeData().
   */
  buildInitialData(
    question: QuizQuestion,
    options: Option[]
  ): {
    questionText: string;
    explanationText: string;
    correctAnswersText: string;
    options: Option[];
  } {
    return {
      questionText: question.questionText,
      explanationText: question.explanation || 'No explanation available',
      correctAnswersText: this.quizService.getCorrectAnswersAsString() || '',
      options: options || [],
    };
  }

  /**
   * Handles the core of loadQuestion after the reset/explanation-clear phase.
   * Starts the timer, fetches questions if needed, validates the index,
   * prepares the component state, and emits to subjects.
   * Returns null if loading should be aborted/failed.
   * Extracted from loadQuestion() in QuizQuestionComponent.
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
    this.timerService.startTimer(this.timerService.timePerQuestion, true);

    // Fetch questions if not already available
    const questionsArray = await this.fetchQuestionsIfNeeded(params.questionsArray);

    // Set totalQuestions before selection messages are computed
    if (questionsArray?.length > 0) {
      this.quizService.totalQuestions = questionsArray.length;
    }

    if (questionsArray.length === 0) return null;

    // Check end of quiz
    const { shouldRedirect } = this.checkEndOfQuiz({
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
   * Loads the question, resets explanation state, and applies explanation transition if answered.
   * Returns state for the component to apply.
   * Extracted from setupRouteChangeHandler().onRouteChange callback.
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

    const currentQuestion = params.questionsArray?.[params.zeroBasedIndex] ?? null;
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

  /**
   * Performs the full quiz data loading and route handler setup.
   * Combines initializeQuizDataAndRouting() and setupRouteChangeHandler().
   * Extracted from QuizQuestionComponent.
   */
  async performQuizDataAndRoutingInit(params: {
    quizId: string | null | undefined;
  }): Promise<{
    questions: QuizQuestion[];
    quiz: any;
  } | null> {
    const questions = await this.loadQuizData(params.quizId);
    if (!questions) return null;

    const activeQuiz = this.quizService.getActiveQuiz();
    return {
      questions,
      quiz: activeQuiz || null,
    };
  }
}
