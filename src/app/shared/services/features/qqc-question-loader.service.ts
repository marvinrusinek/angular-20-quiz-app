import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { OptionBindings } from '../../models/OptionBindings.model';
import { SharedOptionConfig } from '../../models/SharedOptionConfig.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { NextButtonStateService } from '../state/next-button-state.service';
import { ExplanationTextService } from './explanation-text.service';
import { TimerService } from './timer.service';

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
}
