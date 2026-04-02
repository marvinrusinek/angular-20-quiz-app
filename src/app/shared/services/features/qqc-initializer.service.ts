import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { QuizStateService } from '../state/quizstate.service';
import { ExplanationTextService } from './explanation-text.service';
import { QqcQuestionLoaderService } from './qqc-question-loader.service';

/**
 * Manages initialization logic for QuizQuestionComponent:
 * - Quiz data loading and question array population
 * - Quiz question initialization and option ID assignment
 * - First question setup from route parameters
 * - Display mode subscription initialization
 *
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcInitializerService {

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private questionLoader: QqcQuestionLoaderService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // QUIZ DATA LOADING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Loads quiz data (questions) via the question loader.
   * Returns the loaded questions array or null on failure.
   */
  async loadQuizData(quizId: string | null): Promise<{
    questions: QuizQuestion[] | null;
    quiz: Quiz | null;
    isQuizLoaded: boolean;
  }> {
    const questions = await this.questionLoader.loadQuizData(quizId);
    if (!questions) {
      return { questions: null, quiz: null, isQuizLoaded: false };
    }

    const activeQuiz = this.quizService.getActiveQuiz();
    if (!activeQuiz) {
      console.error('Failed to get the active quiz.');
      return { questions, quiz: null, isQuizLoaded: false };
    }

    return { questions, quiz: activeQuiz, isQuizLoaded: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initializes the quiz question subscription for tracking selected options.
   * Called once during component initialization.
   */
  initializeQuizQuestion(params: {
    quizStateService: QuizStateService;
    quizService: QuizService;
  }): void {
    if (!params.quizStateService || !params.quizService) {
      console.warn('Required services are not available.');
      return;
    }

    // Delegate to component — this method just validates readiness
    console.log('[QqcInitializer] Quiz question initialization validated.');
  }

  /**
   * Sets up the first question based on a route index.
   * Returns the prepared question and options.
   */
  setQuestionFirst(params: {
    index: number;
    questionsArray: QuizQuestion[];
  }): {
    currentQuestion: QuizQuestion | null;
    optionsToDisplay: Option[];
    questionIndex: number;
  } | null {
    const { index, questionsArray } = params;

    if (!questionsArray || questionsArray.length === 0) {
      console.error('[setQuestionFirst] ❌ questionsArray is empty or undefined.');
      return null;
    }

    // Clamp index to valid range
    const questionIndex = Math.max(
      0,
      Math.min(index, questionsArray.length - 1)
    );

    if (questionIndex >= questionsArray.length) {
      console.error(`[setQuestionFirst] ❌ Invalid question index: ${questionIndex}`);
      return null;
    }

    const question = questionsArray[questionIndex];
    if (!question) {
      console.error(`[setQuestionFirst] ❌ No question data available at index: ${questionIndex}`);
      return null;
    }

    // Update quiz service
    this.quizService.setCurrentQuestion(question);

    return {
      currentQuestion: question,
      optionsToDisplay: [...(question.options ?? [])],
      questionIndex,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // QUIZ QUESTIONS AND ANSWERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initializes quiz questions and answers from the route quizId.
   * Fetches questions if not already loaded.
   */
  async initializeQuizQuestionsAndAnswers(params: {
    quizId: string | null;
    currentQuestionIndex: number;
    questionsArray: QuizQuestion[];
    fetchAndProcessQuizQuestions: (quizId: string) => Promise<QuizQuestion[]>;
  }): Promise<{
    questionsArray: QuizQuestion[];
    questions: QuizQuestion[];
  } | null> {
    const { quizId, currentQuestionIndex, questionsArray, fetchAndProcessQuizQuestions } = params;

    try {
      if (!quizId) {
        console.error('Quiz ID is empty after initialization.');
        return null;
      }

      // Fetch and store only if not already fetched
      let result = questionsArray;
      if (!result || result.length === 0) {
        const fetched = await fetchAndProcessQuizQuestions(quizId);
        if (!fetched || fetched.length === 0) {
          console.error('[❌] No questions returned.');
          return null;
        }
        result = fetched;
        console.log('[✅] Quiz questions set once.');
      }

      // Now safe to run post-fetch logic
      await this.quizDataService.asyncOperationToSetQuestion(
        quizId,
        currentQuestionIndex
      );

      return {
        questionsArray: result,
        questions: result,
      };
    } catch (error) {
      console.error('Error initializing quiz questions and answers:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPLANATION PREPARATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Prepares explanation text for a question during initialization.
   * Only processes if the question is already answered.
   */
  async prepareExplanationForQuestion(params: {
    quizId: string;
    questionIndex: number;
    question: QuizQuestion;
    getExplanationText: (index: number) => Promise<string>;
  }): Promise<void> {
    const { quizId, questionIndex, question, getExplanationText } = params;

    try {
      const state = this.quizStateService.getQuestionState(quizId, questionIndex);

      if (state?.isAnswered) {
        try {
          const explanationText = await getExplanationText(questionIndex);

          this.explanationTextService.formattedExplanations[questionIndex] = {
            questionIndex,
            explanation: explanationText || 'No explanation provided.',
          };
        } catch (explanationError) {
          console.error(
            `❌ Failed to fetch explanation for Q${questionIndex}:`,
            explanationError
          );

          this.explanationTextService.formattedExplanations[questionIndex] = {
            questionIndex,
            explanation: 'Unable to load explanation.',
          };
        }
      }
    } catch (fatalError) {
      console.error(
        `Unexpected error during prepareQuestion for Q${questionIndex}:`,
        fatalError
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ROUTE INDEX PARSING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Extracts and normalizes a question index from route snapshot.
   * Returns the 0-based index.
   */
  parseQuestionIndexFromRoute(questionIndexParam: string | null): number {
    const routeIndex = questionIndexParam !== null ? +questionIndexParam : 1;
    return Math.max(0, routeIndex - 1);  // Normalize to 0-based
  }

  /**
   * Parses and validates a route parameter for question index,
   * clamping to valid bounds.
   * Returns the 0-based index.
   */
  handleRouteChangeParsing(params: {
    rawParam: string | null;
    totalQuestions: number;
  }): number {
    const { rawParam, totalQuestions } = params;
    const parsedParam = Number(rawParam);
    let questionIndex = isNaN(parsedParam) ? 1 : parsedParam;

    if (questionIndex < 1 || questionIndex > totalQuestions) {
      console.warn(`[⚠️ Invalid questionIndex param: ${rawParam}. Defaulting to Q1]`);
      questionIndex = 1;
    }

    return questionIndex - 1; // Convert to 0-based
  }

  // ═══════════════════════════════════════════════════════════════
  // DISPLAY MODE INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Sets up the initial display mode subscription.
   * Returns the mode string for the component to react to.
   */
  computeInitialDisplayMode(isAnswered: boolean): 'question' | 'explanation' {
    return isAnswered ? 'explanation' : 'question';
  }
}
