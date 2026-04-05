import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject, firstValueFrom, from, Observable, of, Subject
} from 'rxjs';
import {
  auditTime, catchError, distinctUntilChanged, filter, map, shareReplay, tap
} from 'rxjs/operators';
import _, { isEqual } from 'lodash';

import { QUIZ_DATA, QUIZ_RESOURCES } from '../../quiz';
import { Utils } from '../../utils/utils';
import { QuestionType } from '../../models/question-type.enum';
import { QuizStatus } from '../../models/quiz-status.enum';
import { FinalResult } from '../../models/Final-Result.model';
import { Option } from '../../models/Option.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizResource } from '../../models/QuizResource.model';
import { QuizScore } from '../../models/QuizScore.model';
import { QuizSelectionParams } from '../../models/QuizSelectionParams.model';
import { Resource } from '../../models/Resource.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { QuizStateService } from '../state/quizstate.service';
import { QuizShuffleService } from '../flow/quiz-shuffle.service';
import { QuizDataLoaderService } from './quiz-data-loader.service';
import { QuizQuestionResolverService } from './quiz-question-resolver.service';
import { QuizOptionsService } from './quiz-options.service';
import { QuizScoringService } from './quiz-scoring.service';

@Injectable({ providedIn: 'root' })
export class QuizService {
  currentQuestionIndex = 0;
  activeQuiz: Quiz | null = null;
  quiz: Quiz = QUIZ_DATA[this.currentQuestionIndex];
  quizInitialState: Quiz[] = _.cloneDeep(QUIZ_DATA);
  quizData: Quiz[] | null = this.quizInitialState;
  private _quizData$ = new BehaviorSubject<Quiz[]>([]);
  data: {
    questionText: string,
    correctAnswersText?: string,
    currentOptions: Option[]
  } = {
      questionText: '',
      correctAnswersText: '',
      currentOptions: []
    };
  quizId = (() => {
    try { return localStorage.getItem('quizId') ?? ''; }
    catch { return ''; }
  })();
  quizResources: QuizResource[] = [];
  question: QuizQuestion | null = null;
  private _questions: QuizQuestion[] = [];
  questionsList: QuizQuestion[] = [];

  // Scoring state delegated to QuizScoringService — getters for backwards compat
  public get questionCorrectness(): Map<number, boolean> {
    return this.scoringService.questionCorrectness;
  }
  public set questionCorrectness(val: Map<number, boolean>) {
    this.scoringService.questionCorrectness = val;
  }

  isNavigating = false;

  // Delegate to dataLoader's currentQuizSubject for single source of truth
  private get currentQuizSubject(): BehaviorSubject<Quiz | null> {
    return this.dataLoader.currentQuizSubject$;
  }

  private questionsSubject = new BehaviorSubject<QuizQuestion[]>([]);
  questions$ = this.questionsSubject.asObservable();

  private questionsQuizId: string | null = (() => {
    try { return localStorage.getItem('shuffledQuestionsQuizId'); }
    catch { return null; }
  })();

  private questionToDisplaySource = new BehaviorSubject<string>('');
  public readonly questionToDisplay$: Observable<string> =
    this.questionToDisplaySource.asObservable();

  currentQuestionIndexSource = new BehaviorSubject<number>(0);
  currentQuestionIndex$ = this.currentQuestionIndexSource.asObservable();

  currentOptions: BehaviorSubject<Option[]> = new BehaviorSubject<Option[]>([]);
  selectedOptionsMap: Map<number, SelectedOption[]> = new Map();

  resources: Resource[] = [];

  answers: Option[] = [];
  answersSubject = new Subject<number[]>();

  totalQuestions = 0;
  get correctCount(): number { return this.scoringService.correctCount; }
  set correctCount(val: number) { this.scoringService.correctCount = val; }

  selectedQuiz: Quiz | null = null;
  selectedQuiz$ = new BehaviorSubject<Quiz | null>(null);
  indexOfQuizId: number | null = null;
  startedQuizId = '';
  continueQuizId = '';
  completedQuizId = '';
  quizCompleted = false;
  status = '';

  correctAnswers: Map<string, number[]> = new Map<string, number[]>();
  correctAnswerOptions: Option[] = [];
  numberOfCorrectAnswers = 0;

  public get correctAnswersCountSubject(): BehaviorSubject<number> {
    return this.scoringService.correctAnswersCountSubject;
  }

  private correctAnswersCountTextSource = new BehaviorSubject<string>(
    localStorage.getItem('correctAnswersText') ?? ''
  );

