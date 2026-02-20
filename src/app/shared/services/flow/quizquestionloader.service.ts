import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import {
  BehaviorSubject, firstValueFrom, forkJoin, lastValueFrom, of,
  ReplaySubject
} from 'rxjs';
import { catchError, filter, take, timeout } from 'rxjs/operators';

import { QuestionType } from '../../models/question-type.enum';
import { Option } from '../../models/Option.model';
import { QAPayload } from '../../models/QAPayload.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { Quiz } from '../../models/Quiz.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { ExplanationTextService } from '../features/explanation-text.service';
import { FeedbackService } from '../features/feedback.service';
import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { QuizStateService } from '../state/quizstate.service';
import { ResetBackgroundService } from '../ui/reset-background.service';
import { ResetStateService } from '../state/reset-state.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from '../features/selection-message.service';
import { TimerService } from '../features/timer.service';
import { QuizQuestionComponent } from '../../../components/question/quiz-question/quiz-question.component';

@Injectable({ providedIn: 'root' })
export class QuizQuestionLoaderService {
  private quizQuestionComponent!: QuizQuestionComponent;
  question: QuizQuestion | null = null;
  questionData: QuizQuestion | null = null;
  questionPayload: QuestionPayload | null = null;
  currentQuestion: QuizQuestion | null = null;
  currentQuestionIndex = 0;
  currentQuestionAnswered = false;

  questionToDisplay = '';

  // Source subject (can be written to from outside)
  public readonly questionToDisplaySubject = new ReplaySubject<string>(1);
  // Observable stream for safe external subscription
  public readonly questionToDisplay$ = this.questionToDisplaySubject.asObservable();

  questionTextLoaded = false;
  questionInitialized = false;
  explanationToDisplay = '';

  public activeQuizId!: string;
  public totalQuestions = 0;

  showFeedbackForOption: { [key: number]: boolean } = {};

  selectedOptions: Option[] = [];
  optionsToDisplay: Option[] = [];
  public optionsToDisplay$ = new BehaviorSubject<Option[]>([]);
  optionBindingsSrc: Option[] = [];
  public hasOptionsLoaded = false;
  public shouldRenderOptions = false;
  public pendingOptions: Option[] | null = null;

  public hasContentLoaded = false;
  public isLoading = false;
  isQuestionDisplayed = false;
  isNextButtonEnabled = false;
  isAnswered = false;

  shouldRenderQuestionComponent = false;
  resetComplete = false;

  private questionTextSubject = new BehaviorSubject<string>('');
  private questionPayloadReadySource = new BehaviorSubject<boolean>(false);

  private explanationTextSubject = new BehaviorSubject<string>('');

  isButtonEnabled = false;
  private isButtonEnabledSubject = new BehaviorSubject<boolean>(false);

  public readonly isLoading$ = new BehaviorSubject<boolean>(false);  // true while a question is being fetched
  private currentLoadAbortCtl = new AbortController();  // abort a stale fetch when the user clicks “Next” too fast

  private qaSubject = new BehaviorSubject<QAPayload | null>(null);

  readonly optionsStream$: BehaviorSubject<Option[]> = new BehaviorSubject<
    Option[]
  >([]);
  options$ = this.optionsStream$.asObservable();

  lastQuizId: string | null = null;
  questionsArray: QuizQuestion[] = [];

  // Frame-stabilization markers (used by navigation reset)
  public _lastQuestionText = '';
  public _lastRenderedIndex = -1;

  // Timestamp of last safe navigation (used to drop stale emissions)
  public _lastNavTime = 0;

  public _renderFreezeUntil = 0;
  public _frozen = false;
  public _isVisualFrozen = false;
  private _freezeTimer: any = null;
  public _quietUntil = 0;
  public _quietZoneUntil = 0;
  private _navBarrier = false;

  public quietZoneUntil$ = new BehaviorSubject<number>(0);

  constructor(
    private explanationTextService: ExplanationTextService,
    private feedbackService: FeedbackService,
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private resetBackgroundService: ResetBackgroundService,
    private resetStateService: ResetStateService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService,
    private selectedOptionService: SelectedOptionService,
    private quizStateService: QuizStateService,
    private router: Router
  ) {
    (this.explanationTextService as any)._loaderRef = this;
  }

