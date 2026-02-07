import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  BehaviorSubject, firstValueFrom, Observable, of, Subject, throwError
} from 'rxjs';
import {
  catchError, distinctUntilChanged, filter, map, switchMap, take,
  takeUntil, tap
} from 'rxjs/operators';

import { QuestionType } from '../../models/question-type.enum';
import { Option } from '../../models/Option.model';
import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizService } from './quiz.service';
import { QuizShuffleService } from '../flow/quiz-shuffle.service';

@Injectable({ providedIn: 'root' })
export class QuizDataService implements OnDestroy {
  private quizUrl = 'assets/data/quiz.json';
  question: QuizQuestion | null = null;
  questionType: string | null = null;

  private quizzesSubject = new BehaviorSubject<Quiz[]>([]);
  quizzes$ = this.quizzesSubject.asObservable();
  private quizzes: Quiz[] = [];
  private readonly baseQuizQuestionCache = new Map<string, QuizQuestion[]>();
  private readonly quizQuestionCache = new Map<string, QuizQuestion[]>();

  selectedQuiz$: BehaviorSubject<Quiz | null> =
    new BehaviorSubject<Quiz | null>(null);

  private currentQuizSubject = new BehaviorSubject<Quiz | null>(null);

  private isContentAvailableSubject = new BehaviorSubject<boolean>(false);
  public isContentAvailable$: Observable<boolean> =
    this.isContentAvailableSubject.asObservable();

  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizShuffleService: QuizShuffleService,
    private http: HttpClient
  ) { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  
  // Clear the question cache for a quiz to force fresh shuffle on next load.
  // Call this when starting a quiz to ensure shuffle flag is applied correctly.
  clearQuizQuestionCache(quizId: string): void {
    this.quizQuestionCache.delete(quizId);
    this.baseQuizQuestionCache.delete(quizId);
    console.log(`[QuizDataService] 🗑️ Cleared question cache for quiz ${quizId}`);
  }

  getQuizzes(): Observable<Quiz[]> {
    return this.quizzes$.pipe(
      filter((quizzes) => quizzes.length > 0),  // ensure data is loaded
      take(1)  // ensure it emits only once
    );
  }

  loadQuizzes(): Observable<Quiz[]> {
    return this.http.get<Quiz[]>(this.quizUrl).pipe(
      tap((quizzes) => {
        // Preserve existing statuses from previously loaded quizzes
        const existingStatuses = new Map<string, string>();
        for (const quiz of this.quizzesSubject.value) {
          if (quiz.status) {
            existingStatuses.set(quiz.quizId, quiz.status);
          }
        }

        // Merge statuses into new data
        const mergedQuizzes = Array.isArray(quizzes) 
          ? quizzes.map(q => ({
              ...q,
              status: existingStatuses.get(q.quizId) || q.status
            }))
          : [];

        this.quizzes = mergedQuizzes;
        this.quizzesSubject.next(mergedQuizzes);
        console.log('[QuizDataService] Loaded quizzes (with preserved statuses):', mergedQuizzes);
      }),
      catchError((err) => {
        console.error('[QuizDataService] Failed:', err);
        return throwError(() => new Error('Error fetching quiz data'));
      }),
    );
  }

  // Ensure quiz metadata is available before performing operations that rely on it.
  // If quizzes have already been loaded, returns the cached list; otherwise triggers a load.
  ensureQuizzesLoaded(): Observable<Quiz[]> {
    const cached = this.quizzesSubject.value;
    if (Array.isArray(cached) && cached.length > 0) {
      return of(cached);
    }

    return this.loadQuizzes();
  }

  // Returns a synchronously cached quiz instance, if available.
  // Falls back to `null` when the quizzes list has not been populated yet
  // or when the requested quiz cannot be found.
  getCachedQuizById(quizId: string): Quiz | null {
    if (!quizId) return null;

    // Prefer the BehaviorSubject cache (always up-to-date)
    const quizzes = this.quizzesSubject.value;

    // Fallback to your original this.quizzes array if ever needed
    const source =
      Array.isArray(quizzes) && quizzes.length > 0 ? quizzes : this.quizzes;

    if (!Array.isArray(source) || source.length === 0) {
      return null;
    }

    return source.find((q) => q.quizId === quizId) ?? null;
  }

  //  Update the status of a quiz (e.g., to 'completed') and persist it.
  // This updates both the local array and the BehaviorSubject so subscribers see the change.
  updateQuizStatus(quizId: string, status: string): void {
    if (!quizId) return;

    // Update in the local array
    const quizIndex = this.quizzes.findIndex(q => q.quizId === quizId);
    if (quizIndex >= 0) {
      this.quizzes[quizIndex] = { ...this.quizzes[quizIndex], status };
    }

    // Update in the BehaviorSubject
    const currentQuizzes = this.quizzesSubject.value;
    const updatedQuizzes = currentQuizzes.map(q => 
      q.quizId === quizId ? { ...q, status } : q
    );
    this.quizzesSubject.next(updatedQuizzes);

    console.log(`[QuizDataService] Updated quiz ${quizId} status to: ${status}`);
  }

  async loadQuizById(quizId: string): Promise<Quiz | null> {
    try {
      const quiz = await firstValueFrom(
        this.getQuiz(quizId).pipe(
          filter((q): q is Quiz => q !== null),
          take(1)
        ),
      );

      if (!quiz.questions?.length) {
        console.warn('[QuizDataService] Quiz invalid or empty:', quiz);
        return null;
      }

      return quiz;
    } catch (err) {
      console.error('[QuizDataService] Failed to fetch quiz:', err);
      return null;
    }
  }

  isValidQuiz(quizId: string): Observable<boolean> {
    return this.getQuizzes().pipe(
      map((quizzes: Quiz[]) => quizzes.some((quiz) => quiz.quizId === quizId)),
      catchError((error: any) => {
        console.error(
          `Error validating quiz ID "${quizId}":`,
          error.message || error,
        );
        return of(false);  // return `false` to indicate an invalid quiz
      }),
    );
  }

  getCurrentQuizId(): string | null {
    const currentQuiz = this.currentQuizSubject.getValue();
    return currentQuiz ? currentQuiz.quizId : null;
  }

  setSelectedQuiz(quiz: Quiz | null): void {
    this.selectedQuiz$.next(quiz);
  }

  getSelectedQuizSnapshot(): Quiz | null {
    return this.selectedQuiz$.getValue();
  }

  setSelectedQuizById(quizId: string): Observable<void> {
    return this.getQuizzes().pipe(
      map((quizzes: Quiz[]) => {
        this.quizzes = quizzes;
        const selectedQuiz = quizzes.find((quiz) => quiz.quizId === quizId);

        if (!selectedQuiz) {
          throw new Error(`Quiz with ID "${quizId}" not found.`);
        }

        this.setSelectedQuiz(selectedQuiz);
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('Error retrieving quizzes:', error.message || error);
        return throwError(() => new Error('Error retrieving quizzes'));
      }),
      takeUntil(this.destroy$)
    );
  }

  setCurrentQuiz(quiz: Quiz): void {
    this.currentQuizSubject.next(quiz);
  }

  getCurrentQuizSnapshot(): Quiz | null {
    return this.currentQuizSubject.getValue();
  }

  getQuiz(quizId: string): Observable<Quiz | null> {
    return this.quizzes$.pipe(
      filter((quizzes) => Array.isArray(quizzes) && quizzes.length > 0),
      map((quizzes) => {
        const quiz = quizzes.find((q) => q.quizId === quizId);
        if (!quiz) {
          throw new Error(
            `[QuizDataService] Quiz with ID ${quizId} not found.`
          );
        }
        return quiz;
      }),
      take(1),
      catchError((error) => {
        console.error(`[QuizDataService] Error fetching quiz:`, error);
        return of(null);
      })
    );
  }

  updateContentAvailableState(isAvailable: boolean): void {
    this.isContentAvailableSubject.next(isAvailable);
  }

  // Return a brand-new array of questions with fully-cloned options.
  getQuestionsForQuiz(quizId: string): Observable<QuizQuestion[]> {
    //  When shuffle is ON, ALWAYS delegate to prepareQuizSession
    // This ensures ONE consistent shuffle regardless of which code path calls this
    if (this.quizService.isShuffleEnabled()) {
      // If we already have shuffled questions for this quiz, return them
      if (
        this.quizService.shuffledQuestions?.length > 0 &&
        this.quizService.quizId === quizId
      ) {
        console.log(`[getQuestionsForQuiz] Returning existing SHUFFLED questions (${this.quizService.shuffledQuestions.length})`);
        return of(this.cloneQuestions(this.quizService.shuffledQuestions));
      }
      // Otherwise, delegate to prepareQuizSession to create the shuffle
      console.log(`[getQuestionsForQuiz] Shuffle ON but no data - delegating to prepareQuizSession`);
      return this.prepareQuizSession(quizId);
    }

    // Cache Check: Return cached questions if already built for this quiz (unshuffled case)
    const cachedQuestions = this.quizQuestionCache.get(quizId);
    if (Array.isArray(cachedQuestions) && cachedQuestions.length > 0) {
      console.log(`[QuizDataService] Returning CACHED questions for quiz ${quizId} (${cachedQuestions.length} questions)`);
      // Sync cache hit with QuizService so standard subscribers (like ScoreComponent) get the update
      this.quizService.questions = this.cloneQuestions(cachedQuestions);
      return of(this.cloneQuestions(cachedQuestions));
    }

    return this.getQuiz(quizId).pipe(
      map((quiz) => {
        if (!quiz) {
          throw new Error(`Quiz with ID ${quizId} not found`);
        }
        if (!quiz.questions || quiz.questions.length === 0) {
          throw new Error(`Quiz with ID ${quizId} has no questions`);
        }

        // Build normalized base questions (clone options per question)
        const baseQuestions: QuizQuestion[] = (quiz.questions ?? []).map(
          (question, index) => this.normalizeQuestion(question, index)
        );

        this.baseQuizQuestionCache.set(
          quizId,
          this.cloneQuestions(baseQuestions)
        );
        this.quizService.setCanonicalQuestions(quizId, baseQuestions);

        const shouldShuffle = this.quizService.isShuffleEnabled();
        console.log(`[QuizDataService] 🔀 getQuestionsForQuiz: shouldShuffle = ${shouldShuffle}`);
        const sessionQuestions = this.buildSessionQuestions(
          quizId,
          baseQuestions,
          shouldShuffle
        );

        this.quizQuestionCache.set(
          quizId,
          this.cloneQuestions(sessionQuestions)
        );
        this.quizService.applySessionQuestions(
          quizId,
          this.cloneQuestions(sessionQuestions)
        );
        this.syncSelectedQuizState(quizId, sessionQuestions, quiz);

        // Assign questions to QuizService so UI can access them
        console.log(`[QuizDataService] OVERWRITING quizService.questions with ${sessionQuestions.length} questions. Q1: "${sessionQuestions[0]?.questionText?.substring(0, 40)}..."`);
        this.quizService.questions = this.cloneQuestions(sessionQuestions);
        
        // Stamp multi-answer flag for each question
        for (const [qIndex, question] of this.quizService.questions.entries()) {
          (question as any).isMulti =
            question.type === QuestionType.MultipleAnswer ||
            (Array.isArray(question.options) &&
              question.options.filter((o: Option) => o.correct === true)
                .length > 1);

          console.log(
            `[QuizDataService] Q${qIndex + 1} isMulti =`,
            (question as any).isMulti
          );
        }

        return this.cloneQuestions(sessionQuestions);
      }),
      catchError((error) => {
        console.error('[QuizDataService] getQuestionsForQuiz:', error);
        return throwError(() => error);
      })
    );
  }

  // Ensure the quiz session questions are available before starting a quiz.
  // Reuses any cached clone for the quiz and re-applies it to the quiz service
  // so downstream consumers receive a consistent question set.
  prepareQuizSession(quizId: string): Observable<QuizQuestion[]> {
    if (!quizId) {
      console.error('[prepareQuizSession] quizId is required.');
      return of([]);
    }

    const shouldShuffle = this.quizService.isShuffleEnabled();
    const cached = this.quizQuestionCache.get(quizId);
    const baseForCanonical = this.baseQuizQuestionCache.get(quizId);

    if (Array.isArray(baseForCanonical) && baseForCanonical.length > 0) {
      this.quizService.setCanonicalQuestions(quizId, baseForCanonical);
    }

    // Cache Policy: Only use cache if NOT shuffling.
    // If shuffling is enabled, we MUST regenerate to ensure the user gets a shuffled set.
    // (Future improvement: Store 'isShuffled' metadata in cache to allow resuming shuffled sessions correctly)
    if (!shouldShuffle && Array.isArray(cached) && cached.length > 0) {
      console.log('[QuizDataService] Cache Hit (Unshuffled) - reusing session');
      const sessionReadyQuestions = this.cloneQuestions(cached);
      this.quizService.applySessionQuestions(quizId, sessionReadyQuestions);
      this.syncSelectedQuizState(quizId, sessionReadyQuestions);
      return of(this.cloneQuestions(sessionReadyQuestions));
    } else if (shouldShuffle && Array.isArray(cached) && cached.length > 0) {
      console.log('[QuizDataService] Cache Exists but Shuffle is ON. Regenerating fresh shuffle from Base to avoid stale order.');
      // Intentionally fall through to the buildSessionQuestions logic below
    }

    const baseQuestions = this.baseQuizQuestionCache.get(quizId);

    if (Array.isArray(baseQuestions) && baseQuestions.length > 0) {
      const sessionQuestions = this.buildSessionQuestions(
        quizId,
        baseQuestions,
        shouldShuffle
      );

      this.quizQuestionCache.set(quizId, this.cloneQuestions(sessionQuestions));
      const sessionClone = this.cloneQuestions(sessionQuestions);
      this.quizService.setCanonicalQuestions(quizId, baseQuestions);
      this.quizService.applySessionQuestions(quizId, sessionClone);
      this.syncSelectedQuizState(quizId, sessionClone);

      return of(this.cloneQuestions(sessionClone));
    }

    return this.getQuiz(quizId).pipe(
      map((quiz) => {
        const base = this.ensureBaseQuestions(quizId, quiz);
        const sessionQuestions = this.buildSessionQuestions(
          quizId,
          base,
          shouldShuffle
        );

        this.quizQuestionCache.set(
          quizId,
          this.cloneQuestions(sessionQuestions)
        );
        const sessionClone = this.cloneQuestions(sessionQuestions);
        this.quizService.setCanonicalQuestions(quizId, base);
        this.quizService.applySessionQuestions(quizId, sessionClone);
        this.syncSelectedQuizState(quizId, sessionClone, quiz);

        return this.cloneQuestions(sessionClone);
      }),
      catchError((error: Error) => {
        console.error('[prepareQuizSession] Failed to fetch questions:', error);
        return of([]);
      })
    );
  }

  private buildSessionQuestions(
    quizId: string,
    baseQuestions: QuizQuestion[],
    shouldShuffle: boolean
  ): QuizQuestion[] {
    const workingSet = this.cloneQuestions(baseQuestions);

    if (shouldShuffle) {
      console.log('[buildSessionQuestions] Starting shuffle...');
      this.quizShuffleService.prepareShuffle(quizId, workingSet);
      const shuffled = this.quizShuffleService.buildShuffledQuestions(
        quizId,
        workingSet
      );

      return this.cloneQuestions(shuffled);
    }

    this.quizShuffleService.clear(quizId);
    return workingSet;
  }

  private sanitizeOptions(
    options: Option[] = [],
    questionIndex: number
  ): Option[] {
    // Ensure numeric IDs (idempotent)
    const withIds = this.quizShuffleService.assignOptionIds(
      options,
      questionIndex
    );

    const toNum = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const n = Number(String(v));
      return Number.isFinite(n) ? n : null;
    };

    return withIds.map((option, index): Option => {
      // Keep value strictly numeric per Option type
      const numericValue =
        toNum(option.value) ??
        toNum((option as any).text) ??  // in case text is "3"
        index + 1;

      return {
        ...option,
        value: numericValue,
        correct: option.correct === true,
        selected: option.selected === true,
        highlight: option.highlight ?? false,
        showIcon: option.showIcon ?? false
      };
    });
  }

  private normalizeQuestion(
    question: QuizQuestion,
    questionIndex: number
  ): QuizQuestion {
    const sanitizedOptions = this.sanitizeOptions(
      question.options ?? [],
      questionIndex
    );
    const alignedAnswers = this.quizShuffleService.alignAnswersWithOptions(
      question.answer,
      sanitizedOptions
    );

    return {
      ...question,
      options: sanitizedOptions.map((option) => ({ ...option })),
      answer: alignedAnswers.map((option) => ({ ...option })),
      selectedOptions: Array.isArray(question.selectedOptions)
        ? question.selectedOptions.map((option) => ({ ...option }))
        : undefined,
      selectedOptionIds: Array.isArray(question.selectedOptionIds)
        ? [...question.selectedOptionIds]
        : undefined
    };
  }

  private cloneQuestions(questions: QuizQuestion[] = []): QuizQuestion[] {
    return (questions ?? []).map((question) => ({
      ...question,
      options: Array.isArray(question.options)
        ? question.options.map((option) => ({ ...option }))
        : [],
      answer: Array.isArray(question.answer)
        ? question.answer.map((answer) => ({ ...answer }))
        : undefined,
      selectedOptions: Array.isArray(question.selectedOptions)
        ? question.selectedOptions.map((option) => ({ ...option }))
        : undefined,
      selectedOptionIds: Array.isArray(question.selectedOptionIds)
        ? [...question.selectedOptionIds]
        : undefined
    }));
  }

  private cloneQuestion(
    question: QuizQuestion | undefined | null
  ): QuizQuestion | null {
    if (!question) {
      return null;
    }

    return this.cloneQuestions([question])[0] ?? null;
  }

  private ensureBaseQuestions(
    quizId: string,
    quiz: Quiz | null
  ): QuizQuestion[] {
    const cached = this.baseQuizQuestionCache.get(quizId);
    if (Array.isArray(cached) && cached.length > 0) {
      this.quizService.setCanonicalQuestions(quizId, cached);
      return this.cloneQuestions(cached);
    }

    const normalized = (quiz?.questions ?? []).map((question, index) =>
      this.normalizeQuestion(question, index),
    );

    const normalizedClone = this.cloneQuestions(normalized);
    this.baseQuizQuestionCache.set(
      quizId,
      this.cloneQuestions(normalizedClone)
    );
    this.quizService.setCanonicalQuestions(quizId, normalizedClone);

    return normalizedClone;
  }

  getQuestionAndOptions(
    quizId: string,
    questionIndex: number
  ): Observable<[QuizQuestion | null, Option[] | null]> {
    if (typeof questionIndex !== 'number' || isNaN(questionIndex)) {
      console.error(`❌ Invalid questionIndex: ${questionIndex}`);
      return of<[QuizQuestion | null, Option[] | null]>([null, null]);
    }

    return this.getQuiz(quizId).pipe(
      map((quiz) => {
        if (!quiz) {
          console.error(
            `[getQuestionAndOptions] No quiz found for ID: ${quizId}`
          );
          return [null, null] as [QuizQuestion | null, Option[] | null];
        }

        let questionsToUse = this.quizQuestionCache.get(quizId);

        if (!Array.isArray(questionsToUse) || questionsToUse.length === 0) {
          const base = this.ensureBaseQuestions(quizId, quiz);
          const sessionQuestions = this.buildSessionQuestions(
            quizId,
            base,
            this.quizService.isShuffleEnabled()
          );

          this.quizQuestionCache.set(
            quizId,
            this.cloneQuestions(sessionQuestions)
          );
          questionsToUse = sessionQuestions;
        }

        if (
          questionIndex < 0 ||
          !Array.isArray(questionsToUse) ||
          questionIndex >= questionsToUse.length
        ) {
          console.error(`Question index ${questionIndex} out of bounds`);
          return [null, null] as [QuizQuestion | null, Option[] | null];
        }

        const question = this.cloneQuestion(questionsToUse[questionIndex]);
        if (!question) {
          console.error(`No question found at index ${questionIndex}`);
          return [null, null] as [QuizQuestion | null, Option[] | null];
        }

        const options = (question.options ?? []).map((option) => ({
          ...option,
          correct: option.correct === true,
          selected: option.selected === true,
          highlight: option.highlight ?? false,
          showIcon: option.showIcon ?? false
        }));

        question.options = [...options];
        question.answer = this.quizShuffleService.alignAnswersWithOptions(
          question.answer,
          options
        );

        return [question, options] as [QuizQuestion | null, Option[] | null];
      }),
      catchError((error) => {
        console.error('Error fetching question and options:', error);
        return of<[QuizQuestion | null, Option[] | null]>([null, null]);
      }),
    );
  }

  fetchQuizQuestionByIdAndIndex(
    quizId: string,
    questionIndex: number
  ): Observable<QuizQuestion | null> {
    if (!quizId) {
      console.error('Quiz ID is required but not provided.');
      return of(null);
    }

    // Get the total-question count
    return this.quizService.getTotalQuestionsCount(quizId).pipe(
      take(1),
      switchMap((totalQuestions) => {
        // Index-bounds guard now that we have the number
        if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) {
          console.error(
            `[fetchQuizQuestionByIdAndIndex] ❌ Invalid totalQuestions (${totalQuestions}) for quiz ${quizId}`,
          );
          return of(null);
        }

        const maxIndex = totalQuestions - 1;
        if (questionIndex < 0 || questionIndex > maxIndex) {
          console.warn(
            `[fetchQuizQuestionByIdAndIndex] Index ${questionIndex} out of range (0-${maxIndex}).`
          );
          return of(null);
        }

        // Fall through to existing tuple-fetch logic
        return this.getQuestionAndOptions(quizId, questionIndex).pipe(
          switchMap((result) => {
            if (!result) {
              console.error(
                `Expected a tuple with QuizQuestion and Options from getQuestionAndOptions but received null for index ${questionIndex}`
              );
              return of(null);
            }

            const [question, options] = result;
            if (!question || !options) {
              console.error(
                'Received incomplete data from getQuestionAndOptions:', result
              );
              return of(null);
            }

            question.options = options;
            return of(question);
          })
        );
      }),
      // Unchanged operators
      distinctUntilChanged(),
      catchError((err) => {
        console.error('Error getting quiz question:', err);
        return throwError(
          () =>
            new Error('An error occurred while fetching data: ' + err.message)
        );
      })
    );
  }

  async fetchQuestionAndOptionsFromAPI(
    quizId: string,
    currentQuestionIndex: number
  ): Promise<[QuizQuestion, Option[]] | null> {
    try {
      const questionAndOptions = await firstValueFrom(
        this.getQuestionAndOptions(quizId, currentQuestionIndex).pipe(
          filter((v): v is [QuizQuestion, Option[]] => v !== null),
          take(1)
        ),
      );

      return questionAndOptions;
    } catch (error) {
      console.error('Error fetching question and options:', error);
      return null;
    }
  }

  getOptions(quizId: string, questionIndex: number): Observable<Option[]> {
    return this.getQuiz(quizId).pipe(
      map((quiz) => {
        const cachedQuestions = this.quizQuestionCache.get(quizId);
        if (cachedQuestions) {
          if (questionIndex < 0 || questionIndex >= cachedQuestions.length) {
            console.warn(
              `Question at index ${questionIndex} not found in cached quiz "${quizId}".`
            );
            return [];
          }
          return cachedQuestions[questionIndex].options ?? [];
        }

        // Only call extractOptions if quiz is valid
        if (quiz) {
          return this.extractOptions(quiz, questionIndex);
        } else {
          console.warn(`[QuizDataService] No quiz found for ID: ${quizId}`);
          return [];
        }
      }),
      distinctUntilChanged(),
      catchError((error: HttpErrorResponse) => {
        console.error(
          `Error fetching options for quiz ID "${quizId}", question index ${questionIndex}:`,
          error.message
        );
        return throwError(() => new Error('Failed to fetch question options.'));
      }),
    );
  }

  private extractOptions(quiz: Quiz, questionIndex: number): Option[] {
    if (!quiz?.questions || quiz.questions.length <= questionIndex) {
      console.warn(
        `Question at index ${questionIndex} not found in quiz "${quiz.quizId}".`
      );
      return [];
    }

    return quiz.questions[questionIndex].options || [];
  }

  getAllExplanationTextsForQuiz(quizId: string): Observable<string[]> {
    return this.getQuiz(quizId).pipe(
      filter((quiz): quiz is Quiz => quiz !== null),
      switchMap((quiz: Quiz) => {
        const sourceQuestions =
          this.quizQuestionCache.get(quizId) ?? quiz.questions ?? [];

        const explanationTexts = sourceQuestions.map((q) =>
          typeof q.explanation === 'string' ? q.explanation : ''
        );

        return of(explanationTexts);
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('Error getting explanation texts:', error);
        return of([]);
      }),
    );
  }

  async asyncOperationToSetQuestion(
    quizId: string,
    currentQuestionIndex: number
  ): Promise<void> {
    try {
      if (!quizId || currentQuestionIndex < 0) {
        console.error('Invalid quiz ID or question index');
        return;
      }

      const observable = this.fetchQuizQuestionByIdAndIndex(
        quizId,
        currentQuestionIndex
      );
      if (!observable) {
        console.error(
          'Received undefined Observable from fetchQuizQuestionByIdAndIndex',
        );
        return;
      }

      const question = await firstValueFrom(observable);
      this.question = question ?? null;
    } catch (error) {
      console.error('Error setting question:', error);
    }
  }

  setQuestionType(question: QuizQuestion): void {
    if (!question) {
      console.error('Question is undefined or null:', question);
      return;
    }

    if (!Array.isArray(question.options)) {
      console.error('Question options is not an array:', question.options);
      return;
    }

    if (question.options.length === 0) {
      console.warn('Question options array is empty:', question.options);
      return;
    }

    const numCorrectAnswers = question.options.filter(
      (option) => option?.correct ?? false
    ).length;
    question.type =
      numCorrectAnswers > 1
        ? QuestionType.MultipleAnswer
        : QuestionType.SingleAnswer;
    this.questionType = question.type;
  }

  submitQuiz(quiz: Quiz): Observable<any> {
    const submitUrl = `${this.quizUrl}/results/${quiz.quizId}`;
    return this.http.post(submitUrl, quiz).pipe(
      catchError((error: HttpErrorResponse) =>
        throwError(
          () =>
            new Error(`Error submitting quiz ${quiz.quizId}: ` + error.message),
        )
      ),
      distinctUntilChanged()
    );
  }

  private syncSelectedQuizState(
    quizId: string,
    questions: QuizQuestion[],
    sourceQuiz?: Quiz | null
  ): void {
    if (!Array.isArray(questions) || questions.length === 0) return;

    const baseQuiz =
      sourceQuiz ??
      this.selectedQuiz$.getValue() ??
      this.quizService.selectedQuiz ??
      this.getCachedQuizById(quizId);

    if (!baseQuiz) return;

    const sanitizedQuestions = questions.map((question) => ({
      ...question,
      options: Array.isArray(question.options)
        ? question.options.map((option) => ({ ...option }))
        : []
    }));

    const syncedQuiz: Quiz = {
      ...baseQuiz,
      quizId: baseQuiz.quizId ?? quizId,
      questions: sanitizedQuestions
    };

    this.setSelectedQuiz(syncedQuiz);
    this.setCurrentQuiz(syncedQuiz);
    this.quizService.setSelectedQuiz(syncedQuiz);
    this.quizService.setActiveQuiz(syncedQuiz);
  }
}