  // Frame-synchronized observable for banner display
  // Smooth banner emission (coalesced with question text)
  public readonly correctAnswersText$ = this.correctAnswersCountTextSource
    .asObservable()
    .pipe(
      // Always emit — including empty clears — but skip null/undefined
      filter((v) => v != null), // keeps '', filters null/undefined
      // Give Angular and questionText$ exactly one paint frame to sync
      auditTime(0),
      // Drop accidental rapid double-emits
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  // Guards to prevent banner flicker during nav
  private _lastBanner = '';  // last text we emitted
  private _pendingBannerTimer: any = null;

  currentQuestionIndexSubject = new BehaviorSubject<number>(0);
  multipleAnswer = false;

  currentQuestionSource: Subject<QuizQuestion | null> =
    new Subject<QuizQuestion | null>();
  currentQuestion: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);
  currentQuestionSubject: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);
  public currentQuestion$: Observable<QuizQuestion | null> =
    this.currentQuestionSubject.asObservable();

  currentOptionsSubject = new BehaviorSubject<Array<Option>>([]);
  totalQuestionsSubject = new BehaviorSubject<number>(0);

  private questionDataSubject = new BehaviorSubject<any>(null);
  questionData$ = this.questionDataSubject.asObservable();

  explanationText: BehaviorSubject<string> = new BehaviorSubject<string>('');
  displayExplanation = false;
  shouldDisplayExplanation = false;

  private readonly shuffleEnabledSubject = new BehaviorSubject<boolean>(
    localStorage.getItem('checkedShuffle') === 'true'
  );
  checkedShuffle$ = this.shuffleEnabledSubject.asObservable();

  public shuffledQuestions: QuizQuestion[] = (() => {
    try {
      // One-time purge of stale cache with corrupted correct flags
      if (!localStorage.getItem('_shuffleCacheV2')) {
        localStorage.removeItem('shuffledQuestions');
        localStorage.removeItem('shuffledQuestionsQuizId');
        localStorage.setItem('_shuffleCacheV2', '1');
        return [];
      }
      const stored = localStorage.getItem('shuffledQuestions');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  })();

  // Canonical question data is stored in dataLoader — access via getters below
  private get canonicalQuestionsByQuiz(): Map<string, QuizQuestion[]> {
    return this.dataLoader.getCanonicalQuestionsByQuiz();
  }
  private get canonicalQuestionIndexByText(): Map<string, Map<string, number>> {
    return this.dataLoader.getCanonicalQuestionIndexByText();
  }

  correctMessage = '';
  correctOptions: Option[] = [];
  selectedOption$ = new BehaviorSubject<string | null>(null);

  userAnswers: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('userAnswers') ?? '[]'); }
    catch { return []; }
  })();
  previousAnswers: string[] = [];

  optionsSource: Subject<Option[]> = new Subject<Option[]>();
  private optionsSubject = new BehaviorSubject<Option[]>([]);

  nextQuestionSource = new BehaviorSubject<QuizQuestion | null>(null);
  nextQuestionSubject = new BehaviorSubject<QuizQuestion | null>(null);
  nextQuestion$ = this.nextQuestionSubject.asObservable();

  nextOptionsSource = new BehaviorSubject<Option[]>([]);
  nextOptionsSubject = new BehaviorSubject<Option[]>([]);
  nextOptions$ = this.nextOptionsSubject.asObservable();

  previousQuestionSubject = new BehaviorSubject<QuizQuestion | null>(null);
  previousQuestion$ = this.previousQuestionSubject.asObservable();

  previousOptionsSubject = new BehaviorSubject<Option[]>([]);
  previousOptions$ = this.previousOptionsSubject.asObservable();

  private correctAnswersSubject: BehaviorSubject<Map<string, number[]>> =
    new BehaviorSubject<Map<string, number[]>>(new Map());

  correctAnswersLoadedSubject: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);

  badgeTextSource = new BehaviorSubject<string>('');
  badgeText = this.badgeTextSource.asObservable();

  private nextExplanationTextSource = new BehaviorSubject<string>('');
  nextExplanationText$ = this.nextExplanationTextSource.asObservable();

  private questionsLoadedSource = new BehaviorSubject<boolean>(false);
  questionsLoaded$ = this.questionsLoadedSource.asObservable();

  private quizResetSource = new Subject<void>();
  quizReset$ = this.quizResetSource.asObservable();

  lock = false;

  get score(): number { return this.scoringService.score; }
  set score(val: number) { this.scoringService.score = val; }
  currentScore$: Observable<number> = of(0);
  get quizScore(): QuizScore | null { return this.scoringService.quizScore; }
  set quizScore(val: QuizScore | null) { this.scoringService.quizScore = val; }
  get highScores(): QuizScore[] { return this.scoringService.highScores; }
  set highScores(val: QuizScore[]) { this.scoringService.highScores = val; }
  get highScoresLocal(): any { return this.scoringService.highScoresLocal; }
  set highScoresLocal(val: any) { this.scoringService.highScoresLocal = val; }

  private quizUrl = 'assets/data/quiz.json';
  questionPayloadSubject = new BehaviorSubject<QuestionPayload | null>(null);
  questionPayload$ = this.questionPayloadSubject.asObservable();
  private questionPayloadMap = new Map<number, QuestionPayload>();

  private finalResultSource = new BehaviorSubject<FinalResult | null>(null);
  finalResult$ = this.finalResultSource.asObservable();

  private readonly _preReset$ = new Subject<number>();
  // Emitted with the target question index just before navigation hydrates it
  readonly preReset$ = this._preReset$.asObservable();

  private fetchPromise: Promise<QuizQuestion[]> | null = null;

  destroy$ = new Subject<void>();

  constructor(
    private quizShuffleService: QuizShuffleService,
    private quizStateService: QuizStateService,
    private http: HttpClient,
    public dataLoader: QuizDataLoaderService,
    public questionResolver: QuizQuestionResolverService,
    public optionsService: QuizOptionsService,
    public scoringService: QuizScoringService
  ) {
    this.http = http;
    // Scoring state is loaded in QuizScoringService constructor (loadQuestionCorrectness)
    this.scoringService.restoreScoreFromPersistence(this.quizId);
    this.initializeData();

    // Reset State Sync
    // When quizReset$ emits (e.g. on Shuffle Toggle), clear the internal state cache
    // in QuizStateService. Otherwise, "isAnswered" state for index 0 persists across shuffles.
    this.quizReset$.subscribe(() => {
      console.log('[QuizService] 🧹 Triggering QuizStateService RESET via quizReset$');
      this.quizStateService.reset();
    });
  }

  get questions() {
    // Sync Safeguard
    // Direct access to .questions should ALSO return shuffled data if active.
    // This fixes components (like CodelabQuizContentComponent) that read array indices directly.
    if (this.isShuffleEnabled() && this.shuffledQuestions.length > 0) {
      return this.shuffledQuestions;
    }
    return this._questions;
  }
  set questions(value: any) {
    if (Array.isArray(value) && value.length === 0 && Array.isArray(this._questions) && this._questions.length > 0) {
      console.warn('[QuizService] CLEARING questions array! Trace:');
      console.trace();
    }

    // Prevent shuffled data from overwriting canonical _questions
    // Check if the incoming data is the shuffled array to prevent pollution
    const isIncomingShuffledData =
      this.shuffledQuestions.length > 0 &&
      Array.isArray(value) &&
      value.length > 0 &&
      value === this.shuffledQuestions;

    if (isIncomingShuffledData) {
      console.warn('[QuizService] BLOCKED: Attempted to overwrite _questions with shuffledQuestions reference!');
      // Do NOT update _questions - the canonical data should remain unshuffled
      // But still emit the shuffled questions for subscribers
      this.questionsSubject.next(this.shuffledQuestions);
      return;
    }

    this._questions = value;

    // Sync Safeguard
    // If shuffle is active and we have shuffled questions, DO NOT overwrite with incoming (likely unshuffled) data.
    // Instead, re-emit the shuffled questions to keep everyone in sync.
    // Use isShuffleEnabled() instead of checkedShuffle property
    if (this.isShuffleEnabled() && this.shuffledQuestions.length > 0) {
      console.log('[QuizService] 🔒 Shuffle active: Emitting shuffledQuestions instead of incoming value.');
      this.questionsSubject.next(this.shuffledQuestions);
      this.questionsQuizId = this.quizId ?? null;
    } else {
      this.questionsSubject.next(value);
      this.questionsQuizId = this.quizId ?? null;
    }
  }

  get shuffleEnabled(): boolean {
    return this.isShuffleEnabled();
  }

  initializeData(): void {
    if (!QUIZ_DATA || !Array.isArray(QUIZ_DATA)) {
      console.error('QUIZ_DATA is invalid:', QUIZ_DATA);
      this.quizData = [];
    } else {
      this.quizData = QUIZ_DATA;
    }

    if (this.quizData.length > 0) {
      this.quizInitialState = _.cloneDeep(this.quizData);
      let selectedQuiz;

      if (this.quizId) {
        // Try to find the quiz with the specified ID
        selectedQuiz = this.quizData.find(
          (quiz) => quiz.quizId === this.quizId
        );
        if (!selectedQuiz) {
          console.warn(
            `No quiz found with ID: ${this.quizId}. Falling back to the first quiz.`
          );
        }
      }

      // If no quiz is selected or found, default to the first quiz
      selectedQuiz = selectedQuiz ?? this.quizData[0];
      this.quizId = selectedQuiz.quizId;

      if (
        Array.isArray(selectedQuiz.questions) &&
        selectedQuiz.questions.length > 0
      ) {
        // Create a new array to avoid reference issues
        this.questions = [...selectedQuiz.questions];
      } else {
        console.error(
          `Selected quiz (ID: ${this.quizId}) does not have a valid questions array:`,
          selectedQuiz.questions
        );
        this.questions = [];
      }
    } else {
      console.error('QUIZ_DATA is empty');
      this.questions = [];
    }

    this.quizResources = Array.isArray(QUIZ_RESOURCES) ? QUIZ_RESOURCES : [];

    this.currentQuestion$ = this.currentQuestionSource.asObservable();

    if (!this.questions || this.questions.length === 0) {
      console.warn('Questions array is empty or undefined after initialization');
    } else {
      console.log('Final questions state:', this.questions);
    }

    // Additional check for question structure
    if (this.questions.length > 0) {
      this.totalQuestions = this.questions.length;
      this.totalQuestionsSubject.next(this.totalQuestions);

      const firstQuestion = this.questions[0];
      if (!this.isValidQuestionStructure(firstQuestion)) {
        console.error(
          'First question does not have a valid structure:', firstQuestion
        );
      }
    }
  }

  public setActiveQuiz(quiz: Quiz): void {
    this.activeQuiz = quiz;
    this.quizId = quiz.quizId;
    this.questionsList = quiz.questions ?? [];
    this.questionsSubject.next(quiz.questions ?? []);
    this.questionsQuizId = quiz.quizId;
    this.questions = quiz.questions ?? [];
    this.totalQuestions = (quiz.questions ?? []).length;
    this.totalQuestionsSubject.next(this.totalQuestions);

    // Load resources for this quiz
    this.loadResourcesForQuiz(quiz.quizId);

    // Push quiz into observable stream
    this.currentQuizSubject.next(quiz);
  }

  // Load resources for a specific quiz ID
  loadResourcesForQuiz(quizId: string): void {
    this.dataLoader.loadResourcesForQuiz(quizId);
    this.resources = this.dataLoader.resources;
  }

  getActiveQuiz(): Quiz | null {
    return this.activeQuiz;
  }

  setCurrentQuiz(q: Quiz): void {
    this.activeQuiz = q;
    this.currentQuizSubject.next(q);
    if (q?.quizId) {
      this.quizId = q.quizId;
    }
    if (Array.isArray(q?.questions)) {
      this.questionsList = q.questions;
      this.questionsSubject.next(q.questions);
      this.questionsQuizId = q.quizId;
      this.questions = q.questions;
      this.totalQuestions = q.questions.length;
      this.totalQuestionsSubject.next(this.totalQuestions);
    }
  }

  getCurrentQuiz(): Observable<Quiz | null> {
    return this.dataLoader.getCurrentQuiz(this.quizId, this.activeQuiz);
  }

  getCurrentQuizId(): string {
    return this.quizId;
  }

  setSelectedQuiz(selectedQuiz: Quiz): void {
    this.selectedQuiz$.next(selectedQuiz);
    this.selectedQuiz = selectedQuiz;
  }

  setQuizData(quizData: Quiz[]): void {
    this.quizData = quizData;
    this.dataLoader.quizData = quizData;
  }

  setQuizId(id: string): void {
    if (id && this.questionsQuizId && this.questionsQuizId !== id) {
      this.questionsSubject.next([]);
      this.questionsQuizId = null;
      this.questions = [];
      this.shuffledQuestions = [];
    }
    this.quizId = id;
  }

  setIndexOfQuizId(index: number): void {
    this.indexOfQuizId = index;
  }

  setQuizStatus(value: QuizStatus): void {
    // Hard lock: once completed, status is immutable
    if (this.quizCompleted && value === QuizStatus.CONTINUE) {
      console.warn(
        '[QuizService] ⚠️ Ignoring CONTINUE status after quiz completion'
      );
      return;
    }

    this.status = value;
  }

  setCompletedQuizId(value: string) {
    this.completedQuizId = value;
  }

  setOptions(options: Option[]): void {
    if (!Array.isArray(options) || options.length === 0) {
      console.error('[setOptions] Options are either missing or empty.');
      return;
    }

    this.optionsSubject.next(options);  // emit to options$
  }

  // Return a sanitized array of options for the given question index.
  getOptions(index: number): Observable<Option[]> {
    return this.getQuestionByIndex(index).pipe(
      map((question) => {
        if (!question || !Array.isArray(question.options) || question.options.length === 0) {
          console.warn(`[getOptions] No options found for Q${index}.`);
          return [];
        }

        const deepClone = (obj: any) => JSON.parse(JSON.stringify(obj));
        const normalized = this.cloneOptions(this.sanitizeOptions(question.options));

        // Refine with deep clone
        return normalized.map(opt => deepClone(opt));
      }),
      tap(options => {
        // Broadcast to the app
        this.currentOptionsSubject.next(options);
      }),
      catchError((err) => {
        console.error(`[getOptions] Failed for index ${index}`, err);
        return of([]);
      })
    );
  }

  private cloneOptions(options: Option[] = []): Option[] {
    return this.optionsService.cloneOptions(options);
  }

  sanitizeOptions(options: Option[]): Option[] {
    return this.optionsService.sanitizeOptions(options);
  }

  getQuestionByIndex(index: number): Observable<QuizQuestion | null> {
    return this.questionResolver.getQuestionByIndex(
      index,
      () => this.resolveShuffleQuizId(),
      (idx, q) => this.resolveCanonicalQuestion(idx, q),
      () => this.isShuffleEnabled(),
      this.shuffledQuestions,
      this.questions$
    );
  }

  getQuestionsInDisplayOrder(): QuizQuestion[] {
    const shuffled = this.shuffledQuestions ?? [];
    return this.shuffleEnabled && shuffled.length
      ? shuffled
      : (this.questions ?? []);
  }

  async fetchQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
    console.log(`[QuizService] fetchQuizQuestions(${quizId}). hasShuffle=${this.shuffledQuestions?.length}, quizId=${this.quizId}, shouldShuffle=${this.shouldShuffle()}`);

    // Restore persisted shuffled order for THIS quiz on fresh app/tab start.
    // Without this, shuffle can be regenerated with a different order while
    // state/explanations remain index-based, causing Q1 FET index mismatches.
    if (this.shouldShuffle() && (!this.shuffledQuestions || this.shuffledQuestions.length === 0)) {
      try {
        const persistedQuizId = localStorage.getItem('shuffledQuestionsQuizId');
        const persisted = localStorage.getItem('shuffledQuestions');
        if (persistedQuizId === quizId && persisted) {
          const parsed = JSON.parse(persisted);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.shuffledQuestions = parsed;
            this.questionsQuizId = quizId;
            this.quizId = quizId;
            console.log(`[QuizService] Restored persisted shuffledQuestions for quiz ${quizId} (${parsed.length} questions).`);
          }
        }
      } catch {
        // ignore invalid persisted shuffle payloads
      }
    }

    // ALWAYS return existing shuffledQuestions if available.
    // This prevents re-shuffling on every call which causes option order instability
    if (this.shuffledQuestions && this.shuffledQuestions.length > 0) {
      // CRITICAL: Cache Validation
      // Check for stale data where 'correct' flags might be missing (all false) due to previous bugs.
      // If a question has options but NONE are correct, the data is likely corrupted/stale.
      const hasBadData = this.shuffledQuestions.some(q =>
        Array.isArray(q.options) &&
        q.options.length > 1 && // ignore single/zero option edge cases
        !q.options.some(o => o.correct === true)
      );

      if (hasBadData) {
        console.warn('[QuizService] 🧹 Cache Eviction: Detected stale shuffledQuestions (missing correct flags). Purging cache.');
        this.shuffledQuestions = [];
        this._questions = [];
        this.questionsQuizId = null;
        try {
          localStorage.removeItem('shuffledQuestions');
          localStorage.removeItem('shuffledQuestionsQuizId');
        } catch { }
      } else {
        // CRITICAL: Only return cached shuffle if it belongs to the SAME quiz
        // Check both quizId AND questionsQuizId to prevent cross-quiz data leakage
        const isSameQuiz = quizId && this.questionsQuizId === quizId;

        if (isSameQuiz) {
          // One final safety check: if we somehow have questions but they are empty, don't use cache
          if (Array.isArray(this.shuffledQuestions) && this.shuffledQuestions.length > 0) {
            console.log(`[fetchQuizQuestions] Returning EXISTING shuffledQuestions (${this.shuffledQuestions.length} questions) for quiz ${quizId}`);
            this.questionsSubject.next(this.shuffledQuestions);
            return this.shuffledQuestions;
          }
          console.warn('[fetchQuizQuestions] Cache hit but questions array is empty. Proceeding to fetch.');
        } else {
          console.log(`[fetchQuizQuestions] Quiz mismatch - clearing old shuffle. quizId=${quizId}, this.quizId=${this.quizId}, questionsQuizId=${this.questionsQuizId}`);
          // Clear old shuffle for new quiz
          this.shuffledQuestions = [];
          this._questions = [];
          this.questionsQuizId = null;
          try {
            localStorage.removeItem('shuffledQuestions');
            localStorage.removeItem('shuffledQuestionsQuizId');
          } catch { }
        }
      }
    }

    if (this.fetchPromise) {
      console.log('[QuizService] Reuse in-flight fetch promise.');
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        if (!quizId) {
          console.error('Quiz ID is not provided or is empty:', quizId);
          return [];
        }

        // 1. Fetch JSON metadata as source of truth
        const quizzes = await firstValueFrom<Quiz[]>(
          this.http.get<Quiz[]>(this.quizUrl)
        );

        const quiz = quizzes.find((q) => String(q.quizId) === String(quizId));
        if (!quiz) {
          console.error(`Quiz with ID ${quizId} not found`);
          return [];
        }

        // Update current quiz metadata immediately for totalQuestions callers
        this.currentQuizSubject.next(quiz);
        this.totalQuestions = quiz.questions?.length || 0;

        // 2. Validate cache: check same quiz ID AND same total question count
        const isSameQuiz = quizId && this.questionsQuizId === quizId;
        const cachedLen = this.shuffledQuestions?.length || 0;
        const metadataLen = quiz.questions?.length || 0;

        const lengthMatches = cachedLen > 0 && cachedLen === metadataLen;

        if (isSameQuiz && lengthMatches) {
          console.log(`[QuizService] fetchQuizQuestions: Cache Hit & Length Match (${cachedLen}). Returning shuffle.`);
          this.questionsSubject.next(this.shuffledQuestions);
          return this.shuffledQuestions;
        }

        // 3. Cache Miss or Update: Re-initialize and (optionally) shuffle
        console.log(`[QuizService] fetchQuizQuestions: ${isSameQuiz ? 'STALE (Length Mismatch)' : 'MISS'}. Expected=${metadataLen}, Found=${cachedLen}`);

        this.shuffledQuestions = [];
        this._questions = [];
        this.questionsQuizId = quizId;

        // Normalization: assign option IDs and align answers
        const normalized: QuizQuestion[] = (quiz.questions ?? []).map((q, qIdx) => {
          const optsWithIds = this.quizShuffleService.assignOptionIds(q.options ?? [], qIdx);
          const alignedAnswers = this.quizShuffleService.alignAnswersWithOptions(q.answer, optsWithIds);

          const correctIds = new Set(alignedAnswers.map(a => Number(a.optionId)));
          const finalOpts = optsWithIds.map(o => ({
            ...o,
            correct: correctIds.has(Number(o.optionId))
          }));

          return {
            ...q,
            options: finalOpts.map(o => ({ ...o })),
            answer: alignedAnswers.map(a => ({ ...a }))
          } as QuizQuestion;
        });

        // Save canonical reference
        this.canonicalQuestionsByQuiz.set(quizId, JSON.parse(JSON.stringify(normalized)));
        this._questions = JSON.parse(JSON.stringify(normalized));

        if (this.shouldShuffle()) {
          console.log('[QuizService] 🔀 Generating fresh shuffle for', quizId);
          this.quizShuffleService.prepareShuffle(quizId, normalized);
          const shuffled = this.quizShuffleService.buildShuffledQuestions(quizId, normalized);

          this.shuffledQuestions = shuffled;
          try {
            localStorage.setItem('shuffledQuestions', JSON.stringify(shuffled));
            localStorage.setItem('shuffledQuestionsQuizId', quizId);
          } catch { }

          this.questionsSubject.next(shuffled);
          return shuffled;
        }

        this.questionsSubject.next(normalized);
        return normalized;
      } catch (error) {
        console.error('Error in fetchQuizQuestions:', error);
        return [];
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  getAllQuestions(): Observable<QuizQuestion[]> {
    // Prioritize shuffled questions if they exist!
    if (this.shuffledQuestions && this.shuffledQuestions.length > 0) {
      console.log('[getAllQuestions] Returning active SHUFFLED questions');
      return of(this.shuffledQuestions);
    }

    if (this.questionsSubject.getValue().length === 0) {
      // Delegate to fetchQuizQuestions which handles normalization AND shuffling!
      // This prevents getAllQuestions from returning raw/unshuffled data that bypasses the shuffle logic.
      return from(this.fetchQuizQuestions(this.quizId));
    }
    return this.questions$;
  }

  public setQuestionData(data: any): void {
    this.questionDataSubject.next(data);
  }

  getQuestionData(
    quizId: string,
    questionIndex: number
  ): {
    questionText: string;
    currentOptions: Option[];
  } | null {
    const currentQuiz = (this.quizData ?? []).find(
      (quiz) => quiz.quizId === quizId
    );

    const questions = currentQuiz?.questions ?? [];
    if (questions.length > questionIndex) {
      const currentQuestion = questions[questionIndex];

      return {
        questionText: currentQuestion.questionText ?? '',
        currentOptions: currentQuestion.options
      };
    }

    return null;
  }

  public setCurrentQuestion(question: QuizQuestion): void {
    if (!question) {
      console.error('[QuizService] Attempted to set a null or undefined question.');
      return;
    }

    const previousQuestion = this.currentQuestion.getValue();

    // Do NOT mutate score when simply navigating between questions.
    // Score should reflect answer correctness events only, not navigation direction.
    // Check for deep comparison result
    const isEqual = this.areQuestionsEqual(previousQuestion, question);
    if (isEqual) {
      console.warn(
        '[QuizService] Question is considered identical to the previous one. Skipping update.'
      );
      return;
    }

    // Verify options structure
    if (!Array.isArray(question.options) || question.options.length === 0) {
      console.error(
        '[QuizService] No valid options array found in the provided question:',
        question
      );
      return;
    }

    // Populate options ensuring necessary properties are present
    const updatedOptions = question.options.map((option, index) => ({
      ...option,
      optionId: option.optionId ?? index,
      correct: option.correct ?? false,
      selected: option.selected ?? false,
      active: option.active ?? true,
      showIcon: option.showIcon ?? false
    }));

    // Construct the updated question object
    const updatedQuestion: QuizQuestion = {
      ...question,
      options: updatedOptions
    };

    // Emit the new question
    this.currentQuestion.next(updatedQuestion);
  }

  public getCurrentQuestion(
    questionIndex: number,
  ): Observable<QuizQuestion | null> {
    return this.questionResolver.getCurrentQuestion(questionIndex, this.questions);
  }

  public getLastKnownOptions(): Option[] {
    return this.currentQuestion.getValue()?.options || [];
  }

  // Get the current options for the current quiz and question
  getCurrentOptions(
    questionIndex: number = this.currentQuestionIndex ?? 0
  ): Observable<Option[]> {
    if (!Number.isInteger(questionIndex) || questionIndex < 0) {
      console.error(
        `Invalid questionIndex: ${questionIndex}. Returning empty options.`
      );
      return of([]);
    }

    return this.getQuestionByIndex(questionIndex).pipe(
      map((question) => {
        if (
          !question ||
          !Array.isArray(question.options) ||
          question.options.length === 0
        ) {
          console.warn(
            `No options found for Q${questionIndex}. Returning empty array.`
          );
          return [];
        }

        const deepClone =
          typeof structuredClone === 'function'
            ? structuredClone
            : (obj: any) => JSON.parse(JSON.stringify(obj));

        // Clone and assign each option defensively
        const sanitized = question.options.map((opt, index) => ({
          ...deepClone(opt),
          optionId: typeof opt.optionId === 'number' ? opt.optionId : index,
          correct: opt.correct ?? false,
          feedback:
            opt.feedback ??
            `Generated feedback for Q${questionIndex} Option ${index}`
        }));

        console.log(
          `[getCurrentOptions] Q${questionIndex} returning ${sanitized.length} options`
        );
        return sanitized;
      }),
      catchError((error) => {
        console.error(`Error fetching options for Q${questionIndex}:`, error);
        return of([]);
      }),
    );
  }

  getCurrentQuestionObservable(): Observable<QuizQuestion | null> {
    return this.currentQuestion.asObservable();
  }

  setCurrentQuestionIndex(idx: number) {
    const safeIndex = Number.isFinite(idx) ? Math.max(0, Math.trunc(idx)) : 0;

    this.currentQuestionIndex = safeIndex;
    this.currentQuestionIndexSource.next(safeIndex);
    this.currentQuestionIndexSubject.next(safeIndex);

    // Restore answers from persistence if available to prevent score decrement on navigation
    const prevSelected = this.selectedOptionsMap.get(safeIndex);

    if (prevSelected && prevSelected.length > 0) {
      // Re-hydrate full Option objects (needing .correct flag) from the source question
      const question = this.questions[safeIndex];  // use getter (handles shuffle)
      if (question && question.options) {
        const selectedIds = new Set(prevSelected.map(s => s.optionId));
        // text-match fallback for robustness
        const restoredAnswers = question.options.filter((o: Option) =>
          selectedIds.has(o.optionId) ||
          prevSelected.some(s => (s.text || '').trim() === (o.text || '').trim())
        );
        this.answers = restoredAnswers;
        console.log(`[QuizService] Restored ${restoredAnswers.length} answers for Q${safeIndex} (preventing score drop)`);
      } else {
        this.answers = [];
      }
    } else {
      this.answers = [];
    }

    this.answersSubject.next(
      this.answers.map(a => a.optionId).filter((id): id is number => typeof id === 'number')
    );
  }

  getCurrentQuestionIndex(): number {
    return this.currentQuestionIndexSource.getValue();
  }

  getCurrentQuestionIndexObservable(): Observable<number> {
    return this.currentQuestionIndexSubject.asObservable();
  }

  // Set the text of the previous user answers in an array to show in the following quiz
  setPreviousUserAnswersText(
    questions: QuizQuestion[],
    previousAnswers: string[]
  ): void {
    this.previousAnswers = previousAnswers.map((answer) => {
      const index = previousAnswers.indexOf(answer);
      const opts = questions[index]?.options ?? [];

      if (Array.isArray(answer)) {
        // Join multiple selected answers into a readable string
        return answer
          .map((ans) => opts.find((option) => option.text === ans)?.text ?? '')
          .join(', ');
      }

      // Single answer
      return opts.find((option) => option.text === answer)?.text ?? '';
    });
  }

  calculateCorrectAnswers(questions: QuizQuestion[]): Map<string, number[]> {
    return this.optionsService.calculateCorrectAnswers(questions);
  }

  getCorrectOptionsForCurrentQuestion(question: QuizQuestion): Option[] {
    const correctOptions = this.optionsService.getCorrectOptionsForCurrentQuestion(question);
    this.correctOptions = correctOptions;
    return correctOptions;
  }

  setCorrectAnswersLoaded(loaded: boolean): void {
    this.correctAnswersLoadedSubject.next(loaded);
  }

  updateCurrentQuestionIndex(index: number): void {
    this.currentQuestionIndex = index;
  }

  updateBadgeText(questionIndex: number, totalQuestions: number): void {
    try {
      console.warn('[updateBadgeText input]', {
        questionIndex,
        totalQuestions
      });

      // Validate inputs
      const isValidIndex =
        Number.isInteger(questionIndex) && questionIndex >= 1;
      const isValidTotal =
        Number.isInteger(totalQuestions) && totalQuestions > 0;

      if (!isValidIndex || !isValidTotal || questionIndex > totalQuestions) {
        console.error(
          `[❌ updateBadgeText] Invalid question number: ${questionIndex} of ${totalQuestions}`
        );
        return;
      }

      const newBadgeText = `Question ${questionIndex} of ${totalQuestions}`;
      const currentBadgeText = this.badgeTextSource.getValue();

      // Avoid unnecessary UI updates
      if (currentBadgeText === newBadgeText) {
        return;
      }

      this.badgeTextSource.next(newBadgeText);
      localStorage.setItem(
        'savedQuestionIndex',
        JSON.stringify(questionIndex - 1)
      );
    } catch (error) {
      console.error('[updateBadgeText] Exception:', error);
    }
  }

  getCurrentBadgeNumber(): number {
    const currentBadgeText = this.badgeTextSource.getValue();  // get the current badge text
    if (!currentBadgeText || currentBadgeText.trim() === '') {
      return 1;  // default if badge text isn't ready
    }

    const match = currentBadgeText.match(/Question (\d+) of \d+/);  // extract the question number
    if (match && match[1]) {
      return parseInt(match[1], 10);  // return parsed badge number
    }

    console.warn(`Unable to extract badge number from: ${currentBadgeText}`);
    return 1;  // default to Question 1 if parsing fails
  }

  public updateCorrectAnswersText(newText: string): void {
    const text = (newText ?? '').trim();

    // Prevent redundant updates (exact same text as before)
    if (this._lastBanner === text) return;

    // Cancel any pending delayed banner timers
    if (this._pendingBannerTimer) {
      clearTimeout(this._pendingBannerTimer);
      this._pendingBannerTimer = null;
    }

    // Cache for comparison and persist later
    this._lastBanner = text;

    // Emit immediately — even empty — for reactive streams
    console.log('[QuizService] updateCorrectAnswersText called with:', text);
    this.correctAnswersCountTextSource.next(text);
    console.log(
      '[QuizService] Emitted banner text to Subject →', JSON.stringify(text)
    );

    // Optional micro-delay to keep UI paint order stable (prevents banner from racing the question text)
    requestAnimationFrame(() => {
      const current = this.correctAnswersCountTextSource.value;
      console.log('[QuizService] 🧮 Banner visible value after RAF:', current);
    });

    // Always persist — even empty — so restored state matches live UI
    try {
      localStorage.setItem('correctAnswersText', text);
    } catch (err) {
      console.warn('[QuizService] Persist failed:', err);
    }
  }

  public clearStoredCorrectAnswersText(): void {
    try {
      localStorage.removeItem('correctAnswersText');
      this.correctAnswersCountTextSource.next('');
      console.log('[QuizService] Cleared correctAnswersText from storage');
    } catch (err) {
      console.warn('[QuizService] Failed to clear correctAnswersText', err);
    }
  }

  // Method to check if the current question is answered
  isAnswered(questionIndex: number): Observable<boolean> {
    const options = this.selectedOptionsMap.get(questionIndex) ?? [];
    const isAnswered = options.length > 0;
    return of(isAnswered);
  }

  get totalQuestions$(): Observable<number> {
    return this.totalQuestionsSubject.asObservable();
  }

  getTotalQuestionsCount(quizId: string): Observable<number> {
    return this.currentQuizSubject.pipe(
      map((quiz) => {
        // Try to get count from the emitted quiz object
        if (quiz && quiz.quizId === quizId) {
          return quiz.questions?.length ?? 0;
        }

        // Fallback: If quiz object missing (e.g. cached/shuffled session), check active state
        // Validation of IDs proved flaky. If we have active questions, return their count.
        if (Array.isArray(this.questions) && this.questions.length > 0) {
          return this.questions.length;
        }

        return 0;
      }),
      distinctUntilChanged(),
    );
  }

  getTotalCorrectAnswers(currentQuestion: QuizQuestion) {
    return this.optionsService.getTotalCorrectAnswers(currentQuestion);
  }

  handleQuestionChange(
    question: QuizQuestion | null,
    selectedOptions: Array<string | number> | null | undefined,
    options: Option[]
  ): {
    updatedOptions: Option[];  // same reference, mutated
    nextQuestion: QuizQuestion | null;  // question with updated options
    questionText: string;  // for UI
    correctAnswersText: string;  // for UI
  } {
    // Logic to update options based on the question
    if (question && Array.isArray(question.options)) {
      // Preserve the SAME array reference the caller passed in
      options.splice(0, options.length, ...question.options);

      // Save state before reset to prevent score loss during navigation
      const savedCorrectness = new Map(this.questionCorrectness);
      const savedSelections = new Map(this.selectedOptionsMap);
      const savedCount = this.correctCount;
      const savedShuffled = this.shuffledQuestions ? [...this.shuffledQuestions] : [];
      const savedQuestions = this._questions ? [...this._questions] : [];
      const savedQuestionsQuizId = this.questionsQuizId;

      this.resetAll();

      // Restore state immediately to maintain score persistence
      this.questionCorrectness = savedCorrectness;
      this.selectedOptionsMap = savedSelections;
      this.correctCount = savedCount;
      if (savedShuffled.length > 0) {
        this.shuffledQuestions = savedShuffled;
      }
      if (savedQuestions.length > 0) {
        this._questions = savedQuestions;
        this.questionsSubject.next(savedQuestions);
      }
      this.questionsQuizId = savedQuestionsQuizId;
    }

    const base = options;  // caller’s array reference

    // Empty state → return empties; caller will handle UI
    if (!Array.isArray(base) || base.length === 0) {
      return {
        updatedOptions: [],
        nextQuestion: question ?? null,
        questionText: question?.questionText ?? '',
        correctAnswersText: ''
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
      nextQuestion && typeof this.buildCorrectAnswerCountLabel === 'function'
        ? this.buildCorrectAnswerCountLabel(nextQuestion, base)
        : '';

    return {
      updatedOptions: base,
      nextQuestion,
      questionText,
      correctAnswersText
    };
  }

  private buildCorrectAnswerCountLabel(
    question: QuizQuestion,
    options: Option[]
  ): string {
    return this.optionsService.buildCorrectAnswerCountLabel(question, options);
  }

  async determineCorrectAnswer(
    question: QuizQuestion,
    answers: Option[]
  ): Promise<boolean[]> {
    return this.optionsService.determineCorrectAnswer(question, answers);
  }

  // Populate correctOptions when questions are loaded
  setCorrectOptions(options: Option[]): void {
    const sanitizedOptions = this.sanitizeOptions(options);  // ensure options are sanitized

    this.correctOptions = sanitizedOptions.filter((option, idx) => {
      const isValid = Number.isInteger(option.optionId);

      if (!isValid) {
        console.warn(`Invalid option at index ${idx}:`, option);
      } else if (option.correct) {
        console.log(`Correct option found at index ${idx}:`, option);
      }
      return isValid && option.correct;
    });
  }

  setCorrectAnswers(
    question: QuizQuestion,
    options: Option[]
  ): Observable<void> {
    return new Observable((observer) => {
      console.log(
        'Setting correct answers for question:', question.questionText
      );

      // Filter and map correct options
      const correctOptionNumbers = options
        .filter((option) => option.correct)
        .map((option) => option.optionId);

      if (correctOptionNumbers.length > 0) {
        // Store the correct answers in the map
        this.correctAnswers.set(
          question.questionText.trim(),
          correctOptionNumbers.filter((n): n is number => n !== undefined)
        );
        this.correctAnswersSubject.next(new Map(this.correctAnswers));
        console.log(
          'Updated correctAnswers map:',
          Array.from(this.correctAnswers.entries())
        );

        observer.next();
        observer.complete();
      } else {
        observer.error(
          `No correct options found for question: "${question.questionText}".`
        );
      }
    });
  }

  getCorrectAnswers(question: QuizQuestion): number[] {
    return this.optionsService.getCorrectAnswers(question);
  }

  getCorrectAnswersAsString(): string {
    return Array.from(this.correctAnswers.values())
      .map((a) => a.join(','))
      .join(';');
  }

  updateAnswersForOption(selectedOption: Option): void {
    if (!this.answers) {
      this.answers = [];
    }

    const isOptionSelected = this.answers.some(
      (answer: Option) => answer.optionId === selectedOption.optionId,
    );

    if (!isOptionSelected) {
      this.answers.push(selectedOption);
    }

    const answerIds = this.answers
      .map((answer: Option) => answer.optionId)
      .filter((id): id is number => id !== undefined);
    this.answersSubject.next(answerIds);

    // Update the persistent userAnswers array for the current question
    if (this.currentQuestionIndex >= 0) {
      if (!this.userAnswers) this.userAnswers = [];
      this.userAnswers[this.currentQuestionIndex] = answerIds;
    }

    console.log(`[updateAnswersForOption] Final answers array: 
      ${JSON.stringify(this.answers.map(a => a.text?.substring(0, 15)))}`);
  }


  returnQuizSelectionParams(): QuizSelectionParams {
    return {
      startedQuizId: this.startedQuizId,
      continueQuizId: this.continueQuizId,
      completedQuizId: this.completedQuizId,
      quizCompleted: this.quizCompleted,
      status: this.status
    };
  }

  setQuestionsLoaded(state: boolean): void {
    console.log('Questions loaded state set to:', state);
    this.questionsLoadedSource.next(state);
  }

  saveHighScores(): void {
    this.scoringService.saveHighScores(this.quizId, this.totalQuestions);
  }

  calculatePercentageOfCorrectlyAnsweredQuestions(): number {
    return this.scoringService.calculatePercentageOfCorrectlyAnsweredQuestions(this.totalQuestions);
  }

  private shouldShuffle(): boolean {
    const should = this.shuffleEnabledSubject.getValue();
    console.log(`[QuizService] shouldShuffle? ${should}`);
    return should;
  }

  isShuffleEnabled(): boolean {
    // Keep using local subject since it's initialized in this service
    return this.shuffleEnabledSubject.getValue();
  }

  // Expose sub-services for direct access by consumers that need them
  get quizDataLoader(): QuizDataLoaderService { return this.dataLoader; }
  get quizQuestionResolver(): QuizQuestionResolverService { return this.questionResolver; }
  get quizOptions(): QuizOptionsService { return this.optionsService; }
  get quizScoring(): QuizScoringService { return this.scoringService; }

  setCheckedShuffle(isChecked: boolean): void {
    this.shuffleEnabledSubject.next(isChecked);
    try {
      localStorage.setItem('checkedShuffle', String(isChecked));

      // Clear stale shuffledQuestions from localStorage to prevent mismatch
      localStorage.removeItem('shuffledQuestions');
      localStorage.removeItem('shuffledQuestionsQuizId');
    } catch { }

    // Clear shuffle state on toggle to ensure fresh shuffle
    // This prevents stale shuffled data from being used when toggling
    this.quizShuffleService.clearAll();
    this.shuffledQuestions = [];

    // Also clear basic questions to force a fresh fetch/shuffle cycle
    this.questions = [];
    this.questionsSubject.next([]);
    this.questionsQuizId = null;

    // Reset score when shuffle is toggled to clear stale questionCorrectness.
    // Otherwise, questions might be marked as "already correct" from previous sessions.
    this.resetScore();

    this.quizId = '';
    console.log(`[setCheckedShuffle] Shuffle=${isChecked}, cleared shuffle state & questions for fresh start`);
  }

  getShuffledQuestions(): Observable<QuizQuestion[]> {
    console.log(`[QuizService] getShuffledQuestions called. stored=${this.shuffledQuestions?.length}`);
    // If we have a stored shuffled session, return it to maintain consistency
    if (this.shuffledQuestions && this.shuffledQuestions.length > 0) {
      console.log('[getShuffledQuestions] Returning stored SHUFFLED session. First ID:', this.shuffledQuestions[0]?.questionText?.substring(0, 10));
      return of(this.shuffledQuestions);
    }

    // If we have cached question data (likely raw from Intro), shuffle it now
    const cachedQuestions = this.questionsSubject.getValue();
    if (Array.isArray(cachedQuestions) && cachedQuestions.length > 0) {
      console.log('[getShuffledQuestions] Found cached raw questions. Shuffling now...');
      const shuffled = this.shuffleQuestions(cachedQuestions);
      console.log('[getShuffledQuestions] Shuffled result First ID:', shuffled[0]?.questionText?.substring(0, 10));
      return of(shuffled);
    }

    const quizId = this.quizId;
    if (!quizId) {
      console.warn('[getShuffledQuestions] Quiz ID not set.');
      return of([]);
    }

    // Fetch from network and shuffle
    return from(this.fetchQuizQuestions(quizId)).pipe(
      map(questions => {
        console.log('[getShuffledQuestions] Questions fetched. Shuffling now...');
        return this.shuffleQuestions(questions);
      })
    );
  }

  shuffleQuestions(questions: QuizQuestion[]): QuizQuestion[] {
    if (this.shouldShuffle() && questions && questions.length > 0) {
      return Utils.shuffleArray([...questions]);  // shuffle a copy for immutability
    }
    console.log('[shuffleQuestions] Skipping shuffle or no questions available.');
    return questions;
  }

  public hasCachedQuestion(quizId: string, questionIndex: number): boolean {
    return this.dataLoader.hasCachedQuestion(quizId, questionIndex);
  }

  private cloneQuestionForSession(question: QuizQuestion, qIndex?: number): QuizQuestion | null {
    return this.questionResolver.cloneQuestionForSession(question, qIndex);
  }

  setCanonicalQuestions(
    quizId: string,
    questions: QuizQuestion[] | null | undefined
  ): void {
    this.dataLoader.setCanonicalQuestions(
      quizId,
      questions,
      (q, idx) => this.cloneQuestionForSession(q, idx),
      (text) => this.normalizeQuestionText(text)
    );
  }

  public getCanonicalQuestions(quizId: string): QuizQuestion[] {
    return this.dataLoader.getCanonicalQuestions(quizId);
  }

  /**
   * Returns a PRISTINE version of the question from the canonical cache.
   * This version has not been shuffled or mutated by user interactions.
   * @param index The original (unshuffled) index of the question.
   */
  public getPristineQuestion(index: number): QuizQuestion | null {
    return this.dataLoader.getPristineQuestion(
      this.quizId,
      index,
      (q, idx) => this.cloneQuestionForSession(q, idx)
    );
  }

  applySessionQuestions(quizId: string, questions: QuizQuestion[]): void {
    if (!quizId) {
      console.warn('[applySessionQuestions] quizId missing.');
      return;
    }

    // Guard: Skip if questions already applied for this quiz
    if (
      this.shuffledQuestions &&
      this.shuffledQuestions.length > 0 &&
      this.quizId === quizId
    ) {
      console.log(`[applySessionQuestions] SKIPPING - already applied for ${quizId}`);
      return;
    }

    // Set quizId first to enable guard for subsequent calls
    this.quizId = quizId;

    // Reset FET state when applying a new session
    // This removes stale explanations from previous runs/quizzes
    try {
      // Use injector or find a way to access ETS without circular dep if possible
      // Assuming we can't inject it in constructor easily due to circular deps, 
      // we might need to rely on the component or a shared state trigger.
      // BUT, let's try to emit an event that ETS listens to?
      // Actually, ETS listens to `active index`.
      // Let's just emit a "reset" event via a Subject that ETS subscribes to?
      // Oh wait, I added resetState() to ETS. I should use it if I can access it.
      // For now, let's trigger it via a new Subject in QuizService if we can't inject.
      this.quizResetSource.next();  // ETS should maybe listen to this?
    } catch (err) { }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.warn('[applySessionQuestions] No questions supplied.');
      return;
    }

    const sanitizedQuestions = questions
      .map((question) => this.cloneQuestionForSession(question))
      .filter((question): question is QuizQuestion => !!question);

    if (sanitizedQuestions.length === 0) {
      console.warn('[applySessionQuestions] Sanitized question list empty.');
      return;
    }

    this.shuffledQuestions = sanitizedQuestions;
    try {
      localStorage.setItem('shuffledQuestions', JSON.stringify(this.shuffledQuestions));
      localStorage.setItem('shuffledQuestionsQuizId', String(this.quizId ?? ''));
    } catch (err) {
      console.warn('Failed to persist shuffledQuestions:', err);
    }
    this.questions = sanitizedQuestions;
    this.questionsList = sanitizedQuestions;
    console.log('[QuizService] applySessionQuestions: Setting questionsSubject to SHUFFLED list. First Q:', sanitizedQuestions[0]?.questionText);
    this.questionsSubject.next(sanitizedQuestions);
    this.questionsQuizId = quizId;

    this.totalQuestions = sanitizedQuestions.length;
    this.totalQuestionsSubject.next(this.totalQuestions);

    const boundedIndex = Math.min(
      Math.max(this.currentQuestionIndex ?? 0, 0),
      sanitizedQuestions.length - 1
    );
    this.currentQuestionIndex = Number.isFinite(boundedIndex)
      ? boundedIndex
      : 0;

    this.currentQuestionIndexSource.next(this.currentQuestionIndex);
    this.currentQuestionIndexSubject.next(this.currentQuestionIndex);

    const currentQuestion =
      sanitizedQuestions[this.currentQuestionIndex] ?? null;
    this.currentQuestionSource.next(currentQuestion);
    this.currentQuestionSubject.next(currentQuestion);
    this.currentQuestion.next(currentQuestion);

    const normalizedOptions = Array.isArray(currentQuestion?.options)
      ? [...currentQuestion.options]
      : [];

    if (currentQuestion) {
      currentQuestion.options = normalizedOptions;
    }

    if (currentQuestion && normalizedOptions.length > 0) {
      this.emitQuestionAndOptions(
        currentQuestion,
        normalizedOptions,
        this.currentQuestionIndex
      );
    } else {
      this.nextQuestionSubject.next(currentQuestion);
      this.nextOptionsSubject.next(normalizedOptions);
    }

    const correctAnswersMap = this.calculateCorrectAnswers(sanitizedQuestions);
    this.correctAnswers = correctAnswersMap;
    this.correctAnswersSubject.next(new Map(correctAnswersMap));

    if (!Array.isArray(this.quizData)) {
      this.quizData = [];
    }

    const baseQuiz =
      this.quizData.find((quiz) => quiz.quizId === quizId) ||
      (Array.isArray(this.quizInitialState)
        ? this.quizInitialState.find((quiz) => quiz.quizId === quizId)
        : undefined) ||
      this.activeQuiz ||
      this.selectedQuiz ||
      ({ quizId } as Quiz);

    const updatedQuiz: Quiz = {
      ...baseQuiz,
      quizId,
      questions: sanitizedQuestions
    };

    const quizIndex = this.quizData.findIndex((quiz) => quiz.quizId === quizId);
    if (quizIndex >= 0) {
      this.quizData[quizIndex] = updatedQuiz;
    } else {
      this.quizData.push(updatedQuiz);
    }

    if (this.activeQuiz?.quizId === quizId || !this.activeQuiz) {
      this.activeQuiz = updatedQuiz;
    }

    if (this.selectedQuiz?.quizId === quizId || !this.selectedQuiz) {
      this.selectedQuiz = updatedQuiz;
    }

    this.currentQuizSubject.next(updatedQuiz);
    this._quizData$.next([...this.quizData]);
    this.questionsSubject.next(sanitizedQuestions);
  }

  initializeSelectedQuizData(selectedQuiz: Quiz): void {
    this.setQuizData([selectedQuiz]);
    this.setSelectedQuiz(selectedQuiz);
  }

  submitQuizScore(userAnswers: number[]): Observable<void> {
    const correctAnswersMap: Map<string, number[]> =
      this.calculateCorrectAnswers(this.questions);

    let score = 0;
    for (const [questionId, answers] of correctAnswersMap.entries()) {
      if (answers.includes(userAnswers[parseInt(questionId)])) {
        score += 1;
      }
    }

    if (!this.selectedQuiz) {
      console.error('No selected quiz found when creating quiz score.');
      return of(void 0);
    }

    const quizScore: QuizScore = {
      quizId: this.selectedQuiz.quizId,
      attemptDateTime: new Date(),
      score: score,
      totalQuestions: this.questions.length
    };
    this.quizScore = quizScore;
    return this.http.post<void>(`${this.quizUrl}/quiz/scores`, quizScore);
  }

  // Helper function to find a quiz by quizId
  findQuizByQuizId(quizId: string): Observable<Quiz | undefined> {
    return this.dataLoader.findQuizByQuizId(quizId);
  }

  // Method to find the index of a question
  findQuestionIndex(question: QuizQuestion | null): number {
    if (!question) {
      console.error('[QuizService] Provided question parameter is null or undefined.');
      return -1;
    }

    if (!this.selectedQuiz) {
      console.error(
        '[QuizService] Quiz data is not properly initialized: selectedQuiz is null'
      );
      return -1;
    }

    if (!Array.isArray(this.selectedQuiz.questions)) {
      console.error(
        '[QuizService] Quiz data is not properly initialized: questions is not an array'
      );
      return -1;
    }

    if (this.selectedQuiz.questions.length === 0) {
      console.error(
        '[QuizService] Quiz data is not properly initialized: questions array is empty'
      );
      return -1;
    }

    // Find and return index for question
    return this.selectedQuiz.questions.findIndex(
      (q) => q.questionText === question.questionText
    );
  }

  isValidQuestionIndex(index: number, data: Quiz | QuizQuestion[]): boolean {
    if (!data) {
      console.error('Data is not provided');
      return false;
    }

    // Check if data is a Quiz object with a questions array
    if (
      data &&
      typeof data === 'object' &&
      'questions' in data &&
      Array.isArray(data.questions)
    ) {
      return index >= 0 && index < data.questions.length;
    }

    // Check if data is directly an array of QuizQuestion
    else if (Array.isArray(data)) {
      return index >= 0 && index < data.length;
    } else {
      console.error('Unexpected data structure:', data);
      return false;
    }
  }

  areQuestionsEqual(
    question1: QuizQuestion | null,
    question2: QuizQuestion | null
  ): boolean {
    if (!question1 || !question2) return false;

    return isEqual(question1, question2);
  }

  resetQuestions(): void {
    let currentQuizData = this.quizInitialState.find(
      (quiz) => quiz.quizId === this.quizId
    );
    if (currentQuizData) {
      this.quizData = _.cloneDeep([currentQuizData]);
      this.questions = currentQuizData.questions ?? [];
      this.setCurrentQuestionIndex(0);
    } else {
      this.quizData = null;
      this.questions = [];
      this.setCurrentQuestionIndex(0);
    }
  }

  // Ensure quiz ID exists, retrieving it if necessary
  async ensureQuizIdExists(): Promise<boolean> {
    const result = await this.dataLoader.ensureQuizIdExists(this.quizId);
    if (result.resolvedId && result.resolvedId !== this.quizId) {
      this.quizId = result.resolvedId;
    }
    return result.exists;
  }

  assignOptionIds(options: Option[], questionIndex: number): Option[] {
    return this.optionsService.assignOptionIds(options, questionIndex);
  }

  private normalizeOptionDisplayOrder(options: Option[] = []): Option[] {
    return this.optionsService.normalizeOptionDisplayOrder(options);
  }

  assignOptionActiveStates(
    options: Option[],
    correctOptionSelected: boolean,
  ): Option[] {
    return this.optionsService.assignOptionActiveStates(options, correctOptionSelected);
  }

  updateUserAnswer(questionIndex: number, answerIds: number[]): void {
    console.log(`[QuizService] 💾 updateUserAnswer(idx=${questionIndex}, ids=${JSON.stringify(answerIds)})`);
    this.userAnswers[questionIndex] = answerIds;
    try {
      localStorage.setItem('userAnswers', JSON.stringify(this.userAnswers));
    } catch (err) {
      console.warn('Failed to persist userAnswers:', err);
    }

    // Live Scoring & Correctness Check
    let question = this.questions[questionIndex];

    if (this.shouldShuffle() && this.quizId) {
      const resolved = this.resolveCanonicalQuestion(questionIndex, null);
      if (resolved) {
        question = resolved;
      }
    }

    if (question && Array.isArray(question.options)) {
      this.answers = answerIds
        .map((id) => {
          // NO Try direct ID match (Property Match)
          let match = question.options.find((o: Option) => o.optionId == id);

          if (!match) {
            // Generated ID Match (e.g. 101 for Q1 Opt 1)
            const qPrefix = (questionIndex + 1).toString();
            const strId = id.toString();
            if (strId.length > qPrefix.length && strId.startsWith(qPrefix)) {
              const suffix = parseInt(strId.substring(qPrefix.length), 10);
              const optIdx = suffix - 1;
              if (question.options[optIdx]) match = question.options[optIdx];
            }
          }

          if (!match) {
            // Text Match (Reliable fallback for clones/disparate IDs)
            const answerId = id;
            match = question.options.find((o: Option) =>
              (o.text && String(o.optionId) === String(answerId)) ||
              (o.text && String(o.value) === String(answerId))
            );
          }

          if (!match && !this.shouldShuffle()) {
            // Fallback: Direct Index Matching for Unshuffled
            if (typeof id === 'number' && id >= 0 && question.options[id]) {
              match = question.options[id];
            }
          }

          if (!match) {
            console.warn(`[QuizService] ⚠️ No match found for Option ID ${id} in Q${questionIndex + 1}. Returning dummy.`);
          }
          return match;
        })
        .filter((o): o is Option => !!o);

      console.log(`[QuizService] updateUserAnswer: Populated answers:`, this.answers.map(a => a.text));
    } else {
      console.warn(`[QuizService] Could not find question/options for Q${questionIndex} during update. questions.length=${this.questions?.length}`);
      this.answers = answerIds.map(id => ({ optionId: id } as Option));
    }

    // For SHUFFLED mode, skip checkIfAnsweredCorrectly here
    // Scoring is handled by scoreDirectly calls in SharedOptionComponent to avoid race conditions
    // For UNSHUFFLED mode, call checkIfAnsweredCorrectly for score verification
    if (!this.shouldShuffle()) {
      // Use updateScore=false here. Actual score mutations are handled by
      // scoreDirectly() calls in OIS and QuizComponent.onOptionSelected.
      // Allowing score mutation here caused decrements when synthetic answer-IDs
      // didn't match the question's real optionId values.
      this.checkIfAnsweredCorrectly(questionIndex, false);
    } else {
      console.log(`[QuizService] SHUFFLED mode: Skipping checkIfAnsweredCorrectly in updateUserAnswer (scoreDirectly handles scoring)`);
    }
  }

  async checkIfAnsweredCorrectly(index: number = -1, updateScore: boolean = false): Promise<boolean> {
    const qIndex = index >= 0 ? index : this.currentQuestionIndex;
    console.log(`[checkIfAnsweredCorrectly] Called for Q${qIndex}. IndexParam=${index}, ServiceIndex=${this.currentQuestionIndex}`);

    let currentQuestionValue: QuizQuestion | null = null;
    if (this.shouldShuffle()) {
      const resolved = this.resolveCanonicalQuestion(qIndex, null);
      if (resolved) currentQuestionValue = resolved;
    } else {
      currentQuestionValue = this.questions[qIndex] ?? this.currentQuestionSubject.getValue();
    }

    if (!currentQuestionValue) {
      console.error(`[checkIfAnsweredCorrectly] No Question Found for Q${qIndex}`);
      return false;
    }

    this.numberOfCorrectAnswers = currentQuestionValue.options.filter(
      (option) => !!option.correct && String(option.correct) !== 'false'
    ).length;
    this.multipleAnswer = this.numberOfCorrectAnswers > 1;

    // Always evaluate using the answer(s) saved for THIS question index.
    // This prevents stale answers from a previous question from affecting score
    // when navigation triggers correctness checks.
    const storedAnswerIds = Array.isArray(this.userAnswers[qIndex])
      ? (this.userAnswers[qIndex] as number[])
      : [];

    this.answers = storedAnswerIds
      .map((id) => {
        const found = currentQuestionValue!.options.find((o: Option) =>
          String(o.optionId) === String(id)
        );
        if (found) return found;

        // Fallback for ID-less questions (where ID = index)
        if (typeof id === 'number') {
          if (id >= 0 && id < currentQuestionValue!.options.length) {
            return currentQuestionValue!.options[id];
          }
          // Try synthetic ID backwards mapping
          if (id > 100) {
            const optIdx = (id % 100) - 1;
            if (optIdx >= 0 && optIdx < currentQuestionValue!.options.length) {
              return currentQuestionValue!.options[optIdx];
            }
          }
        }
        return { optionId: id } as Option;
      })
      .filter((o): o is Option => !!o);

    console.log(`[checkIfAnsweredCorrectly] 📊 Expected Correct Count: ${this.numberOfCorrectAnswers}. User Answers Count: ${this.answers?.length}`);

    if (!this.answers || this.answers.length === 0) {
      console.log(`[checkIfAnsweredCorrectly] Answers empty for Q${qIndex} -> exiting false`);
      return false;
    }

    console.log(`[checkIfAnsweredCorrectly] User Answers:`, this.answers.map(a => `ID=${a.optionId}, Text="${a.text}"`));

    const correctnessArray = await this.determineCorrectAnswer(currentQuestionValue, this.answers);
    const allSelectedAreCorrect = correctnessArray.every((v) => v === true);
    const isCorrect = allSelectedAreCorrect && correctnessArray.length === this.numberOfCorrectAnswers;
    const answerIds = this.answers.map((a) => a.optionId).filter((id): id is number => id !== undefined);

    // If updateScore is explicitly true, then we apply score logic
    if (updateScore) {
      if (answerIds.length > 0) {
        this.incrementScore(answerIds, isCorrect, this.multipleAnswer, qIndex);
      } else {
        console.log(`[checkIfAnsweredCorrectly] No answerIds to score for Q${qIndex}`);
      }
    } else {
      console.log(`[checkIfAnsweredCorrectly] Skipping score mutation for Q${qIndex} (updateScore=false)`);
    }

    return isCorrect;
  }

  /**
   * Simple Scoring: Direct scoring method that bypasses complex answer matching.
   * Call this when you already know whether the user's selection is correct.
   * @param questionIndex The display index of the question
   * @param isCorrect Whether the user's current answer state is correct
   * @param isMultipleAnswer Whether this is a multi-answer question
   */
  public scoreDirectly(questionIndex: number, isCorrect: boolean, isMultipleAnswer: boolean): void {
    this.scoringService.scoreDirectly(questionIndex, isCorrect, isMultipleAnswer, this.shouldShuffle(), this.quizId);
  }

  incrementScore(
    answers: number[],
    correctAnswerFound: boolean,
    isMultipleAnswer: boolean,
    questionIndex: number = -1
  ): void {
    const qIndex = questionIndex >= 0 ? questionIndex : this.currentQuestionIndex;
    this.scoringService.incrementScore(answers, correctAnswerFound, isMultipleAnswer, qIndex, this.shouldShuffle(), this.quizId);
  }

  resetScore(): void {
    this.scoringService.resetScore(this.quizId);
  }

  sendCorrectCountToResults(value: number): void {
    this.scoringService.sendCorrectCountToResults(value, this.quizId);
  }

  resetQuizSessionState(): void {
    this.resetScore();
    console.log(`[QuizService] resetQuizSessionState called. Stack:`);
    console.trace();
    this.isNavigating = false;

    this.currentQuestionIndex = 0;
    this.currentQuestionIndexSource.next(0);
    this.currentQuestionIndexSubject.next(0);

    try {
      localStorage.removeItem('shuffledQuestions');
      localStorage.removeItem('shuffledQuestionsQuizId');
      localStorage.removeItem('selectedOptions');  // clear stale selection data too
    } catch { }

    // Clear shuffled questions to prevent stale data when switching quizzes
    this.shuffledQuestions = [];
    // Also clear regular questions for unshuffled mode
    this.questions = [];
    this.questionsQuizId = null;

    // this.quizId = ''; // clear quizId for fresh shuffle on restart
    // Do NOT clear questions here. Clearing them breaks results display if this method 
    // is called during navigation or cleanup before results are fully rendered.
    // Explicit resets (like resetQuestions or setCheckedShuffle) should handle clearing if needed.
    // this.questions = [];
    // this.questionsList = [];
    // this.questionsSubject.next([]);
    console.log(`[QuizService] resetQuizSessionState called (cleared shuffle & questions)`);

    this.currentQuestionSource.next(null);
    this.currentQuestion.next(null);
    this.currentQuestionSubject.next(null);

    this.nextQuestionSource.next(null);
    this.nextQuestionSubject.next(null);
    this.nextOptionsSource.next([]);
    this.nextOptionsSubject.next([]);
    this.previousQuestionSubject.next(null);
    this.previousOptionsSubject.next([]);

    this.currentOptionsSubject.next([]);
    this.optionsSubject.next([]);
    this.optionsSource.next([]);

    this.questionPayloadSubject.next(null);
    this.answersSubject.next([]);
    this.selectedOption$.next(null);
    this.correctAnswersCountSubject.next(0);
    this.correctAnswersSubject.next(new Map<string, number[]>());
    this.correctAnswersLoadedSubject.next(false);

    this.userAnswers = [];
    try {
      localStorage.removeItem('userAnswers');
    } catch { }
    this.previousAnswers = [];

    this.badgeTextSource.next('');
    this.explanationText.next('');
    this.displayExplanation = false;
    this.shouldDisplayExplanation = false;
    this.resetScore();
    this.quizResetSource.next();
    console.log('[QuizService] resetQuizSessionState complete.');

    // Clear internal scoring state map to prevent stale "wasCorrect" flags
    this.questionCorrectness.clear();
  }

  resetAll(): void {
    console.log('[QuizService] resetAll() called - full state reset');
    this.correctMessage = '';
    this.currentQuestionIndex = 0;
    this.questionCorrectness.clear();
    this.selectedOptionsMap.clear();
    this.userAnswers = [];
    this.previousAnswers = [];
    this.answers = [];
    this.correctAnswerOptions = [];
    this.correctOptions = [];

    // IMPORTANT: Clear shuffledQuestions FIRST to prevent questions setter
    // from re-setting questionsQuizId based on shuffle state
    this.shuffledQuestions = [];
    this._questions = [];  // Direct assignment to avoid setter side effects
    this.questionsList = [];
    this.questionsSubject.next([]);
    this.questionsQuizId = null;

    // NOTE: Do NOT clear this.quizId here - it's needed for in-quiz navigation (pagination dots)
    // The questionsQuizId = null above is sufficient for cache invalidation

    // Clear any in-flight fetch promise to prevent stale data
    this.fetchPromise = null;

    // Reset quiz completion flag for new quiz
    this.quizCompleted = false;

    // Clear multi-answer perfect map so stale entries don't trigger early FET
    (this as any)._multiAnswerPerfect?.clear?.();

    try {
      localStorage.removeItem('userAnswers');
      localStorage.removeItem('questionCorrectness');
      localStorage.removeItem('shuffledQuestions');
      localStorage.removeItem('selectedOptionsMap');
      localStorage.removeItem('highScore');
      console.log('[QuizService] RESET: Storage cleared');
    } catch { }

    this.quizResetSource.next();
  }

  private normalizeQuestionText(value: string | null | undefined): string {
    return this.dataLoader.normalizeQuestionText(value);
  }

  private toNumericId(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private resolveShuffleQuizId(): string | null {
    return (
      this.quizId ||
      this.activeQuiz?.quizId ||
      this.selectedQuiz?.quizId ||
      null
    );
  }

  private resolveCanonicalQuestion(
    index: number,
    currentQuestion?: QuizQuestion | null
  ): QuizQuestion | null {
    const quizId = this.resolveShuffleQuizId();
    if (!quizId) return null;

    // ⚡ FIX: Strict Shuffle Priority
    // If shuffle is enabled, the "canonical" question for this session IS the shuffled question.
    // We should NOT look up the original quiz index 0, because that's a completely different question.
    if (this.isShuffleEnabled() && this.shuffledQuestions && this.shuffledQuestions.length > 0) {
      if (index >= 0 && index < this.shuffledQuestions.length) {
        // Validation: If currentQuestion is provided, ensure it matches the text of the shuffled question
        const shuffledQ = this.shuffledQuestions[index];
        if (currentQuestion && currentQuestion.questionText !== shuffledQ.questionText) {
          console.warn(`[resolveCanonicalQuestion] ⚠️ Index ${index} Mismatch! Shuffled="${shuffledQ.questionText.substring(0, 10)}", Current="${currentQuestion.questionText.substring(0, 10)}"`);
        }
        return shuffledQ;
      }
    }

    const canonical = this.canonicalQuestionsByQuiz.get(quizId) ?? [];
    const source = Array.isArray(this.questions) ? this.questions : [];
    const hasCanonical = canonical.length > 0;
    const shuffleActive = this.shouldShuffle();

    const cloneCandidate = (
      question: QuizQuestion | null | undefined,
      reason: string
    ): QuizQuestion | null => {
      if (!question) return null;

      const clone = this.cloneQuestionForSession(question);
      if (!clone) return null;

      // Ensure 'type' always exists
      if (!clone.type) {
        // Use the original question's type if present, otherwise default
        clone.type = question.type ?? QuestionType.SingleAnswer;
      }

      if (currentQuestion) {
        const incomingText = this.normalizeQuestionText(clone.questionText);
        const currentText = this.normalizeQuestionText(
          currentQuestion.questionText
        );
        if (incomingText && currentText && incomingText !== currentText) {
          console.debug(
            '[resolveCanonicalQuestion] Replacing mismatched question text',
            {
              reason,
              currentText,
              incomingText,
              index
            }
          );
        }
      }

      return clone;
    };

    if (shuffleActive) {
      // Direct Session Return
      // If we have a prepared shuffle session, return the exact instance from it.
      // Do not attempt to map back to canonical indices, which returns original (unshuffled) data.
      if (
        Array.isArray(this.shuffledQuestions) &&
        this.shuffledQuestions.length > index &&
        this.shuffledQuestions[index]
      ) {
        // console.log(`[resolveCanonicalQuestion] Direct return from shuffledQuestions[${index}]`);
        return this.shuffledQuestions[index];
      }

      const base = hasCanonical ? canonical : source;
      if (!Array.isArray(base) || base.length === 0) {
        return cloneCandidate(currentQuestion, 'shuffle-no-base');
      }

      if (hasCanonical) {
        const originalIndex = this.quizShuffleService.toOriginalIndex(
          quizId,
          index
        );

        if (
          typeof originalIndex === 'number' &&
          Number.isInteger(originalIndex) &&
          originalIndex >= 0 &&
          originalIndex < canonical.length
        ) {
          const canonicalClone = cloneCandidate(
            canonical[originalIndex],
            'canonical-original-index'
          );
          if (canonicalClone) return canonicalClone;
        }
      }

      const fromShuffle = this.quizShuffleService.getQuestionAtDisplayIndex(
        quizId,
        index,
        base
      );
      const shuffleClone = cloneCandidate(fromShuffle, 'shuffle-display-index');
      if (shuffleClone) return shuffleClone;

      const baseClone = cloneCandidate(base[index], 'shuffle-base-index');
      if (baseClone) return baseClone;

      // Post-shuffle fallbacks
      if (hasCanonical) {
        const canonicalClone = cloneCandidate(
          canonical[index],
          'canonical-index'
        );
        if (canonicalClone) return canonicalClone;
      }

      if (currentQuestion) {
        const currentKey = this.normalizeQuestionText(
          currentQuestion.questionText
        );
        if (currentKey) {
          const textIndexMap = this.canonicalQuestionIndexByText.get(quizId);
          const mappedIndex = textIndexMap?.get(currentKey);
          if (
            Number.isInteger(mappedIndex) &&
            mappedIndex! >= 0 &&
            mappedIndex! < canonical.length
          ) {
            const mappedClone = cloneCandidate(
              canonical[mappedIndex!],
              'canonical-text-index'
            );
            if (mappedClone) return mappedClone;
          }

          const fallbackMatch = canonical.find(
            (q) => this.normalizeQuestionText(q?.questionText) === currentKey
          );
          const fallbackClone = cloneCandidate(
            fallbackMatch,
            'canonical-text-scan'
          );
          if (fallbackClone) return fallbackClone;
        }
      }

      return cloneCandidate(
        currentQuestion ?? source[index] ?? null,
        'current-fallback'
      );
    }

    // Non-shuffle path
    const sourceClone = cloneCandidate(source[index], 'source-index');
    return sourceClone ?? null;
  }

  private mergeOptionsWithCanonical(
    question: QuizQuestion,
    incoming: Option[] = []
  ): Option[] {
    return this.optionsService.mergeOptionsWithCanonical(question, incoming);
  }

  emitQuestionAndOptions(
    currentQuestion: QuizQuestion,
    options: Option[],
    indexOverride?: number
  ): void {
    if (!currentQuestion) {
      console.warn('[emitQuestionAndOptions] Missing question data.');
      return;
    }

    const rawOptions = Array.isArray(options) ? options : [];
    const normalizedIndex = Number.isFinite(indexOverride as number)
      ? Math.max(0, Math.trunc(indexOverride as number))
      : Number.isFinite(this.currentQuestionIndex)
        ? Math.max(0, Math.trunc(this.currentQuestionIndex as number))
        : 0;

    let questionToEmit = currentQuestion;
    let optionsToUse = rawOptions;

    // Log what we are trying to emit
    if (this.isShuffleEnabled()) {
      console.log(`[emitQA] ⚡ Shuffle Active. Emitting from currentQuestion directly.`);
      console.log(`[emitQA] Question: "${currentQuestion?.questionText?.substring(0, 20)}..."`);
      console.log(`[emitQA] Options[0]: "${currentQuestion?.options?.[0]?.text?.substring(0, 20)}..."`);
    }

    // If shuffle is enabled, trust the questions/options passed in.
    if (this.isShuffleEnabled()) {
      optionsToUse = this.normalizeOptionDisplayOrder(rawOptions ?? []).map(
        (option, index) => ({
          ...option,
          optionId: this.toNumericId(option.optionId, index + 1),
          displayOrder: index,
          correct: (option.correct as any) === true || (option.correct as any) === 'true',
          selected: option.selected === true,
          highlight: option.highlight ?? false,
          showIcon: option.showIcon ?? false
        })
      );
    } else {
      const canonical = this.resolveCanonicalQuestion(
        normalizedIndex,
        currentQuestion
      );

      if (canonical) {
        const sameQuestion =
          this.normalizeQuestionText(canonical?.questionText) ===
          this.normalizeQuestionText(currentQuestion?.questionText);

        if (!sameQuestion) {
          questionToEmit = {
            ...canonical,
            explanation:
              canonical.explanation ?? currentQuestion.explanation ?? ''
          };
          optionsToUse = Array.isArray(canonical.options)
            ? canonical.options.map((option) => ({ ...option }))
            : [];
        } else {
          questionToEmit = {
            ...currentQuestion,
            explanation:
              canonical.explanation ?? currentQuestion.explanation ?? '',
            options: Array.isArray(canonical.options)
              ? canonical.options.map((option) => ({ ...option }))
              : []
          };
        }

        optionsToUse = this.mergeOptionsWithCanonical(
          questionToEmit,
          optionsToUse
        );
      } else {
        optionsToUse = this.normalizeOptionDisplayOrder(optionsToUse ?? []).map(
          (option, index) => ({
            ...option,
            optionId: this.toNumericId(option.optionId, index + 1),
            displayOrder: index,
            correct: option.correct === true,
            selected: option.selected === true,
            highlight: option.highlight ?? false,
            showIcon: option.showIcon ?? false
          })
        );
      }
    }

    if (!optionsToUse.length) {
      console.warn(
        '[emitQuestionAndOptions] No options available after normalization.'
      );
      return;
    }

    const normalizedOptions = optionsToUse.map((option) => ({ ...option }));
    const normalizedQuestion = {
      ...questionToEmit,
      options: normalizedOptions
    };

    // Safeguard: Only mutate currentQuestion if we are NOT in shuffle mode,
    // or if we are sure we aren't creating a mixed source.
    // In shuffle mode, currentQuestion SHOULD be the shuffled instance.
    // Assigning normalizedQuestion (which uses currentQuestion properties) is redundant but safe,
    // UNLESS optionsToUse came from a different source.
    if (!this.isShuffleEnabled()) {
      Object.assign(currentQuestion, normalizedQuestion);
    } else {
      // In Shuffle mode, we just update the internal state of the question (e.g. options ref)
      // but we do NOT merge properties blindly from potential canonical fallbacks.
      currentQuestion.options = normalizedOptions;
    }

    questionToEmit = normalizedQuestion;
    optionsToUse = normalizedOptions;

    // Emit to individual subjects
    this.nextQuestionSubject.next(questionToEmit);
    this.updateCurrentQuestion(questionToEmit);  // manually trigger text update
    this.nextOptionsSubject.next(optionsToUse);

    // Emit the combined payload
    this.questionPayloadSubject.next({
      question: questionToEmit,
      options: optionsToUse,
      explanation: questionToEmit.explanation ?? ''
    });
  }

  // When the service receives a new question (usually in a method
  // that loads the next question), push the text into the source:
  public updateCurrentQuestion(question: QuizQuestion): void {
    const qText =
      (question.questionText ?? '').trim() || 'No question available';
    console.log(
      `[QuizService] Updating question text: "${qText.slice(0, 80)}"`
    );
    this.questionToDisplaySource.next(qText);
  }

  /**
   * Clears any cached question payloads so a stale BehaviorSubject value
   * from a previous run cannot leak into a freshly loaded quiz.
   */
  resetQuestionPayload(): void {
    this.questionPayloadSubject.next(null);
    this.questionPayloadMap.clear();
  }

  private isValidQuestionStructure(question: any): boolean {
    return this.dataLoader.isValidQuestionStructure(question);
  }

  setFinalResult(result: FinalResult): void {
    this.finalResultSource.next(result);

    try {
      sessionStorage.setItem('finalResult', JSON.stringify(result));
    } catch (err) {
      console.warn('[QuizService] Unable to persist finalResult', err);
    }
  }

  getFinalResultSnapshot(): FinalResult | null {
    // Prefer in-memory snapshot
    const live = this.finalResultSource.value;
    if (live) return live;

    // Fallback to sessionStorage (tab switch / reload safe)
    try {
      const raw = sessionStorage.getItem('finalResult');
      return raw ? (JSON.parse(raw) as FinalResult) : null;
    } catch (err) {
      console.warn('[QuizService] Unable to restore finalResult', err);
      return null;
    }
  }

  clearFinalResult(): void {
    this.finalResultSource.next(null);
    try {
      sessionStorage.removeItem('finalResult');
    } catch { }
  }

  resetQuizSessionForNewRun(quizId: string): void {
    // In-memory flags
    this.quizCompleted = false;
    this.currentQuestionIndex = 0;
    this.setQuizStatus(QuizStatus.STARTED);

    // CRITICAL: Reset the score to 0 for the new quiz run
    this.resetScore();

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
}