  public async loadQuestionContents(questionIndex: number): Promise<void> {
    try {
      // Validate quizId before proceeding
      const quizId = this.quizService.getCurrentQuizId();
      if (!quizId) {
        console.warn(
          `[QuizQuestionLoaderService] No quiz ID available. Cannot load question contents.`
        );
        return;
      }

      const hasCachedQuestion = this.quizService.hasCachedQuestion(
        quizId,
        questionIndex
      );

      // Reset visual/UI state before rendering
      if (!hasCachedQuestion) {
        this.hasContentLoaded = false;
        this.hasOptionsLoaded = false;
        this.shouldRenderOptions = false;
        this.isLoading = true;
        this.isQuestionDisplayed = false;
        this.isNextButtonEnabled = false;

        // Reset any previous data
        this.optionsToDisplay = [];
        this.explanationToDisplay = '';
        this.questionData = null;
      } else {
        this.isLoading = false;
      }

      // Attempt to fetch question, options, and explanation in parallel
      try {
        type FetchedData = {
          question: QuizQuestion | null;
          options: Option[] | null;
          explanation: string | null;
        };

        const question$ = this.quizService
          .getQuestionByIndex(questionIndex)
          .pipe(take(1));
        const options$ = this.quizService
          .getCurrentOptions(questionIndex)
          .pipe(take(1));
        const explanation$ = this.explanationTextService.explanationsInitialized
          ? this.explanationTextService
            .getFormattedExplanationTextForQuestion(questionIndex)
            .pipe(take(1))
          : of('');

        const data: FetchedData = await lastValueFrom(
          forkJoin({
            question: question$,
            options: options$,
            explanation: explanation$
          }).pipe(
            catchError((error) => {
              console.error(
                `[QuizQuestionLoaderService] Error in forkJoin for Q${questionIndex}:`,
                error
              );
              return of({
                question: null,
                options: [],
                explanation: ''
              } as FetchedData);
            }),
          ),
        );

        // Guard against incomplete question data
        if (
          !data.question?.questionText?.trim() ||
          !Array.isArray(data.options) ||
          data.options.length === 0
        ) {
          console.warn(
            `[QuizQuestionLoaderService] Missing question or options for Q${questionIndex}. Aborting render.`
          );
          this.isLoading = false;
          return;
        }

        // Apply loaded values to local state
        this.optionsToDisplay = [...data.options];
        this.optionsToDisplay$.next(this.optionsToDisplay);
        this.hasOptionsLoaded = true;

        this.questionData = data.question ?? ({} as QuizQuestion);
        this.explanationToDisplay = data.explanation ?? '';
        this.isQuestionDisplayed = true;

        // Final loading flag
        this.isLoading = false;
      } catch (error) {
        console.error(
          `[QuizQuestionLoaderService] ❌ Error loading question contents for Q${questionIndex}:`,
          error
        );
        this.isLoading = false;
      }
    } catch (error) {
      console.error(
        `[QuizQuestionLoaderService] ❌ Unexpected outer error:`, error);
      this.isLoading = false;
    }
  }

  // Fetch a question and its options and emit a single payload so the
  // heading and list paint in the same change-detection pass (no flicker).
  async loadQuestionAndOptions(index: number): Promise<boolean> {
    // quizId & cache handling
    if (!this.ensureRouteQuizId()) {
      return false;
    }

    // Index Validation and Count Fetch
    const isCountValid = await this.ensureQuestionCount();
    const isIndexValid = this.validateIndex(index);

    if (!isCountValid || !isIndexValid) {
      console.warn('[Invalid index or quiz length]', { index });
      return false;
    }

    // UI reset for a new question
    await this.resetUiForNewQuestion(index);

    // Fetch question and options for this quiz
    const { q, opts } = await this.fetchQuestionAndOptions(index);
    if (!q || !opts.length) {
      return false;
    }

    // HARD CLONE BARRIER — break reference identity
    let cloned: Option[] = [];
    try {
      cloned = JSON.parse(JSON.stringify(opts));

      let i = 0;
      for (const opt of cloned) {
        opt.optionId = opt.optionId ?? i + 1;
        opt.selected = false;
        opt.highlight = false;
        opt.showIcon = false;
        opt.active = true;
        i++;
      }
    } catch (error) {
      console.warn(
        '[QQ Loader] Deep clone failed, falling back to structuredClone',
        error
      );
      cloned =
        typeof structuredClone === 'function'
          ? structuredClone(opts)
          : [...opts.map((o) => ({ ...o }))];
    }

    // Clear all legacy or leaked state
    (this.explanationTextService as any)._fetLocked = false;
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setIsExplanationTextDisplayed(false);
    this.explanationTextService.setExplanationText('');

    // Safe assignment — always new objects
    this.currentQuestion = { ...q, options: cloned };
    this.optionsToDisplay = [...cloned];
    this.optionBindingsSrc = [...cloned];
    this.currentQuestionIndex = index;

    // Explanation fallback
    const explanation = q.explanation?.trim() || 'No explanation available';

    // Emit to observers downstream
    this.emitQaPayload(q, cloned, index, explanation);

    // Explanation / timers / final flags
    await this.postEmitUpdates(q, cloned, index);

    return true;
  }

