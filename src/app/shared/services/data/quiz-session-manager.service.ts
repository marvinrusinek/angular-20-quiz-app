import { Injectable, WritableSignal } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { Option } from '../../models/Option.model';
import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizStatus } from '../../models/quiz-status.enum';
import { SelectedOption } from '../../models/SelectedOption.model';
import { QuizOptionsService } from './quiz-options.service';
import { QuizQuestionResolverService } from './quiz-question-resolver.service';
import { QuizDataLoaderService } from './quiz-data-loader.service';
import { QuizScoringService } from './quiz-scoring.service';

/**
 * Interface describing the QuizService state that the session manager
 * needs to read and mutate. Keeps the dependency loosely coupled.
 */
export interface QuizSessionState {
  quizId: string;
  currentQuestionIndex: number;
  quizCompleted: boolean;
  multipleAnswer: boolean;
  activeQuiz: Quiz | null;
  selectedQuiz: Quiz | null;
  quizData: Quiz[] | null;
  quizInitialState: Quiz[];
  shuffledQuestions: QuizQuestion[];
  answers: Option[];
  correctAnswers: Map<string, number[]>;
  userAnswers: any[];
  selectedOptionsMap: Map<number, SelectedOption[]>;
  correctCount: number;
  totalQuestions: number;

  // Subjects that need to be emitted to
  currentQuestionSource: Subject<QuizQuestion | null>;
  currentQuestion: BehaviorSubject<QuizQuestion | null>;
  currentQuestionSubject: BehaviorSubject<QuizQuestion | null>;
  currentQuestionIndexSig: WritableSignal<number>;
  nextQuestionSubject: BehaviorSubject<QuizQuestion | null>;
  nextOptionsSubject: BehaviorSubject<Option[]>;
  previousQuestionSubject: BehaviorSubject<QuizQuestion | null>;
  currentOptionsSubject: BehaviorSubject<Array<Option>>;
  optionsSource: Subject<Option[]>;
  questionPayloadSubject: BehaviorSubject<any>;
  totalQuestionsSig: WritableSignal<number>;
  badgeTextSig: WritableSignal<string>;

  // Methods that need to be called
  get questions(): QuizQuestion[];
  set questions(val: QuizQuestion[]);
  get questionCorrectness(): Map<number, boolean>;
  set questionCorrectness(val: Map<number, boolean>);
  emitQuestionAndOptions(q: QuizQuestion, opts: Option[], idx?: number): void;
  updateCurrentQuestion(q: QuizQuestion): void;
  resetAll(): void;
  resetScore(): void;
  setQuizStatus(val: QuizStatus): void;
  isShuffleEnabled(): boolean;
}

