import { Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject, firstValueFrom, from, Observable, of, Subject
} from 'rxjs';
import {
  auditTime, catchError, distinctUntilChanged, filter, map, shareReplay,
  take, tap
} from 'rxjs/operators';
import _, { isEqual } from 'lodash';

import { QUIZ_DATA, QUIZ_RESOURCES } from '../quiz';
import { Utils } from '../utils/utils';
import { QuestionType } from '../models/question-type.enum';
import { QuizStatus } from '../models/quiz-status.enum';
import { FinalResult } from '../models/Final-Result.model';
import { Option } from '../models/Option.model';
import { QuestionPayload } from '../models/QuestionPayload.model';
import { Quiz } from '../models/Quiz.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { QuizResource } from '../models/QuizResource.model';
import { QuizScore } from '../models/QuizScore.model';
import { QuizSelectionParams } from '../models/QuizSelectionParams.model';
import { Resource } from '../models/Resource.model';
import { SelectedOption } from '../models/SelectedOption.model';
import { QuizStateService } from './quizstate.service';
import { QuizShuffleService } from './quiz-shuffle.service';

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

  // State tracking for scoring (Index -> IsCorrect)
  private questionCorrectness = new Map<number, boolean>();

  isNavigating = false;

  private currentQuizSubject = new BehaviorSubject<Quiz | null>(null);

  private questionsSubject = new BehaviorSubject<QuizQuestion[]>([]);
  questions$ = this.questionsSubject.asObservable();
  private questionsQuizId: string | null = null;

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
  correctCount = Number(localStorage.getItem('correctAnswersCount')) || 0;

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

  public correctAnswersCountSubject = new BehaviorSubject<number>(
    Number(localStorage.getItem('correctAnswersCount')) || 0
  );

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
      const stored = localStorage.getItem('shuffledQuestions');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  })();

  private canonicalQuestionsByQuiz = new Map<string, QuizQuestion[]>();
  private canonicalQuestionIndexByText = new Map<string, Map<string, number>>();

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

  score = 0;
  currentScore$: Observable<number> = of(0);
  quizScore: QuizScore | null = null;
  highScores: QuizScore[] = [];
  highScoresLocal = JSON.parse(localStorage.getItem('highScoresLocal') ?? '[]');

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
    private activatedRoute: ActivatedRoute,
    private http: HttpClient
  ) {
    this.http = http;
    this.loadQuestionCorrectness();  // load persisted correctness state
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

  getQuizName(segments: any[]): string {
    return segments[1].toString();
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
    const quizResource = this.quizResources.find(r => r.quizId === quizId);
    this.resources = quizResource?.resources ?? [];
    console.log(`[QuizService] Loaded ${this.resources.length} resources for quiz: ${quizId}`);
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
    if (this.activeQuiz) {
      return of(this.activeQuiz);
    }

    const quiz = Array.isArray(this.quizData)
      ? this.quizData.find((quiz) => quiz.quizId === this.quizId)
      : null;

    if (!quiz) {
      console.warn(`No quiz found for quizId: ${this.quizId}`);
    }

    return of(quiz ?? null);
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
    // 🔒 Hard lock: once completed, status is immutable
    if (this.quizCompleted === true && value === QuizStatus.CONTINUE) {
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
    return options.map((option) => ({ ...option }));
  }

  sanitizeOptions(options: Option[]): Option[] {
    if (!Array.isArray(options)) {
      console.warn('[sanitizeOptions] options is not an array');
      return [];
    }

    return options.map((opt, idx) => {
      const safeId =
        Number.isInteger(opt?.optionId) && (opt?.optionId as number) >= 0
          ? (opt.optionId as number)
          : idx + 1;

      const safeText = (opt?.text ?? '').trim() || `Option ${idx + 1}`;
      const normalizedHighlight =
        typeof opt?.highlight === 'boolean' ? opt.highlight : !!opt?.highlight;
      const normalizedActive =
        typeof opt?.active === 'boolean' ? opt.active : true;

      const sanitized: Option = {
        ...opt,
        optionId: safeId,
        text: safeText,
        correct: opt?.correct === true,
        value: typeof opt?.value === 'number' ? opt.value : safeId,
        answer: opt?.answer ?? undefined,
        selected: opt?.selected === true,
        active: normalizedActive,
        highlight: normalizedHighlight,
        showIcon: opt?.showIcon === true,
        showFeedback:
          typeof opt?.showFeedback === 'boolean' ? opt.showFeedback : false,
        feedback: (opt?.feedback ?? 'No feedback available').trim(),
        styleClass: opt?.styleClass ?? ''
      };

      if (typeof opt?.displayOrder === 'number') {
        sanitized.displayOrder = opt.displayOrder;
      }

      return sanitized;
    });
  }

  getSafeOptionId(option: SelectedOption, index: number): number | undefined {
    // Ensure optionId exists and is a number
    if (option && typeof option.optionId === 'number') {
      return option.optionId;
    }

    console.warn(
      `Invalid or missing optionId. Falling back to index: ${index}`
    );
    return index;
  }

  getQuestionByIndex(index: number): Observable<QuizQuestion | null> {
    const quizId = this.resolveShuffleQuizId();
    if (!quizId) {
      console.warn('[getQuestionByIndex] No active quiz ID resolved.');
      return of(null);
    }

    // Use the centralized resolution logic to ensure consistency with shuffle service
    // This expects that resolveCanonicalQuestion returns the CORRECT shuffled question at this index
    const resolvedQuestion = this.resolveCanonicalQuestion(index, null);

    if (resolvedQuestion) {
      // Strict Shuffle Mismatch Guard - if shuffle is active, verify that the 
      // resolved question matches the shuffledQuestions at this index
      if (this.isShuffleEnabled() && this.shuffledQuestions && this.shuffledQuestions.length > index) {
        const strictShuffled = this.shuffledQuestions[index];
        if (strictShuffled && strictShuffled.questionText !== resolvedQuestion.questionText) {
          console.warn(`[getQuestionByIndex] ⚠️ MISMATCH DETECTED for Q${index + 1}! 
            Resolved="${resolvedQuestion.questionText.substring(0, 15)}...", 
            Shuffled="${strictShuffled.questionText.substring(0, 15)}..."`);
          console.log(`[getQuestionByIndex] 🛡️ Overriding with STRICT shuffled question.`);
          return of({
            ...strictShuffled,
            options: (strictShuffled.options ?? []).map((o) => ({ ...o }))
          });
        }
      }

      return of({
        ...resolvedQuestion,
        options: (resolvedQuestion.options ?? []).map((o) => ({ ...o }))
      });
    }

    // Fallback to legacy behavior if resolution fails (should rarely happen)
    return this.questions$.pipe(
      filter((questions) => Array.isArray(questions) && questions.length > 0),
      take(1),
      map((questions: QuizQuestion[] | null) => {
        if (!Array.isArray(questions) || !questions[index]) return null;
        const q = questions[index];
        return {
          ...q,
          options: (q.options ?? []).map((o) => ({ ...o }))
        };
      })
    );
  }

  getQuestionPayloadForIndex(
    index: number,
  ): Observable<QuestionPayload | null> {
    return this.questionPayload$.pipe(
      map(() => this.questionPayloadMap.get(index) ?? null),
      distinctUntilChanged()
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

    // ALWAYS return existing shuffledQuestions if available.
    // This prevents re-shuffling on every call which causes option order instability
    if (this.shuffledQuestions && this.shuffledQuestions.length > 0) {
      // If quiz IDs don't match, only then we might need to re-fetch
      // But if they DO match (or quizId is empty), return the cached shuffle
      if (!quizId || this.quizId === quizId || !this.quizId) {
        console.log(`[fetchQuizQuestions] Returning EXISTING shuffledQuestions (${this.shuffledQuestions.length} questions) - NO RE-SHUFFLE`);

        if (this.shuffledQuestions.length > 0) {
          console.log(`[fetchQuizQuestions] Q1 Preview: Text="${this.shuffledQuestions[0].questionText.substring(0, 20)}..." | Options[0]="${this.shuffledQuestions[0].options?.[0]?.text.substring(0, 10)}..."`);
        }

        // Ensure the quizId is set if it wasn't
        if (quizId && !this.quizId) {
          this.quizId = quizId;
        }

        // Ensure subscribers get the shuffled version
        this.questionsSubject.next(this.shuffledQuestions);
        this.questionsQuizId = this.quizId ?? quizId ?? null;
        return this.shuffledQuestions;
      } else {
        console.log(`[fetchQuizQuestions] Quiz ID changed from ${this.quizId} to ${quizId} - will re-fetch`);
        // Clear old shuffle for new quiz
        this.shuffledQuestions = [];
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

        // Reuse the already prepared questions when available
        const cachedQuestions = this.questionsSubject.getValue();
        if (
          Array.isArray(cachedQuestions) &&
          cachedQuestions.length > 0 &&
          // this.quizId === quizId
          this.questionsQuizId === quizId
        ) {
          console.log(`[QuizService] fetchQuizQuestions: Cache hit. shouldShuffle=${this.shouldShuffle()}, cachedSize=${cachedQuestions.length}`);
          if (this.shouldShuffle()) {
            // Reuse already shuffled session data if available
            if (
              this.shuffledQuestions &&
              this.shuffledQuestions.length > 0 &&
              // this.quizId === quizId
              this.questionsQuizId === quizId
            ) {
              console.log('[QuizService] Reusing ALREADY SHUFFLED session data.');
              this.questionsSubject.next(this.shuffledQuestions);  // sync fix
              this.questionsQuizId = quizId;
              return this.shuffledQuestions;
            }

            console.log('[QuizService] Shuffle requested on CACHED data - re-shuffling...');

            // Use CANONICAL questions for shuffling, never the cached (potentially already shuffled) ones!
            let sourceQuestions = this.canonicalQuestionsByQuiz.get(quizId);
            if (!sourceQuestions || sourceQuestions.length === 0) {
              console.warn('[QuizService] Canonical questions missing during re-shuffle! Falling back to cached.');
              sourceQuestions = cachedQuestions;
            } else {
              // Clone to be safe
              sourceQuestions = JSON.parse(JSON.stringify(sourceQuestions));
            }

            if (!sourceQuestions || sourceQuestions.length === 0) {
              console.error('[QuizService] Cannot shuffle: No questions available.');
              return [];
            }

            // Delegate cached shuffle to QuizShuffleService
            this.quizShuffleService.prepareShuffle(quizId, sourceQuestions);
            const syncedShuffled = this.quizShuffleService.buildShuffledQuestions(quizId, sourceQuestions);

            this.shuffledQuestions = syncedShuffled;
            this.questions = syncedShuffled;
            this.questionsQuizId = quizId;
            return syncedShuffled;
          }

          // If NOT shuffling, we should return the canonical order
          const canonical = this.canonicalQuestionsByQuiz.get(quizId);
          if (canonical && canonical.length > 0) {
            console.log('[QuizService] Restoring canonical order from cache.');
            const restored = JSON.parse(JSON.stringify(canonical));
            this.questions = restored;
            this.questionsQuizId = quizId;
            return restored;
          }

          this.questionsQuizId = quizId;
          return cachedQuestions.map(
            (question) => this.cloneQuestionForSession(question) ?? question
          );
        }

        // Fetch quizzes from the API
        const quizzes = await firstValueFrom<Quiz[]>(
          this.http.get<Quiz[]>(this.quizUrl)
        );

        const quiz = quizzes.find((q) => String(q.quizId) === String(quizId));
        if (!quiz) {
          console.error(`Quiz with ID ${quizId} not found`);
          return [];
        }

        // Populate currentQuizSubject so getTotalQuestionsCount works
        this.currentQuizSubject.next(quiz);

        // Normalize
        const normalizedQuestions: QuizQuestion[] = (quiz.questions ?? []).map((question) => {
          const normalizedOptions = Array.isArray(question.options)
            ? question.options.map((option, index) => ({
              ...option,
              correct: !!option.correct,
              optionId: option.optionId ?? index + 1,
              displayOrder: index
            }))
            : [];

          return { ...question, options: normalizedOptions };
        });

        // Store canonical (original) order BEFORE shuffling!
        // valid 'canonical' base allows resolveCanonicalQuestion to working correctly
        // instead of falling back to the ALREADY shuffled 'this.questions' (double shuffle).
        this.canonicalQuestionsByQuiz.set(
          quizId,
          JSON.parse(JSON.stringify(normalizedQuestions))
        );

        // Shuffle if needed, OR if we already have shuffled data we should preserve
        const effectivelyShuffling = this.shouldShuffle();

        if (effectivelyShuffling) {
          if (!this.shouldShuffle()) {
            console.warn('[fetchQuizQuestions] shouldShuffle is false, but restoring from existing shuffledQuestions.');
          }

          // Delegate shuffling to QuizShuffleService
          // This ensures the internal map (used by resolveCanonicalQuestion) matches the array we return.
          console.log('[QuizService] Generating NEW shuffle via QuizShuffleService...');
          this.quizShuffleService.prepareShuffle(quizId, normalizedQuestions);

          // Re-generate the array from the authoritative map
          const syncedShuffled = this.quizShuffleService.buildShuffledQuestions(quizId, normalizedQuestions);

          // Assign to normalizedQuestions so subsequent logic uses the synced version
          // We clear the array first to ensure we replace it
          normalizedQuestions.length = 0;
          normalizedQuestions.push(...syncedShuffled);
        }

        const sanitizedQuestions = normalizedQuestions
          .map((question) => this.cloneQuestionForSession(question))
          .filter((question): question is QuizQuestion => !!question);

        this.quizId = quizId;

        if (effectivelyShuffling) {
          this.shuffledQuestions = sanitizedQuestions;
        } else {
          // Ensure we don't store unshuffled questions as "shuffled"
          // This prevents future checks from returning unshuffled data when shuffle is requested
          this.shuffledQuestions = [];
        }

        const broadcastQuestions = sanitizedQuestions.map(
          (question) => this.cloneQuestionForSession(question) ?? question
        );
        this.questions = broadcastQuestions;
        this.questionsQuizId = quizId;

        return sanitizedQuestions.map(
          (question) => this.cloneQuestionForSession(question) ?? question
        );
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

    // Volatile Scoring: Decrement score when leaving a previously correct question
    // provided we are navigating backwards
    if (previousQuestion) {
      let prevIndex = (previousQuestion as any).index;
      if (typeof prevIndex !== 'number') {
        prevIndex = this.questions.findIndex(
          (q: QuizQuestion) =>
            q === previousQuestion ||
            (q.questionText === previousQuestion.questionText &&
              q.questionText)
        );
      }
      const isGoingBack = prevIndex > this.currentQuestionIndex;

      if (prevIndex > -1 && isGoingBack) {
        // Use correct scoring key for shuffled quizzes
        // The questionCorrectness map is keyed by ORIGINAL index, not shuffled index
        let scoringKey = prevIndex;

        if (this.shouldShuffle() && this.quizId) {
          const originalIndex = this.quizShuffleService.toOriginalIndex(this.quizId, prevIndex);

          if (typeof originalIndex === 'number' && originalIndex >= 0) {
            scoringKey = originalIndex;
          }
        }

        const wasCorrect = this.questionCorrectness.get(scoringKey);
        if (wasCorrect) {
          this.updateCorrectCountForResults(this.correctCount - 1);
          this.questionCorrectness.set(scoringKey, false);
          console.log(
            `[QuizService] Decremented score for Leaving Q${prevIndex} (Key=${scoringKey}, Backwards)`
          );
        }
      }
    }

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
    // Use this.questions (shuffled) instead of fetching from findQuizByQuizId (unshuffled)
    // This ensures the question text matches the options which also come from this.questions
    return of(null).pipe(
      map(() => {
        // Use the shuffled questions array that was set via applySessionQuestions
        const questions = this.questions;

        if (!Array.isArray(questions) || questions.length === 0) {
          console.error('[QuizService] getCurrentQuestion: No questions available in this.questions');
          return null;
        }

        if (questionIndex < 0 || questionIndex >= questions.length) {
          console.warn(
            `[QuizService] Index ${questionIndex} out of bounds (0-${questions.length - 1}). Returning null.`
          );
          return null;
        }

        const question = questions[questionIndex];

        return question;
      }),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error fetching current question:', error);
        return of(null);
      })
    );
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
    const correctAnswers = new Map<string, number[]>();

    for (const question of questions) {
      if (question?.options) {
        // Use flatMap to build a clean number[] directly
        const correctOptionNumbers = question.options.flatMap((opt, idx) =>
          opt.correct ? [idx + 1] : []
        );

        correctAnswers.set(question.questionText, correctOptionNumbers);
      } else {
        console.warn('Options are undefined for question:', question);
      }
    }

    return correctAnswers;
  }

  getCorrectOptionsForCurrentQuestion(question: QuizQuestion): Option[] {
    if (!question) {
      console.error('No question provided to getCorrectOptionsForCurrentQuestion.');
      return [];
    }

    if (!Array.isArray(question.options)) {
      console.error('No options available for the provided question:', question);
      return [];
    }

    // Filter and return the correct options for the current question
    const correctOptions = question.options.filter((option) => option.correct);
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

  setAnswers(answers: number[]): void {
    this.answersSubject.next(answers);

    // Populate selectedOptionsMap so isAnswered() works correctly
    // Map numbers to partial SelectedOption objects to satisfy the type.
    const selectedOptions = answers.map(id => ({ optionId: id } as any));
    this.selectedOptionsMap.set(this.currentQuestionIndex, selectedOptions);

    // Also update the main questions array so component checks work
    const q = this.questions[this.currentQuestionIndex];
    if (q) {
      for (const o of q.options) {
        o.selected = answers.includes(o.optionId as number);
      }
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

  setTotalQuestions(total: number): void {
    this.totalQuestionsSubject.next(total);
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
    if (currentQuestion && currentQuestion.options) {
      return currentQuestion.options.filter((option) => option.correct).length;
    }
    return 0;
  }

  validateAndSetCurrentQuestion(
    quiz: Quiz,
    currentQuestionIndex: number
  ): boolean {
    if (
      quiz &&
      Array.isArray(quiz.questions) &&
      currentQuestionIndex >= 0 &&
      currentQuestionIndex < quiz.questions.length
    ) {
      this.currentQuestion.next(quiz.questions[currentQuestionIndex]);
      return true;
    } else {
      console.error(
        'Quiz is not initialized or currentQuestionIndex is out of bounds'
      );
      return false;
    }
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
      this.resetAll();
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
    if (!question) {
      return '';
    }

    const isMultipleAnswer =
      question.type === QuestionType.MultipleAnswer ||
      options.filter((option) => option.correct).length > 1;

    if (!isMultipleAnswer) {
      return '';
    }

    const correctCount = options.filter((option) => option.correct).length;
    if (!correctCount) return '';

    return correctCount === 1
      ? '1 correct answer'
      : `${correctCount} correct answers`;
  }

  validateAnswers(currentQuestionValue: QuizQuestion, answers: any[]): boolean {
    if (!currentQuestionValue || !answers || answers.length === 0) {
      console.error('Question or Answers is not defined');
      return false;
    }
    return true;
  }

  async determineCorrectAnswer(
    question: QuizQuestion,
    answers: Option[]
  ): Promise<boolean[]> {
    return answers.map((answer) => {
      const found = question.options.find(
        (option) => option === answer ||
          option.text.trim().toLowerCase() ===
          answer.text.trim().toLowerCase()
      );
      const correct = found?.correct as any;
      return !!correct && String(correct) !== 'false';
    });
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
    if (
      !question ||
      !Array.isArray(question.options) ||
      question.options.length === 0
    ) {
      console.error('Invalid question or no options available.');
      return [];
    }

    // Filter options marked as correct and map their IDs
    const correctAnswers = question.options
      .filter((option) => option.correct && option.optionId !== undefined)
      .map((option) => option.optionId as number);

    if (correctAnswers.length === 0) {
      console.warn(
        `No correct answers found for question: "${question.questionText}".`,
      );
    } else {
      console.log('Correct answers:', correctAnswers);
    }

    return correctAnswers;
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
    this.quizScore = {
      quizId: this.quizId,
      attemptDateTime: new Date(),
      score: this.calculatePercentageOfCorrectlyAnsweredQuestions(),
      totalQuestions: this.totalQuestions
    };

    const MAX_HIGH_SCORES = 10;  // show results of the last 10 quizzes
    this.highScoresLocal = this.highScoresLocal ?? [];
    this.highScoresLocal.push(this.quizScore);

    // Sort descending by date
    this.highScoresLocal.sort((a: any, b: any) => {
      const dateA = new Date(a.attemptDateTime);
      const dateB = new Date(b.attemptDateTime);
      return dateB.getTime() - dateA.getTime();
    });
    // this.highScoresLocal.reverse();  // Removed to ensure most recent is first
    // Filter out scores older than 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    this.highScoresLocal = this.highScoresLocal.filter((score: any) => {
      const scoreDate = new Date(score.attemptDateTime);
      return scoreDate >= oneWeekAgo;
    });

    this.highScoresLocal.splice(MAX_HIGH_SCORES);
    localStorage.setItem(
      'highScoresLocal',
      JSON.stringify(this.highScoresLocal)
    );
    this.highScores = this.highScoresLocal;
  }

  calculatePercentageOfCorrectlyAnsweredQuestions(): number {
    const correctAnswers = this.correctAnswersCountSubject.getValue();
    const totalQuestions = this.totalQuestions;

    if (totalQuestions === 0) {
      return 0;  // handle division by zero
    }

    return Math.round((correctAnswers / totalQuestions) * 100);
  }

  private shouldShuffle(): boolean {
    const should = this.shuffleEnabledSubject.getValue();
    console.log(`[QuizService] shouldShuffle? ${should}`);
    return should;
  }

  isShuffleEnabled(): boolean {
    return this.shuffleEnabledSubject.getValue();
  }

  setCheckedShuffle(isChecked: boolean): void {
    console.log(`[QuizService] setCheckedShuffle(${isChecked})`);
    this.shuffleEnabledSubject.next(isChecked);
    try {
      localStorage.setItem('checkedShuffle', String(isChecked));

      // Clear stale shuffledQuestions from localStorage to prevent mismatch
      localStorage.removeItem('shuffledQuestions');
    } catch { }

    // Clear shuffle state on toggle to ensure fresh shuffle
    // This prevents stale shuffled data from being used when toggling
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
    const quiz = this.currentQuizSubject.getValue();
    if (!quiz || quiz.quizId !== quizId) return false;

    const questions = quiz.questions ?? [];
    if (
      !Array.isArray(questions) ||
      questionIndex < 0 ||
      questionIndex >= questions.length
    ) {
      return false;
    }

    const q = questions[questionIndex];
    if (!q) return false;

    const hasOptions = Array.isArray(q.options) && q.options.length > 0;
    const hasText =
      typeof q.questionText === 'string' && q.questionText.trim().length > 0;

    return hasOptions && hasText;
  }

  private cloneQuestionForSession(question: QuizQuestion): QuizQuestion | null {
    if (!question) {
      return null;
    }

    const deepClone = JSON.parse(JSON.stringify(question)) as QuizQuestion;
    const normalizedOptions = Array.isArray(deepClone.options)
      ? deepClone.options.map((option, optionIdx) => ({
        ...option,
        optionId:
          typeof option.optionId === 'number'
            ? option.optionId
            : optionIdx + 1,
        displayOrder:
          typeof option.displayOrder === 'number'
            ? option.displayOrder
            : optionIdx,
        correct: option.correct === true,
        selected: option.selected ?? false,
        highlight: option.highlight ?? false,
        showIcon: option.showIcon ?? false
      }))
      : [];

    return {
      ...deepClone,
      options: normalizedOptions
    };
  }

  setCanonicalQuestions(
    quizId: string,
    questions: QuizQuestion[] | null | undefined
  ): void {
    if (!quizId) {
      console.warn('[setCanonicalQuestions] quizId missing.');
      return;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      this.canonicalQuestionsByQuiz.delete(quizId);
      this.canonicalQuestionIndexByText.delete(quizId);
      return;
    }

    const sanitized = questions
      .map((question) => this.cloneQuestionForSession(question))
      .filter((question): question is QuizQuestion => !!question)
      .map((question) => ({
        ...question,
        options: Array.isArray(question.options)
          ? question.options.map((option) => ({ ...option }))
          : []
      }));

    if (sanitized.length === 0) {
      this.canonicalQuestionsByQuiz.delete(quizId);
      this.canonicalQuestionIndexByText.delete(quizId);
      return;
    }

    const textIndex = new Map<string, number>();

    let idx = 0;
    for (const question of sanitized) {
      const key = this.normalizeQuestionText(question?.questionText);
      if (!key) {
        idx++;
        continue;
      }

      if (!textIndex.has(key)) {
        textIndex.set(key, idx);
      }

      idx++;
    }

    this.canonicalQuestionsByQuiz.set(quizId, sanitized);
    this.canonicalQuestionIndexByText.set(quizId, textIndex);
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
    // Find the quiz by quizId within the quizData array
    const foundQuiz =
      this.quizData?.find((quiz) => quiz.quizId === quizId) ?? null;

    // If a quiz is found, and it's indeed a Quiz (as checked by this.isQuiz), return it as an Observable
    if (foundQuiz && this.isQuiz(foundQuiz)) {
      return of(foundQuiz as Quiz);
    }

    // Return an Observable with undefined if the quiz is not found
    return of(undefined);
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

  // Type guard function to check if an object is of type Quiz
  private isQuiz(item: any): item is Quiz {
    return typeof item === 'object' && 'quizId' in item;
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
    if (!this.quizId) {
      this.quizId =
        this.activatedRoute.snapshot.paramMap.get('quizId') || this.quizId;
      if (this.quizId) {
        localStorage.setItem('quizId', this.quizId);
      }
    }
    return !!this.quizId;
  }

  // Ensures every option has a valid optionId. If optionId is missing or invalid, it will assign the index as the optionId.
  assignOptionIds(options: Option[], questionIndex: number): Option[] {
    if (!Array.isArray(options)) {
      console.error('[assignOptionIds] Invalid options array:', options);
      return [];
    }

    return options.map((option, localIdx) => {
      // ⚡ FIX: Sync Safeguard
      // If the option ALREADY has a computed ID (e.g. from ShuffleService, usually > 100),
      // DO NOT overwrite it with an ID based on the (potentially shuffled) "questionIndex".
      // This ensures scoring uses the canonical ID (e.g. 301) instead of the display ID (e.g. 101).
      // We assume raw JSON IDs are small (< 100) or undefined.
      if (option.optionId && typeof option.optionId === 'number' && option.optionId >= 100) {
        return {
          ...option,
          selected: false,
          highlight: false,
          showIcon: false
        };
      }

      // Build a globally unique numeric ID like 1001, 1002, 2001, 2002, etc.
      const uniqueId = Number(
        `${questionIndex + 1}${(localIdx + 1).toString().padStart(2, '0')}`
      );
      return {
        ...option,
        optionId: uniqueId,
        selected: false,
        highlight: false,
        showIcon: false
      };
    });
  }

  private normalizeOptionDisplayOrder(options: Option[] = []): Option[] {
    if (!Array.isArray(options)) {
      return [];
    }

    return options.map((option, index) => ({
      ...option,
      displayOrder: index
    }));
  }

  assignOptionActiveStates(
    options: Option[],
    correctOptionSelected: boolean,
  ): Option[] {
    if (!Array.isArray(options) || options.length === 0) {
      console.warn('[assignOptionActiveStates] No options provided.');
      return [];
    }

    return options.map((opt) => ({
      ...opt,
      active: correctOptionSelected ? opt.correct : true,  // keep only correct options active
      feedback: correctOptionSelected && !opt.correct ? 'x' : undefined,  // add feedback for incorrect options
      showIcon: correctOptionSelected
        ? opt.correct || opt.showIcon
        : opt.showIcon  // preserve icons for correct or previously shown
    }));
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

          if (!match && !this.shouldShuffle()) {
            // Fallback: Direct Index Matching for Unshuffled
            // Priority: 1-based index (Loader standard: 1 -> Option 0)
            if (typeof id === 'number' && id > 0 && question.options[id - 1]) {
              match = question.options[id - 1];
            }
            // Fallback: 0-based index (if some component sends 0)
            else if (typeof id === 'number' && question.options[id]) {
              match = question.options[id];
            }
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
      this.checkIfAnsweredCorrectly(questionIndex);
    } else {
      console.log(`[QuizService] SHUFFLED mode: Skipping checkIfAnsweredCorrectly in updateUserAnswer (scoreDirectly handles scoring)`);
    }
  }

  async checkIfAnsweredCorrectly(index: number = -1): Promise<boolean> {
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

    console.log(`[checkIfAnsweredCorrectly] 📊 Expected Correct Count: ${this.numberOfCorrectAnswers}. User Answers Count: ${this.answers?.length}`);

    if (!this.answers || this.answers.length === 0) {
      console.log(`[checkIfAnsweredCorrectly] Answers empty for Q${qIndex} -> exiting false`);
      return false;
    }

    console.log(`[checkIfAnsweredCorrectly] User Answers:`, this.answers.map(a => `ID=${a.optionId}, Text="${a.text}"`));

    const correctnessArray = await this.determineCorrectAnswer(currentQuestionValue, this.answers);
    const correctFoundCount = correctnessArray.filter((v) => v === true).length;
    const isCorrect = correctFoundCount === this.numberOfCorrectAnswers;

    console.log(`[checkIfAnsweredCorrectly] Result: Found=${correctFoundCount}, Required=${this.numberOfCorrectAnswers}, correctnessArray=${JSON.stringify(correctnessArray)} -> isCorrect=${isCorrect}`);

    const answerIds = this.answers.map((a) => a.optionId).filter((id): id is number => id !== undefined);
    this.incrementScore(answerIds, isCorrect, this.multipleAnswer, qIndex);

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
    console.log(`[scoreDirectly] 🎯 Q${questionIndex}: isCorrect=${isCorrect}, isMulti=${isMultipleAnswer}`);
    this.incrementScore([], isCorrect, isMultipleAnswer, questionIndex);
  }

  incrementScore(
    answers: number[],
    correctAnswerFound: boolean,
    isMultipleAnswer: boolean,
    questionIndex: number = -1
  ): void {
    const qIndex = questionIndex >= 0 ? questionIndex : this.currentQuestionIndex;

    // Scoring Key Resolution
    let scoringKey = qIndex;

    // Strict Shuffle Guard
    // Only use the shuffle service mapping if shuffle is explicitly ENABLED.
    // If we rely on valid ID checks alone, a stale map in QuizShuffleService (from a prev session)
    // might incorrectly remap an unshuffled question (0->3), updating the wrong score key.
    if (this.shouldShuffle()) {
      // Try to get quizId from various sources if it's empty
      let effectiveQuizId = this.quizId;
      if (!effectiveQuizId) {
        // Try localStorage
        try {
          effectiveQuizId = localStorage.getItem('lastQuizId') || '';
        } catch { }
      }
      if (!effectiveQuizId) {
        // Try to find any active shuffle state
        const shuffleKeys = Object.keys(localStorage).filter(k => k.startsWith('shuffleState:'));
        if (shuffleKeys.length > 0) {
          effectiveQuizId = shuffleKeys[0].replace('shuffleState:', '');
          console.log(`[incrementScore] Found shuffle state for quizId: ${effectiveQuizId}`);
        }
      }

      if (effectiveQuizId) {
        const originalIndex = this.quizShuffleService.toOriginalIndex(effectiveQuizId, qIndex);

        // Valid original index is >= 0
        if (typeof originalIndex === 'number' && originalIndex >= 0) {
          scoringKey = originalIndex;
        }
      } else {
        console.warn(`[incrementScore] Shuffle enabled but no quizId found - using display index as scoringKey`);
      }
    }

    const wasCorrect = this.questionCorrectness.get(scoringKey) || false;
    const isNowCorrect = correctAnswerFound;  // simplified

    if (isNowCorrect && !wasCorrect) {
      this.updateCorrectCountForResults(this.correctCount + 1);
      this.questionCorrectness.set(scoringKey, true);
      console.log(`[incrementScore] INCREMENTED score to ${this.correctCount}`);
    } else if (!isNowCorrect && wasCorrect) {
      this.updateCorrectCountForResults(this.correctCount - 1);
      this.questionCorrectness.set(scoringKey, false);
      console.log(`[incrementScore] Decremented score for Q${qIndex} (Key=${scoringKey})`);
    } else {
      console.log(`[incrementScore] NO CHANGE: isNowCorrect=${isNowCorrect}, wasCorrect=${wasCorrect}`);
    }

    this.saveQuestionCorrectness();
  }

  resetScore(): void {
    this.questionCorrectness.clear();
    this.saveQuestionCorrectness();  // clear persistence
    this.correctAnswersCountSubject.next(0);
    this.correctCount = 0;
    this.sendCorrectCountToResults(0);
    localStorage.setItem('correctAnswersCount', '0');
    console.log('[QuizService] Score fully reset.');
  }

  private updateCorrectCountForResults(value: number): void {
    this.correctCount = value;
    this.sendCorrectCountToResults(this.correctCount);
  }

  sendCorrectCountToResults(value: number): void {
    this.correctAnswersCountSubject.next(value);
    localStorage.setItem('correctAnswersCount', String(value));
  }

  private loadQuestionCorrectness(): void {
    try {
      const stored = localStorage.getItem('questionCorrectness');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.questionCorrectness = new Map(
          Object.entries(parsed).map(([k, v]) => [Number(k), Boolean(v)])
        );
        console.log('[QuizService] Loaded questionCorrectness:', this.questionCorrectness);
      }
    } catch (err) {
      console.warn('Failed to load questionCorrectness:', err);
    }
  }

  private saveQuestionCorrectness(): void {
    try {
      const obj = Object.fromEntries(this.questionCorrectness);
      localStorage.setItem('questionCorrectness', JSON.stringify(obj));
    } catch (err) {
      console.warn('Failed to save questionCorrectness:', err);
    }
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
    console.log('[QuizService] resetQuizSessionState complete.');

    // Clear internal scoring state map to prevent stale "wasCorrect" flags
    this.questionCorrectness.clear();
  }

  resetAll(): void {
    console.log('[QuizService] resetAll() called');
    this.answers = [];
    this.correctAnswerOptions = [];
    this.correctOptions = [];
    this.correctMessage = '';
    this.currentQuestionIndex = 0;
    this.questions = [];
    this.shuffledQuestions = [];
    this.questionsList = [];
    this.questionsSubject.next([]);
    this.questionsQuizId = null;
    this.quizResetSource.next();
  }

  private normalizeQuestionText(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    const canonical = Array.isArray(question?.options) ? question.options : [];

    if (!canonical.length) {
      return this.normalizeOptionDisplayOrder(incoming ?? []).map(
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

    const textKey = (value: string | null | undefined) =>
      (value ?? '').trim().toLowerCase();

    const incomingList = Array.isArray(incoming) ? incoming : [];
    const incomingById = new Map<number, Option>();

    for (const option of incomingList) {
      const id = this.toNumericId(option?.optionId, NaN);
      if (Number.isFinite(id)) {
        incomingById.set(id, option);
      }
    }

    return canonical.map((option, index) => {
      const id = this.toNumericId(option?.optionId, index + 1);
      const match =
        incomingById.get(id) ||
        incomingList.find(
          (candidate) => textKey(candidate?.text) === textKey(option?.text)
        );

      const merged: Option = {
        ...option,
        optionId: id,
        displayOrder: index,
        correct: option.correct === true || match?.correct === true,
        selected: match?.selected === true || option.selected === true,
        highlight: match?.highlight ?? option.highlight ?? false,
        showIcon: match?.showIcon ?? option.showIcon ?? false
      };

      if (match && 'active' in match) {
        (merged as any).active = (match as any).active;
      }

      return merged;
    });
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
          correct: option.correct === true,
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

  // Helper method to check question structure
  private isValidQuestionStructure(question: any): boolean {
    return (
      question &&
      typeof question === 'object' &&
      typeof question.questionText === 'string' &&
      Array.isArray(question.options) &&
      question.options.length > 0 &&
      question.options.every((opt: any) => opt && typeof opt.text === 'string')
    );
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