  // Ensure quizId comes from the route and clear cache on change
  private ensureRouteQuizId(): boolean {
    const routeId = this.readRouteParam('quizId') ?? this.quizService.quizId;
    if (!routeId) {
      console.error('[Loader] No quizId');
      return false;
    }

    if (routeId !== this.lastQuizId) {
      // Quiz switch
      this.questionsArray = [];
      this.lastQuizId = routeId;
    }
    this.activeQuizId = routeId;
    // this.quizService.quizId = routeId;
    this.quizService.setQuizId(routeId);
    return true;
  }

  // Fetch quiz length once per quiz
  private async ensureQuestionCount(): Promise<boolean> {
    if (this.totalQuestions) {
      return true;
    }
    const qs = (await firstValueFrom(
      this.quizDataService.getQuestionsForQuiz(this.activeQuizId)
    )) as QuizQuestion[];
    this.totalQuestions = qs.length;
    this.questionsArray = qs;
    return qs.length > 0;
  }

  // Bounds check
  private validateIndex(i: number): boolean {
    const ok = Number.isInteger(i) && i >= 0 && i < this.totalQuestions;
    if (!ok) {
      console.warn('[Loader] bad index', i);
    }
    return ok;
  }

  private readRouteParam(param: string): string | null {
    let snapshot: ActivatedRouteSnapshot | null =
      this.router.routerState.snapshot.root;

    while (snapshot) {
      const value = snapshot.paramMap?.get(param);
      if (value != null) {
        return value;
      }
      snapshot = snapshot.firstChild ?? null;
    }

    return null;
  }

  private canServeQuestionFromCache(index: number): boolean {
    const activeQuizId = this.activeQuizId ?? this.quizService.quizId ?? null;

    if (
      activeQuizId &&
      this.quizService.hasCachedQuestion(activeQuizId, index)
    ) {
      return true;
    }

    if (
      !Array.isArray(this.questionsArray) ||
      this.questionsArray.length === 0
    ) {
      return false;
    }

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.questionsArray.length
    ) {
      return false;
    }

    const question = this.questionsArray[index];
    if (!question) {
      return false;
    }