/**
 * Manages quiz session lifecycle: applying session questions, handling
 * question transitions, and resetting state. Extracted from QuizService
 * to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizSessionManagerService {
  constructor(
    private optionsService: QuizOptionsService,
    private questionResolver: QuizQuestionResolverService,
    private dataLoader: QuizDataLoaderService,
    private scoringService: QuizScoringService
  ) {}

  /**
   * Handles a question change event: splices new options into the caller's
   * array, performs a save-reset-restore cycle to prevent score loss, then
   * updates option selection state.
   */
  handleQuestionChange(
    state: QuizSessionState,
    question: QuizQuestion | null,
    selectedOptions: Array<string | number> | null | undefined,
    options: Option[],
    _questions: QuizQuestion[],
    questionsSig: WritableSignal<QuizQuestion[]>,
    questionsQuizId: string | null
  ): {
    updatedOptions: Option[];
    nextQuestion: QuizQuestion | null;
    questionText: string;
    correctAnswersText: string;
    restoredQuestionsQuizId: string | null;
  } {
    if (question && Array.isArray(question.options)) {
      // Preserve the SAME array reference the caller passed in
      options.splice(0, options.length, ...question.options);

      // Save state before reset to prevent score loss during navigation
      const savedCorrectness = new Map(state.questionCorrectness);
      const savedSelections = new Map(state.selectedOptionsMap);
      const savedCount = state.correctCount;
      const savedShuffled = state.shuffledQuestions ? [...state.shuffledQuestions] : [];
      const savedQuestions = _questions ? [..._questions] : [];
      const savedQuestionsQuizId = questionsQuizId;

      state.resetAll();

      // Restore state immediately to maintain score persistence
      state.questionCorrectness = savedCorrectness;
      state.selectedOptionsMap = savedSelections;
      state.correctCount = savedCount;
      if (savedShuffled.length > 0) {
        state.shuffledQuestions = savedShuffled;
      }
      if (savedQuestions.length > 0) {
        state.questions = savedQuestions;
        questionsSig.set(savedQuestions);
      }
      questionsQuizId = savedQuestionsQuizId;
    }

    const base = options;

    // Empty state → return empties; caller will handle UI
    if (!Array.isArray(base) || base.length === 0) {
      return {
        updatedOptions: [],
        nextQuestion: question ?? null,
        questionText: question?.questionText ?? '',
        correctAnswersText: '',
        restoredQuestionsQuizId: questionsQuizId
      };
    }

    const selSet = new Set(
      (Array.isArray(selectedOptions) ? selectedOptions : [])
        .filter((v) => v != null)
        .map((v) => String(v))
    );

    for (const opt of base as any[]) {
      const valueToken = String(opt?.value ?? '');
      const idToken = String(opt?.optionId ?? '');

      const isSelected =
        selSet.size > 0 && (selSet.has(valueToken) || selSet.has(idToken));

      opt.selected = isSelected;
      opt.highlight = isSelected ? true : !!opt.highlight;
      if (typeof opt.active !== 'boolean') opt.active = true;
    }

    const nextQuestion = question ? { ...question, options: base } : null;
    const questionText = question?.questionText ?? '';
    const correctAnswersText =
      nextQuestion && typeof this.optionsService.buildCorrectAnswerCountLabel === 'function'
        ? this.optionsService.buildCorrectAnswerCountLabel(nextQuestion, base)
        : '';

    return {
      updatedOptions: base,
      nextQuestion,
      questionText,
      correctAnswersText,
      restoredQuestionsQuizId: questionsQuizId
    };
  }

  /**
   * Applies a set of session questions (typically shuffled) to the quiz state.
   * Sets up questions, indices, quiz data, and emits to all reactive subjects.
   */
  applySessionQuestions(
    state: QuizSessionState,
    quizId: string,
    questions: QuizQuestion[],
    questionsSig: WritableSignal<QuizQuestion[]>,
    quizResetSource: Subject<void>
  ): string | null {
    if (!quizId) {      return null;
    }

    // Guard: Skip if questions already applied for this quiz
    if (
      state.shuffledQuestions &&
      state.shuffledQuestions.length > 0 &&
      state.quizId === quizId
    ) {      return null;
    }

    // Set quizId first to enable guard for subsequent calls
    state.quizId = quizId;

    try {
      quizResetSource.next();
    } catch { }

    if (!Array.isArray(questions) || questions.length === 0) {      return null;
    }

    const sanitizedQuestions = questions
      .map((question) => this.questionResolver.cloneQuestionForSession(question))
      .filter((question): question is QuizQuestion => !!question);

    if (sanitizedQuestions.length === 0) {      return null;
    }

    state.shuffledQuestions = sanitizedQuestions;
    try {
      localStorage.setItem('shuffledQuestions', JSON.stringify(state.shuffledQuestions));
      localStorage.setItem('shuffledQuestionsQuizId', String(state.quizId ?? ''));
    } catch (err) {    }
    state.questions = sanitizedQuestions;
    questionsSig.set(sanitizedQuestions);

    const newQuizId = quizId;

    state.totalQuestions = sanitizedQuestions.length;
    state.totalQuestionsSig.set(state.totalQuestions);

    const boundedIndex = Math.min(
      Math.max(state.currentQuestionIndex ?? 0, 0),
      sanitizedQuestions.length - 1
    );
    state.currentQuestionIndex = Number.isFinite(boundedIndex)
      ? boundedIndex
      : 0;

    state.currentQuestionIndexSig.set(state.currentQuestionIndex);

    const currentQuestion =
      sanitizedQuestions[state.currentQuestionIndex] ?? null;
    state.currentQuestionSource.next(currentQuestion);
    state.currentQuestionSubject.next(currentQuestion);
    state.currentQuestion.next(currentQuestion);

    const normalizedOptions = Array.isArray(currentQuestion?.options)
      ? [...currentQuestion.options]
      : [];

    if (currentQuestion) {
      currentQuestion.options = normalizedOptions;
    }

    if (currentQuestion && normalizedOptions.length > 0) {
      state.emitQuestionAndOptions(
        currentQuestion,
        normalizedOptions,
        state.currentQuestionIndex
      );
    } else {
      state.nextQuestionSubject.next(currentQuestion);
      state.nextOptionsSubject.next(normalizedOptions);
    }

    const correctAnswersMap = this.optionsService.calculateCorrectAnswers(sanitizedQuestions);
    state.correctAnswers = correctAnswersMap;

    if (!Array.isArray(state.quizData)) {
      state.quizData = [];
    }

    const baseQuiz =
      state.quizData.find((quiz) => quiz.quizId === quizId) ||
      (Array.isArray(state.quizInitialState)
        ? state.quizInitialState.find((quiz) => quiz.quizId === quizId)
        : undefined) ||
      state.activeQuiz ||
      state.selectedQuiz ||
      ({ quizId } as Quiz);

    const updatedQuiz: Quiz = {
      ...baseQuiz,
      quizId,
      questions: sanitizedQuestions
    };

    const quizIndex = state.quizData.findIndex((quiz) => quiz.quizId === quizId);
    if (quizIndex >= 0) {
      state.quizData[quizIndex] = updatedQuiz;
    } else {
      state.quizData.push(updatedQuiz);
    }

    if (state.activeQuiz?.quizId === quizId || !state.activeQuiz) {
      state.activeQuiz = updatedQuiz;
    }

    if (state.selectedQuiz?.quizId === quizId || !state.selectedQuiz) {
      state.selectedQuiz = updatedQuiz;
    }

    questionsSig.set(sanitizedQuestions);

    return newQuizId;
  }

  /**
   * Resets all quiz session state for starting a new run.
   * Clears in-memory flags and removes stored resume/index/session leftovers.
   */
  resetQuizSessionForNewRun(state: QuizSessionState, quizId: string): void {
    state.quizCompleted = false;
    state.currentQuestionIndex = 0;
    state.setQuizStatus(QuizStatus.STARTED);

    // CRITICAL: Reset the score to 0 for the new quiz run
    state.resetScore();

    // Remove any stored resume/index/session leftovers
    try {
      localStorage.removeItem('currentQuestionIndex');
      localStorage.removeItem('savedQuestionIndex');
      localStorage.removeItem('userAnswers');
      localStorage.removeItem('selectedOptionsMap');
      localStorage.removeItem('answeredMap');
      localStorage.removeItem('currentQuestionType');

      // If you store per-quiz keys, also remove those patterns:
      localStorage.removeItem(`quizState_${quizId}`);
      localStorage.removeItem(`quizResumeIndex_${quizId}`);
    } catch { }
  }

  /**
   * Full session state reset: clears indices, subjects, scoring, and persistence.
   */
  resetQuizSessionState(state: QuizSessionState, quizResetSource: Subject<void>): void {
    state.resetScore();
    state.currentQuestionIndex = 0;
    state.currentQuestionIndexSig.set(0);

    try {
      localStorage.removeItem('shuffledQuestions');
      localStorage.removeItem('shuffledQuestionsQuizId');
      localStorage.removeItem('selectedOptions');
    } catch { }

    // Clear per-question selection/display keys so stale highlights
    // from a previous session don't leak into the new quiz run.
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('sel_Q') || key?.startsWith('displayMode_')) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        sessionStorage.removeItem(key);
      }
    } catch { }

    // Clear shuffled questions to prevent stale data when switching quizzes
    state.shuffledQuestions = [];
    // Also clear regular questions for unshuffled mode
    state.questions = [];

    state.currentQuestionSource.next(null);
    state.currentQuestion.next(null);
    state.currentQuestionSubject.next(null);
    state.nextQuestionSubject.next(null);
    state.nextOptionsSubject.next([]);
    state.previousQuestionSubject.next(null);
    state.currentOptionsSubject.next([]);
    state.optionsSource.next([]);
    state.questionPayloadSubject.next(null);
    this.scoringService.correctAnswersCountSig.set(0);
    state.userAnswers = [];
    try { localStorage.removeItem('userAnswers'); } catch { }
    state.badgeTextSig.set('');
    state.resetScore();
    quizResetSource.next();
    state.questionCorrectness.clear();
  }
}