    return Array.isArray(question.options) && question.options.length > 0;
  }

  // Do all the big UI resets
  // Clears forms, timers, messages, and child-component state so the
  // next question starts with a clean slate. Call before fetching data.
  private async resetUiForNewQuestion(index: number): Promise<void> {
    const canReuseCachedQuestion = this.canServeQuestionFromCache(index);

    // Parent-level reset
    this.resetQuestionState(index);

    // Always reset display state when navigating to new question (not conditional)
    this.quizStateService.displayStateSubject.next({
      mode: 'question',
      answered: false
    });
    this.resetStateService.triggerResetState();
    this.explanationTextService.resetExplanationState();

    this.quizService.questionPayloadSubject.next(null);
    this.questionPayloadReadySource.next(false);
    this.questionPayload = null;
    this.isLoading = !canReuseCachedQuestion;

    if (!canReuseCachedQuestion) {
      // Blank out the QA streams only when we can't re-use cached content.
      // This prevents the question/answers panel from flashing when the
      // next question is already available locally.
      this.clearQA();
      this.resetQuestionDisplayState();
      this.questionTextSubject.next('');
      this.questionToDisplaySubject.next('');
      this.optionsStream$.next([]);
      this.explanationTextSubject.next('');
    }

    // Per-question flags
    this.questionTextLoaded = false;
    this.hasOptionsLoaded = false;
    if (!canReuseCachedQuestion) {
      this.shouldRenderOptions = false;
    }

    // Explanation / selection messages
    this.explanationTextService.unlockExplanation();
    this.explanationTextService.forceResetBetweenQuestions();
    // Clear only — don’t recompute baseline here.
    this.resetComplete = false;

    // Force a small delay so the DOM can repaint when we clear the view.
    if (!canReuseCachedQuestion) {
      await new Promise((res) => setTimeout(res, 30));
    }

    // If the previous question was answered, update guards
    if (this.selectedOptionService.isQuestionAnswered(index)) {
      this.quizStateService.setAnswered(true);
      this.selectedOptionService.setAnswered(true, true);
    }
  }

  // Fetch a single question and its options
  private async fetchQuestionAndOptions(
    index: number
  ): Promise<{ q: QuizQuestion | null; opts: Option[] }> {
    // Which quiz is in the URL right now?
    const quizId =
      this.readRouteParam('quizId') ??
      this.activeQuizId ??
      this.quizService.quizId;
    if (!quizId) {
      console.error('[Loader] No quizId in route');
      return { q: null, opts: [] };
    }

    // Reset cache if user switched quizzes
    if (quizId !== this.lastQuizId) {
      this.questionsArray = [];  // discard stale TypeScript list
      this.lastQuizId = quizId;
    }

    // Ensure questions are loaded in QuizService
    // Strictly prioritize shuffledQuestions if shuffle is enabled
    if (this.quizService.isShuffleEnabled() && this.quizService.shuffledQuestions?.length > 0) {
      console.log(`[QQLoader] 🛡️ Using SHUFFLED questions source (${this.quizService.shuffledQuestions.length})`);
      this.questionsArray = [...this.quizService.shuffledQuestions];
    } else {
      let questions = this.quizService.questions;

      // Don't overwrite existing questions if they are already loaded (and potentially shuffled!)
      // Only fetch raw if we truly have NOTHING.
      if (!Array.isArray(questions) || questions.length === 0) {

        // Race Condition Fix: If shuffle is enabled but we don't have shuffled questions YET,
        // we must not fetch raw data from QuizDataService. We must wait for QuizService to finish its shuffle.
        if (this.quizService.isShuffleEnabled()) {
          console.log(`[QQLoader] Shuffle enabled but no questions yet. WAITING for QuizService...`);
          try {
            // Wait for QuizService to populate questions (it handles the fetch + shuffle)
            const fetched = await firstValueFrom(this.quizService.getAllQuestions().pipe(
              filter(q => Array.isArray(q) && q.length > 0),
              take(1),
              timeout(5000)  // safety timeout
            ));

            // Re-check shuffled questions
            if (this.quizService.shuffledQuestions?.length > 0) {
              console.log(`[QQLoader] Shuffle ready! Loading shuffled questions.`);
              this.questionsArray = [...this.quizService.shuffledQuestions];
              // this.quizService.questions = this.questionsArray; // DO NOT POISON
            } else {
              console.warn(`[QQLoader] ⚠️ Shuffle wait timed out or failed. Using fetched data.`);
              this.questionsArray = [...(fetched as QuizQuestion[])];
              // If fetched data is essentially shuffled data, do not assign.
              // But 'fetched' came from getAllQuestions() which returns shuffled if enabled.
              // So we should NOT assign.
            }
          } catch (error) {
            console.error(`[QQLoader] ❌ Error waiting for shuffle:`, error);
            // Fallback only on error
            this.questionsArray = await firstValueFrom(this.quizDataService.getQuestionsForQuiz(quizId));
            this.quizService.questions = [...this.questionsArray];
          }
        } else {
          console.log(`[QQLoader fetchQO] quizService.questions EMPTY - fetching from getQuestionsForQuiz`);
          this.questionsArray = await firstValueFrom(
            this.quizDataService.getQuestionsForQuiz(quizId),
          );
          // Update QuizService so it has the base data
          this.quizService.questions = [...this.questionsArray];
        }
      } else {
        console.log(`[QQLoader fetchQO] reusing existing quizService.questions (Length: ${questions.length})`);
      }
    }

    // Keep other services in sync
    this.activeQuizId = quizId;
    // this.quizService.quizId = quizId;
    this.quizService.setQuizId(quizId);

    // Consistency Fix: Use getQuestionByIndex to respect shuffle state
    // Previously, we accessed this.quizService.questions[index] directly,
    // which bypassed 'shuffledQuestions' if they were different.
    const q = await firstValueFrom(this.quizService.getQuestionByIndex(index));
    if (!q) {
      throw new Error(`No question found for index ${index}`);
    }

    // Call hydrateAndClone immediately
    const { question, options } = this.hydrateAndClone(q, index);

    const opts = options;

    // Hydrate the full quiz metadata if needed (optional, kept for safety)
    if (this.quizService.questions?.length) {
      const fullQuiz: Quiz = await firstValueFrom(
        this.quizDataService.getQuiz(quizId).pipe(
          filter((quiz): quiz is Quiz => quiz !== null),
          take(1)
        )
      );

      this.quizService.setCurrentQuiz({
        ...fullQuiz,
        questions: this.quizService.questions
      });
    }

    return { q: question, opts };
  }

  // Hydrate flags then deep-clone
  private hydrateAndClone(
    q: QuizQuestion,
    qIndex: number
  ): { question: QuizQuestion; options: Option[] } {
    // Clone the question object (no mutation of source)
    const question: QuizQuestion = { ...q };

    // Get options safely
    const baseOpts: Option[] = Array.isArray(q?.options) ? q.options : [];

    // Hydrate UI fields + normalize
    const hydrated: Option[] = baseOpts.map((o: Option, i: number) => ({
      ...o,
      optionId: o.optionId ?? i,     // keep fallback
      correct: !!o.correct,
      feedback: o.feedback ?? '',
      selected: false,
      highlight: false,
      showIcon: false,
      active: true,                 // if Option supports it
      // disabled: false            // only if Option supports it
    }));

    // Apply your active-state logic (returns Option[])
    const active: Option[] = this.quizService.assignOptionActiveStates(hydrated, false);

    // Deep clone to guarantee fresh references
    const options: Option[] =
      typeof structuredClone === 'function'
        ? structuredClone(active)
        : JSON.parse(JSON.stringify(active));

    return { question, options };
  }

  // Push options and heading downstream
  // Emits heading, options, and explanation through the BehaviourSubjects and
  // updates every downstream service in one place.
  private emitQaPayload(
    question: QuizQuestion,
    options: Option[],
    index: number,
    explanation: string
  ): void {
    const isAnswered = this.selectedOptionService.isQuestionAnswered(index);
    const explanationForPayload = isAnswered ? explanation : '';
    const optionsForPayload = [...options];
    const questionForPayload: QuizQuestion = {
      ...question,
      options: optionsForPayload,
      explanation: explanationForPayload
    };

    // Streams for the template
    this.optionsStream$.next(optionsForPayload);
    this.qaSubject.next({
      quizId: this.quizService.quizId,
      index,
      heading: question.questionText.trim(),
      options: optionsForPayload,
      explanation: explanationForPayload,
      question: questionForPayload,
      selectionMessage: this.selectionMessageService.getCurrentMessage()
    });

    // State shared across services/components
    this.setQuestionDetails(
      question.questionText.trim(),
      optionsForPayload,
      explanationForPayload
    );
    this.currentQuestionIndex = index;
    this.shouldRenderQuestionComponent = true;

    // Push into QuizService and QuizStateService
    this.quizService.setCurrentQuestion(question);
    this.quizStateService.updateCurrentQuestion(question);

    // Broadcast QA for any external listener (progressbar, etc.)
    const selMsg = this.selectionMessageService.determineSelectionMessage(
      index,
      this.totalQuestions,
      false
    );
    this.quizStateService.emitQA(
      questionForPayload,
      selMsg,
      this.quizService.quizId!,
      index
    );

    this.quizService.questionPayloadSubject.next({
      question: questionForPayload,
      options: optionsForPayload,
      explanation: explanationForPayload
    });
  }

  // Explanation, timers, flags – original logic lifted verbatim
  // Runs AFTER we have emitted the QA payload. Handles
  // explanation, timers, downstream state, and final flags.
  private async postEmitUpdates(
    q: QuizQuestion,
    opts: Option[],
    idx: number
  ): Promise<void> {
    const optionIdSet = new Set(
      opts
        .map((opt) => opt.optionId)
        .filter((id): id is number => typeof id === 'number')
    );
    const selectedOptions =
      this.selectedOptionService.getSelectedOptionsForQuestion(idx);
    const validSelections = (selectedOptions ?? []).filter((opt: any) =>
      optionIdSet.has(opt.optionId ?? -1)
    );
    const quizIdForState = this.quizService.quizId ?? this.activeQuizId ?? 'default-quiz';
    const questionState = this.quizStateService.getQuestionState(quizIdForState, idx);

    let isAnswered = validSelections.length > 0;
    if (!isAnswered && questionState?.isAnswered) {
      this.quizStateService.setQuestionState(quizIdForState, idx, {
        ...questionState,
        isAnswered: false,
        explanationDisplayed: false
      });
      this.selectedOptionService.clearSelectionsForQuestion(idx);
      this.selectedOptionService.setAnswered(false, true);
    }

    if (isAnswered) {
      this.quizStateService.setAnswered(true);
      this.selectedOptionService.setAnswered(true, true);
    } else {
      this.quizStateService.setAnswered(false);
      this.selectedOptionService.setAnswered(false, true);
    }

    this.explanationTextService.setResetComplete(false);
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.explanationText$.next('');

    let explanationText = '';
    this.timerService.stopTimer?.(undefined, { force: true });
    this.timerService.resetTimer();
    this.timerService.resetTimerFlagsFor(idx);

    if (isAnswered) {
      explanationText = q.explanation?.trim() || 'No explanation available';
      this.explanationTextService.setExplanationTextForQuestionIndex(
        idx,
        explanationText
      );

      this.quizStateService.setDisplayState({
        mode: 'explanation',
        answered: true
      });
      this.timerService.isTimerRunning = false;
    } else {
      this.timerService.startTimer(
        this.timerService.timePerQuestion,
        this.timerService.isCountdown,
        true
      );
    }

    // Down-stream state updates
    this.setQuestionDetails(q.questionText.trim(), opts, explanationText);

    this.currentQuestionIndex = idx;
    this.explanationToDisplay = explanationText;

    const payloadForBroadcast: QuestionPayload = {
      question: {
        ...q,
        options: [...opts],
        explanation: explanationText
      },
      options: [...opts],
      explanation: explanationText
    };
    this.questionPayload = payloadForBroadcast;
    this.shouldRenderQuestionComponent = true;
    this.questionPayloadReadySource.next(true);
    this.quizService.questionPayloadSubject.next(payloadForBroadcast);

    this.quizService.setCurrentQuestion({ ...q, options: opts });
    this.quizStateService.updateCurrentQuestion({ ...q, options: opts });

    if (q.questionText && opts.length) {
      const selMsg = this.selectionMessageService.determineSelectionMessage(
        idx,
        this.totalQuestions,
        false
      );

      this.quizStateService.emitQA(
        { ...q, options: opts },  // question object
        selMsg,  // selection message
        this.quizService.quizId!, // quiz id (non-null assertion)
        idx  // question index
      );
    }

    await this.loadQuestionContents(idx);
    await this.quizService.checkIfAnsweredCorrectly(idx);

    // Final flags
    this.questionTextLoaded = true;
    this.hasOptionsLoaded = true;
    this.shouldRenderOptions = true;
    this.resetComplete = true;

    // Final emit so late subscribers have data
    this.optionsStream$.next([...opts]);
  }

  public setQuestionDetails(
    questionText: string,
    options: Option[],
    explanationText: string
  ): void {
    // Use fallback if question text is empty
    this.questionToDisplay =
      questionText?.trim() || 'No question text available';

    // Ensure options are a valid array
    this.optionsToDisplay = Array.isArray(options) ? options : [];

    this.explanationToDisplay = explanationText.trim();

    // Emit latest values to any subscribers (template/UI)
    this.questionTextSubject.next(this.questionToDisplay);
    this.explanationTextSubject.next(this.explanationToDisplay);

    if (!explanationText.trim() && explanationText.length > 0) {
      console.warn('[setQuestionDetails] ⚠️ Explanation fallback triggered');
    }
  }

  // Reset UI immediately before navigating
  resetUI(): void {
    // Clear current question reference and options
    this.question = null;
    this.currentQuestion = null;
    this.optionsToDisplay = [];
    this.resetQuestionDisplayState();
    this.questionTextSubject.next('');
    this.questionToDisplaySubject.next('');
    this.optionsStream$.next([]);
    this.explanationTextSubject.next('');
    this.questionPayloadReadySource.next(false);
    this.questionPayload = null;

    // Reset question component state only if method exists
    if (this.quizQuestionComponent) {
      if (typeof this.quizQuestionComponent.resetFeedback === 'function') {
        this.quizQuestionComponent.resetFeedback();
      }
      if (typeof this.quizQuestionComponent.resetState === 'function') {
        this.quizQuestionComponent.resetState();
      }
    } else {
      console.warn(
        '[resetUI] ⚠️ quizQuestionComponent not initialized or dynamically loaded.'
      );
    }

    // Reset visual selection state
    this.showFeedbackForOption = {};

    // Background reset
    this.resetBackgroundService.setShouldResetBackground(true);

    // Trigger global reset events
    this.resetStateService.triggerResetFeedback();
    this.resetStateService.triggerResetState();

    // Clear selected options tracking
    this.selectedOptionService.clearOptions();

    this.explanationTextService.resetExplanationState();
  }

  public resetQuestionState(index: number = this.currentQuestionIndex): void {
    // Clear local UI state
    this.questionInitialized = false; // block during reset
    this.isAnswered = false;
    this.selectedOptions = [];
    this.currentQuestionAnswered = false;
    this.isNextButtonEnabled = false;
    this.isButtonEnabled = false;
    this.isButtonEnabledSubject.next(false);

    // Clear all lock sets (single + multi)
    this.selectionMessageService['_singleAnswerIncorrectLock'].clear();
    this.selectionMessageService['_singleAnswerCorrectLock'].clear();
    this.selectionMessageService['_multiAnswerInProgressLock'].clear();
    this.selectionMessageService['_multiAnswerCompletionLock'].clear();
    this.selectionMessageService['_multiAnswerPreLock']?.clear();

    // Only reset options if current question exists
    if (this.currentQuestion?.options?.length) {
      for (const option of this.currentQuestion.options) {
        if (option.selected || option.highlight || !option.active) {
          console.log(
            `[resetQuestionState] Clearing state for optionId: ${option.optionId}`
          );
        }

        // Reset all option UI-related flags
        option.selected = false;
        option.highlight = false;
        option.active = true;
        option.showIcon = false;
        option.feedback = undefined;
      }
    } else {
      console.warn(
        '[resetQuestionState] No current question options found to reset.'
      );
    }

    // Reset internal selected options tracking
    this.selectedOptionService.stopTimerEmitted = false;

    this.seedSelectionBaseline(index);
  }

  public resetQuestionLocksForIndex(index: number): void {
    this.selectionMessageService['_singleAnswerIncorrectLock'].delete(index);
    this.selectionMessageService['_singleAnswerCorrectLock'].delete(index);
    this.selectionMessageService['_multiAnswerInProgressLock'].delete(index);
    this.selectionMessageService['_multiAnswerCompletionLock'].delete(index);
    this.selectionMessageService['_multiAnswerPreLock']?.delete(index);
  }

  private seedSelectionBaseline(index: number | null | undefined): void {
    if (typeof index !== 'number' || !Number.isFinite(index)) return;

    const i0 = Math.trunc(index);
    if (i0 < 0) return;

    if (!Array.isArray(this.questionsArray) || i0 >= this.questionsArray.length)
      return;

    const question = this.questionsArray[i0];
    if (
      !question ||
      !Array.isArray(question.options) ||
      question.options.length === 0
    )
      return;

    const options = question.options;
    const correctCount = options.reduce(
      (total, option) => (option?.correct ? total + 1 : total),
      0
    );
    const totalCorrect = Math.max(correctCount, 1);

    let qType: QuestionType;
    switch (question.type) {
      case QuestionType.MultipleAnswer:
        qType = QuestionType.MultipleAnswer;
        break;
      case QuestionType.TrueFalse:
        qType = QuestionType.SingleAnswer;
        break;
      case QuestionType.SingleAnswer:
      default:
        qType = QuestionType.SingleAnswer;
        break;
    }

    if (correctCount > 1) qType = QuestionType.MultipleAnswer;
    this.selectionMessageService.enforceBaselineAtInit(i0, qType, totalCorrect);
  }

  private resetQuestionDisplayState(): void {
    this.questionToDisplay = '';
    this.explanationToDisplay = '';
    this.optionsToDisplay = [];
  }

  public async loadQA(index: number): Promise<boolean> {
    // Clear stale question and options immediately
    this.resetHeadlineStreams();

    // Abort any in-flight request
    this.currentLoadAbortCtl.abort();
    this.currentLoadAbortCtl = new AbortController();
    this.isLoading$.next(true);

    // Clear stale explanation so it can’t flash
    this.explanationTextService.explanationText$.next('');

    try {
      // ─── Fetch all questions once ──────────────────────────────────
      const allQuestions = (await firstValueFrom(
        this.quizDataService.getQuestionsForQuiz(this.activeQuizId),
      )) as QuizQuestion[];
      const q: QuizQuestion | undefined = allQuestions[index];

      if (!q) {
        console.error('[loadQA] null question for Q', index);
        return false;
      }

      // ─── Ensure we have an options array ───────────────────────────
      let opts = q.options ?? [];
      if (opts.length === 0) {
        // Fallback: recheck question structure
        opts = (allQuestions as QuizQuestion[])?.[index]?.options ?? [];
        if (opts.length === 0) {
          console.error('[loadQA] no options for Q', index);
          return false;
        }
      }

      // ─── Normalize / add fallback feedback once ───────────────────
      const finalOpts = opts.map((o, i) => ({
        ...o,
        optionId: o.optionId ?? i + 1,
        active: o.active ?? true,
        showIcon: !!o.showIcon,
        selected: !!o.selected,
        correct: !!o.correct,
        feedback:
          o.feedback ?? `You're right! The correct answer is Option ${i + 1}.`
      }));

      // ─── Synthesize the selection message ──────────────────────────
      const msg = this.selectionMessageService.determineSelectionMessage(
        index,
        this.totalQuestions,
        false
      );

      // ─── Clone question and attach quizId and index ────────────────
      const safeQuestion: QuizQuestion = JSON.parse(
        JSON.stringify({
          ...q,
          options: finalOpts,
        })
      );

      const effectiveQuizId = this.quizService.quizId;

      // Emit values into QuizService manually — no getNextQuestion() needed
      this.quizService.currentQuestionSource.next(safeQuestion);
      this.quizService.optionsSource.next(finalOpts);

      // Emit trio into state
      this.quizStateService.emitQA(safeQuestion, msg, effectiveQuizId, index);

      return true;
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[loadQA] fetch failed', err);
      }
      return false;
    } finally {
      this.isLoading$.next(false);
    }
  }

  resetHeadlineStreams(index?: number): void {
    const activeIndex = this.quizService.getCurrentQuestionIndex();

    // Guard: skip stale resets from previous questions
    if (index != null && index !== activeIndex) {
      console.log(
        `[SKIP stale resetHeadlineStreams] tried Q${index + 1}, active Q${activeIndex + 1}`
      );
      return;
    }

    console.log('[RESET HEADLINES] clearing for active index', activeIndex);

    // Clear streams only for the current question
    this.questionToDisplaySubject.next('');  // clears question text
    this.explanationTextService.explanationText$.next('');  // clears explanation
    this.clearQA();  // clears question and options
    this.quizStateService.setDisplayState({
      mode: 'question',  // force "question" mode
      answered: false
    });
  }

  clearQA(): void {
    this.qaSubject.next({
      quizId: '',
      index: -1,
      heading: '',
      question: null as unknown as QuizQuestion,
      options: [],
      explanation: '',
      selectionMessage: ''
    });
  }

  public emitQuestionTextSafely(text: string, index: number): void {
    if (this.isNavBarrierActive()) {
      console.log('[Loader] Blocked emission: navigation barrier active');
      return;
    }

    const now = performance.now();

    // Global quiet-zone guard (shared with ETS)
    if (now < (this._quietZoneUntil ?? 0)) {
      const remain = (this._quietZoneUntil ?? 0) - now;
      console.log(
        `[Loader] 🚫 Blocked question emission during quiet zone (${remain.toFixed(1)}ms left)`
      );
      return;
    }

    // Standard freeze gating
    if (this._frozen && now < (this._renderFreezeUntil ?? 0)) {
      console.log('[Loader] 🧊 Emission blocked within freeze window');
      return;
    }

    const activeIndex = this.quizService.getCurrentQuestionIndex();
    if (index !== activeIndex) {
      console.log(
        `[SKIP] stale emission for Q${index + 1} (active is Q${activeIndex + 1})`
      );
      return;
    }

    const trimmed = (text ?? '').trim();
    if (!trimmed || trimmed === '?') return;

    // Anti-early guard — skip emissions too close to navigation
    if (now - (this._lastNavTime ?? 0) < 80) {
      console.log(
        `[Drop] Early emission for Q${index + 1} (Δ=${(now - (this._lastNavTime ?? 0)).toFixed(1)}ms)`,
      );
      return;
    }

    // Safe to emit
    this._lastQuestionText = trimmed;
    this.questionToDisplaySubject.next(trimmed);
    console.log(`[Loader] Emitted question text safely for Q${index + 1}`);
  }

  public clearQuestionTextBeforeNavigation(): void {
    try {
      this._frozen = true;  // extra safeguard
      this.questionToDisplaySubject.next('');  // emit empty to flush template
      this._lastQuestionText = '';
      this._lastRenderedIndex = -1;
      console.log('[Loader] Cleared question text before navigation');
    } catch (error) {
      console.warn('[Loader] clearQuestionTextBeforeNavigation error', error);
    }
  }

  public freezeQuestionStream(durationMs = 120): void {
    // Prevent multiple overlapping freezes
    if (this._isVisualFrozen) return;

    this._isVisualFrozen = true;
    this._frozen = true;

    // Extend the logic freeze window slightly (extra 20–40 ms)
    const EXTENSION_MS = 40;
    this._renderFreezeUntil = performance.now() + durationMs + EXTENSION_MS;

    console.log(
      `[Freeze] Logic+visual freeze started (${durationMs + EXTENSION_MS} ms)`,
    );

    // Hide content DOM-side without touching Angular templates
    const el = document.querySelector('h3[i18n]');
    if (el) (el as HTMLElement).style.opacity = '0';

    clearTimeout(this._freezeTimer);
    this._freezeTimer = setTimeout(
      () => {
        this.unfreezeQuestionStream();
      },
      durationMs + EXTENSION_MS + 8
    );
  }

  public unfreezeQuestionStream(): void {
    const now = performance.now();

    // Define a quiet zone after unfreeze to prevent early emissions
    const QUIET_WINDOW_MS = 120;

    // If still within freeze window, schedule a delayed unfreeze
    if (now < this._renderFreezeUntil) {
      const delay = this._renderFreezeUntil - now;
      console.log(`[Loader] Delaying unfreeze ${delay.toFixed(1)} ms`);

      // keep question text hidden visually during this delay
      this._isVisualFrozen = true;
      const el = document.querySelector('h3[i18n]');
      if (el) (el as HTMLElement).style.opacity = '0';

      clearTimeout(this._freezeTimer);
      this._freezeTimer = setTimeout(() => {
        this._isVisualFrozen = false;
        this._frozen = false;
        this._quietUntil = performance.now() + QUIET_WINDOW_MS;  // add quiet zone

        // Restore visibility one frame after Angular repaint
        requestAnimationFrame(() => {
          const el2 = document.querySelector('h3[i18n]');
          if (el2) (el2 as HTMLElement).style.visibility = 'visible';
          console.log(
            `[Loader] Stream unfrozen (delayed) + quiet ${QUIET_WINDOW_MS} ms`
          );
        });
      }, delay + 12);

      return;
    }

    // Immediate unfreeze path
    this._isVisualFrozen = false;
    this._frozen = false;
    this._quietUntil = now + QUIET_WINDOW_MS;

    // Show the element again right after frame stabilization
    requestAnimationFrame(() => {
      const el = document.querySelector('h3[i18n]');
      if (el) (el as HTMLElement).style.opacity = '1';
      console.log(
        `[Loader] Stream unfrozen (immediate) + quiet ${QUIET_WINDOW_MS} ms`
      );
    });
  }

  public isNavBarrierActive(): boolean {
    return this._navBarrier;
  }

  // Ensures Angular and the DOM have both fully re-rendered before resuming UI emissions.
  public waitForDomStable(extra = 32): Promise<void> {
    // Unified DOM settle: 1 frame + small buffer
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, extra);
      });
    });
  }
}