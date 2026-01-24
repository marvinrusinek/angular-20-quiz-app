import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component,
  ComponentRef, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy,
  OnInit, Output, SimpleChange, SimpleChanges, ViewChild, ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import {
  BehaviorSubject, firstValueFrom, from, Observable, of, ReplaySubject,
  Subject, Subscription
} from 'rxjs';
import {
  catchError, debounceTime, distinctUntilChanged, filter, map, skip,
  switchMap, take, takeUntil, tap, timeout
} from 'rxjs/operators';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatRadioButton } from '@angular/material/radio';

import { QuestionType } from '../../../shared/models/question-type.enum';
import { Utils } from '../../../shared/utils/utils';
import { FeedbackProps } from '../../../shared/models/FeedbackProps.model';
import { Option } from '../../../shared/models/Option.model';
import { OptionBindings } from '../../../shared/models/OptionBindings.model';
import { OptionClickedPayload } from '../../../shared/models/OptionClickedPayload.model';
import { QuestionPayload } from '../../../shared/models/QuestionPayload.model';
import { QuestionState } from '../../../shared/models/QuestionState.model';
import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizQuestionConfig } from '../../../shared/models/QuizQuestionConfig.interface';
import { QuizQuestionEvent } from '../../../shared/models/QuizQuestionEvent.type';
import { SelectedOption } from '../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../shared/models/SharedOptionConfig.model';
import { FeedbackService } from '../../../shared/services/feedback.service';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/quiz-navigation.service';
import { QuizStateService } from '../../../shared/services/quizstate.service';
import { QuizQuestionLoaderService } from '../../../shared/services/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/quizquestionmgr.service';
import { DynamicComponentService } from '../../../shared/services/dynamic-component.service';
import { ExplanationTextService } from '../../../shared/services/explanation-text.service';
import { NextButtonStateService } from '../../../shared/services/next-button-state.service';
import { ResetStateService } from '../../../shared/services/reset-state.service';
import { SelectedOptionService } from '../../../shared/services/selectedoption.service';
import { SelectionMessageService } from '../../../shared/services/selection-message.service';
import { SharedVisibilityService } from '../../../shared/services/shared-visibility.service';
import { SoundService } from '../../../shared/services/sound.service';
import { TimerService } from '../../../shared/services/timer.service';
import { UserPreferenceService } from '../../../shared/services/user-preference.service';
import { BaseQuestion } from '../base/base-question';
import { AnswerComponent } from '../answer/answer-component/answer.component';
import { SharedOptionComponent } from '../answer/shared-option-component/shared-option.component';

type FeedbackKey = number | string;

export interface FeedbackConfig {
  showFeedback: boolean,
  isCorrect?: boolean,
  icon?: string,
  text?: string,
  timedOut?: boolean
}

@Component({
  selector: 'codelab-quiz-question',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './quiz-question.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuizQuestionComponent extends BaseQuestion
  implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  @ViewChild('dynamicAnswerContainer', { read: ViewContainerRef, static: false })
  dynamicAnswerContainer!: ViewContainerRef;
  @ViewChild(SharedOptionComponent, { static: false })
  sharedOptionComponent!: SharedOptionComponent;

  @Output() answer = new EventEmitter<number>();
  @Output() answeredChange = new EventEmitter<boolean>();
  @Output() selectionChanged: EventEmitter<{
    question: QuizQuestion,
    selectedOptions: Option[]
  }> = new EventEmitter();
  @Output() questionAnswered = new EventEmitter<QuizQuestion>();
  @Output() isAnswerSelectedChange = new EventEmitter<boolean>();
  @Output() override explanationToDisplayChange = new EventEmitter<string>();
  @Output() showExplanationChange = new EventEmitter<boolean>();
  @Output() selectionMessageChange = new EventEmitter<string>();
  @Output() isAnsweredChange = new EventEmitter<boolean>();
  @Output() feedbackTextChange = new EventEmitter<string>();
  @Output() isAnswered = false;
  @Output() answerSelected = new EventEmitter<boolean>();
  @Output() optionSelected = new EventEmitter<SelectedOption>();
  @Output() displayStateChange = new EventEmitter<{
    mode: 'question' | 'explanation';
    answered: boolean;
  }>();
  @Output() feedbackApplied = new EventEmitter<number>();
  @Output() nextButtonState = new EventEmitter<boolean>();
  @Output() questionAndOptionsReady = new EventEmitter<void>();

  /**
   * Unified event output - combines all child events into a single stream.
   * Use this instead of individual outputs for cleaner template bindings.
   */
  @Output() events = new EventEmitter<QuizQuestionEvent>();

  /**
   * Config input setter - hydrates all properties from a single config object.
   * Use this instead of individual inputs for cleaner template bindings.
   */
  @Input() set quizConfig(cfg: QuizQuestionConfig | null) {
    if (!cfg) return;

    // Hydrate individual properties from config
    this.currentQuestionIndex = cfg.currentQuestionIndex;
    this.displayState$ = cfg.displayState$;
    this.shouldRenderOptions = cfg.shouldRenderOptions;
    this.questionToDisplay$ = cfg.questionToDisplay$;
    this.explanationToDisplay = cfg.explanationToDisplay;

    // Set questionPayload directly since it's already in the right format (QuestionPayload)
    if (cfg.questionPayload) {
      this.questionPayload = cfg.questionPayload;
    }
  }

  @Input() data!: {
    questionText: string,
    explanationText?: string,
    correctAnswersText?: string,
    options: Option[]
  };
  @Input() override question!: QuizQuestion;
  @Input() question$!: Observable<QuizQuestion>;
  @Input() questions$: Observable<QuizQuestion[]> = new Observable<QuizQuestion[]>();
  @Input() options!: Option[];
  @Input() override optionsToDisplay: Option[] = [];
  @Input() currentQuestion: QuizQuestion | null = null;
  @Input() currentQuestion$: Observable<QuizQuestion | null> = of(null);
  @Input() currentQuestionIndex = 0;
  @Input() previousQuestionIndex = 0;
  @Input() quizId = '';
  @Input() multipleAnswer: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);
  @Input() explanation = '';
  @Input() explanationText = '';
  @Input() isOptionSelected = false;
  @Input() override showFeedback = false;
  @Input() selectionMessage = '';
  @Input() reset = false;
  @Input() override explanationToDisplay: string | null = null;
  @Input() passedOptions: Option[] | null = null;
  @Input() questionToDisplay$!: Observable<string | null>;
  @Input() displayState$!: Observable<{
    mode: 'question' | 'explanation',
    answered: boolean
  }>;
  @Input() shouldRenderOptions = false;
  private quiz: Quiz | null = null;
  selectedQuiz = new ReplaySubject<Quiz>(1);
  questions: QuizQuestion[] = [];
  questionsArray: QuizQuestion[] = [];
  questionsObservableSubscription!: Subscription;
  private _questionIndex!: number;
  questionData!: QuizQuestion;
  override questionForm: FormGroup = new FormGroup({});
  questionRenderComplete = new EventEmitter<void>();
  questionToDisplay: QuizQuestion | null = null;
  private _questionPayload: QuestionPayload | null = null;
  latestQuestionText$: Observable<string> = of('');
  totalQuestions!: number;
  private lastProcessedQuestionIndex: number | null = null;
  fixedQuestionIndex = 0;
  private navigatingBackwards = false;
  lastLoggedIndex = -1;
  lastLoggedQuestionIndex = -1;
  private _clickGate = false;  // same-tick re-entrance guard
  public selectedIndices = new Set<number>();

  private _lastGoodQuestion: QuizQuestion | null = null;
  private _lastGoodOptions: Option[] = [];

  combinedQuestionData$: Subject<{
    questionText: string;
    explanationText?: string;
    correctAnswersText?: string;
    currentOptions: Option[];
  }> = new Subject();

  override selectedOption: SelectedOption | null = null;
  selectedOptions: SelectedOption[] = [];
  currentOptions: Option[] | undefined;
  correctAnswers: number[] | undefined;
  override correctMessage = '';
  alreadyAnswered = false;
  optionChecked: { [optionId: number]: boolean } = {};
  answers: any[] = [];
  shuffleOptions = true;
  override optionBindings: OptionBindings[] = [];
  override showFeedbackForOption: { [optionId: string | number]: boolean } = {};
  isFeedbackApplied = false;
  resetFeedbackSubscription!: Subscription;
  resetStateSubscription!: Subscription;
  sharedVisibilitySubscription!: Subscription;
  optionSelectionSubscription!: Subscription;
  shufflePreferenceSubscription!: Subscription;
  private idxSub!: Subscription;
  private routeSub!: Subscription;
  isMultipleAnswer = false;
  isExplanationTextDisplayed = false;
  isNavigatingToPrevious = false;
  isLoading = true;
  private isLoadingInProgress = false;
  isFirstQuestion = true;
  isPaused = false;
  isQuizLoaded = false;
  private initialized = false;
  feedbackText = '';
  displayExplanation = false;
  override sharedOptionConfig: SharedOptionConfig | null = null;
  shouldRenderComponent = false;
  shouldRenderFinalOptions = false;
  areOptionsReadyToRender = false;
  public renderReady = false;
  _canRenderFinalOptions = false;
  explanationLocked = false;  // flag to lock explanation
  explanationVisible = false;
  displayMode: 'question' | 'explanation' = 'question';
  private displayMode$ = new BehaviorSubject<'question' | 'explanation'>('question');
  private displaySubscriptions: Subscription[] = [];
  private displayModeSubscription!: Subscription;
  private lastOptionsQuestionSignature: string | null = null;
  shouldDisplayExplanation = false;
  private isRestoringState = false;
  private displayState = {
    mode: 'question' as 'question' | 'explanation',
    answered: false
  };
  public displayStateSubject = new BehaviorSubject({
    mode: 'question',
    answered: false
  });

  private forceQuestionDisplay = true;
  readyForExplanationDisplay = false;
  isExplanationReady = false;
  isExplanationLocked = true;
  currentExplanationText = '';
  explanationOwnerIdx = -1;

  private _expl$ = new BehaviorSubject<string | null>(null);

  private _formattedByIndex = new Map<number, string>();
  private _timerForIndex: number | null = null;
  private handledOnExpiry = new Set<number>();

  private lastSerializedOptions = '';
  lastSerializedPayload = '';
  private payloadSubject = new BehaviorSubject<QuestionPayload | null>(null);
  private hydrationInProgress = false;

  public finalRenderReadySubject = new BehaviorSubject<boolean>(false);
  public finalRenderReady = false;
  public internalBufferReady = false;

  explanationTextSubject = new BehaviorSubject<string>('');
  private _fetEarlyShown = new Set<number>();

  feedbackTextSubject = new BehaviorSubject<string>('');

  selectionMessageSubscription: Subscription = new Subscription();

  private questionPayloadSubject = new BehaviorSubject<QuestionPayload | null>(null);

  private renderReadySubject = new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();
  private renderReadySubscription?: Subscription;

  private timerSub!: Subscription;

  waitingForReady = false;
  deferredClick?: {
    option: SelectedOption | null,
    index: number,
    checked: boolean,
    wasReselected?: boolean
  };

  private _wasHidden = false;
  private _savedDisplayMode: 'question' | 'explanation' | null = null;
  private _hiddenAt: number | null = null;
  private _elapsedAtHide: number | null = null;
  private _pendingRAF: number | null = null;
  private _msgTok = 0;

  private questionFresh = true;
  public feedbackConfigs: Record<FeedbackKey, FeedbackConfig> = {};
  public lastFeedbackOptionId: FeedbackKey = -1 as const;
  private lastResetFor = -1;
  private timedOut = false;

  // Tracks whether we already stopped for this question
  private _timerStoppedForQuestion = false;
  private _skipNextAsyncUpdates = false;

  // Last computed "allCorrect" (used across microtasks/finally)
  private _lastAllCorrect = false;

  private isUserClickInProgress = false;

  private _abortController: AbortController | null = null;

  private destroy$: Subject<void> = new Subject<void>();

  constructor(
    protected quizDataService: QuizDataService,
    protected quizNavigationService: QuizNavigationService,
    protected quizQuestionLoaderService: QuizQuestionLoaderService,
    protected quizQuestionManagerService: QuizQuestionManagerService,
    protected explanationTextService: ExplanationTextService,
    protected nextButtonStateService: NextButtonStateService,
    protected resetStateService: ResetStateService,
    protected selectionMessageService: SelectionMessageService,
    protected sharedVisibilityService: SharedVisibilityService,
    protected soundService: SoundService,
    protected timerService: TimerService,
    protected userPreferenceService: UserPreferenceService,
    protected activatedRoute: ActivatedRoute,
    protected router: Router,
    protected ngZone: NgZone,
    // override needed
    protected override dynamicComponentService: DynamicComponentService,
    protected override feedbackService: FeedbackService,
    protected override quizService: QuizService,
    protected override quizStateService: QuizStateService,
    protected override selectedOptionService: SelectedOptionService,
    protected override fb: FormBuilder,
    protected override cdRef: ChangeDetectorRef
  ) {
    super(fb, dynamicComponentService, feedbackService, quizService, quizStateService,
      selectedOptionService, cdRef
    );
  }

  @Input() set questionIndex(value: number) {
    this._questionIndex = value;

    // Cancel any previous request
    this._abortController?.abort();

    // Create a new AbortController for this load
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Save the new index locally
    this.currentQuestionIndex = value;

    // Fire-and-forget, but intentional
    void this.loadQuestion(signal);
  }

  get questionIndex(): number {
    return this._questionIndex;
  }

  @Input() set questionPayload(value: QuestionPayload | null) {
    if (!value) {
      console.warn('[⚠️ Skipping: value is null]');
      return;
    }

    try {
      this._questionPayload = value;
      this.questionPayloadSubject.next(value);
      this.hydrateFromPayload(value);
    } catch (err: any) {
      console.error('[❌ Error during hydrateFromPayload]', err);
    }
  }

  get questionPayload(): QuestionPayload | null {
    return this._questionPayload;
  }

  // ============ Unified Event Emission Helpers ============
  // These methods emit through both individual outputs (backwards compatibility)
  // and the unified `events` output (new pattern)

  private emitOptionSelected(option: SelectedOption): void {
    this.optionSelected.emit(option);
    this.events.emit({ type: 'optionSelected', payload: option });
  }

  private emitExplanationToDisplayChange(explanation: string): void {
    this.explanationToDisplayChange.emit(explanation);
    this.events.emit({ type: 'explanationToDisplayChange', payload: explanation });
  }

  private emitShowExplanationChange(show: boolean): void {
    this.showExplanationChange.emit(show);
    this.events.emit({ type: 'showExplanationChange', payload: show });
  }

  private emitSelectionMessageChange(message: string): void {
    this.selectionMessageChange.emit(message);
    this.events.emit({ type: 'selectionMessageChange', payload: message });
  }

  private emitAnswer(optionIndex: number): void {
    this.answer.emit(optionIndex);
    this.events.emit({ type: 'answer', payload: optionIndex });
  }
  // ============ End Unified Event Emission Helpers ============

  private resetUIForNewQuestion(): void {
    this.sharedOptionComponent?.resetUIForNewQuestion();
    this.updateShouldRenderOptions([]);
  }

  override async ngOnInit(): Promise<void> {
    this.checkForSharedOptions();
    this.clearSoundFlagsForCurrentQuestion(0);

    this.subscribeToCurrentQuestionIndex();
    this.logQuestionIndexObservations();
    this.initializeLatestQuestionText();
    this.subscribeToQuestionPayload();
    this.subscribeToShuffleChanges();
    this.subscribeToNavigationEvents();
    this.subscribeToEventsAndResets();
    this.subscribeToRouteParams();

    // Sync local questionsArray with Service!
    // This ensures that when Shuffle is toggled, this component sees the new order immediately.
    this.quizService.questions$.pipe(takeUntil(this.destroy$)).subscribe(questions => {
      if (questions && questions.length > 0) {
        this.questionsArray = questions;
        console.log(`[QuizQuestionComponent] 🔄 Synced questionsArray (${questions.length} items). Shuffle active? ${this.quizService.isShuffleEnabled()}`);
      }
    });

    const loaded = await this.initializeInitialQuestion();
    if (!loaded) {
      return;
    }

    this.subscribeToTimerEvents();
    await this.initializeComponentAndPipelines();
  }

  private checkForSharedOptions(): void {
    const qIndex = this.quizService.getCurrentQuestionIndex();
    const current = this.quizService.questions?.[qIndex];
    const next = this.quizService.questions?.[qIndex + 1];

    if (current && next && current.options && next.options) {
      const shared = current.options.some(
        (o: Option, i: number) => o === next.options[i]
      );
      console.log(`[REF TRACE] Shared option refs between Q${qIndex} and 
        Q${qIndex + 1}:`, shared);
    }
  }

  private subscribeToCurrentQuestionIndex(): void {
    this.idxSub = this.quizService.currentQuestionIndex$
      .pipe(
        map((i: number) => this.normalizeIndex(i)),
        distinctUntilChanged(),

        // On every question: hard reset view and restart visible countdown
        tap((i0: number) => {
          this.currentQuestionIndex = i0;
          this.resetPerQuestionState(i0);  // this must NOT arm any expiry
          this.handledOnExpiry.delete(i0);  // clear any one-shot guards
          requestAnimationFrame(() => this.applyPassiveWriteGate(i0));

          // Prewarm formatted text for THIS question (non-blocking; no UI writes)
          // Cache hit → no-op; miss → compute & store for first-click
          try {
            const hasCache = this._formattedByIndex?.has(i0);
            if (!hasCache) {
              // Don’t await—keep nav snappy
              this.resolveFormatted(i0, {
                useCache: true,
                setCache: true
              }).catch((err: Error) =>
                console.warn('[prewarm resolveFormatted]', err)
              );
            }
          } catch (err: any) {
            console.warn('[prewarm] skipped', err);
          }
        }),

        // Wait for the SAME clock the UI renders: elapsedTime$
        // When it reaches the duration once, expire this question.
        switchMap((i0: number) =>
          this.timerService.elapsedTime$.pipe(
            filter(
              (elapsed: number) =>
                this.timerService.isTimerRunning &&
                elapsed >= this.timerService.timePerQuestion
            ),
            take(1),
            map((): number => i0)
          )
        )
      )
      .subscribe((i0: number) => this.onTimerExpiredFor(i0));
  }

  private logQuestionIndexObservations(): void {
    this.quizService.currentQuestionIndex$
      .pipe(distinctUntilChanged())
      .subscribe((index) => {
        console.warn('[QQC INDEX OBSERVED]', index, {
          routeIndex: Number(this.activatedRoute.snapshot.paramMap.get('questionIndex')) - 1,
          serviceIndex: this.quizService.getCurrentQuestionIndex()
        });
      });
  }

  private initializeLatestQuestionText(): void {
    if (this.questionToDisplay$) {
      this.latestQuestionText$ = this.questionToDisplay$.pipe(
        map((value) => value ?? ''),  // ensure it's always a string
        distinctUntilChanged()
      );
    }
  }

  private subscribeToQuestionPayload(): void {
    this.quizService.questionPayload$
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        tap((payload) => {
          this.currentQuestion = payload.question;
          this.optionsToDisplay = payload.options;
          this.explanationToDisplay = payload.explanation ?? '';
          this.updateShouldRenderOptions(this.optionsToDisplay);
        })
      )
      .subscribe((payload) => {
        console.log('[📥 QQC got payload]', payload);
      });
  }

  private subscribeToShuffleChanges(): void {
    this.quizService.checkedShuffle$.subscribe((shouldShuffle) => {
      this.shuffleOptions = shouldShuffle;
      // Clear local cache to force re-fetch of correct (shuffled/unshuffled) questions
      this.questionsArray = [];
      console.log('[QQC] Shuffle changed, cleared questionsArray');
    });
  }

  private subscribeToNavigationEvents(): void {
    this.quizNavigationService.navigationSuccess$.subscribe(() => {
      console.info('[QQC] 📦 navigationSuccess$ received — general navigation');
      this.resetUIForNewQuestion();
    });

    this.quizNavigationService.navigatingBack$.subscribe(() => {
      console.info('[QQC] 🔙 navigatingBack$ received');
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.isNavigatingBackwards = true;
      }
      this.resetUIForNewQuestion();
    });

    this.quizNavigationService.navigationToQuestion$.subscribe(
      ({ question, options }) => {
        if (question?.questionText && options?.length) {
          console.log(`[QQC] 🚢 navigationToQuestion$ fired. QID: ${(question as any).questionId}, Text: "${question.questionText?.substring(0, 15)}..."`);

          // ALWAYS load dynamic component to ensure fresh data
          if (this.dynamicAnswerContainer) {
            void this.loadDynamicComponent(question, options);
            this.containerInitialized = true;
            console.log('[✅ Component injected dynamically from navigation ' +
              '(FORCE REFRESH)]');
          }

          this.sharedOptionConfig = null;
          this.shouldRenderFinalOptions = false;
        } else {
          console.warn('[🚫 Dynamic injection skipped]', {
            questionText: question?.questionText,
            optionsLength: options?.length
          });
        }
      }
    );
  }

  private subscribeToEventsAndResets(): void {
    this.quizNavigationService.explanationReset$.subscribe(() => {
      this.resetExplanation();
    });

    this.quizNavigationService.renderReset$.subscribe(() => {
      this.renderReady = false;
    });

    this.quizNavigationService.resetUIForNewQuestion$.subscribe(() => {
      this.resetUIForNewQuestion();
    });

    this.quizService.preReset$
      .pipe(
        takeUntil(this.destroy$),
        filter((idx) => Number.isFinite(idx as number) && (idx as number) >= 0),
        filter((idx) => idx !== this.lastResetFor),  // optional de-dupe
        tap((idx) => (this.lastResetFor = idx as number))
      )
      .subscribe((idx) => {
        this.resetPerQuestionState(idx as number);  // reset for the incoming question
      });
  }

  private subscribeToRouteParams(): void {
    this.activatedRoute.paramMap.subscribe(async (params) => {
      this.explanationVisible = false;
      this.explanationText = '';
      this._expl$.next(null);

      const rawIndex = Number(params.get('questionIndex'));
      // Convert 1-based route index to 0-based internal index
      const questionIndex = (rawIndex > 0 ? rawIndex : 1) - 1;

      // SYNC: Explicitly set service index to ensure it matches visual state
      // This is a failsafe in case QuizComponent didn't update it yet or we are
      // in a different routing context
      this.quizService.setCurrentQuestionIndex(questionIndex);
      this.currentQuestionIndex = questionIndex;

      // Prioritize Input Data ("Prop Drilling")
      // If the parent (CodelabQuizContentComponent) passed us a question that
      // matches the requested index, USE IT. Do not re-fetch from service, which
      // might return stale/unshuffled data.
      if (
        this.question &&
        this.questionToDisplay &&
        (this.currentQuestionIndex === questionIndex ||
          this.quizService.currentQuestionIndex === questionIndex)
      ) {
        console.log('[QQC] ⚡ Using INPUT question (preventing double-fetch mismatch). Text:', this.question.questionText?.substring(0, 20));
        this.hydrateFromPayload({
          question: this.question,
          options: this.optionsToDisplay || this.question.options,
          explanation: this.explanationToDisplay || this.question.explanation
        });
        return;
      }

      try {
        const question = await firstValueFrom(
          this.quizService.getQuestionByIndex(questionIndex)
        );
        if (!question) {
          console.warn(`[⚠️ No valid question returned for index ${questionIndex}]`);
          return;
        }
      } catch (err: any) {
        console.error('[❌ Error during question fetch]', err);
      }
    });
  }

  private async initializeInitialQuestion(): Promise<boolean> {
    const routeIndex =
      +(this.activatedRoute.snapshot.paramMap.get('questionIndex') ?? 0);
    const zeroBasedIndex = Number.isFinite(routeIndex) && routeIndex > 0
      ? routeIndex - 1
      : 0;

    this.currentQuestionIndex = zeroBasedIndex;
    this.fixedQuestionIndex = zeroBasedIndex;
    this.quizService.setCurrentQuestionIndex(zeroBasedIndex);

    const loaded = await this.loadQuestion();
    if (!loaded) {
      console.error('[❌ Failed to load initial question]');
      return false;
    }
    return true;
  }

  private subscribeToTimerEvents(): void {
    this.timerService.expired$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const idx = this.normalizeIndex(this.currentQuestionIndex ?? 0);
      this.onQuestionTimedOut(idx);
    });

    this.timerService.stop$
      .pipe(skip(1), takeUntil(this.destroy$))
      .subscribe(() => {
        queueMicrotask(() => {
          const reason = this.timedOut ? 'timeout' : 'stopped';
          this.handleTimerStoppedForActiveQuestion(reason);
        });
      });
  }

  private async initializeComponentAndPipelines(): Promise<void> {
    try {
      this.populateOptionsToDisplay();

      // Initialize display mode subscription for reactive updates
      this.initializeDisplayModeSubscription();

      this.renderReady$ = this.questionPayloadSubject.pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((payload) => {
          // Assign all data at once
          const { question, options, explanation } = payload;
          this.currentQuestion = question;
          this.optionsToDisplay = [...options];
          this.explanationToDisplay = explanation?.trim() || '';

          // Show everything together — Q+A in one paint pass
          setTimeout(() => {
            this.renderReady = true;
            this.renderReadySubject.next(true);
          }, 0);

          console.log('[✅ renderReady triggered with Q&A]');
        }),
        map(() => true)
      );
      this.renderReadySubscription = this.renderReady$.subscribe();

      // Initial component setups
      await this.initializeComponent();
      this.initializeComponentState();

      // Initialize quiz data and routing
      await this.initializeQuiz();
      await this.initializeQuizDataAndRouting();

      // Initialize questions
      this.initializeQuizQuestion();
      this.initializeFirstQuestion();
      await this.handleQuestionState();

      // Setup for visibility and routing
      this.setupVisibilitySubscription();
      this.initializeRouteListener();

      // Additional subscriptions and state tracking
      this.setupSubscriptions();
      this.subscribeToNavigationFlags();
      this.subscribeToTotalQuestions();
    } catch (error: any) {
      console.error('Error in ngOnInit:', error);
    }
  }

  async ngAfterViewInit(): Promise<void> {
    const idx = this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0;
    if (this._timerForIndex == null) this.resetForQuestion(idx);  // starts timer for Q1

    // Defer renderReady subscription until ViewChild is actually initialized
    setTimeout(() => {
      if (this.sharedOptionComponent) {
        this.subscribeToRenderReady();
      } else {
        console.warn('[⚠️ sharedOptionComponent not ready in ngAfterViewInit]');
      }
    });

    this.quizQuestionLoaderService.options$
      .pipe(filter((arr) => Array.isArray(arr) && arr.length > 0))
      .subscribe((opts: Option[]) => {
        this.currentOptions = [...opts];
      });

    // Hydrate from payload
    this.payloadSubject
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        distinctUntilChanged(
          (a, b) =>
            JSON.stringify(a) === JSON.stringify(b))
      )
      .subscribe((payload: QuestionPayload) => {
        if (this.hydrationInProgress) return;

        this.renderReady = false;
        this.hydrationInProgress = true;

        // Extract and assign payload
        const { question, options, explanation } = payload;
        this.currentQuestion = question;
        this.explanationToDisplay = explanation?.trim() || '';
        this.optionsToDisplay = structuredClone(options);  // ensure isolation

        // Initialize option bindings if needed
        if (this.sharedOptionComponent) {
          this.sharedOptionComponent.initializeOptionBindings();
        }

        // Baseline message recompute, now that options are known
        if (this.optionsToDisplay && this.optionsToDisplay.length > 0) {
          // Release baseline immediately
          this.selectionMessageService.releaseBaseline(this.currentQuestionIndex);
        }

        // Finalize rendering state after one microtask delay
        setTimeout(() => {
          this.renderReady = true;
          this.hydrationInProgress = false;
          this.cdRef.detectChanges();  // trigger OnPush refresh
        }, 0);
      });

    const index = this.currentQuestionIndex;

    // Wait until questions are available
    if (!this.questionsArray || this.questionsArray.length <= index) {
      // Retry after a short delay
      setTimeout(() => this.ngAfterViewInit(), 50);
      return;
    }

    const question = this.questionsArray[index];
    if (question) {
      this.quizService.setCurrentQuestion(question);

      setTimeout(() => {
        const explanationText = question.explanation || 'No explanation available';
        this.updateExplanationUI(index, explanationText);
      }, 50);
    } else {
      console.error(`[ngAfterViewInit] ❌ No question found at index ${index}`);
    }
  }

  override async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const newIndex = changes['currentQuestionIndex']?.currentValue;
    const prevIndex = changes['currentQuestionIndex']?.previousValue;

    if (
      typeof newIndex === 'number' &&
      typeof prevIndex === 'number' &&
      newIndex !== prevIndex
    ) {
      this._fetEarlyShown.delete(prevIndex);  // only clear the last one, not all
      console.log(`[QQC] 🔄 Reset _fetEarlyShown for transition ${prevIndex + 1} → ${newIndex + 1}`);
    }

    if (changes['questionPayload'] && this.questionPayload) {
      this.hydrateFromPayload(this.questionPayload);
      this.questionPayloadSubject.next(this.questionPayload);
      this.enforceHydrationFallback();
    }

    if (changes['currentQuestionIndex'] && !changes['currentQuestionIndex'].firstChange) {
      // Hide any leftover explanation from the previous question
      this.explanationVisible = false;
      this.explanationText = '';
    }

    if (changes['question']) {
      // Clear local icon state before changing question
      this.clearOptionStateForQuestion(this.previousQuestionIndex);
    }

    if (changes['question'] || changes['options']) {
      this.unselectOption();  // clears per-question UI state
      this.handleQuestionAndOptionsChange(changes['question'], changes['options']);

      // Restore selected + icon state
      if (this.currentQuestionIndex != null) {
        this.restoreSelectionsAndIconsForQuestion(
          this.quizService.currentQuestionIndex
        );
      }

      this.previousQuestionIndex = this.currentQuestionIndex;
    }

    // Emit renderReady when both question and options are valid
    const hasValidQuestion =
      !!this.questionData?.questionText?.trim() ||
      !!this.currentQuestion?.questionText?.trim();

    const hasValidOptions = Array.isArray(this.options) && this.options.length > 0;

    if (hasValidQuestion && hasValidOptions) {
      // Use setTimeout to allow DOM update cycle
      setTimeout(() => {
        this.renderReadySubject.next(true);  // conditions met, emitting true
      }, 0);
    } else {
      console.warn('[⏸️ renderReady] Conditions not met:', { hasValidQuestion, hasValidOptions });
      this.renderReadySubject.next(false);
    }
  }

  override ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.idxSub?.unsubscribe();
    this.questionsObservableSubscription?.unsubscribe();
    this.optionSelectionSubscription?.unsubscribe();
    this.selectionMessageSubscription?.unsubscribe();
    this.sharedVisibilitySubscription?.unsubscribe();
    this.resetFeedbackSubscription?.unsubscribe();
    this.resetStateSubscription?.unsubscribe();
    this.displayModeSubscription?.unsubscribe();
    this.renderReadySubscription?.unsubscribe();
    this.timerSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.shufflePreferenceSubscription?.unsubscribe();
  }

  // Listen for the visibility change event
  @HostListener('window:visibilitychange', [])
  async onVisibilityChange(): Promise<void> {
    const state = document.visibilityState;

    // HIDDEN  → save state + timer + DISPLAY MODE
    if (state === 'hidden') {
      this._wasHidden = true;

      // Save the current display mode to restore it later
      const currentDisplayState =
        this.quizStateService.displayStateSubject?.value;
      if (currentDisplayState) {
        this._savedDisplayMode = currentDisplayState.mode;
        console.log('[VISIBILITY] 💾 QQC saved display mode on hide:',
          this._savedDisplayMode);
      }

      try {
        const idx = this.currentQuestionIndex ?? 0;

        if (!this.quizId) {
          console.warn('[VISIBILITY] ⚠️ Missing quizId on hide');
        } else {
          const qState =
            this.quizStateService.getQuestionState(this.quizId, idx);

          const totalCorrectAnswers = Array.isArray(qState?.selectedOptions)
            ? qState.selectedOptions.filter((o) => o.correct).length
            : 0;

          this.quizStateService.updateQuestionState(this.quizId, idx,
            {
              ...qState,
              isAnswered: qState?.isAnswered ?? false,
              explanationDisplayed:
                this.displayExplanation ||
                !!(this.explanationTextService as any)
                  ?.shouldDisplayExplanation$?.value,
              explanationText:
                this.explanationTextService.latestExplanation ??
                qState?.explanationText ??
                '',
              selectedOptions: qState?.selectedOptions ?? []
            },
            totalCorrectAnswers
          );

          console.log(
            `[VISIBILITY] 💾 Saved state for Q${idx + 1} (answered=${qState?.isAnswered})`,
          );
        }
      } catch (err: any) {
        console.warn('[VISIBILITY] ⚠️ Failed to persist state on hide', err);
      }

      // Save timer snapshot (for expiry check)
      try {
        this._elapsedAtHide = await firstValueFrom(this.timerService.elapsedTime$.pipe(take(1)));
        this._hiddenAt = performance.now();
      } catch {
        this._elapsedAtHide = null;
        this._hiddenAt = null;
      }

      return;
    }

    // Anything else that isn't "visible" – ignore
    if (state !== 'visible') return;

    // VISIBLE  → timer check + light restore
    // Timer expiry check
    try {
      const duration = this.timerService.timePerQuestion ?? 30;

      let candidate =
        Number(await firstValueFrom(this.timerService.elapsedTime$.pipe(take(1))));

      if (this._hiddenAt != null && this._elapsedAtHide != null) {
        const hiddenDeltaSec = Math.floor(
          (performance.now() - this._hiddenAt) / 1000,
        );
        candidate = this._elapsedAtHide + hiddenDeltaSec;
      }

      if (candidate >= duration) {
        const i0 = this.normalizeIndex(this.currentQuestionIndex ?? 0);

        const alreadyShowing = await firstValueFrom(
          this.explanationTextService.shouldDisplayExplanation$.pipe(map(Boolean), take(1))
        );

        if (!alreadyShowing) {
          console.log('[VISIBILITY] ⏰ Timer expired while hidden, forcing expiry handler');
          this.timerService.stopTimer?.(undefined, { force: true });
          this.ngZone.run(() => void this.onTimerExpiredFor(i0));
        }
      }
    } catch (err: any) {
      console.warn('[VISIBILITY] ⚠️ Timer expiry check failed', err);
    } finally {
      this._hiddenAt = null;
      this._elapsedAtHide = null;
    }

    const idx = this.currentQuestionIndex ?? 0;

    // Ensure optionsToDisplay is sane
    if (!Array.isArray(this.optionsToDisplay) || this.optionsToDisplay.length === 0) {
      if (this.currentQuestion?.options?.length) {
        this.optionsToDisplay = this.currentQuestion.options.map(
          (option, i) => ({
            ...option,
            optionId: option.optionId ?? i,
            correct: option.correct ?? false
          })
        );
      } else {
        console.warn(
          '[VISIBILITY] ⚠️ No options available to repopulate optionsToDisplay'
        );
      }
    }

    // Restore explanation/question display based on SAVED DISPLAY MODE,
    // NOT based on isAnswered or explanationDisplayed flags.
    try {
      if (!this.quizId) {
        console.error('[VISIBILITY] ❌ quizId missing on visible restore');
        this.cdRef.markForCheck();
        return;
      }

      const qState =
        this.quizStateService.getQuestionState(this.quizId, idx);

      // Use the saved display mode, not assumptions based on answered state
      const shouldShowExplanation = this._savedDisplayMode === 'explanation';
      if (shouldShowExplanation) {
        console.log(`[VISIBILITY] ✅ Restoring explanation view for Q${idx + 1}`);

        // Restore only – do NOT regenerate explanation text here
        const stored = qState?.explanationText ||
          this.explanationTextService.latestExplanation || '';

        if (stored && stored.trim().length > 0) {
          console.log('[VisibilityChange] ♻️ Restoring existing FET for Q' + (idx + 1));

          this.displayExplanation = true;
          this.explanationToDisplay = stored;

          // Sync service state
          this.explanationTextService.setExplanationText(stored);
          this.explanationTextService.setShouldDisplayExplanation(true);

          // Update global display mode
          this.quizStateService.displayStateSubject.next(
            { mode: 'explanation', answered: true }
          );
        } else {
          console.log('[VisibilityChange] No stored explanation to restore');
        }

        this.explanationTextService.setShouldDisplayExplanation(true);
        this.explanationTextService.setIsExplanationTextDisplayed(true);

        this.quizStateService.setDisplayState({ mode: 'explanation', answered: true },
          { force: true });
      } else {
        this.displayExplanation = false;
        this.explanationTextService.setShouldDisplayExplanation(false);
        this.explanationTextService.setIsExplanationTextDisplayed(false);

        this.quizStateService.setDisplayState({
          mode: 'question',
          answered: qState?.isAnswered ?? false
        }, { force: true });

        // Explanation is not considered "ready to show" in pure question mode
        this.quizStateService.setExplanationReady(false);
      }
    } catch (err: any) {
      console.warn('[VISIBILITY] ⚠️ FET restore failed', err);
    }

    this._savedDisplayMode = null;  // clear saved mode after restoration
    this._wasHidden = false;
    this.cdRef.markForCheck();
  }

  // Safely replace the option list when navigating to a new question
  public updateOptionsSafely(newOptions: Option[]): void {
    const incoming = JSON.stringify(newOptions);
    const current = JSON.stringify(this.optionsToDisplay);

    if (incoming !== current) {
      // Block render while we swap lists
      this.renderReadySubject.next(false);
      this.internalBufferReady = false;
      this.finalRenderReady = false;

      // Clear previous highlight / form flags before cloning
      for (const o of newOptions) {
        o.selected = false;
        o.highlight = false;
        o.showIcon = false;
      }

      // Batch the visual swap
      const latest = JSON.stringify(newOptions);
      if (latest !== this.lastSerializedOptions) {
        this.lastSerializedOptions = latest;
      }

      // Swap reference for OnPush
      this.optionsToDisplay = [...newOptions];

      // Initialize bindings if applicable
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.initializeOptionBindings();
      }

      // Set renderReady in next microtask to avoid sync paint conflicts
      setTimeout(() => {
        const ready =
          Array.isArray(this.optionsToDisplay) && this.optionsToDisplay.length > 0;
        if (!ready) {
          console.warn('[🛠️ Skipping renderReady — options not ready]');
          return;
        }

        this.internalBufferReady = true;
        this.finalRenderReady = true;
        this.renderReady = true;
        this.renderReadySubject.next(true);
        this.cdRef.markForCheck();
      }, 0);
    } else {
      // No option change, but render was not previously marked ready
      const ready =
        Array.isArray(this.optionsToDisplay) && this.optionsToDisplay.length > 0;

      if (ready && !this.finalRenderReady) {
        this.internalBufferReady = true;
        this.finalRenderReady = true;
        this.renderReady = true;
        this.renderReadySubject.next(true);
        this.cdRef.markForCheck();
      }
    }
  }

  private hydrateFromPayload(payload: QuestionPayload): void {
    // Compare by questionText instead of full JSON
    const incomingQuestionText = payload?.question?.questionText?.trim();
    const currentQuestionText = this.currentQuestion?.questionText?.trim();

    // Skip if same question text and already rendered
    if (
      incomingQuestionText &&
      incomingQuestionText === currentQuestionText &&
      this.finalRenderReady
    ) {
      console.warn('[⚠️ Skipping rehydration: same question text and already rendered]');
      return;
    }

    // Store payload and reset render flags
    this.lastSerializedPayload = JSON.stringify(payload);  // update for tracking
    this.renderReady = false;
    this.finalRenderReady = false;
    this.renderReadySubject.next(false);
    this.finalRenderReadySubject.next(false);
    this.cdRef.detectChanges();  // clear UI

    const { question, options, explanation } = payload;

    // Set both the direct input properties and internal properties
    this.question = question;
    this.options = options;
    this.explanation = explanation ?? '';
    this.currentQuestion = question;
    this.optionsToDisplay = structuredClone(options);
    this.updateShouldRenderOptions(this.optionsToDisplay);

    this.explanationToDisplay = explanation?.trim() || '';

    // Always load component for each question to ensure fresh data
    if (this.dynamicAnswerContainer) {
      void this.loadDynamicComponent(this.currentQuestion, this.optionsToDisplay);
      this.containerInitialized = true;
    } else {
      // ⚡ FIX: Container not ready yet (ngOnChanges fires before ngAfterViewInit)
      // Defer component loading until view is initialized
      console.log('[QQC] ⏳ dynamicAnswerContainer not ready, deferring loadDynamicComponent');

      const deferredLoad = () => {
        if (this.dynamicAnswerContainer) {
          console.log('[QQC] ✅ dynamicAnswerContainer now ready, loading component');
          void this.loadDynamicComponent(this.currentQuestion!, this.optionsToDisplay);
          this.containerInitialized = true;
        } else {
          // Still not ready, try again
          requestAnimationFrame(deferredLoad);
        }
      };

      // Use requestAnimationFrame to wait for view initialization
      requestAnimationFrame(deferredLoad);
    }

    if (this.sharedOptionComponent) {
      this.sharedOptionComponent.initializeOptionBindings();
    }

    // Set render flags after bindings
    setTimeout(() => {
      const bindingsReady =
        Array.isArray(this.sharedOptionComponent?.optionBindings) &&
        this.sharedOptionComponent.optionBindings.length > 0 &&
        this.sharedOptionComponent.optionBindings.every((b) => !!b.option);

      const ready =
        Array.isArray(this.optionsToDisplay) &&
        this.optionsToDisplay.length > 0 &&
        bindingsReady;

      if (ready) {
        this.sharedOptionComponent?.markRenderReady('✅ Hydrated from new payload');
      } else {
        console.warn('[❌ renderReady skipped: options or bindings not ready]');
      }
    }, 0);
  }

  private enforceHydrationFallback(): void {
    setTimeout(() => {
      const safeToRender =
        !this.renderReady &&
        Array.isArray(this.optionsToDisplay) &&
        this.optionsToDisplay.length > 0;

      if (safeToRender) {
        console.warn('[🛠️ Hydration fallback triggered: safe renderReady]');
        this.renderReady = true;
        this.cdRef.detectChanges();
      } else {
        console.warn('[🛠️ Fallback skipped — options not ready]');
      }
    }, 150);
  }

  private saveQuizState(): void {
    try {
      // Save explanation text
      if (this.currentExplanationText) {
        sessionStorage.setItem(`explanationText_${this.currentQuestionIndex}`,
          this.currentExplanationText);
      }

      // Save display mode
      if (this.displayState.mode) {
        sessionStorage.setItem(
          `displayMode_${this.currentQuestionIndex}`, this.displayState.mode
        );
        console.log('[saveQuizState] Saved display mode:', this.displayState.mode);
      }

      // Save options
      const optionsToSave = this.optionsToDisplay || [];
      if (optionsToSave.length > 0) {
        sessionStorage.setItem(
          `options_${this.currentQuestionIndex}`, JSON.stringify(optionsToSave)
        );
      }

      // Save selected options
      const selectedOptions = this.selectedOptionService.getSelectedOptions() || [];
      if (selectedOptions.length > 0) {
        sessionStorage.setItem(
          `selectedOptions_${this.currentQuestionIndex}`,
          JSON.stringify(selectedOptions)
        );
      }

      // Save feedback text
      if (this.feedbackText) {
        sessionStorage.setItem(`feedbackText_${this.currentQuestionIndex}`, this.feedbackText);
      }
    } catch (error: any) {
      console.error('[saveQuizState] Error saving quiz state:', error);
    }
  }

  // Method to initialize `displayMode$` and control the display reactively
  private initializeDisplayModeSubscription(): void {
    this.displayModeSubscription = this.quizService.isAnswered(this.currentQuestionIndex)
      .pipe(
        map((isAnswered) => (isAnswered ? 'explanation' : 'question')),
        distinctUntilChanged(),
        tap((mode: 'question' | 'explanation') => {
          if (this.isRestoringState) {
            console.log(`[🛠️ Restoration] Skipping displayMode$ update (${mode})`);
          } else {
            console.log(`[👀 Observed isAnswered ➡️ ${mode}] — no displayMode$ update`);
          }
        }),
        catchError((error: Error) => {
          console.error('❌ Error in display mode subscription:', error);
          return of('question');  // safe fallback
        })
      )
      .subscribe();
  }

  // Function to set up shared visibility subscription
  private setupVisibilitySubscription(): void {
    this.sharedVisibilitySubscription =
      this.sharedVisibilityService.pageVisibility$.subscribe((isHidden: boolean) => {
        this.handlePageVisibilityChange(isHidden);
      });
  }

  private initializeRouteListener(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const paramIndex =
          this.activatedRoute.snapshot.paramMap.get('questionIndex');
        const index = paramIndex ? +paramIndex : 0;  // fallback to 0 if param is missing or invalid

        // Check if questions are available to avoid out-of-bounds access
        if (!this.questions || this.questions.length === 0) {
          console.warn('Questions are not loaded yet.');
          return;
        }

        const adjustedIndex =
          Math.max(0, Math.min(index - 1, this.questions.length - 1));
        this.quizService.updateCurrentQuestionIndex(adjustedIndex);

        // Use the adjusted index for explanation text to ensure sync
        void this.fetchAndSetExplanationText(adjustedIndex);
      });
  }

  // Function to subscribe to navigation flags
  private subscribeToNavigationFlags(): void {
    this.quizNavigationService
      .getIsNavigatingToPrevious()
      .subscribe(
        (isNavigating) => (this.isNavigatingToPrevious = isNavigating)
      );
  }

  // Function to subscribe to total questions count
  private subscribeToTotalQuestions(): void {
    if (!this.quizId) {
      console.error('[subscribeToTotalQuestions] quizId is missing');
      return;
    }

    this.quizService.getTotalQuestionsCount(this.quizId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((totalQuestions: number) => {
        this.totalQuestions = totalQuestions;
      });
  }

  private subscribeToRenderReady(): void {
    if (!this.sharedOptionComponent) return;

    this.sharedOptionComponent.renderReady$
      .pipe(filter(Boolean), take(1))
      .subscribe(() => {
        console.log('[🟢 QuizQuestionComponent] Render ready confirmed by SOC');
        this.afterRenderReadyTasks();
      });
  }

  private afterRenderReadyTasks(): void {
    // Defer highlighting, feedback checks, etc. here
    console.log('[✨ Performing post-render actions]');
    this.cdRef.detectChanges();
  }

  private initializeComponentState(): void {
    void this.waitForQuestionData();
    this.initializeData();
    this.initializeForm();
    this.initializeForm();
    this.quizStateService.setLoading(true);

    // Ensure shuffling is enabled by default to address "not shuffling" report
    this.shuffleOptions = true;
  }

  async initializeQuizDataAndRouting(): Promise<void> {
    // Start loading quiz data but don't wait for it here
    const loaded = await this.loadQuizData();
    if (!loaded) {
      console.error('Failed to load questions.');
      return;
    }

    // Wait for questionsLoaded$ to emit true before proceeding
    this.quizService.questionsLoaded$
      .pipe(take(1), debounceTime(100))
      .subscribe((loaded) => {
        if (loaded) {
          this.handleRouteChanges();  // handle route changes after questions are loaded
        } else {
          console.warn('Questions are not loaded yet. Skipping explanation ' +
            'update.');
        }
      });
  }

  private initializeFirstQuestion(): void {
    // Retrieve the question index from the route parameters and parse it as a number
    const index =
      +(this.activatedRoute.snapshot.paramMap.get('questionIndex') ?? 0);

    // Set the initial question and load options
    this.setQuestionFirst(index);
  }

  private async loadQuizData(): Promise<boolean> {
    try {
      // Ensure quizId is available
      const quizIdExists = await this.quizService.ensureQuizIdExists();
      if (!quizIdExists) {
        console.error('Quiz ID is missing');
        return false;
      }

      // Fetch and process questions
      if (!this.quizId) {
        console.error('[fetchAndProcessQuizQuestions] quizId is missing or invalid');
        return false;
      }
      const questions = await this.fetchAndProcessQuizQuestions(this.quizId);
      if (questions && questions.length > 0) {
        this.questions = questions;
        this.questionsArray = questions;

        // Get the active quiz after questions are loaded
        this.quiz = this.quizService.getActiveQuiz();
        if (!this.quiz) {
          console.error('Failed to get the active quiz.');
          return false;
        }

        // Mark quiz as loaded and emit
        this.isQuizLoaded = true;
        this.quizService.setQuestionsLoaded(true);
        return true;  // indicate successful data loading
      } else {
        console.error('No questions loaded.');
        return false;
      }
    } catch (error: any) {
      console.error('Error loading questions:', error);
      return false;
    }
  }

  private async handleRouteChanges(): Promise<void> {
    this.activatedRoute.paramMap.subscribe(async (params) => {
      const rawParam = params.get('questionIndex');
      const parsedParam = Number(rawParam);

      // Ensure valid integer and convert to 0-based index
      let questionIndex = isNaN(parsedParam) ? 1 : parsedParam;

      if (questionIndex < 1 || questionIndex > this.totalQuestions) {
        console.warn(`[⚠️ Invalid questionIndex param: ${rawParam}. Defaulting 
          to Q1]`);
        questionIndex = 1;
      }

      const zeroBasedIndex = questionIndex - 1;

      try {
        // Sync state before loadQuestion() so it sees the correct 0-based index.
        this.currentQuestionIndex = zeroBasedIndex;
        this.quizService.setCurrentQuestionIndex(zeroBasedIndex);

        // Reset explanation UI for every new question
        this.explanationVisible = false;
        this.explanationText = '';
        this._expl$.next(null);

        // Load the question using correct index
        const loaded = await this.loadQuestion();  // now uses new index
        if (!loaded) {
          console.error(`[handleRouteChanges] ❌ Failed to load data for 
            Q${questionIndex}`);

          // SAFETY: fall back to last known good question instead of poisoning state
          if (this._lastGoodQuestion) {
            console.warn('[handleRouteChanges] 🛟 Using _lastGoodQuestion fallback');
            this.currentQuestion = this._lastGoodQuestion;
            this.optionsToDisplay = this._lastGoodOptions.map((o: Option) => ({
              ...o
            }));
          }

          return;
        }

        // Reset form and assign question
        this.resetForm();

        const fromArray = Array.isArray(this.questionsArray)
          ? this.questionsArray[zeroBasedIndex]
          : null;

        if (!fromArray) {
          console.warn(`[handleRouteChanges] ⚠️ questionsArray has no entry for index 
            ${zeroBasedIndex}`);

          // Safety: again, fall back to last good instead of "No question available"
          if (this._lastGoodQuestion) {
            console.warn('[handleRouteChanges] 🛟 Using _lastGoodQuestion (array-miss)');
            this.currentQuestion = this._lastGoodQuestion;
            this.optionsToDisplay = this._lastGoodOptions.map((o: Option) => ({
              ...o
            }));
          }

          return;
        }

        this.currentQuestion = fromArray;

        // Cache as “last known good” so later code never has to show "No question available"
        this._lastGoodQuestion = this.currentQuestion;

        // Prepare options
        const originalOptions = this.currentQuestion.options ?? [];
        this.optionsToDisplay = originalOptions.map((opt: Option) => ({
          ...opt,
          active: true,
          feedback: undefined,
          showIcon: false
        }));

        // Cache safe copy of options for fallback
        this._lastGoodOptions =
          this.optionsToDisplay.map((o) => ({ ...o }));

        if (!this.optionsToDisplay.length) {
          console.warn(`[⚠️ Q${questionIndex}] No options to display.`);
        } else {
          console.log(`[✅ Q${questionIndex}] optionsToDisplay:`, this.optionsToDisplay);
        }

        // Handle explanation if previously answered
        const isAnswered = await this.isAnyOptionSelected(zeroBasedIndex);
        if (isAnswered) {
          await this.fetchAndUpdateExplanationText(zeroBasedIndex);

          if (this.shouldDisplayExplanation) {
            this.emitShowExplanationChange(true);
            this.updateDisplayStateToExplanation();
          }
        }
      } catch (error: any) {
        console.error('[handleRouteChanges] ❌ Unexpected error:', error);

        // Final Safety Net: do NOT leave the UI in a "no question" state
        if (this._lastGoodQuestion) {
          console.warn('[handleRouteChanges] 🛟 Error fallback → _lastGoodQuestion');
          this.currentQuestion = this._lastGoodQuestion;
          this.optionsToDisplay =
            this._lastGoodOptions.map((o: Option) => ({ ...o }));
        }
      }
    });
  }

  private setQuestionFirst(index: number): void {
    if (!this.questionsArray || this.questionsArray.length === 0) {
      console.error(`[setQuestionFirst] ❌ questionsArray is empty or undefined.`);
      return;
    }

    // Directly use and clamp index to prevent negative values
    const questionIndex = Math.max(0, Math.min(index, this.questionsArray.length - 1));

    if (questionIndex >= this.questionsArray.length) {
      console.error(`[setQuestionFirst] ❌ Invalid question index: ${questionIndex}`);
      return;
    }

    const question = this.questionsArray[questionIndex];
    if (!question) {
      console.error(`[setQuestionFirst] ❌ No question data available at index: ${questionIndex}`);
      return;
    }

    // Update the current question
    this.currentQuestion = question;
    this.quizService.setCurrentQuestion(question);

    // Ensure options are set immediately to prevent async issues
    this.optionsToDisplay = [...(question.options ?? [])];

    // Ensure option feedback is updated correctly
    if (this.lastProcessedQuestionIndex !== questionIndex || questionIndex === 0) {
      this.lastProcessedQuestionIndex = questionIndex;
    }

    // Force explanation update for correct question
    setTimeout(() => {
      // Explicitly pass questionIndex to avoid shifting
      void this.updateExplanationIfAnswered(questionIndex, question);

      this.questionRenderComplete.emit();
    }, 50);
  }

  // Method to conditionally update the explanation when the question is answered
  private async updateExplanationIfAnswered(index: number, question: QuizQuestion): Promise<void> {
    if (
      (await this.isAnyOptionSelected(index)) && this.shouldDisplayExplanation
    ) {
      const explanationText = this.explanationTextService.prepareExplanationText(question);
      this.explanationToDisplay = explanationText;
      this.emitExplanationToDisplayChange(this.explanationToDisplay);
      this.emitShowExplanationChange(true);

      this.updateCombinedQuestionData(question, explanationText);
      this.isAnswerSelectedChange.emit(true);
    } else {
      console.log(`Question ${index} is not answered. Skipping explanation update.`);
    }
  }

  private setupSubscriptions(): void {
    this.resetFeedbackSubscription =
      this.resetStateService.resetFeedback$.subscribe(() => {
        this.resetFeedback();
      });

    this.resetStateSubscription = this.resetStateService.resetState$.subscribe(
      () => {
        this.resetState();
      }
    );

    document.addEventListener('visibilitychange', this.onVisibilityChange.bind(this));
  }

  // Unsubscribing to prevent multiple triggers
  private handlePageVisibilityChange(isHidden: boolean): void {
    if (isHidden) {
      // Page is now hidden, so pause updates and clear/reset necessary subscriptions
      this.isPaused = true;  // updates are paused
      this.clearDisplaySubscriptions();
    } else {
      // Page is now visible, so resume updates, reinitialize subscriptions, and
      // refresh explanation text
      this.isPaused = false;  // updates are no longer paused
      void this.prepareAndSetExplanationText(this.currentQuestionIndex);
    }
  }

  private clearDisplaySubscriptions(): void {
    // Unsubscribe from any active subscriptions to avoid memory leaks
    if (this.displaySubscriptions) {
      for (const sub of this.displaySubscriptions) {
        sub.unsubscribe();
      }
    }

    // Reset the array to prepare for new subscriptions when the page becomes visible again
    this.displaySubscriptions = [];

    // Additional cleanup logic
    this.explanationToDisplay = '';  // clear any currently displayed explanation text
    this.emitExplanationToDisplayChange('');  // emit empty string to reset UI elements
    this.emitShowExplanationChange(false);  // ensure explanation display is hidden
  }

  private async initializeComponent(): Promise<void> {
    try {
      const quizId = this.quizService.getCurrentQuizId();

      // Ensure questions are loaded before proceeding
      if (!this.questionsArray || this.questionsArray.length === 0) {
        if (!quizId) {
          console.error('[initializeComponent] No active quiz ID found. Aborting ' +
            'initialization.');
          return;
        }

        this.questionsArray = await this.quizService.fetchQuizQuestions(quizId);
        if (!this.questionsArray || this.questionsArray.length === 0) {
          console.error('[initializeComponent] Failed to fetch questions. Aborting ' +
            'initialization.');
          return;
        }

        console.info(
          '[initializeComponent] Questions array successfully fetched:',
          this.questionsArray
        );
      }

      // Clamp currentQuestionIndex to valid range
      if (this.currentQuestionIndex < 0) this.currentQuestionIndex = 0;  // floor

      const lastIndex = this.questionsArray.length - 1;
      if (this.currentQuestionIndex > lastIndex) {
        console.warn(
          `[initializeComponent] Index ${this.currentQuestionIndex} out of range — clamping to last question (${lastIndex}).`,
        );
        this.currentQuestionIndex = lastIndex;  // cap
      }

      // Set the current question
      this.currentQuestion = this.questionsArray[this.currentQuestionIndex];
      if (!this.currentQuestion) {
        console.warn('[initializeComponent] Current question is missing after loading.',
          {
            currentQuestionIndex: this.currentQuestionIndex,
            questionsArray: this.questionsArray
          }
        );
        return;
      }

      console.info('[initializeComponent] Current question set:', this.currentQuestion);

      // Generate feedback for the current question
      try {
        this.feedbackText = await this.generateFeedbackText(this.currentQuestion);
        console.info(
          '[initializeComponent] Feedback text generated for the first question:',
          this.feedbackText
        );
      } catch (feedbackError: any) {
        console.error('[initializeComponent] Error generating feedback:', feedbackError);
        this.feedbackText = 'Unable to generate feedback.';
      }
    } catch (error: any) {
      console.error('[initializeComponent] Error during initialization:', error);
    }
  }

  public override async loadDynamicComponent(
    question: QuizQuestion,
    options: Option[],
    questionIndex: number = -1
  ): Promise<void> {
    try {
      // Guard –- missing question or options
      if (!question || !Array.isArray(options) || options.length === 0) {
        console.warn('[⚠️ Early return A] Missing question or options', {
          question: question ?? '[undefined]',
          options,
          optionsLength: options?.length
        });
        return;
      }

      // Guard –- missing container
      if (!this.dynamicAnswerContainer) {
        console.warn('[⚠️ Early return B] dynamicAnswerContainer not available');
        return;
      }

      let isMultipleAnswer = false;
      try {
        if (!question || !('questionText' in question)) {
          console.warn('[⚠️ Early return C] Invalid question object before ' +
            'isMultipleAnswer', question);
          return;
        }

        isMultipleAnswer = await firstValueFrom(
          this.quizQuestionManagerService.isMultipleAnswerQuestion(question)
        );
      } catch (err: any) {
        console.error('[❌ isMultipleAnswerQuestion failed]', err);
        console.warn('[⚠️ Early return D] Failed to get isMultipleAnswer');
        return;
      }

      this.dynamicAnswerContainer.clear();
      await Promise.resolve();

      const componentRef: ComponentRef<AnswerComponent> =
        await this.dynamicComponentService.loadComponent(
          this.dynamicAnswerContainer,
          isMultipleAnswer,
          this.forwardClickFromAnswer.bind(this)
        );

      if (!componentRef || !componentRef.instance) {
        console.warn('[❌ loadDynamicComponent] ComponentRef or instance is undefined');
        return;
      }

      const instance = componentRef.instance;
      if (!instance) {
        console.warn('[⚠️ Early return F] ComponentRef has no instance');
        return;
      }

      // ROBUST INDEX RESOLUTION:
      // Priority: 1. Passed argument (if valid) which comes from authoritative source
      //           2. Component @Input currentQuestionIndex (if > 0, ensuring it's not default)
      //           3. Service currentQuestionIndex (most up-to-date global state)
      //           4. Default to 0
      let effectiveIndex = 0;
      if (questionIndex >= 0) {
        effectiveIndex = questionIndex;
      } else if (this.currentQuestionIndex > 0) {
        effectiveIndex = this.currentQuestionIndex;
      } else {
        effectiveIndex = this.quizService.currentQuestionIndex;
      }

      // Use setInput to trigger Change Detection properly
      componentRef.setInput('questionIndex', effectiveIndex);
      componentRef.setInput('currentQuestionIndex', effectiveIndex);
      componentRef.setInput('quizId', this.quizService.quizId);

      if ((instance as any)?.hasOwnProperty('isNavigatingBackwards')) {
        componentRef.setInput('isNavigatingBackwards', this.navigatingBackwards ?? false);
      }

      // WIRE: AnswerComponent → QQC
      instance.optionClicked.subscribe((ev: OptionClickedPayload) => {
        this.onOptionClicked(ev);
      });

      // Set backward nav flag if supported
      if ((instance as any)?.hasOwnProperty('isNavigatingBackwards')) {
        componentRef.setInput('isNavigatingBackwards', this.navigatingBackwards ?? false);
      }
      this.navigatingBackwards = false;

      const clonedOptions =
        structuredClone?.(options) ?? JSON.parse(JSON.stringify(options));

      // Generate fresh feedback for this question's options
      const correctOptions = this.quizService.getCorrectOptionsForCurrentQuestion(question);
      const generatedFeedback = this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        clonedOptions
      );

      // Assign the fresh feedback to ALL options
      for (const opt of clonedOptions) {
        opt.feedback = generatedFeedback;
      }

      try {
        componentRef.setInput('questionData', { ...question });
        componentRef.setInput('optionsToDisplay', clonedOptions);

        // Set renderReady immediately after assigning options, fixes StackBlitz
        // first-load timing issue
        if (clonedOptions.length > 0) {
          instance.renderReady = true;
          console.log('[QQC] ✅ Set instance.renderReady = true after assigning options');
        }
      } catch (error: any) {
        console.error('[❌ Assignment failed in loadDynamicComponent]', error, {
          question,
          options: clonedOptions
        });
      }

      instance.optionBindings = clonedOptions.map((opt, idx) => ({
        index: idx,
        appHighlightOption: false,
        option: opt,
        isCorrect: opt.correct ?? false,
        feedback: generatedFeedback,  // use fresh feedback
        showFeedback: false,
        showFeedbackForOption: {},
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        allOptions: clonedOptions,
        type: isMultipleAnswer ? 'multiple' : 'single',
        appHighlightInputType: isMultipleAnswer ? 'checkbox' : 'radio',
        appHighlightReset: false,
        appResetBackground: false,
        optionsToDisplay: clonedOptions,
        isSelected: opt.selected ?? false,
        active: opt.active ?? true,
        checked: false,
        change: (_: MatCheckbox | MatRadioButton) => { },
        disabled: false,
        ariaLabel: opt.text ?? `Option ${idx + 1}`
      }));

      instance.sharedOptionConfig = {
        ...this.getDefaultSharedOptionConfig?.(),
        type: isMultipleAnswer ? 'multiple' : 'single',
        currentQuestion: { ...question },
        optionsToDisplay: clonedOptions,
        selectedOption: null,
        selectedOptionIndex: -1,
        showFeedback: false,
        isAnswerCorrect: false,
        showCorrectMessage: false,
        showExplanation: false,
        explanationText: '',
        shouldResetBackground: false,
        showFeedbackForOption: {},
        isOptionSelected: false,
        correctMessage: '',
        feedback: '',
        idx: this.currentQuestionIndex
      };

      this.questionData = {
        ...(instance as any).question,
        options: clonedOptions
      };
      this.sharedOptionConfig = instance.sharedOptionConfig;
      this.cdRef.markForCheck();

      await (instance as any).initializeSharedOptionConfig(clonedOptions);

      const hasRenderableOptions =
        Array.isArray(instance.optionsToDisplay) &&
        instance.optionsToDisplay.length > 0;

      if (hasRenderableOptions) {
        this.updateShouldRenderOptions(instance.optionsToDisplay);
        this.shouldRenderOptions = true;
        this._canRenderFinalOptions = true;

        // Set renderReady on AnswerComponent so SharedOptionComponent displays
        instance.renderReady = true;

        // ⚡ FIX: Trigger change detection after setting renderReady
        // This ensures template updates in Stackblitz's slower environment
        this.cdRef.detectChanges();
        console.log('[QQC] ✅ Triggered change detection after setting renderReady');
      } else {
        this.updateShouldRenderOptions(instance.optionsToDisplay);
        console.warn('[⚠️ Skipping render — options not ready]', {
          optionBindings: instance.optionBindings?.length,
          options: instance.optionsToDisplay?.length,
          config: !!instance.sharedOptionConfig
        });
      }
    } catch (error: any) {
      console.error('[❌ loadDynamicComponent] Failed to load component:', error);
    }
  }

  public async forwardClickFromAnswer(ev: OptionClickedPayload): Promise<void> {
    const q = this.currentQuestion;  // QQC always sets this before dynamic load
    const idx = ev.index;

    if (!q) {
      console.error('[QQC] forwardClickFromAnswer → currentQuestion is MISSING');
      return;
    }

    if (idx === undefined || idx === null) {
      console.error('[QQC] forwardClickFromAnswer → missing option index in payload', ev);
      return;
    }

    return this.handleOptionClicked(q, idx);
  }

  public async loadQuestion(signal?: AbortSignal): Promise<boolean> {
    // Absolute Lock: prevent stale FET display
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setIsExplanationTextDisplayed(false);
    this.explanationTextService.setExplanationText('', { force: true });
    this.explanationTextService.latestExplanation = '';
    this.explanationTextService.latestExplanationIndex = this.currentQuestionIndex;
    this.readyForExplanationDisplay = false;
    this.isExplanationReady = false;
    this.isExplanationLocked = true;
    this.forceQuestionDisplay = true;

    const shouldPreserveVisualState = this.canRenderQuestionInstantly(
      this.currentQuestionIndex
    );

    const explanationSnapshot = this.captureExplanationSnapshot(
      this.currentQuestionIndex,
      shouldPreserveVisualState
    );
    const shouldKeepExplanationVisible = explanationSnapshot.shouldRestore;

    if (!shouldKeepExplanationVisible) {
      this.resetTexts();  // clean slate before loading new question
    }

    if (shouldPreserveVisualState) {
      this.isLoading = false;
      this.quizStateService.setLoading(false);
      this.quizStateService.setAnswerSelected(false);
    } else {
      this.startLoading();
    }

    // Reset selection and button state before processing question
    if (!shouldKeepExplanationVisible) {
      this.selectedOptionService.clearSelectionsForQuestion(
        this.currentQuestionIndex,
      );
      this.selectedOptionService.setAnswered(false);
      this.nextButtonStateService.reset();
    } else {
      this.selectedOptionService.setAnswered(true, true);
      this.nextButtonStateService.setNextButtonState(true);
    }

    try {
      this.selectedOptionId = null;
      const lockedIndex = this.currentQuestionIndex;

      // Reset all relevant UI and quiz state
      await this.resetQuestionStateBeforeNavigation({
        preserveVisualState: shouldPreserveVisualState,
        preserveExplanation: shouldKeepExplanationVisible
      });

      // Clear optionsToDisplay explicitly to prevent stale options from being used
      // by prepareAndSetExplanationText during the navigation transition
      if (!shouldPreserveVisualState) {
        this.optionsToDisplay = [];
      }
      if (!shouldKeepExplanationVisible) {
        this.explanationTextService.resetExplanationState();
        this.explanationTextService.setExplanationText('', { force: true });
        this.explanationTextService.setIsExplanationTextDisplayed(false);
        this.explanationTextService.setShouldDisplayExplanation(false);
        this.renderReadySubject.next(false);

        this.displayState = { mode: 'question', answered: false };
        this.quizStateService.setDisplayState({ mode: 'question', answered: false });
        this.forceQuestionDisplay = true;
        this.readyForExplanationDisplay = false;
        this.isExplanationReady = false;
        this.isExplanationLocked = true;
        this.currentExplanationText = '';
        this.feedbackText = '';
      } else {
        this.restoreExplanationAfterReset({
          questionIndex: lockedIndex,
          explanationText: explanationSnapshot.explanationText,
          questionState: explanationSnapshot.questionState
        });
      }

      // Start fresh timer
      this.timerService.stopTimer?.(undefined, { force: true });
      this.timerService.resetTimer();
      this.timerService.resetTimerFlagsFor(this.currentQuestionIndex);
      this.timerService.startTimer(this.timerService.timePerQuestion, true, true);

      // Fetch questions if not already available
      if (!this.questionsArray || this.questionsArray.length === 0) {
        const quizId = this.quizService.getCurrentQuizId();
        if (!quizId) {
          console.error('[loadQuestionContents] No active quiz ID found.');
          return false;
        }

        this.questionsArray = await this.quizService.fetchQuizQuestions(quizId);
        if (!this.questionsArray?.length) {
          console.error('[loadQuestionContents] Failed to fetch questions.');
          return false;
        }
      }

      // Set totalQuestions before selection messages are computed
      if (this.questionsArray?.length > 0) {
        this.quizService.totalQuestions = this.questionsArray.length;
        console.log('[loadQuestion] ✅ totalQuestions set',
          this.quizService.totalQuestions);
      }

      // If questionsArray still empty, bail out gracefully
      if (this.questionsArray.length === 0) {
        console.warn('[loadQuestion] questionsArray still empty – aborting load');
        return false;
      }

      // Use maximum known count from all sources to prevent premature results redirect
      const localCount = this.questionsArray?.length ?? 0;
      const serviceCount = this.quizService.questions?.length ?? 0;
      const effectiveTotal = Math.max(localCount, serviceCount);
      
      console.log(`[loadQuestion] 📊 Index Check: currentIndex=${this.currentQuestionIndex}, localCount=${localCount}, serviceCount=${serviceCount}, effectiveTotal=${effectiveTotal}`);
      
      // 🕵️ TEMPORARILY DISABLED FOR DEBUGGING
      // if (effectiveTotal > 0 && this.currentQuestionIndex >= effectiveTotal) {
      //   console.log('[loadQuestion] End of quiz → /results');
      //   await this.router.navigate(['/results', this.quizId]);
      //   return false;
      // }
      if (effectiveTotal > 0 && this.currentQuestionIndex >= effectiveTotal) {
        console.warn(`[loadQuestion] ⚠️ WOULD REDIRECT to /results but BYPASSED. Index=${this.currentQuestionIndex} >= Total=${effectiveTotal}`);
        // Do NOT redirect - let navigation continue for debugging
      }

      // Validate current index
      if (
        this.currentQuestionIndex < 0 ||
        this.currentQuestionIndex >= this.questionsArray.length
      ) {
        console.error(`Invalid question index: ${this.currentQuestionIndex}`);
        return false;
      }

      const potentialQuestion = this.questionsArray[this.currentQuestionIndex];
      if (!potentialQuestion) {
        console.error(`No question found for index ${this.currentQuestionIndex}`);
        return false;
      }

      // Abort before UI update
      if (signal?.aborted) {
        console.warn('[loadQuestion] Load aborted before UI update.');
        this.timerService.stopTimer(undefined, { force: true });
        return false;
      }

      // Defensive clone of question data
      this.currentQuestion = { ...potentialQuestion };

      // Deep clone options to guarantee new references
      const rawOpts = Array.isArray(potentialQuestion.options)
        ? JSON.parse(JSON.stringify(potentialQuestion.options))
        : [];

      this.optionsToDisplay = rawOpts.map((opt: Option, i: number) => ({
        ...opt,
        // ⚡ FIX: Should NOT overwrite optionId with display-index based ID.
        // For shuffled quizzes, the Service provides an ID that maps to the ORIGINAL question index.
        // Overwriting this destroys correctness checks.
        // optionId: this.currentQuestionIndex * 100 + (i + 1),
        optionId: opt.optionId,
        selected: false,
        highlight: false,
        showIcon: false,
        active: true,
        disabled: false,
        feedback: opt.feedback ?? `Default feedback for Q${this.currentQuestionIndex} Opt${i}`
      }));

      // Push early payload to services (all fresh data)
      this.quizService.questionPayloadSubject.next({
        question: this.currentQuestion!,
        options: this.optionsToDisplay,
        explanation: ''
      });

      // Update render variables
      this.questionToDisplay = this.currentQuestion;
      this.updateShouldRenderOptions(this.optionsToDisplay);

      // Emit "# of correct answers" text safely
      try {
        const q = this.currentQuestion;
        if (q?.options?.length) {
          const numCorrect =
            q.options.filter((o: Option) => o.correct).length;
          const totalOpts = q.options.length;
          const msg =
            this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
              numCorrect,
              totalOpts
            );

          if (numCorrect > 1) {
            this.quizService.updateCorrectAnswersText(msg);
            console.log(`[BANNER] Set multi-answer banner for 
              Q${this.currentQuestionIndex + 1}:`, msg);
          } else {
            this.quizService.updateCorrectAnswersText('');
            console.log(`[BANNER] Cleared single-answer banner for 
              Q${this.currentQuestionIndex + 1}`);
          }
        }
      } catch (err: any) {
        console.warn('[BANNER] Failed to emit correct-answers text', err);
      }

      // Finalize bindings
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.initializeOptionBindings();
      }
      this.cdRef.markForCheck();
      // ───────────── End UI Update ─────────────

      // Abort after UI update
      if (signal?.aborted) {
        console.warn('[loadQuestion] Load aborted after UI update.');
        this.timerService.stopTimer(undefined, { force: true });
        return false;
      }

      this.quizService.nextQuestionSubject.next(this.currentQuestion);
      this.quizService.nextOptionsSubject.next(this.optionsToDisplay);
      console.log('[🚀 Emitted Q1 question and options together]');

      // Baseline selection message once options are fully ready
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          if (this.optionsToDisplay?.length > 0) {
            console.log('[loadQuestion] Forcing baseline selection message after emit',
              {
                index: this.currentQuestionIndex,
                total: this.quizService.totalQuestions,
                opts: this.optionsToDisplay.map((o) => ({
                  text: o.text,
                  correct: o.correct,
                  selected: o.selected
                }))
              }
            );
            const q = this.questions[this.currentQuestionIndex];
            if (q) {
              const totalCorrect =
                q.options.filter((o: Option) => !!o.correct).length;

              // Push the baseline immediately
              if (!q.type) {
                console.warn(
                  '[enforceBaselineAtInit] Question type missing for index',
                  this.currentQuestionIndex
                );
                return;
              }

              this.selectionMessageService.enforceBaselineAtInit(
                this.currentQuestionIndex,
                q.type,
                totalCorrect
              );
            }
          } else {
            console.warn('[loadQuestion] Skipped baseline recompute (no options ' +
              'yet)');
          }
        });
      });

      if (this.currentQuestion && this.optionsToDisplay?.length > 0) {
        this.questionAndOptionsReady.emit();
        this.quizService.emitQuestionAndOptions(
          this.currentQuestion,
          this.optionsToDisplay,
          this.currentQuestionIndex
        );
        console.log('[📤 QQC] Emitted questionAndOptionsReady event');
      }

      return true;
    } catch (error: any) {
      console.error('[loadQuestion] Error:', error);
      this.feedbackText = 'Error loading question. Please try again.';
      this.currentQuestion = null;
      this.optionsToDisplay = [];
      return false;
    } finally {
      this.isLoading = false;
      this.quizStateService.setLoading(false);
    }
  }

  private async ensureQuestionsLoaded(): Promise<boolean> {
    if (this.isLoadingInProgress) {
      console.info('Waiting for ongoing loading process...');
      while (this.isLoadingInProgress) {
        await new Promise(
          (resolve) => setTimeout(resolve, 100)
        );
      }
      return this.isQuizLoaded;
    }

    if (this.isQuizLoaded && this.questions && this.questions.length > 0) {
      return true;
    }

    this.isLoadingInProgress = true;
    const loadedSuccessfully = await this.loadQuizData();
    this.isLoadingInProgress = false;

    if (!loadedSuccessfully) console.error('Failed to load questions.');

    return loadedSuccessfully;
  }

  public async generateFeedbackText(question: QuizQuestion): Promise<string> {
    try {
      // Validate the question and its options
      if (!question || !question.options || question.options.length === 0) {
        console.warn('[generateFeedbackText] Invalid question or options are missing.');
        return 'No feedback available for the current question.';
      }

      // Ensure optionsToDisplay is set, falling back to question options if necessary
      if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
        console.warn(
          '[generateFeedbackText] optionsToDisplay is not set. Falling back to question options.',
        );
        // ⚡ FIX: Use existing options but do NOT overwrite IDs!
        // this.quizService.assignOptionIds(...) would destroy shuffled option mappings.
        this.optionsToDisplay = question.options.map(opt => ({ ...opt }));

        // Log and validate the restored options
        if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
          console.error('[generateFeedbackText] Failed to restore valid ' +
            'optionsToDisplay.');
          return 'No options available to generate feedback.';
        } else {
          console.log('[generateFeedbackText] Fallback optionsToDisplay:',
            this.optionsToDisplay);
        }
      }

      // Extract correct options from the question
      const correctOptions = question.options.filter(
        (option: Option) => option.correct
      );
      if (correctOptions.length === 0) {
        console.info('[generateFeedbackText] No correct options found for the ' +
          'question.');
        return 'No correct answers defined for this question.';
      }

      // Generate feedback using the feedback service
      const feedbackText =
        this.feedbackService.setCorrectMessage(this.optionsToDisplay);

      // Emit the feedback text
      this.feedbackText = feedbackText || 'No feedback generated for the current question.';
      this.feedbackTextChange.emit(this.feedbackText);  // emit to notify listeners

      return this.feedbackText;
    } catch (error: any) {
      console.error('[generateFeedbackText] Error generating feedback:', error,
        {
          question,
          optionsToDisplay: this.optionsToDisplay
        }
      );
      const fallbackText = 'An error occurred while generating feedback. Please try again.';
      this.feedbackText = fallbackText;
      this.feedbackTextChange.emit(this.feedbackText);
      return fallbackText;
    }
  }

  private resetTexts(): void {
    this.explanationTextSubject.next('');
    this.feedbackTextSubject.next('');
  }

  private initializeData(): void {
    if (!this.question) {
      console.warn('Question is not defined.');
      return;
    }

    this.data = {
      questionText: this.question.questionText,
      explanationText: this.question.explanation || 'No explanation available',
      correctAnswersText: this.quizService.getCorrectAnswersAsString() || '',
      options: this.options || []
    };
  }

  private async initializeQuiz(): Promise<void> {
    if (this.initialized) {
      console.warn('[🛑 QQC initializeQuiz] Already initialized. Skipping...');
      return;
    }

    this.initialized = true;

    // Initialize selected questions and answers without affecting the index
    this.initializeSelectedQuiz();
    await this.initializeQuizQuestionsAndAnswers();
  }

  private initializeSelectedQuiz(): void {
    if (this.quizDataService.selectedQuiz$) {
      this.quizDataService.selectedQuiz$.subscribe((quiz: Quiz | null) => {
        if (!quiz) {
          console.warn('[initializeSelectedQuiz] selectedQuiz$ emitted null');
          return;
        }

        this.selectedQuiz.next(quiz);
        this.setQuestionOptions();
      });
    }
  }

  private initializeQuizQuestion(): void {
    if (!this.quizStateService || !this.quizService) {
      console.warn('Required services are not available.');
      return;
    }

    if (!this.quizStateService.getQuizQuestionCreated()) {
      this.quizStateService.setQuizQuestionCreated();

      this.questionsObservableSubscription = this.quizService.getAllQuestions()
        .pipe(
          map((questions: QuizQuestion[]) => {
            for (const quizQuestion of questions) {
              quizQuestion.selectedOptions = undefined;

              // ⚡ FIX: Do NOT mutate option IDs here!
              // quizQuestion.options is a reference to the global state (Shuffled or Canonical).
              // Overwriting optionId destroys the mapping that QuizShuffleService relies on.
              // IDs should be handled at the display level (loadQuestion) or by the Service.
            }
            return questions;
          }),
        )
        .subscribe({
          next: (questions: QuizQuestion[]) => {
            if (questions && questions.length > 0) {
              // Only set answered state if selectedOptions is not null or empty
              const selectedOptions = this.selectedOptionService.getSelectedOptions();
              const hasAnswered = Array.isArray(selectedOptions) && selectedOptions.length > 0;

              if (hasAnswered) {
                this.selectedOptionService.setAnsweredState(true);
              } else {
                console.log('Skipping setAnsweredState(false) to avoid overwrite');
              }
            }
          },
          error: (err: Error) => {
            console.error('Error fetching questions:', err);
          }
        });
    }
  }

  private async initializeQuizQuestionsAndAnswers(): Promise<void> {
    try {
      this.quizId = this.activatedRoute.snapshot.paramMap.get('quizId') ?? '';
      if (!this.quizId) {
        console.error('Quiz ID is empty after initialization.');
        return;
      }

      // Fetch and store only if not already fetched
      if (!this.questionsArray || this.questionsArray.length === 0) {
        const fetched = await this.fetchAndProcessQuizQuestions(this.quizId);
        if (!fetched || fetched.length === 0) {
          console.error('[❌] No questions returned.');
          return;
        }

        this.questionsArray = fetched;
        this.questions = fetched;
        console.log('[✅] Quiz questions set once.');
      }

      // Now safe to run post-fetch logic
      await this.quizDataService.asyncOperationToSetQuestion(
        this.quizId,
        this.currentQuestionIndex
      );
    } catch (error: any) {
      console.error('Error initializing quiz questions and answers:', error);
    }
  }

  private async fetchAndProcessQuizQuestions(quizId: string):
    Promise<QuizQuestion[]> {
    if (!quizId) {
      console.error('Quiz ID is not provided or is empty.');
      return [];
    }

    this.isLoading = true;

    try {
      const questions = await this.quizService.fetchQuizQuestions(quizId);

      if (!questions || questions.length === 0) {
        console.error('No questions were loaded');
        return [];
      }

      this.questions$ = of(questions);

      // Run all question preparations in parallel
      await Promise.all(
        questions.map((question, index) =>
          this.prepareQuestion(quizId, question, index)
        )
      );

      return questions;
    } catch (error: any) {
      console.error('Error loading questions:', error);
      return [];
    } finally {
      this.isLoading = false;
    }
  }

  private async prepareQuestion(quizId: string, question: QuizQuestion, index: number): Promise<void> {
    try {
      // ⚡ FIX: Do NOT mutate option IDs here!
      // This overwrites unique IDs assigned by QuizShuffleService (e.g. based on original Q index)
      // with generic 0, 1, 2... which breaks tracking and integrity.
      if (question.options?.length) {
        // Verify options exist but do not modify them
      } else {
        console.error(`❌ No options found for Q${index}: ${question.questionText}`);
      }

      // Check if explanation is needed
      const state = this.quizStateService.getQuestionState(quizId, index);

      if (state?.isAnswered) {
        try {
          const explanationText = await this.getExplanationText(index);

          this.explanationTextService.formattedExplanations[index] = {
            questionIndex: index,
            explanation: explanationText || 'No explanation provided.'
          };
        } catch (explanationError: any) {
          console.error(`❌ Failed to fetch explanation for Q${index}:`,
            explanationError);

          this.explanationTextService.formattedExplanations[index] = {
            questionIndex: index,
            explanation: 'Unable to load explanation.'
          };
        }
      }
    } catch (fatalError: any) {
      console.error(`Unexpected error during prepareQuestion for Q${index}:`,
        fatalError);
    }
  }

  private async handleQuestionState(): Promise<void> {
    if (this.currentQuestionIndex === 0) {
      const initialMessage = 'Please start the quiz by selecting an option.';
      if (this.selectionMessage !== initialMessage) {
        this.selectionMessage = initialMessage;
      }
    } else {
      this.clearSelection();
    }
  }

  private async shouldUpdateMessageOnAnswer(
    isAnswered: boolean
  ): Promise<boolean> {
    const newMessage = this.selectionMessageService.determineSelectionMessage(
      this.currentQuestionIndex,
      this.totalQuestions,
      isAnswered
    );

    return this.selectionMessage !== newMessage;
  }

  private async isAnyOptionSelected(questionIndex: number): Promise<boolean> {
    this.resetStateForNewQuestion();
    try {
      return await firstValueFrom(this.quizService.isAnswered(questionIndex));
    } catch (error: any) {
      console.error('Failed to determine if question is answered:', error);
      return false;
    }
  }

  public async getCorrectAnswers(): Promise<number[]> {
    if (!this.currentQuestion) {
      console.info('Current question not set. Attempting to load it...');
      try {
        this.currentQuestion = await firstValueFrom(
          this.quizService.getQuestionByIndex(this.currentQuestionIndex)
        );
      } catch (error: any) {
        console.error('Error loading current question:', error);
        return [];
      }
    }

    // Double-check that it's truly defined
    if (!this.currentQuestion) {
      console.warn('No current question available even after loading.');
      return [];
    }

    return this.quizService.getCorrectAnswers(this.currentQuestion);
  }

  setQuestionOptions(): void {
    this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      .pipe(take(1))
      .subscribe((currentQuestion: QuizQuestion | null) => {
        if (!currentQuestion) {
          console.error(
            `[QuizQuestionComponent] Question not found for index ${this.currentQuestionIndex}`
          );
          return;
        }

        this.currentQuestion = currentQuestion;
        const options = currentQuestion.options ?? [];

        if (!Array.isArray(options) || options.length === 0) {
          console.error(
            `[QuizQuestionComponent] No options available for question index ${this.currentQuestionIndex}`,
          );
          this.currentOptions = [];
          return;
        }

        const answerValues = (currentQuestion.answer ?? [])
          .map((answer) => answer?.value)
          .filter(
            (value): value is Option['value'] =>
              value !== undefined && value !== null
          );

        const resolveCorrect = (option: Option): boolean => {
          if (option.correct === true) return true;

          if (Array.isArray(answerValues) && answerValues.length > 0) {
            return answerValues.includes(option.value);
          }

          return false;
        };

        this.currentOptions = options.map((option, index) => ({
          ...option,
          correct: resolveCorrect(option),
          selected: false,
          displayOrder: index
        }));

        if (this.shuffleOptions) Utils.shuffleArray(this.currentOptions);

        this.currentOptions = this.applyDisplayOrder(this.currentOptions);
        this.optionsToDisplay = this.currentOptions.map((option) => ({
          ...option
        }));
        this.updateShouldRenderOptions(this.optionsToDisplay);
        this.quizService.nextOptionsSubject.next(
          this.optionsToDisplay.map((option: Option) =>
            ({ ...option }))
        );

        // Now that optionsToDisplay is set, refresh explanation text if needed
        // This ensures the FET is calculated using the SHUFFLED options we just set.
        if (this.currentQuestionIndex >= 0) {
          console.log('[QQC] 🔄 triggering explanation usage/refresh with new options');
          if (this.currentQuestionIndex >= 0) {
            // Recalculate AND push to service to ensure all subscribers see the
            // correct text AND update the cache map so SharedOptionComponent
            // finds the correct text
            this.prepareAndSetExplanationText(this.currentQuestionIndex).then(
              (fet) => {
                if (this.currentQuestion) {
                  this.explanationTextService.storeFormattedExplanation(
                    this.currentQuestionIndex,
                    fet,
                    this.currentQuestion
                  );
                }
                this.explanationTextService.setExplanationText(fet);
              }
            );
          }
        }

        this.cdRef.markForCheck();
      });
  }

  private resetForm(): void {
    if (!this.questionForm) return;

    this.questionForm.patchValue({ answer: '' });
    this.alreadyAnswered = false;
  }

  private clearSelection(): void {
    if (this.correctAnswers && this.correctAnswers.length === 1) {
      if (this.currentQuestion && this.currentQuestion.options) {
        for (const option of this.currentQuestion.options) {
          option.selected = false;
          option.styleClass = '';
        }
      }
    }
  }

  public resetState(): void {
    this.selectedOption = null;
    this.options = [];
    this.resetFeedback();
    this.selectedOptionService.clearOptions();
    this.areOptionsReadyToRender = false;
  }

  public resetFeedback(): void {
    this.correctMessage = '';
    this.showFeedback = false;
    this.selectedOption = null;
    this.showFeedbackForOption = {};
  }

  // Called when a user clicks an option row
  public override async onOptionClicked(
    event: OptionClickedPayload
  ): Promise<void> {
    // Hard Guard: event / option must be valid
    if (!event || !event.option) {
      console.error('[QQC] ❌ onOptionClicked received invalid event:', event);
      return;
    }

    const evtOpt = event.option;

    // SOURCE OF TRUTH: component/service index (0-based)
    // Do NOT trust evtOpt.questionIndex (often 1-based and breaks Q1)
    const idx =
      (typeof this.currentQuestionIndex === 'number' ? this.currentQuestionIndex : null) ??
      (this.quizService.getCurrentQuestionIndex?.() ?? null) ??
      (typeof (this.quizService as any).currentQuestionIndex === 'number' ? (this.quizService as any).currentQuestionIndex : null) ??
      0;

    console.log('[QQC] idx used for click', { idx, payloadIdx: (evtOpt as any)?.questionIndex });

    const evtChecked = event?.checked ?? true;

    // Resolve question safely
    let q: QuizQuestion | null | undefined = this.question;

    if (!q || !q.options?.length) q = this.currentQuestion;
    if (!q || !q.options?.length) q = this.quizService.questions?.[idx];

    if (!q || !q.options?.length) {
      console.error('[QQC] ❌ Unable to resolve question for index', idx, ' ' +
        '→ aborting click handler');
      return;
    }

    const evtIdx = event.index;

    this.resetExplanationBeforeClick(idx);
    this.prepareClickCycle();

    // ⚡ FIX: Mark user interaction EARLY so hasUserInteracted guard passes in fireAndForgetExplanationUpdate
    // This was missing and caused FET to be blocked with "[FET SKIP] User has not interacted yet"
    this.quizStateService.markUserInteracted(idx);

    try {
      await this.waitForInteractionReady();

      const optionsNow = this.cloneOptionsForUi(q!, idx, evtIdx, event);
      const canonicalOpts = this.buildCanonicalOptions(q!, idx, evtOpt, evtIdx);

      // Commit selection into local + state
      this.persistSelection(evtOpt, idx, optionsNow, q?.type === QuestionType.MultipleAnswer);

      // ALSO push into SelectedOptionService using the *question index*
      const enrichedForSOS = {
        ...evtOpt,
        questionIndex: idx,
        selected: evtChecked,
        highlight: true,
        showIcon: true
      } as any;
      this.selectedOptionService.addOption(idx, enrichedForSOS);

      // TIMER STOP CHECK (NEW, CORRECT LOCATION)
      // Uses SOS as the single source of truth
      const selectedIds = new Set<number>(
        this.selectedOptionService
          .getSelectedOptionsForQuestion(idx)
          ?.map(o => o.optionId)
          .filter((id): id is number => typeof id === 'number') ?? []
      );

      // Add the current optionId being clicked (may not be in service yet)
      const currentOptId = evtOpt.optionId;
      if (typeof currentOptId === 'number' && evtChecked) {
        selectedIds.add(currentOptId);
      }

      // ⚡ FIX: Synchronize QuizService.selectedOptionsMap
      // The display logic relies on quizService.isAnswered(), which checks quizService.selectedOptionsMap.
      // We must ensure this map is populated so isAnswered returns true.
      const currentSelectedOptions = this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
      // If the current option is new/checked and not yet in the service list, add it for the sync
      // (Though addOption above should have handled it, there might be a race or we want to be sure)
      if (evtChecked && typeof currentOptId === 'number' && !currentSelectedOptions.some(o => o.optionId === currentOptId)) {
        currentSelectedOptions.push(evtOpt as any);
      }
      this.quizService.selectedOptionsMap.set(idx, currentSelectedOptions);
      console.log(`[QQC] 🔄 Synced QuizService.selectedOptionsMap using index ${idx}`, currentSelectedOptions);

      // EXISTING UI / FEEDBACK LOGIC
      this.emitSelectionMessage(idx, q!, optionsNow, canonicalOpts);
      this.syncCanonicalOptionsIntoQuestion(q!, canonicalOpts);

      // ⚡ FIX: Synchronously format and emit FET to ensure it's ready BEFORE display state changes
      this.optionsToDisplay = canonicalOpts; // Keep local state in sync

      // ⚡ FIX: Generate and emit FET synchronously using visual options (canonicalOpts)
      // This ensures fetByIndex is populated BEFORE CodelabQuizContent evaluates
      const rawExplanation = q!.explanation || '';
      const correctIndices = this.explanationTextService.getCorrectOptionIndices(q!, canonicalOpts);
      const fet = this.explanationTextService.formatExplanation(q!, correctIndices, rawExplanation);

      if (fet) {
        console.log(`[QQC] ⚡ Sync FET for Q${idx + 1}: "${fet.substring(0, 40)}..."`);
        this.explanationTextService.emitFormatted(idx, fet);
      } else {
        console.warn(`[QQC] ⚠️ No FET generated for Q${idx + 1}`);
      }

      // ⚡ FIX: Update QuizStateService state so CodelabQuizContent display logic passes
      // CodelabQuizContent checks getQuestionState(idx).isAnswered !!
      this.quizStateService.updateQuestionState(this.quizId, idx, { isAnswered: true }, 0);
      console.log(`[QQC] Updated QState: idx=${idx}, isAnswered=true, QuizID=${this.quizId}`);

      const allCorrect = this.computeCorrectness(q!, canonicalOpts, evtOpt, idx);
      this._lastAllCorrect = allCorrect;

      await this.maybeTriggerExplanation(q!, evtOpt, idx, allCorrect);
      this.updateNextButtonAndState(allCorrect);
      this.forceExplanationUpdate(idx, q!);

      this.scheduleAsyncUiFinalization(evtOpt, evtIdx, evtChecked);
    } catch (err: any) {
      console.error('[onOptionClicked] ❌ Error:', err);
    } finally {
      this.finalizeClickCycle(q!, evtOpt);
    }
  }

  private prepareClickCycle(): void {
    this.isUserClickInProgress = true;
    this._skipNextAsyncUpdates = false;

    // Cancel pending RAF
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }
  }

  private async waitForInteractionReady(): Promise<void> {
    if (!this.quizStateService.isInteractionReady()) {
      console.warn('[onOptionClicked] Interaction not ready, waiting…');
      await firstValueFrom(
        this.quizStateService.interactionReady$.pipe(filter(Boolean), take(1))
      );
    }
  }

  private resetExplanationBeforeClick(idx: number): void {
    this.explanationTextService._activeIndex = idx;
    this.explanationTextService.updateFormattedExplanation('');
    this.explanationTextService.latestExplanation = '';
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setIsExplanationTextDisplayed(false);
  }

  private cloneOptionsForUi(
    q: QuizQuestion,
    questionIndex: number,
    evtIdx: number,
    event: OptionClickedPayload
  ): Option[] {
    const optionsNow: Option[] =
      this.optionsToDisplay && this.optionsToDisplay.length > 0
        ? this.optionsToDisplay.map((o) => ({ ...o }))
        : q?.options && q.options.length > 0
          ? q.options.map((o) => ({ ...o }))
          : [];

    // SINGLE-ANSWER → ignore deselects
    if (q?.type === QuestionType.SingleAnswer && !event.checked) {
      for (const o of optionsNow) {
        if (o.selected) {
          o.selected = true;
        }
      }

      for (const o of this.optionsToDisplay ?? []) {
        if (o.selected) {
          o.selected = true;
        }
      }
      return optionsNow;
    }

    this.selectionMessageService.releaseBaseline(questionIndex);

    if (q?.type === QuestionType.SingleAnswer) {
      let i = 0;
      for (const opt of optionsNow) {
        opt.selected = i === evtIdx;
        i++;
      }

      i = 0;
      for (const opt of this.optionsToDisplay ?? []) {
        opt.selected = i === evtIdx;
        i++;
      }
    } else {
      optionsNow[evtIdx].selected = event.checked ?? true;
      if (this.optionsToDisplay) {
        this.optionsToDisplay[evtIdx].selected = event.checked ?? true;
      }
    }

    console.log('[cloneOptionsForUi] Returning optionsNow:', optionsNow);
    return optionsNow;
  }

  private persistSelection(
    evtOpt: Option,
    idx: number,
    options: Option[],
    isMultipleAnswer: boolean
  ): void {
    try {
      this.selectedOptionService.setSelectedOption(
        evtOpt,
        idx,
        options,
        isMultipleAnswer
      );
    } catch { }
  }

  private buildCanonicalOptions(q: QuizQuestion, idx: number, evtOpt: Option, evtIdx: number): Option[] {
    const getKey = (o: any, i?: number) =>
      this.selectionMessageService.stableKey(o as Option, i);

    const canonicalOpts = (this.optionsToDisplay?.length > 0 ? this.optionsToDisplay : q?.options ?? []).map((o, i) => ({
      ...o,
      optionId: Number(o.optionId ?? getKey(o, i)),
      selected: (
        this.selectedOptionService.selectedOptionsMap?.get(idx) ?? []
      ).some((sel) => getKey(sel) === getKey(o))
    }));

    if (q?.type === QuestionType.SingleAnswer) {
      let i = 0;
      for (const opt of canonicalOpts) {
        opt.selected = i === evtIdx;
        i++;
      }

      if (evtOpt?.correct && canonicalOpts[evtIdx]) {
        canonicalOpts[evtIdx].selected = true;
        this.selectionMessageService._singleAnswerCorrectLock.add(idx);
        this.selectionMessageService._singleAnswerIncorrectLock.delete(idx);
      }
    } else if (canonicalOpts[evtIdx]) {
      canonicalOpts[evtIdx].selected = true;
    }

    return canonicalOpts;
  }

  private emitSelectionMessage(
    idx: number,
    q: QuizQuestion,
    optionsNow: Option[],
    canonicalOpts: Option[]
  ): void {
    this.selectionMessageService.setOptionsSnapshot(canonicalOpts);
    this._msgTok = (this._msgTok ?? 0) + 1;

    this.selectionMessageService.emitFromClick({
      index: idx,
      totalQuestions: this.totalQuestions,
      questionType: q?.type ?? QuestionType.SingleAnswer,
      options: optionsNow,
      canonicalOptions: canonicalOpts as any,
      token: this._msgTok
    });
  }

  private syncCanonicalOptionsIntoQuestion(
    q: QuizQuestion,
    canonicalOpts: Option[]
  ): void {
    if (q && Array.isArray(q.options)) {
      q.options = canonicalOpts.map((o) => ({ ...o }));
    }
  }

  private computeCorrectness(
    q: QuizQuestion,
    canonicalOpts: Option[],
    evtOpt: Option,
    idx: number
  ): boolean {
    const getKey =
      (o: Option) => this.selectionMessageService.stableKey(o as Option);

    // All correct options
    const correctOpts = canonicalOpts.filter((o: Option) => !!o.correct);

    // Pull selected options from SOS
    const selOpts =
      this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];

    // Convert to canonical comparable keys
    const selKeys = new Set(selOpts.map((o: Option) => getKey(o)));

    const selectedCorrectCount = correctOpts.filter((o: Option) =>
      selKeys.has(getKey(o))
    ).length;

    // MULTIPLE-ANSWER logic
    if (q?.type === QuestionType.MultipleAnswer) {
      // EXACT match required
      return (
        correctOpts.length > 0 &&
        selectedCorrectCount === correctOpts.length &&
        selKeys.size === correctOpts.length
      );
    }

    // SINGLE-ANSWER logic
    return !!evtOpt?.correct;
  }

  private async maybeTriggerExplanation(
    q: QuizQuestion,
    evtOpt: Option,
    idx: number,
    allCorrect: boolean
  ): Promise<void> {
    if (allCorrect && this.quizStateService.hasUserInteracted(idx)) {
      this.quizStateService.displayStateSubject.next({ mode: 'explanation', answered: true });
      this.displayExplanation = true;
    }

    if (evtOpt?.correct) {
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.quizStateService.displayStateSubject.next({ mode: 'explanation', answered: true });
      this.displayExplanation = true;
    }
  }

  private updateNextButtonAndState(allCorrect: boolean): void {
    this.nextButtonStateService.setNextButtonState(allCorrect);
    this.quizStateService.setAnswered(allCorrect);
    this.quizStateService.setAnswerSelected(allCorrect);
  }

  private forceExplanationUpdate(idx: number, q: QuizQuestion): void {
    console.warn('[FET CHECK]', {
      idx,
      type: q?.type,
      alreadyFired: this._fetEarlyShown.has(idx)
    });

    this._fetEarlyShown.delete(idx);

    console.warn(`[QQC] 🔥 FORCED FET call for Q${idx + 1}`);
    this.fireAndForgetExplanationUpdate(idx, q);
  }

  private scheduleAsyncUiFinalization(
    evtOpt: Option,
    evtIdx: number,
    evtChecked: boolean
  ): void {
    queueMicrotask(() => {
      if (this._skipNextAsyncUpdates) return;
      this.refreshFeedbackFor(evtOpt ?? undefined);
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();
    });

    requestAnimationFrame(() => {
      if (this._skipNextAsyncUpdates) return;

      (async () => {
        try {
          if (evtOpt) this.emitOptionSelected(evtOpt);
        } catch { }

        const qSafe = this.currentQuestion;
        if (!qSafe) {
          this.feedbackText = '';
          return;  // prevent crash and keeps behavior unchanged
        }

        this.feedbackText = await this.generateFeedbackText(qSafe);

        await this.postClickTasks(
          evtOpt ?? undefined, evtIdx, true, false
        );

        this.handleCoreSelection({
          option: evtOpt,
          index: evtIdx,
          checked: evtChecked
        });
        if (evtOpt) this.markBindingSelected(evtOpt);
        this.refreshFeedbackFor(evtOpt ?? undefined);
      })().catch(() => { });
    });
  }

  private finalizeClickCycle(q: QuizQuestion, evtOpt: Option): void {
    queueMicrotask(() => {
      this._clickGate = false;
      this.isUserClickInProgress = false;

      this.selectionMessageService.releaseBaseline(this.currentQuestionIndex);

      const selectionComplete =
        q?.type === QuestionType.SingleAnswer
          ? !!evtOpt?.correct
          : this._lastAllCorrect;

      void this.selectionMessageService.setSelectionMessage(selectionComplete);
    });
  }

  private fireAndForgetExplanationUpdate(lockedIndex: number, q: QuizQuestion): void {
    console.error('[FET TRACE]', {
      lockedIndex,
      activeIndex: this.quizService.getCurrentQuestionIndex(),
      hasUserInteracted: this.quizStateService.hasUserInteracted?.(lockedIndex),
      gate: this.explanationTextService.shouldDisplayExplanationSource?.value,
      latestExplanationIndex: (this.explanationTextService as any)
        .latestExplanationIndex,
      latestExplanationPreview:
        this.explanationTextService.latestExplanation?.slice?.(0, 80)
    });

    console.error('[FET ENTRY HIT]', {
      lockedIndex,
      activeIndex: this.quizService.getCurrentQuestionIndex(),
      questionText: q?.questionText?.slice(0, 40)
    });

    const active = this.quizService.getCurrentQuestionIndex();

    console.error('[FET ENTRY] fireAndForgetExplanationUpdate HIT', {
      lockedIndex,
      activeIndex: active,
      hasQuestion: !!q,
      questionText: q?.questionText?.slice(0, 80)
    });

    // Guard: do not fire if stale index
    if (lockedIndex !== active) {
      console.warn('[FET SKIP] Stale explanation request dropped', {
        lockedIndex,
        active
      });
      return;
    }

    // Guard: user must have interacted first
    const hasUserInteracted = (this.quizStateService as any).hasUserInteracted?.(lockedIndex) ?? false;
    if (!hasUserInteracted) {
      console.warn('[FET SKIP] User has not interacted yet, blocking FET');
      return;
    }

    console.error('[FET PIPELINE] Calling performExplanationUpdate for Q' + (lockedIndex + 1));

    this.performExplanationUpdate(lockedIndex, q)
      .then(() => {
        console.log('[FET PIPELINE ✅] performExplanationUpdate completed');
      })
      .catch((err: Error) => {
        console.error('[FET PIPELINE ❌] performExplanationUpdate crashed', err);
      });
  }

  private async performExplanationUpdate(
    lockedIndex: number,
    q: QuizQuestion
  ): Promise<void> {
    console.error('[FET GUARD CHECK] performExplanationUpdate ENTERED', {
      lockedIndex,
      activeIndex: this.quizService.getCurrentQuestionIndex(),
      displayState: this.quizStateService.displayStateSubject?.value,
      shouldShowExplanation: this.explanationTextService.shouldDisplayExplanationSource?.value
    });

    console.warn('[FET GUARD CHECK]', {
      lockedIndex,
      activeIndex: this.quizService.getCurrentQuestionIndex(),
      hasUserInteracted: (this.quizStateService as any).hasUserInteracted?.(
        lockedIndex
      ),
      hasAnswered: (this.quizStateService as any).isQuestionAnswered?.(
        lockedIndex
      ),
      latestExplanation: this.explanationTextService?.latestExplanation?.slice(
        0,
        80
      )
    });

    console.error('[FET ORIGIN] PERFORM UPDATE ENTERED', lockedIndex);

    const ets = this.explanationTextService;

    const raw = (q?.explanation ?? '').trim();

    console.error('[FET DATA]', {
      hasExplanation: !!raw,
      raw: raw.slice(0, 120)
    });

    if (!raw) {
      console.warn('[FET FAIL] No explanation text in question.');
      return;
    }

    try {
      // ───────────── Pin to active index ─────────────
      const currentActiveIndex = this.quizService.getCurrentQuestionIndex();

      // Guard: Prevent stale explanation updates
      if (lockedIndex !== currentActiveIndex) {
        console.warn(
          `[QQC] ⚠️ Index mismatch: locked=${lockedIndex}, active=${currentActiveIndex}. Aborting FET.`,
        );
        return;
      }

      ets._activeIndex = lockedIndex;

      // Lock only during formatting
      ets._fetLocked = true;

      // Clear old text BEFORE setting new index
      ets.latestExplanation = '';
      ets.latestExplanationIndex = null;
      ets.updateFormattedExplanation('');
      ets.formattedExplanationSubject?.next('');

      // Remove stale per-index cache
      ets.purgeAndDefer(lockedIndex);

      // Give one clean frame to kill stale renders
      await new Promise((res) => requestAnimationFrame(res));

      // Now bind explanation to this question index (after clearing)
      (ets as any).latestExplanationIndex = lockedIndex;

      const canonicalQ = this.quizService.questions?.[lockedIndex] ?? q;

      const canonicalRaw = (canonicalQ?.explanation ?? '').trim();
      if (!canonicalRaw) {
        console.warn(`[QQC] ⚠️ No explanation text for Q${lockedIndex + 1}`);
        ets._fetLocked = false;
        return;
      }

      const correctIdxs = ets.getCorrectOptionIndices(canonicalQ);

      const formatted = ets
        .formatExplanation(canonicalQ, correctIdxs, canonicalRaw)
        .trim();

      if (!formatted) {
        console.warn(`[QQC] ⚠️ Formatter stripped explanation text`);
        ets._fetLocked = false;
        return;
      }

      // ───────────── Unlock BEFORE emission ─────────────
      ets._fetLocked = false;

      // Guard: ensure we're still on the same question
      const finalActiveIndex = this.quizService.getCurrentQuestionIndex();
      if (lockedIndex !== finalActiveIndex) {
        console.warn(`[QQC] ⚠️ Question changed during FET generation. Aborting emission.`);
        ets._fetLocked = false;
        return;
      }

      ets.latestExplanation = formatted;
      (ets as any).latestExplanationIndex = lockedIndex;

      // ⚡ FIX: Call emitFormatted to populate fetByIndex
      // The display logic in codelab-quiz-content checks fetByIndex.has(idx) to determine
      // whether to show FET. Without this call, fetByIndex was never populated and FET never displayed.
      ets.emitFormatted(lockedIndex, formatted);

      ets.formattedExplanationSubject?.next(formatted);
      ets.updateFormattedExplanation(formatted);

      // Open the gate and mark as displayed
      ets.shouldDisplayExplanationSource?.next(true);
      ets.setIsExplanationTextDisplayed(true);

      console.warn('[FET EMISSION FINAL]', {
        idx: lockedIndex,
        activeIndex: ets._activeIndex,
        latestExplanationIndex: (ets as any).latestExplanationIndex,
        preview: formatted.slice(0, 80)
      });

      // Do NOT touch displayMode here – let content decide based on latestExplanation
      this.explanationToDisplay = formatted;
      this.emitExplanationToDisplayChange(formatted);
    } catch (err: any) {
      console.warn('[QQC ❌] FET trigger failed:', err);
      this.explanationTextService._fetLocked = false;
    }
  }

  private onQuestionTimedOut(targetIndex?: number): void {
    // Ignore repeated signals
    if (this.timedOut) return;
    this.timedOut = true;

    const activeIndex = targetIndex ?? this.currentQuestionIndex ?? 0;
    const i0 = this.normalizeIndex(activeIndex);
    const q =
      this.questions[i0] ??
      (this.currentQuestionIndex === i0 ? this.currentQuestion : undefined);

    // Collect canonical snapshot and robust lock keys
    const { canonicalOpts, lockKeys } = this.collectLockContextForQuestion(i0, {
      question: q,
      fallbackOptions: this.optionsToDisplay
    });

    // Reveal feedback, lock, and disable options now that the timer has ended
    this.applyLocksAndDisableForQuestion(i0, canonicalOpts, lockKeys, {
      revealFeedback: true,
      timedOut: true
    });

    // Announce completion to any listeners (progress, gating, etc.)
    try {
      this.selectionMessageService.releaseBaseline(activeIndex);

      const anySelected = canonicalOpts.some((opt: Option) => !!opt?.selected);
      if (!anySelected) {
        const total = this.totalQuestions ?? this.quizService?.totalQuestions ?? 0;
        const isLastQuestion = total > 0 && i0 === total - 1;
        this.selectionMessageService.forceNextButtonMessage(i0, { isLastQuestion });
      } else {
        void this.selectionMessageService.setSelectionMessage(true);
      }
    } catch { }

    // Show explanation immediately
    try {
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.displayExplanation = true;
      this.emitShowExplanationChange(true);

      const cached = this._formattedByIndex.get(i0);
      const rawTrue = (
        q?.explanation ??
        this.currentQuestion?.explanation ??
        ''
      ).trim();
      const txt = cached?.trim() ?? rawTrue ?? '<span class="muted">Formatting…</span>';
      this.setExplanationFor(i0, txt);
      this.explanationToDisplay = txt;
      this.explanationToDisplayChange?.emit(txt);
    } catch { }

    // Allow navigation to proceed
    this.nextButtonStateService.setNextButtonState(true);
    this.quizStateService.setAnswered(true);
    this.quizStateService.setAnswerSelected(true);

    // Defensive stop in case the timer didn’t auto-stop at zero
    try {
      this.timerService.stopTimer(undefined, { force: true });
    } catch { }

    this.cdRef.markForCheck();  // render
  }

  private handleTimerStoppedForActiveQuestion(reason: 'timeout' | 'stopped'): void {
    if (this._timerStoppedForQuestion) return;

    const i0 = this.normalizeIndex(this.currentQuestionIndex ?? 0);
    if (!Number.isFinite(i0) || !this.questions?.[i0]) return;
    if (reason !== 'timeout' && this.questionFresh) return;

    const { canonicalOpts, lockKeys } = this.collectLockContextForQuestion(i0);

    this.applyLocksAndDisableForQuestion(i0, canonicalOpts, lockKeys, {
      revealFeedback: reason === 'timeout',
      timedOut: reason === 'timeout'
    });

    if (reason !== 'timeout') {
      try {
        this.selectionMessageService.releaseBaseline(this.currentQuestionIndex);
      } catch { }
    }

    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }

  private collectLockContextForQuestion(
    i0: number,
    context: {
      question?: QuizQuestion | null;
      fallbackOptions?: Option[] | null;
    } = {}
  ): {
    canonicalOpts: Option[];
    lockKeys: Set<string | number>;
  } {
    const lockKeys = new Set<string | number>();

    const addKeyVariant = (raw: unknown) => {
      if (raw == null) return;

      if (typeof raw === 'number') {
        lockKeys.add(raw);
        lockKeys.add(String(raw));
        return;
      }

      const str = String(raw).trim();
      if (!str) return;

      const num = Number(str);
      if (Number.isFinite(num)) {
        lockKeys.add(num);
      }

      lockKeys.add(str);
    };

    const harvestOptionKeys = (opt?: Option, idx?: number) => {
      if (!opt) return;

      addKeyVariant(opt.optionId);
      addKeyVariant(opt.value);

      try {
        const stable = this.selectionMessageService.stableKey(opt, idx);
        addKeyVariant(stable);
      } catch { }
    };

    const resolvedQuestion =
      context.question ??
      this.questions[i0] ??
      (this.currentQuestionIndex === i0 ? this.currentQuestion : undefined);

    const baseOptions = (() => {
      if (
        Array.isArray(resolvedQuestion?.options) &&
        resolvedQuestion.options.length
      ) {
        return resolvedQuestion.options;
      }
      if (
        Array.isArray(context.fallbackOptions) &&
        context.fallbackOptions.length
      ) {
        return context.fallbackOptions;
      }
      if (
        Array.isArray(this.optionsToDisplay) &&
        this.optionsToDisplay.length
      ) {
        return this.optionsToDisplay;
      }
      return [] as Option[];
    })();

    let canonicalOpts: Option[] = baseOptions.map((o, idx) => {
      harvestOptionKeys(o, idx);

      const numericId = Number(o.optionId);

      return {
        ...o,
        optionId: Number.isFinite(numericId) ? numericId : o.optionId,
        selected: !!o.selected
      } as Option;
    });

    if (!canonicalOpts.length && Array.isArray(this.sharedOptionComponent?.optionBindings)) {
      canonicalOpts = this.sharedOptionComponent.optionBindings
        .map((binding, idx) => {
          const opt = binding?.option;
          if (!opt) return undefined;
          harvestOptionKeys(opt, idx);
          const numericId = Number(opt.optionId);
          return {
            ...opt,
            optionId: Number.isFinite(numericId) ? numericId : opt.optionId,
            selected: !!opt.selected
          } as Option;
        })
        .filter((opt): opt is Option => !!opt);
    }

    let idx = 0;
    for (const opt of this.optionsToDisplay ?? []) {
      harvestOptionKeys(opt, idx);
      idx++;
    }

    idx = 0;
    for (const binding of this.sharedOptionComponent?.optionBindings ?? []) {
      harvestOptionKeys(binding?.option, idx);
      idx++;
    }

    return { canonicalOpts, lockKeys };
  }

  private applyLocksAndDisableForQuestion(
    i0: number,
    canonicalOpts: Option[],
    lockKeys: Set<string | number>,
    options: { revealFeedback: boolean; timedOut?: boolean }
  ): void {
    if (options.revealFeedback) {
      try {
        this.revealFeedbackForAllOptions(canonicalOpts, options.timedOut ?? false);
      } catch { }
    }

    try {
      this.selectedOptionService.lockQuestion(i0);
    } catch { }

    if (lockKeys.size) {
      try {
        this.selectedOptionService.lockMany(i0, Array.from(lockKeys));
      } catch { }
    }

    try {
      this.sharedOptionComponent?.forceDisableAllOptions();
      this.sharedOptionComponent?.triggerViewRefresh();
    } catch { }

    try {
      // Update local bindings and option snapshots so any direct consumers within this component also
      // respect the disabled state even if the child component has not yet processed the disable broadcast.
      this.optionBindings = (this.optionBindings ?? []).map((binding) => {
        const updated = {
          ...binding,
          disabled: true
        } as OptionBindings;

        if (updated.option) {
          updated.option = {
            ...updated.option,
            active: false
          } as Option;
        }

        return updated;
      });

      this.optionsToDisplay = (this.optionsToDisplay ?? []).map((option) => ({
        ...option,
        active: false
      }));
    } catch { }

    this._timerStoppedForQuestion = true;
  }

  private handleCoreSelection(ev: {
    option: SelectedOption | null;
    index: number;
    checked: boolean;
  }): void {
    if (!ev.option) {
      console.warn('[handleCoreSelection] Skipping null option');
      return;
    }

    const isMultiSelect = this.question?.type === QuestionType.MultipleAnswer;

    this.performInitialSelectionFlow(ev, ev.option);
    this.handleInitialSelection({
      option: ev.option,
      index: ev.index,
      checked: true
    });

    this.setAnsweredAndDisplayState();
    this.selectedOptionService.setSelectedOption(ev.option);

    this.selectedOptionService.evaluateNextButtonStateForQuestion(
      this.currentQuestionIndex,
      isMultiSelect
    );

    this.cdRef.detectChanges();
  }

  // Mark the binding and repaint highlight
  private markBindingSelected(opt: Option): void {
    // Rebuild selectedKeys from the service map for current question
    const currentSelected =
      this.selectedOptionService.selectedOptionsMap.get(this.currentQuestionIndex) ?? [];
    const selectedKeys =
      new Set(currentSelected.map((o) => o.optionId));

    const b = this.optionBindings.find(
      (x) => x.option.optionId === opt.optionId
    );
    if (!b) return;

    // Update binding based on whether this option is still selected
    b.isSelected = selectedKeys.has(opt.optionId!);
    b.showFeedback = true;

    this.updateOptionBinding(b);
    b.directiveInstance?.updateHighlight();
  }

  // Keep feedback only for the clicked row
  private refreshFeedbackFor(opt: Option): void {
    if (!this.sharedOptionComponent) {
      console.warn('[QQC] <app-shared-option> not ready');
      return;
    }

    this.sharedOptionComponent.lastFeedbackOptionId = opt.optionId ?? -1;

    if (opt.optionId === undefined) {
      console.warn('[Feedback] Option missing ID', opt);
      return;
    }

    const cfg: FeedbackProps = {
      ...this.sharedOptionComponent.feedbackConfigs[opt.optionId],
      showFeedback: true,
      selectedOption: opt,
      options: this.optionBindings.map((b) => b.option),
      question: this.currentQuestion!,
      feedback: opt.feedback ?? '',
      idx:
        this.optionBindings.find((b) => b.option.optionId === opt.optionId)
          ?.index ?? 0,
      correctMessage: ''
    };

    this.sharedOptionComponent.feedbackConfigs = {
      ...this.sharedOptionComponent.feedbackConfigs,
      [opt.optionId]: cfg
    };

    this.cdRef.markForCheck();
  }

  // Any async follow-ups
  private async postClickTasks(
    opt: SelectedOption,
    idx: number,
    checked: boolean,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    await this.processSelectedOption(opt, idx, checked);
    await this.finalizeAfterClick(opt, idx, wasPreviouslySelected);
  }

  // Utility: replace the changed binding and keep a fresh array ref
  private updateOptionBinding(binding: OptionBindings): void {
    this.optionBindings = this.optionBindings.map((b) =>
      b.option.optionId === binding.option.optionId ? binding : b
    );
  }

  private performInitialSelectionFlow(
    event: any,
    option: SelectedOption
  ): void {
    // Capture pre-toggle selection state BEFORE we mutate
    const prevSelected = !!option.selected;

    this.updateOptionSelection(event, option);

    if (!this.currentQuestion) {
      console.warn('[handleOptionSelection] currentQuestion is null, skipping');
      return;
    }
    void this.handleOptionSelection(option, event.index, this.currentQuestion);
    void this.applyFeedbackIfNeeded(option);

    // Tell SMS about this click (id-deduped)
    // Only bump for a true transition: unselected → selected AND it’s correct
    const nowSelected = !!option.selected; // after updateOptionSelection()
    const becameSelected = !prevSelected && nowSelected;

    if (becameSelected) {
      const idx = this.currentQuestionIndex;
      const optId = Number(option.optionId);

      // Use fields that exist on model
      const wasCorrect =
        option.correct === true ||
        (typeof option.feedback === 'string' &&
          /correct/i.test(option.feedback));

      if (Number.isFinite(optId)) {
        this.selectionMessageService.registerClick(idx, optId, wasCorrect);
      }
    }

    // Reconcile deselects when selected → unselected
    const becameDeselected = prevSelected && !nowSelected;
    if (becameDeselected) {
      const idx = this.currentQuestionIndex;
      const optsNow =
        ((this.optionsToDisplay?.length
          ? this.optionsToDisplay
          : this.currentQuestion?.options) as Option[]) || [];
      this.selectionMessageService['reconcileObservedWithCurrentSelection']?.(
        idx,
        optsNow
      );
    }

    // Emit exactly once; service builds the message
    void this.handleSelectionMessageUpdate();
  }

  private setAnsweredAndDisplayState(): void {
    this.selectedOptionService.setAnswered(true);
    this.quizStateService.setAnswered(true);
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
  }

  private async applyFeedbackIfNeeded(option: SelectedOption): Promise<void> {
    if (!this.optionsToDisplay?.length) {
      console.warn(
        '[⚠️ applyFeedbackIfNeeded] Options not populated. Attempting to ' +
        'repopulate...'
      );
      await new Promise((res) => setTimeout(res, 50));
      this.optionsToDisplay = this.populateOptionsToDisplay();
    }

    const index = this.optionsToDisplay.findIndex(
      (opt: Option) => opt.optionId === option.optionId
    );
    if (index === -1) {
      console.warn(`[⚠️ Option ${option.optionId} not found in optionsToDisplay`);
      return;
    }

    const foundOption = this.optionsToDisplay[index];
    console.log(`[✅ applyFeedbackIfNeeded] Found Option at index ${index}:`,
      foundOption
    );

    // Flag that feedback has been applied at least once (optional guard)
    this.isFeedbackApplied = true;

    // Explanation evaluation (optional)
    const ready = !!this.explanationTextService.latestExplanation?.trim();
    const show = this.explanationTextService.shouldDisplayExplanationSource.getValue();

    if (ready && show) {
      console.log('[📢 Triggering Explanation Evaluation]');
      this.explanationTextService.triggerExplanationEvaluation();
    } else {
      console.warn('[⏭️ Explanation trigger skipped – not ready or not set to display]');
    }

    // Ensure change detection
    this.cdRef.detectChanges();
  }

  public async handleSelectionMessageUpdate(): Promise<void> {
    // Wait a microtask so any selection mutations and state evals have landed
    queueMicrotask(() => {
      // Then wait a frame to ensure the rendered list reflects the latest flags
      requestAnimationFrame(async () => {
        const optionsNow =
          ((this.optionsToDisplay?.length
            ? this.optionsToDisplay
            : this.currentQuestion?.options) as Option[]) || [];

        // Notify the service that selection just changed (starts hold-off window)
        this.selectionMessageService.notifySelectionMutated(optionsNow);

        // Always recompute based on answered state
        await this.selectionMessageService.setSelectionMessage(this.isAnswered);
      });
    });
  }

  private async finalizeAfterClick(
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const lockedIndex = this.fixedQuestionIndex ?? this.currentQuestionIndex;
    this.markQuestionAsAnswered(lockedIndex);

    await this.finalizeSelection(option, index, wasPreviouslySelected);

    const sel: SelectedOption = { ...option, questionIndex: lockedIndex };
    this.emitOptionSelected(sel);

    this.selectedOptionService.setAnswered(true);
    this.nextButtonStateService.setNextButtonState(true);

    this.cdRef.markForCheck();
  }

  private async fetchAndUpdateExplanationText(questionIndex: number): Promise<string> {
    // Lock the question index at the time of call
    const lockedQuestionIndex = this.currentQuestionIndex;

    // Early exit if question index has changed
    if (lockedQuestionIndex !== questionIndex) {
      console.warn(
        `[fetchAndUpdateExplanationText] ⚠️ Mismatch detected! Skipping 
        explanation update for Q${questionIndex}.`
      );
      return '';
    }

    try {
      // Check session storage
      const storedExplanation = sessionStorage.getItem(
        `explanationText_${questionIndex}`
      );
      if (storedExplanation) {
        this.applyExplanation(storedExplanation);
        return storedExplanation;  // return the explanation text
      }

      // Check service cache
      const cachedExplanation =
        this.explanationTextService.formattedExplanations[questionIndex]
          ?.explanation;

      if (cachedExplanation) {
        this.syncExplanationService(questionIndex, cachedExplanation);
        this.applyExplanation(cachedExplanation);

        // Store in session storage for future use
        sessionStorage.setItem(`explanationText_${questionIndex}`,
          cachedExplanation);
        return cachedExplanation;  // return the cached explanation text
      }

      // Fetch explanation from service, only if initialized
      const explanationText = this.explanationTextService
        .explanationsInitialized
        ? await firstValueFrom(
          this.explanationTextService.getFormattedExplanationTextForQuestion(
            questionIndex
          )
        )
        : 'No explanation available';

      if (!explanationText?.trim()) {
        console.warn(
          `[fetchAndUpdateExplanationText] ⚠️ No explanation text found for Q${questionIndex}`
        );
        return '';  // return empty string to ensure consistent return type
      }

      // Confirm the question index hasn’t changed during async fetch
      if (lockedQuestionIndex !== this.currentQuestionIndex) {
        console.warn(
          `[fetchAndUpdateExplanationText] ⚠️ Explanation index mismatch after fetch! Skipping update.`
        );
        return '';
      }

      // Cache and display
      this.explanationTextService.formattedExplanations[questionIndex] = {
        questionIndex,
        explanation: explanationText
      };
      sessionStorage.setItem(`explanationText_${questionIndex}`, explanationText);
      this.syncExplanationService(questionIndex, explanationText);
      this.applyExplanation(explanationText);

      return explanationText;  // return the fetched explanation text
    } catch (error: any) {
      console.error(
        `[fetchAndUpdateExplanationText] ❌ Error fetching explanation for Q${questionIndex}:`,
        error
      );
      return '';  // return empty string in case of error
    }
  }

  private applyExplanation(explanation: string): void {
    this.explanationToDisplay = explanation;

    if (this.shouldDisplayExplanation && this.isAnswered) {
      this.emitExplanationToDisplayChange(explanation);
      this.emitShowExplanationChange(true);
    }

    this.cdRef.detectChanges();
  }

  private syncExplanationService(
    questionIndex: number,
    explanation: string
  ): void {
    const ets: any = this.explanationTextService;

    ets.latestExplanation = explanation;
    ets.latestExplanationIndex = questionIndex;
    ets.formattedExplanationSubject.next(explanation);
    ets.updateFormattedExplanation(explanation);
    ets.setShouldDisplayExplanation(true);
    ets.setIsExplanationTextDisplayed(true);
  }

  // ====================== Helper Functions ======================
  private async handleMultipleAnswerTimerLogic(
    option: Option,
    questionIndex: number
  ): Promise<void> {
    this.showFeedback = true;  // enable feedback display

    try {
      const normalizedIndex = this.normalizeIndex(
        questionIndex >= 0
          ? questionIndex
          : (this.quizService.getCurrentQuestionIndex() ?? 0)
      );

      // Include previously selected options so the snapshot reflects every choice
      // the user has made (including earlier incorrect picks).
      const priorSelections =
        this.selectedOptionService.selectedOptionsMap.get(normalizedIndex) ?? [];
      const selectedIds = new Set<number>(
        priorSelections
          .map((sel) => sel?.optionId)
          .filter((id): id is number => id !== null && id !== undefined)
      );

      // Also fold in any already-selected options from the rendered list so we
      // don't lose earlier picks that weren't captured in the selections map.
      let idx = 0;

      for (const opt of this.optionsToDisplay) {
        const id = opt?.optionId ?? idx;

        if (opt?.selected && id !== undefined && id !== null) {
          selectedIds.add(id);
        }

        idx++;
      }

      if (option?.optionId !== undefined && option?.optionId !== null) {
        selectedIds.add(option.optionId);
      }

      // Check if all correct options are selected
      // Update options state
      this.optionsToDisplay = this.optionsToDisplay.map((opt: Option) => {
        const isSelected = opt.optionId === option.optionId;

        return {
          ...opt,
          feedback: isSelected && !opt.correct ? 'x' : opt.feedback,
          showIcon: isSelected,
          selected:
            opt.selected || isSelected || selectedIds.has(opt.optionId ?? -1),
          active: true  // keep all options active
        };
      });
    } catch (error: any) {
      console.error('[handleMultipleAnswerTimerLogic] Error:', error);
    }
  }

  public populateOptionsToDisplay(): Option[] {
    if (!this.currentQuestion) {
      console.warn(
        '[⚠️ populateOptionsToDisplay] currentQuestion is null or undefined. Skipping population.'
      );
      return [];
    }

    if (
      !Array.isArray(this.currentQuestion.options) ||
      this.currentQuestion.options.length === 0
    ) {
      console.warn(
        '[⚠️ populateOptionsToDisplay] currentQuestion.options is not a valid ' +
        'array. Returning empty array.'
      );
      return [];
    }

    const signature = this.computeQuestionSignature(this.currentQuestion);

    const hasValidOptions =
      Array.isArray(this.optionsToDisplay) &&
      this.optionsToDisplay.length === this.currentQuestion.options.length &&
      this.lastOptionsQuestionSignature === signature;

    if (hasValidOptions) return this.optionsToDisplay;

    this.optionsToDisplay = this.currentQuestion.options.map(
      (option, index) => ({
        ...option,
        optionId: option.optionId ?? index,
        correct: option.correct ?? false
      })
    );

    this.lastOptionsQuestionSignature = signature;

    return this.optionsToDisplay;
  }

  private computeQuestionSignature(question: QuizQuestion): string {
    const baseText = (question.questionText ?? '').trim();
    const optionKeys = (question.options ?? []).map((opt, idx) => {
      const optionId = opt.optionId ?? idx;
      const text = (opt.text ?? '').trim();
      const correctness = opt.correct === true ? '1' : '0';
      return `${optionId}|${text}|${correctness}`;
    });

    return `${baseText}::${optionKeys.join('||')}`;
  }

  public async applyOptionFeedback(selectedOption: Option): Promise<void> {
    if (!selectedOption) {
      console.error(
        '[applyOptionFeedback] ❌ ERROR: selectedOption is null or undefined! Aborting.',
      );
      return;
    }

    // Ensure options are available before applying feedback
    if (!Array.isArray(this.optionsToDisplay) || this.optionsToDisplay.length === 0) {
      console.warn(
        '[applyOptionFeedback] ⚠️ optionsToDisplay is empty! Attempting to repopulate...'
      );
      this.populateOptionsToDisplay();
    }

    // Ensure UI-related states are initialized
    this.showFeedbackForOption = this.showFeedbackForOption || {};
    if (selectedOption.optionId !== undefined) {
      this.showFeedbackForOption[selectedOption.optionId] = true;
    } else {
      console.warn('[showFeedbackForOption] Missing optionId for', selectedOption);
    }

    // Find index of the selected option safely
    this.selectedOptionIndex = this.optionsToDisplay.findIndex(
      (opt: Option) => opt.optionId === selectedOption.optionId
    );
    if (this.selectedOptionIndex === -1) {
      console.error(
        `[applyOptionFeedback] ❌ ERROR: selectedOptionIndex not found for optionId: 
        ${selectedOption.optionId}`
      );
      return;
    }

    // Apply feedback to only the clicked option, keeping others unchanged
    this.optionsToDisplay = this.optionsToDisplay.map((option) => ({
      ...option,
      feedback:
        option.optionId === selectedOption.optionId
          ? option.correct
            ? '✅ This is a correct answer!'
            : '❌ Incorrect answer!'
          : option.feedback,  // preserve feedback for other options
      showIcon: option.optionId === selectedOption.optionId,  // show icon for clicked option only
      selected: option.optionId === selectedOption.optionId  // ensure clicked option stays selected
    }));

    // Emit event to notify SharedOptionComponent
    this.feedbackApplied.emit(selectedOption.optionId);

    // Add a slight delay to ensure UI refreshes properly
    await new Promise(
      (resolve) => setTimeout(resolve, 50)
    );

    // Ensure UI updates after applying feedback
    // Ensure the flag is initialized if missing
    if (selectedOption.optionId == null) {
      console.warn('[applyOptionFeedback] Missing optionId — skipping feedback flag');
      return;
    }
    if (!this.showFeedbackForOption[selectedOption.optionId]) {
      this.showFeedbackForOption[selectedOption.optionId] = true;
    }

    // Now apply UI update logic
    this.cdRef.markForCheck();
  }

  // Handles option selection logic to avoid duplicating "add/remove option" logic.
  private updateOptionSelection(
    event: { option: SelectedOption; checked: boolean; index?: number },
    option: SelectedOption
  ): void {
    if (!option) {
      console.error('Option is undefined, cannot update.');
      return;
    }

    // Check for undefined optionId
    if (option.optionId === undefined) {
      console.error('option.optionId is undefined:', option);
      option.optionId = event.index ?? -1;  // assign fallback optionId
    }

    if (event.checked) {
      this.selectedOptionService.addOption(this.currentQuestionIndex, option);
    } else {
      this.selectedOptionService.removeOption(
        this.currentQuestionIndex,
        option.optionId
      );
    }
  }

  // Updates the display to explanation mode.
  private updateDisplayStateToExplanation(): void {
    // Get answered state from SelectedOptionService
    const isAnswered = this.selectedOptionService.isAnsweredSubject.getValue();

    // Guard conditions to prevent premature execution
    if (!isAnswered || !this.shouldDisplayExplanation) return;
    if (this.displayMode$.getValue() === 'explanation') return;

    // Update the display state
    this.displayState = { mode: 'explanation', answered: isAnswered };
    this.displayStateSubject.next(this.displayState);
    this.displayStateChange.emit(this.displayState);

    // Update the display mode
    this.displayMode = 'explanation';
    this.displayMode$.next('explanation');

    // Ensure explanation is visible
    this.shouldDisplayExplanation = true;
    this.explanationVisible = true;
    this.isExplanationTextDisplayed = true;

    // Update rendering flags
    this.forceQuestionDisplay = false;
    this.readyForExplanationDisplay = true;
    this.isExplanationReady = true;
    this.isExplanationLocked = false;
  }

  // Handles the outcome after checking if all correct answers are selected.
  private async handleCorrectnessOutcome(
    allCorrectSelected: boolean,
    option: SelectedOption,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    if (!this.currentQuestion) {
      console.error('[handleCorrectnessOutcome] currentQuestion is null');
      return;
    }

    const routeIndex =
      this.quizService.getCurrentQuestionIndex() ?? this.currentQuestionIndex ?? 0;

    // Normalize to the actual 0-based index used throughout the timer logic
    const effectiveIdx = this.normalizeIndex(routeIndex);

    console.warn('🧭 INDEX CHECK', {
      routeIndex,
      effectiveIdx,
      expectedForQ1: 0
    });

    console.warn('[INDEX NORMALIZED]', { routeIndex, effectiveIdx });

    if (this.currentQuestion.type === QuestionType.MultipleAnswer) {
      await this.handleMultipleAnswerTimerLogic(option, effectiveIdx);
    }

    // TIMER-EXPIRED PATH → force FET pipeline
    const timerExpired =
      !this.timerService.isTimerRunning &&
      !allCorrectSelected &&
      !this.quizStateService.hasUserInteracted(effectiveIdx);

    if (timerExpired) {
      console.warn(
        '[TIMER EXPIRED] Triggering FET via timeout path for Q', effectiveIdx
      );

      // Treat timeout as virtual interaction
      this.quizStateService.markUserInteracted(effectiveIdx);
      this.quizStateService.markQuestionAnswered(effectiveIdx);

      // Bind explanation identity to this question
      this.explanationTextService.latestExplanationIndex = effectiveIdx;

      // Open explanation gate
      this.explanationTextService.shouldDisplayExplanationSource.next(true);

      requestAnimationFrame(() => {
        this.quizStateService.displayStateSubject.next({
          mode: 'explanation',
          answered: true
        });

        const q = this.currentQuestion;
        if (!q) return;

        this.fireAndForgetExplanationUpdate(effectiveIdx, q);
      });
    }

    // Normal correct answer path
    if (allCorrectSelected) {
      // Mark interaction using the SAME 0-based index the streams use
      this.quizStateService.markUserInteracted(effectiveIdx);

      // HARD BIND explanation identity for this question
      this.explanationTextService.latestExplanationIndex = effectiveIdx;

      // Ensure Next button is enabled
      this.answerSelected.emit(true);
      this.selectedOptionService.isAnsweredSubject.next(true);

      // Enable explanation gate
      this.explanationTextService.shouldDisplayExplanationSource.next(true);

      // Clean FET trigger — no UI mutation here
      requestAnimationFrame(() => {
        this.quizStateService.displayStateSubject.next({
          mode: 'explanation',
          answered: true
        });

        const q = this.currentQuestion;
        if (!q) return;

        this.fireAndForgetExplanationUpdate(effectiveIdx, q);
      });
    }

    // Update selection state
    this.selectedOptionService.setSelectedOption(option);

    // Play sound based on correctness
    if (!wasPreviouslySelected) {
      const enrichedOption: SelectedOption = {
        ...option,
        questionIndex: effectiveIdx
      };

      this.soundService.playOnceForOption(enrichedOption);
    } else {
      console.log('[⏸️ No sound - reselection]');
    }

    setTimeout(() => {
      const shouldEnableNext =
        allCorrectSelected || this.selectedOptionService.isAnsweredSubject.getValue();

      this.nextButtonState.emit(shouldEnableNext);
    }, 50);
  }

  private handleInitialSelection(_event: {
    option: SelectedOption | null;
    index: number;
    checked: boolean;
  }): void {
    if (this.forceQuestionDisplay) {
      this.isAnswered = true;
      this.forceQuestionDisplay = false;
      this.displayState.answered = true;
      this.displayState.mode = 'explanation';
    }
  }

  private startLoading(): void {
    this.isLoading = true;
    this.quizStateService.setLoading(true);
    this.quizStateService.setAnswerSelected(false);

    if (!this.quizStateService.isLoading()) {
      this.quizStateService.startLoading();
    }
  }

  private markQuestionAsAnswered(questionIndex: number): void {
    if (!this.quizId) {
      console.error('[markQuestionAsAnswered] quizId is missing or invalid');
      return;
    }

    const questionState = this.quizStateService.getQuestionState(
      this.quizId,
      questionIndex
    );

    if (questionState) {
      questionState.isAnswered = true;
      questionState.explanationDisplayed = true;

      this.quizStateService.setQuestionState(
        this.quizId,
        questionIndex,
        questionState
      );
    } else {
      console.error(
        `[markQuestionAsAnswered] ❌ Question state not found for Q${questionIndex}`
      );
    }

    if (!this.quizStateService.isAnswered$) {
      this.quizStateService.setAnswerSelected(true);
    }
  }

  private async processSelectedOption(
    option: SelectedOption,
    index: number,
    checked: boolean
  ): Promise<void> {
    await this.handleOptionProcessingAndFeedback(option, index, checked);
    await this.updateQuestionState(option);

    void this.handleCorrectAnswers(option);
    this.updateFeedback(option);
  }

  private async finalizeSelection(
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const questionState =
      this.initializeQuestionState(this.currentQuestionIndex);

    this.answerSelected.emit(true);

    await this.handleCorrectnessOutcome(true, option, wasPreviouslySelected);
    await this.processSelectedOption(option, index, true);
    await this.finalizeOptionSelection(option, index, questionState);

    this.saveQuizState();
  }

  private initializeQuestionState(questionIndex: number): QuestionState {
    if (!this.quizId) {
      console.error('[initializeQuestionState] quizId is missing or invalid');

      // Return a default empty state to satisfy the return type
      return {
        isAnswered: false,
        numberOfCorrectAnswers: 0,
        selectedOptions: [],
        explanationDisplayed: false
      };
    }

    // Retrieve existing state for the given index
    let questionState = this.quizStateService.getQuestionState(
      this.quizId,
      questionIndex
    );

    // If state doesn't exist, create a new one
    if (!questionState) {
      questionState = {
        isAnswered: false,
        numberOfCorrectAnswers: 0,
        selectedOptions: [],
        explanationDisplayed: false
      };

      this.quizStateService.setQuestionState(
        this.quizId,
        questionIndex,
        questionState
      );
    } else {
      questionState.isAnswered = false;
    }

    return questionState;
  }

  private async handleOptionProcessingAndFeedback(
    option: SelectedOption,
    index: number,
    checked: boolean
  ): Promise<void> {
    try {
      const event = { option, index, checked };
      await super.onOptionClicked(event);

      // Update selected option state ONLY
      this.selectedOptions = [
        { ...option, questionIndex: this.currentQuestionIndex }
      ];
      this.selectedOption = { ...option };
      this.showFeedback = true;

      if (option.optionId == null) {
        console.warn('[QQC] Option missing optionId');
        return;
      }

      this.showFeedbackForOption[option.optionId] = true;

      // Single-Answer Hard Reset
      if (this.type === 'single') {
        this.selectedOptionService.clearAllSelectionsForQuestion(
          this.currentQuestionIndex
        );
      }

      // Load question data
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      );
      if (!questionData) {
        console.warn('[QQC] questionData missing');
        return;
      }

      // Normalize questionData optionIds so UI + questionData match
      questionData.options = this.quizService.assignOptionIds(
        [...(questionData.options ?? [])],
        this.currentQuestionIndex
      );

      this.selectedOptionService.storeQuestion(
        this.currentQuestionIndex,
        questionData
      );

      // Authoritative clicked option (NEVER trust event.option.optionId)
      const clickedFromQuestion = questionData.options[index];
      if (!clickedFromQuestion || clickedFromQuestion.optionId == null) {
        console.warn('[QQC] clicked option missing in questionData',
          { idx: this.currentQuestionIndex, index });
        return;
      }

      this.selectedOptionService.storeQuestion(
        this.currentQuestionIndex,
        questionData
      );

      // Update SelectedOptionService
      const isMultiple = this.type === 'multiple';

      // Store canonical selection (from questionData), not raw event.option
      const canonicalSelected: SelectedOption = {
        ...option,
        optionId: clickedFromQuestion.optionId,
        questionIndex: this.currentQuestionIndex,
        correct: clickedFromQuestion.correct === true,
        selected: true,
        highlight: true,
        showIcon: true
      };

      this.selectedOptionService.setSelectedOption(
        canonicalSelected,
        this.currentQuestionIndex,
        undefined,
        isMultiple
      );

      // STOP TIMER — ONLY if fully correct
      const idx = this.currentQuestionIndex;

      queueMicrotask(() => {
        const correctIds = new Set(
          (questionData.options ?? [])
            .filter(o => o.correct === true)
            .map(o => String(o.optionId))
        );

        if (correctIds.size === 0) return;

        let shouldStop = false;

        if (this.type === 'single') {
          // SINGLE: only stop if the clicked canonical option is correct
          shouldStop = clickedFromQuestion.correct === true;

          // If correct, wipe any stale garbage that could interfere later
          if (shouldStop) {
            this.selectedOptionService.clearAllSelectionsForQuestion(idx);
            this.selectedOptionService.setSelectedOption(
              canonicalSelected,
              idx,
              undefined,
              false
            );
          }
        } else {
          // MULTI: stop when ALL correct ids are included in selected ids
          const selectedIds = new Set(
            this.selectedOptionService
              .getSelectedOptionsForQuestion(idx)
              .map(o => String(o.optionId))
          );
        }
      });

      // Feedback + messages
      this.correctMessage = this.feedbackService.setCorrectMessage(
        this.optionsToDisplay
      );
    } catch (error: any) {
      console.error('[handleOptionProcessingAndFeedback] ❌ Error:', error);
      this.explanationToDisplay = 'Error processing question. Please try again.';
      this.emitExplanationToDisplayChange(this.explanationToDisplay);
    }
  }

  private async updateQuestionState(option: SelectedOption): Promise<void> {
    if (!this.quizId) {
      console.error('[updateQuestionState] quizId is missing or invalid');
      return;
    }

    try {
      this.quizStateService.updateQuestionState(
        this.quizId,
        this.currentQuestionIndex,
        {
          explanationDisplayed: true,
          selectedOptions: [option],
          explanationText: this.explanationToDisplay
        },
        this.correctAnswers?.length ?? 0
      );
    } catch (stateUpdateError: any) {
      console.error('Error updating question state:', stateUpdateError);
    }
  }

  private async handleCorrectAnswers(option: SelectedOption): Promise<void> {
    try {
      // Fetch correct answers asynchronously
      this.correctAnswers = await this.getCorrectAnswers();

      // Check if the correct answers are available
      if (!this.correctAnswers || this.correctAnswers.length === 0) {
        console.warn('No correct answers available for this question.');
        return;
      }

      // Check if the selected option is among the correct answers
      if (option.optionId === undefined) {
        console.warn('[updateQuestionEvaluation] optionId is missing, skipping check');
        return;
      }
      const isSpecificAnswerCorrect = this.correctAnswers.includes(option.optionId);
      console.log('Is the specific answer correct?', isSpecificAnswerCorrect);
    } catch (error: any) {
      console.error('An error occurred while handling correct answers:', error);
    }
  }

  private updateFeedback(option: SelectedOption): void {
    // Only process feedback if user actually clicked
    if (!this.isUserClickInProgress) {
      console.warn('[updateFeedback] skipped — no user click in progress');
      return;
    }

    this.updateFeedbackForOption(option);

    if (!option.correct) {
      console.log('Incorrect option selected.');
      for (const opt of this.optionsToDisplay) {
        if (opt.optionId == null) {
          console.warn('[showFeedback] Missing optionId for option:', opt);
          continue;
        }

        if (opt.correct) {
          this.showFeedbackForOption[opt.optionId] = true;
        }
      }
    }

    // Find the index of the selected option
    const selectedIndex = this.optionsToDisplay.findIndex(
      (opt: Option) => opt.optionId === option.optionId,
    );
    if (selectedIndex !== -1) {
      this.processOptionSelectionAndUpdateState(selectedIndex);
    }

    this.selectedOptionService.setOptionSelected(true);
    this.selectedOptionService.setSelectedOption(option);
    this.selectedOptionService.setAnsweredState(true);
  }

  private async finalizeOptionSelection(
    option: SelectedOption,
    index: number,
    _questionState: QuestionState
  ): Promise<void> {
    const currentQuestion = await this.fetchAndProcessCurrentQuestion();
    if (!currentQuestion) {
      console.error('Could not retrieve the current question.');
      return;
    }

    // Select the option and update the state
    void this.selectOption(currentQuestion, option, index);

    this.processCurrentQuestionState(currentQuestion, option, index);
  }

  // Helper method to update feedback for options
  private updateFeedbackForOption(option: SelectedOption): void {
    if (option.optionId == null) {
      console.warn('[updateFeedbackForOption] Missing optionId for', option);
      return;
    }

    this.showFeedbackForOption = {};  // reset the feedback object
    this.showFeedbackForOption[option.optionId] =
      this.showFeedback && this.selectedOption === option;
  }

  private resetStateForNewQuestion(): void {
    this.showFeedbackForOption = {};
    this.showFeedback = false;
    this.correctMessage = '';
    this.selectedOption = null;
    this.isOptionSelected = false;
    this.emitExplanationToDisplayChange('');
    this.emitShowExplanationChange(false);
    this.selectedOptionService.clearOptions();  // clears Feedback/Subjects (Safe)
    this.selectedOptionService.resetCurrentSelection();  // clears Current UI Selection (Safe) - PRESERVES MAP
    this.selectedOptionService.setOptionSelected(false);
  }

  private processOptionSelectionAndUpdateState(index: number): void {
    // Skip if this was not triggered by an actual click
    if (!this.isUserClickInProgress) {
      console.warn(
        '[processOptionSelectionAndUpdateState] skipped — no user click in progress'
      );
      return;
    }

    const option = this.question.options[index];
    const selectedOption: SelectedOption = {
      optionId: option.optionId,
      questionIndex: this.currentQuestionIndex,
      text: option.text,
      correct: option.correct ?? false,
      selected: true,
      highlight: true,
      showIcon: true
    };

    this.selectedOptionService.updateSelectionState(
      this.currentQuestionIndex,
      selectedOption,
      this.isMultipleAnswer
    );
    this.selectedOptionService.setOptionSelected(true);
    this.selectedOptionService.setAnsweredState(true);
    this.answerSelected.emit(true);
    this.isFirstQuestion = false;  // reset after the first option click
  }

  public async fetchAndProcessCurrentQuestion(): Promise<QuizQuestion | null> {
    try {
      this.resetStateForNewQuestion();

      // Use the ONLY valid API now
      const currentQuestion = await firstValueFrom(
        this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      );

      if (!currentQuestion) {
        console.warn('[fetchAndProcessCurrentQuestion] No question found.');
        return null;
      }

      // Assign
      this.currentQuestion = currentQuestion;
      this.optionsToDisplay = [...(currentQuestion.options ?? [])];

      // Prepare UI data
      this.data = {
        questionText: currentQuestion.questionText,
        explanationText: currentQuestion.explanation,
        correctAnswersText: this.quizService.getCorrectAnswersAsString(),
        options: this.optionsToDisplay
      };

      // Check if the question has been answered
      const isAnswered = await this.isAnyOptionSelected(this.currentQuestionIndex);

      // Update selection message only if needed
      if (await this.shouldUpdateMessageOnAnswer(isAnswered)) {
        // await this.updateSelectionMessageBasedOnCurrentState(isAnswered);
      }

      return currentQuestion;
    } catch (error: any) {
      console.error('[fetchAndProcessCurrentQuestion] Error:', error);
      return null;
    }
  }

  private processCurrentQuestionState(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    index: number
  ): void {
    if (!this.quizId) {
      console.error('[processCurrentQuestionState] quizId is missing or invalid');
      return;
    }

    void this.processCurrentQuestion(currentQuestion);
    void this.handleOptionSelection(option, index, currentQuestion);
    this.quizStateService.updateQuestionStateForExplanation(
      this.quizId,
      this.currentQuestionIndex
    );
    this.questionAnswered.emit();
  }

  private async processCurrentQuestion(currentQuestion: QuizQuestion): Promise<void> {
    try {
      // Await the explanation text to ensure it resolves to a string
      const explanationText: string = await this.getExplanationText(
        this.currentQuestionIndex
      );

      // Set the current explanation text
      this.explanationTextService.setCurrentQuestionExplanation(explanationText);

      const totalCorrectAnswers =
        this.quizService.getTotalCorrectAnswers(currentQuestion);

      // Update the quiz state with the latest question information
      if (!this.quizId) {
        console.error('[updateQuestionState] quizId is missing or invalid');
        return;
      }
      this.quizStateService.updateQuestionState(
        this.quizId,
        this.currentQuestionIndex,
        { isAnswered: true },
        totalCorrectAnswers
      );
    } catch (error: any) {
      console.error('Error processing current question:', error);

      // Set a fallback explanation text on error
      this.explanationTextService.setCurrentQuestionExplanation(
        'Unable to load explanation.'
      );
    }
  }

  public async resetQuestionStateBeforeNavigation(options?: {
    preserveVisualState?: boolean;
    preserveExplanation?: boolean;
  }): Promise<void> {
    const preserveVisualState = options?.preserveVisualState ?? false;
    const preserveExplanation = options?.preserveExplanation ?? false;

    // Reset core state
    this.currentQuestion = null;
    this.selectedOption = null;
    this.options = [];

    if (!preserveExplanation) {
      this.feedbackText = '';

      this.displayState = { mode: 'question', answered: false };
      this.displayStateSubject.next(this.displayState);
      this.displayStateChange.emit(this.displayState);

      this.displayMode = 'question';
      this.displayMode$.next('question');

      this.forceQuestionDisplay = true;
      this.readyForExplanationDisplay = false;
      this.isExplanationReady = false;
      this.isExplanationLocked = false;
      this.explanationLocked = false;
      this.explanationVisible = false;
      this.displayExplanation = false;
      this.shouldDisplayExplanation = false;
      this.isExplanationTextDisplayed = false;

      // Reset explanation
      this.explanationToDisplay = '';
      this.emitExplanationToDisplayChange('');
      this.explanationTextService.explanationText$.next('');
      this.explanationTextService.setExplanationText('');
      this.explanationTextService.setResetComplete(false);
      this.explanationTextService.unlockExplanation();
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.explanationTextService.setIsExplanationTextDisplayed(false);
      this.emitShowExplanationChange(false);
    }

    if (!preserveVisualState) {
      // Clear the currently rendered question/option references so that child
      // components (such as <app-answer>) do not keep stale options while the
      // next question is being fetched.
      this.questionToDisplay = null;
      this.updateShouldRenderOptions([]);
      this.shouldRenderOptions = false;
    }

    this.finalRenderReadySubject.next(false);
    this.renderReadySubject.next(false);

    // Reset feedback
    setTimeout(() => {
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.freezeOptionBindings = false;
        this.sharedOptionComponent.showFeedbackForOption = {};
        this.isFeedbackApplied = false;
      } else {
        console.warn('[⚠️] sharedOptionComp still undefined after navigation');
      }
    }, 0);

    // Small delay to ensure reset completes
    const resetDelay = preserveVisualState ? 0 : 50;
    if (resetDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, resetDelay));
    }
  }

  private captureExplanationSnapshot(
    index: number,
    preserveVisualState: boolean
  ): {
    shouldRestore: boolean;
    explanationText: string;
    questionState?: QuestionState;
  } {
    if (!preserveVisualState) return { shouldRestore: false, explanationText: '' };

    const rawExplanation = (this.explanationToDisplay ?? '').trim();
    const latestExplanation = (
      this.explanationTextService.getLatestExplanation() ?? ''
    )
      .toString()
      .trim();
    const serviceExplanation = (
      this.explanationTextService.explanationText$.getValue() ?? ''
    )
      .toString()
      .trim();
    const explanationText =
      rawExplanation || latestExplanation || serviceExplanation;

    if (!explanationText) {
      return { shouldRestore: false, explanationText: '' };
    }

    const activeQuizId =
      [
        this.quizId,
        this.quizService.getCurrentQuizId(),
        this.quizService.quizId
      ].find((id) => id?.trim().length > 0) ?? null;

    const questionState = activeQuizId
      ? this.quizStateService.getQuestionState(activeQuizId, index)
      : undefined;

    const answered = Boolean(
      questionState?.isAnswered ||
      this.selectedOptionService.isAnsweredSubject.getValue() ||
      this.isAnswered ||
      this.displayState?.answered
    );

    const explanationVisible = Boolean(
      this.displayMode$.getValue() === 'explanation' ||
      this.displayState?.mode === 'explanation' ||
      this.shouldDisplayExplanation ||
      this.explanationVisible ||
      this.displayExplanation ||
      this.explanationTextService.shouldDisplayExplanationSource.getValue() ||
      questionState?.explanationDisplayed
    );

    return {
      shouldRestore:
        preserveVisualState &&
        answered &&
        explanationVisible &&
        explanationText.length > 0,
      explanationText,
      questionState
    };
  }

  private restoreExplanationAfterReset(args: {
    questionIndex: number;
    explanationText: string;
    questionState?: QuestionState;
  }): void {
    const normalized = (args.explanationText ?? '').trim();
    if (!normalized) return;

    this.explanationToDisplay = normalized;
    this.emitExplanationToDisplayChange(normalized);

    const ets = this.explanationTextService;
    ets.setExplanationText(normalized);
    ets.setShouldDisplayExplanation(true);
    ets.setIsExplanationTextDisplayed(true);
    ets.setResetComplete(true);
    ets.lockExplanation();

    this.displayMode = 'explanation';
    this.displayMode$.next('explanation');

    this.displayState = { mode: 'explanation', answered: true };
    this.displayStateSubject.next(this.displayState);
    this.displayStateChange.emit(this.displayState);

    this.forceQuestionDisplay = false;
    this.readyForExplanationDisplay = true;
    this.isExplanationReady = true;
    this.isExplanationLocked = false;
    this.explanationLocked = true;
    this.explanationVisible = true;
    this.displayExplanation = true;
    this.shouldDisplayExplanation = true;
    this.isExplanationTextDisplayed = true;

    this.emitShowExplanationChange(true);

    const quizId =
      [
        this.quizId,
        this.quizService.getCurrentQuizId(),
        this.quizService.quizId
      ].find((id) => typeof id === 'string' && id.trim().length > 0) ?? null;

    if (quizId && args.questionState) {
      args.questionState.isAnswered = true;
      args.questionState.explanationDisplayed = true;
      this.quizStateService.setQuestionState(
        quizId,
        args.questionIndex,
        args.questionState
      );
    }
  }

  private canRenderQuestionInstantly(index: number): boolean {
    if (!Array.isArray(this.questionsArray) || this.questionsArray.length === 0) {
      return false;
    }

    if (!Number.isInteger(index) || index < 0 || index >= this.questionsArray.length) {
      return false;
    }

    const candidate = this.questionsArray[index];
    if (!candidate) return false;

    const hasQuestionText =
      typeof candidate?.questionText === 'string' &&
      candidate.questionText.trim().length > 0;
    const options = Array.isArray(candidate.options) ? candidate.options : [];

    return hasQuestionText && options.length > 0;
  }

  private setExplanationFor(idx: number, html: string): void {
    this.explanationOwnerIdx = idx;  // tag ownership
    this.explanationTextService.setExplanationText(html);  // single place that writes
    this.cdRef.markForCheck();
  }

  async updateExplanationText(index: number): Promise<string> {
    const i0 = this.normalizeIndex(index);
    const q = this.questions?.[i0];
    const ets = this.explanationTextService;

    // Hard-align ETS to the current question before doing any work so the
    // per-index emit guard (activeIndex check) cannot short-circuit the emit
    // for questions other than the one it last saw. Without this, the
    // formatted explanation stream may only emit for the previously active
    // index (e.g., Q2) and skip all others.
    if (ets._activeIndex !== i0) {
      ets._activeIndex = i0;
      ets.latestExplanation = '';
    }

    // Allow FET building even if we just switched questions.
    // DO NOT check _fetLocked here. Purge happens elsewhere now.

    // Wait a frame so UI stabilizes before formatting
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Build the raw explanation text
    const cached = (ets.formattedExplanations?.[i0]?.explanation ?? '').trim();
    let baseRaw = (q?.explanation ?? '').toString().trim();

    // Ignore old cached text if user navigated quickly
    if (ets._activeIndex !== i0) {
      baseRaw = baseRaw || '';
    } else if (!baseRaw && cached) {
      baseRaw = cached;
    }

    // Format the explanation via ETS.formatExplanation
    let formatted: string;

    try {
      formatted =
        typeof ets.formatExplanation === 'function'
          ? ets.formatExplanation(
            q,
            q.options
              ?.map((o, i) => (o.correct ? i + 1 : -1))
              .filter((n) => n > 0),
            baseRaw
          )
          : baseRaw;
    } catch (err: any) {
      console.warn('[updateExplanationText] formatter failed, using raw', err);
      formatted = baseRaw;
    }

    const clean = (formatted ?? '').trim();
    const next = clean || baseRaw;

    if (!next) return next;

    // Cache per-index (safe overwrite)
    try {
      const prev = ets.formattedExplanations?.[i0] as any;
      ets.formattedExplanations[i0] = {
        ...(prev ?? {}),
        questionIndex: i0,
        explanation: next
      };
    } catch (err: any) {
      console.warn('[updateExplanationText] cache push failed', err);
    }

    // Only emit if still on the same index
    const stillActive = i0 === this.currentQuestionIndex && ets._activeIndex === i0;

    if (!stillActive) {
      console.log(
        `[🧠 FET] ⏸ Skip emit — index mismatch (Q${i0 + 1}, active=${ets._activeIndex}, current=${this.currentQuestionIndex})`
      );
      return next;
    }

    // Drop duplicate emits
    if (ets.latestExplanation?.trim() === next.trim()) {
      console.log(`[🧠 FET] ⏸ Skip duplicate emit for Q${i0 + 1}`);
      return next;
    }

    // EMIT the formatted explanation
    ets.setExplanationText(next);
    ets.setShouldDisplayExplanation(true);
    ets.setIsExplanationTextDisplayed(true);
    ets.latestExplanation = next;

    this.displayExplanation = true;

    this.quizStateService.displayStateSubject.next({
      mode: 'explanation',
      answered: true
    });

    return next;
  }

  public async handleOptionSelection(
    option: SelectedOption,
    optionIndex: number,
    currentQuestion: QuizQuestion
  ): Promise<void> {
    const questionIndex = this.currentQuestionIndex;

    // Ensure that the option and optionIndex are valid
    if (!option || optionIndex < 0) {
      console.error(
        `Invalid option or optionIndex: ${JSON.stringify(
          option
        )}, index: ${optionIndex}`
      );
      return;
    }

    // Ensure the question index is valid
    if (questionIndex < 0) {
      console.error('[XYZ] Invalid questionIndex < 0:', questionIndex);
      return;
    }

    try {
      const resolvedOptionId = this.resolveStableOptionId(option, optionIndex);
      option.optionId = resolvedOptionId;

      // Toggle option selection state
      option.selected = !option.selected;

      // Process the selected option and update states
      this.processOptionSelection(currentQuestion, option, optionIndex);

      // Update selected option service
      this.selectedOptionService.setAnsweredState(true);
      this.selectedOptionService.updateSelectedOptions(
        questionIndex,
        resolvedOptionId,
        'add'
      );

      // Immediate state synchronization and feedback application
      this.selectedOption = { ...option, correct: option.correct };
      this.showFeedback = true;

      // Apply feedback immediately for the selected option
      void this.applyFeedbackIfNeeded(option);

      // Emit explanation text immediately after feedback
      const explanationText = await this.getExplanationText(this.currentQuestionIndex);
      this.explanationTextService.setExplanationText(explanationText);
      this.explanationText = explanationText;

      // Update the answers and check if the selection is correct
      this.quizService.updateAnswersForOption(option);

      // Update score immediately when correct answer is selected
      try {
        await this.quizService.checkIfAnsweredCorrectly(this.currentQuestionIndex);
      } catch (err: any) {
        console.error('[handleOptionSelection] Error checking correctness:', err);
      }

      const totalCorrectAnswers =
        this.quizService.getTotalCorrectAnswers(currentQuestion);

      // Update the question state in the QuizStateService
      if (!this.quizId) {
        console.error('[updateQuestionState] quizId is missing or invalid');
        return;
      }
      this.quizStateService.updateQuestionState(
        this.quizId,
        this.currentQuestionIndex,
        {
          selectedOptions: [option],
          isCorrect: option.correct ?? false
        },
        totalCorrectAnswers
      );

      // Trigger explanation evaluation immediately
      this.explanationTextService.triggerExplanationEvaluation();

      // Update state
      this.setAnsweredAndDisplayState();
    } catch (error: any) {
      console.error('Error during option selection:', error);
    }
  }

  private processOptionSelection(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    index: number
  ): void {
    // Trigger selection logic (adds/removes selected option)
    void this.handleOptionClicked(currentQuestion, index);

    // Check if this specific option is now selected
    const isOptionSelected = this.selectedOptionService.isSelectedOption(option);

    // Only update explanation display flag if not locked
    if (!this.explanationTextService.isExplanationLocked()) {
      // Only trigger explanation if selected, otherwise ensure it's hidden
      this.explanationTextService.setShouldDisplayExplanation(isOptionSelected);
    } else {
      console.warn(
        '[processOptionSelection] 🛡️ Explanation is locked. Skipping display update.'
      );
    }
  }

  private async waitForQuestionData(): Promise<void> {
    // Clamp bad incoming values (negative / NaN)
    if (!Number.isInteger(this.currentQuestionIndex) || this.currentQuestionIndex < 0) {
      this.currentQuestionIndex = 0;
    }

    this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      .pipe(
        take(1),
        switchMap(async (question) => {
          if (!question) {
            console.warn(
              `[waitForQuestionData] Index ${this.currentQuestionIndex} out of range — clamping to last question`
            );

            // Get the total-question count (single emission)
            const total: number = await firstValueFrom(
              this.quizService.getTotalQuestionsCount(this.quizService.quizId)
                .pipe(take(1))
            );

            this.currentQuestionIndex = Math.max(0, total - 1);

            // Re-query for the clamped index
            question = await firstValueFrom(
              this.quizService.getQuestionByIndex(this.currentQuestionIndex)
                .pipe(take(1))
            );

            if (!question) {
              console.error(
                '[waitForQuestionData] Still no question after clamping — aborting.'
              );
              return;
            }
          }

          // Existing validity check
          if (!question.options?.length) {
            console.error(
              `[waitForQuestionData] ❌ Invalid question data or options missing for index: ${this.currentQuestionIndex}`
            );
            return;
          }

          this.currentQuestion = question;

          // Now set the new options after clearing
          this.optionsToDisplay = [...question.options];

          // Explicitly type options as `Option[]`
          this.quizService.getCurrentOptions(this.currentQuestionIndex)
            .pipe(take(1))
            .subscribe((options: Option[]) => {
              this.optionsToDisplay = Array.isArray(options) ? options : [];  // ensure it's an array

              // Apply feedback immediately if an option was already selected
              const previouslySelectedOption = this.optionsToDisplay.find(
                (opt: Option) => opt.selected
              );
              if (previouslySelectedOption) {
                this.applyOptionFeedback(previouslySelectedOption);
              }
            });

          this.initializeForm();
          this.questionForm.updateValueAndValidity();
          window.scrollTo(0, 0);
        }),
      )
      .subscribe({
        error: (error: Error) =>
          console.error(
            `[waitForQuestionData] ❌ Error loading question data for index ${this.currentQuestionIndex}:`,
            error
          )
      });
  }

  initializeForm(): void {
    if (!this.currentQuestion?.options?.length) {
      console.warn('Question data not ready or options are missing.');
      return;
    }

    const controls = this.currentQuestion.options.reduce(
      (acc, option) => {
        if (option.optionId == null) {
          console.warn('[reduce] Missing optionId for option:', option);
          return acc;
        }

        acc[option.optionId] = new FormControl(false);
        return acc;
      },
      {} as Record<number, FormControl>
    );

    this.questionForm = this.fb.group(controls);
    this.questionForm.updateValueAndValidity();
    this.updateRenderComponentState();
  }

  private updateRenderComponentState(): void {
    // Check if both the form is valid and question data is available
    if (this.isFormValid()) {
      console.info('Both form and question data are ready, rendering component.');
      this.shouldRenderComponent = true;
    } else {
      console.log('Form or question data is not ready yet');
    }
  }

  private isFormValid(): boolean {
    // Check form validity, ensure form is defined
    return this.questionForm?.valid ?? false;
  }

  private async handleOptionClicked(
    currentQuestion: QuizQuestion,
    optionIndex: number,
  ): Promise<void> {
    try {
      if (!currentQuestion || !Array.isArray(currentQuestion.options)) {
        console.warn(
          '[❌ handleOptionClicked] currentQuestion or options is null/invalid',
          currentQuestion
        );
        return;
      }

      // ⚡ FIX: Do NOT overwrite option IDs with display-index based IDs!
      // In shuffled mode, IDs must match the original question IDs stored in Slice/Service.
      // Re-assigning them here using 'currentQuestionIndex' validates against the WRONG question.
      // currentQuestion.options = this.quizService.assignOptionIds(
      //   currentQuestion.options,
      //   this.currentQuestionIndex
      // );

      // Get selected options, but only include those with a valid optionId
      const selectedOptions: Option[] = this.selectedOptionService
        .getSelectedOptionIndices(this.currentQuestionIndex)
        .map((index) => currentQuestion.options[index])
        .filter((option) => option && option.optionId !== undefined);

      // Check if the option is already selected
      const isOptionSelected = selectedOptions.some(
        (option: Option) => option.optionId === optionIndex
      );

      // Add or remove the option based on its current state
      if (!isOptionSelected) {
        this.selectedOptionService.addSelectedOptionIndex(
          this.currentQuestionIndex,
          optionIndex
        );
      } else {
        this.selectedOptionService.removeSelectedOptionIndex(
          this.currentQuestionIndex,
          optionIndex
        );
      }

      // Check if all correct answers are selected
      // Update answered state
      this.selectedOptionService.updateAnsweredState(
        currentQuestion.options,
        this.currentQuestionIndex
      );

      // Ensure the UI reflects the changes
      this.cdRef.markForCheck();
    } catch (error: any) {
      console.error('[handleOptionClicked] Unhandled error:', error);
    }
  }

  private resolveStableOptionId(
    option: Option | null | undefined,
    fallbackIndex: number
  ): number {
    const coerce = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      return null;
    };

    const direct = coerce(option?.optionId);
    if (direct !== null) {
      return direct;
    }

    const fromValue = coerce((option as any)?.value);
    if (fromValue !== null) {
      return fromValue;
    }

    const fromDisplayOrder = coerce((option as any)?.displayOrder);
    if (fromDisplayOrder !== null) return fromDisplayOrder;

    return Math.max(0, fallbackIndex);
  }

  async selectOption(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    optionIndex: number
  ): Promise<void> {
    if (optionIndex < 0) {
      console.error(`Invalid optionIndex ${optionIndex}.`);
      return;
    }

    const resolvedOptionId = this.resolveStableOptionId(option, optionIndex);

    const selectedOption = {
      ...option,
      optionId: resolvedOptionId,
      questionIndex: this.currentQuestionIndex
    };

    this.showFeedbackForOption = { [resolvedOptionId]: true };
    this.selectedOptionService.setSelectedOption(selectedOption);

    // Build a snapshot that mirrors what the user sees (UI order + flags)
    const qIdx = this.quizService.getCurrentQuestionIndex();
    const canonical = (this.quizService.questions?.[qIdx]?.options ?? []).map(
      (o: Option) => ({ ...o })
    );
    const ui = (this.optionsToDisplay ?? []).map((o) => ({ ...o }));

    // Prefer your identity overlay if you have it; otherwise use UI list
    const snapshot: Option[] =
      this.selectedOptionService.overlaySelectedByIdentity?.(canonical, ui) ??
      ui ?? canonical;

    // Coerce optionId safely (0 is valid)
    this.selectedOption = selectedOption;
    await this.selectedOptionService.selectOption(
      resolvedOptionId,
      selectedOption.questionIndex,
      selectedOption.text ?? (selectedOption as any).value ?? '',
      this.isMultipleAnswer,
      snapshot
    );

    this.explanationTextService.setIsExplanationTextDisplayed(true);

    this.quizService.setCurrentQuestion(currentQuestion);

    // Update the selected option in the quiz service and mark the question as answered
    this.selectedOptionService.updateSelectedOptions(
      this.currentQuestionIndex,
      resolvedOptionId,
      'add'
    );

    // Update the selection message based on the new state
    const explanationText =
      (await this.getExplanationText(this.currentQuestionIndex)) ||
      'No explanation available';
    this.explanationTextService.setExplanationText(explanationText);

    // Notify the service to update the explanation text
    if (this.currentQuestion) {
      this.explanationTextService.updateExplanationText(this.currentQuestion);
    } else {
      console.error('Current question is not set.');
    }

    // Set the explanation text in the quiz question manager service
    this.quizQuestionManagerService.setExplanationText(
      currentQuestion.explanation || ''
    );

    // Emit events and update states after the option is selected
    this.isOptionSelected = true;
    this.isAnswered = this.selectedOptions.length > 0;
    this.isAnswerSelectedChange.emit(this.isAnswered);
    this.emitOptionSelected(selectedOption);

    this.selectionChanged.emit({
      question: currentQuestion,
      selectedOptions: this.selectedOptions
    });

    // Set correct message
    this.feedbackService.setCorrectMessage(this.optionsToDisplay);
  }

  unselectOption(): void {
    this.selectedOptions = [];
    this.optionChecked = {};
    this.showFeedbackForOption = {};
    this.showFeedback = false;
    this.selectedOption = null;
    this.selectedOptionService.clearSelectionsForQuestion(this.currentQuestionIndex);
    this.quizQuestionManagerService.setExplanationText('');
  }

  // Helper method to clear explanation
  resetExplanation(force: boolean = false): void {
    // Reset local component state
    this.displayExplanation = false;  // hide explanation display
    this.explanationToDisplay = '';  // clear local explanation text

    // Always reset the internal explanation text state (service first)
    this.explanationTextService.resetExplanationText();

    // Determine current question index for per-question locking (if supported)
    const qIndex = this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0;

    // If lock exists, only skip when *not* forced
    const locked = this.explanationTextService.isExplanationLocked();  // fallback to legacy
    if (!force && locked) {
      console.log('[🛡️ resetExplanation] Blocked — lock is active.', { qIndex });
      return;
    }

    // Clear display flags in the service (do this BEFORE emitting to parent)
    this.explanationTextService.setShouldDisplayExplanation(false);

    // Reset display state so templates go back to question mode
    this.quizStateService.setDisplayState({ mode: 'question', answered: false });
    this.quizStateService.setAnswerSelected(false);

    // Emit cleared states to parent components
    this.emitExplanationToDisplayChange('');  // inform parent: explanation cleared
    this.emitShowExplanationChange(false);  // inform parent: hide explanation

    // Mark reset complete (true, not false) so listeners don’t wait forever
    this.explanationTextService.setResetComplete(true);

    this.cdRef.markForCheck();
  }

  async prepareAndSetExplanationText(questionIndex: number): Promise<string> {
    if (document.hidden) {
      this.explanationToDisplay =
        'Explanation text not available when document is hidden.';
      return this.explanationToDisplay;
    }

    try {
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );
      if (!questionData) {
        console.error(
          `[getQuestionByIndex] No question found for index ${questionIndex}`
        );
        return '';
      }

      // Format the explanation using ExplanationTextService
      const rawExplanation = questionData.explanation || 'No explanation available';

      // Use locally displayed options if available and indices match
      // AND verify the question text matches to avoid using Q1 options for Q2 FET
      const useLocalOptions =
        this.optionsToDisplay?.length > 0 &&
        questionIndex === (this.currentQuestionIndex ?? -1) &&
        this.currentQuestion?.questionText === questionData.questionText;

      const correctIndices =
        this.explanationTextService.getCorrectOptionIndices(
          questionData,
          useLocalOptions ? this.optionsToDisplay : undefined
        );
      const formattedExplanation =
        this.explanationTextService.formatExplanation(
          questionData,
          correctIndices,
          rawExplanation
        );

      this.explanationToDisplay = formattedExplanation;

      // Sync to service cache immediately
      this.explanationTextService.storeFormattedExplanation(
        questionIndex,
        formattedExplanation,
        questionData
      );

      return formattedExplanation;
    } catch (error: any) {
      console.error('Error in fetching explanation text:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      this.explanationToDisplay = 'Error fetching explanation.';
    }

    return this.explanationToDisplay;
  }

  public async fetchAndSetExplanationText(questionIndex: number): Promise<void> {
    this.resetExplanation();  // clear any previous explanation state

    try {
      // Ensure the questions array is loaded only once, without retries
      const questionsLoaded = await this.ensureQuestionsLoaded();

      // Exit early if loading was unsuccessful
      if (!questionsLoaded || !this.questionsArray || this.questionsArray.length === 0) {
        console.error(
          'Failed to load questions or questions array is empty. Aborting explanation fetch.'
        );
        return;
      }

      // Check if the specified question index is valid in the array
      if (!this.questionsArray[questionIndex]) {
        console.error(
          `Questions array is not properly populated or invalid index: ${questionIndex}`
        );
        return;
      }

      // Ensure question data is fully loaded before fetching explanation
      await this.ensureQuestionIsFullyLoaded(questionIndex);

      // Prepare and fetch explanation text using observable
      const explanation$ = from(
        this.prepareAndSetExplanationText(questionIndex)
      ).pipe(
        debounceTime(100)  // smooth out updates
      );

      explanation$.subscribe({
        next: async (explanationText: string) => {
          if (await this.isAnyOptionSelected(questionIndex)) {
            this.currentQuestionIndex = questionIndex;

            const finalExplanation = explanationText || 'No explanation available';
            this.explanationToDisplay = finalExplanation;
            this.explanationTextService.setExplanationText(finalExplanation);
            this.explanationTextService.setShouldDisplayExplanation(true);
            this.shouldDisplayExplanation = true;
            this.emitExplanationToDisplayChange(finalExplanation);
          } else {
            console.log(
              `Skipping explanation for unanswered question ${questionIndex}.`
            );
          }
        },
        error: (error: Error) => {
          console.error(
            `Error fetching explanation for question ${questionIndex}:`, error
          );
          this.handleExplanationError();
        },
      });
    } catch (error: any) {
      console.error(
        `Error fetching explanation for question ${questionIndex}:`,
        error
      );
      this.handleExplanationError();
    }
  }

  private handleExplanationError(): void {
    this.explanationToDisplay = 'Error fetching explanation. Please try again.';
    if (this.isAnswered && this.shouldDisplayExplanation) {
      this.emitExplanationToDisplayChange(this.explanationToDisplay);
      this.emitShowExplanationChange(true);
    }
  }

  private async ensureQuestionIsFullyLoaded(index: number): Promise<void> {
    if (!this.questionsArray || this.questionsArray.length === 0) {
      console.error('Questions array is not loaded yet. Loading questions...');
      await this.loadQuizData();  // ensure the data is loaded

      // Re-check if the questions are loaded after the loading step
      if (!this.questionsArray || this.questionsArray.length === 0) {
        console.error('Questions array still not loaded after loading attempt.');
        throw new Error('Failed to load questions array.');
      }
    }

    if (index < 0 || index >= this.questionsArray.length) {
      console.error(
        `Invalid index ${index}. Must be between 0 and ${this.questionsArray.length - 1
        }.`
      );
      throw new Error(`Invalid index ${index}. No such question exists.`);
    }

    return new Promise((resolve, reject) => {
      let subscription: Subscription | undefined;

      try {
        subscription = this.quizService.getQuestionByIndex(index).subscribe({
          next: (question) => {
            if (question && question.questionText) {
              console.log(`Question loaded for index ${index}:`, question);
              subscription?.unsubscribe();
              resolve();  // successfully loaded
            } else {
              reject(new Error(`No valid question at index ${index}`));
            }
          },
          error: (err: Error) => {
            console.error(`Error loading question at index ${index}:`, err);
            subscription?.unsubscribe();
            reject(err);
          },
        });
      } catch (error) {
        reject(error);  // reject for unexpected error
      }
    });
  }

  public async getExplanationText(questionIndex: number): Promise<string> {
    try {
      if (!this.explanationTextService.explanationsInitialized) {
        console.warn(
          `[getExplanationText] ⏳ Explanations not initialized — returning fallback for Q${questionIndex}`
        );
        return 'No explanation available for this question.';
      }

      const explanation$ =
        this.explanationTextService.getFormattedExplanationTextForQuestion(
          questionIndex
        );
      const explanationText = await firstValueFrom(explanation$);

      const trimmed = explanationText?.trim();
      if (!trimmed) {
        console.warn(
          `[getExplanationText] ⚠️ Empty or undefined explanation for Q${questionIndex}. Using fallback.`
        );
        return 'No explanation available for this question.';
      }

      return trimmed;
    } catch (error: any) {
      console.error(
        `[getExplanationText] ❌ Error fetching explanation for Q${questionIndex}:`,
        error
      );
      return 'Error loading explanation.';
    }
  }

  private updateExplanationUI(
    questionIndex: number,
    explanationText: string
  ): void {
    // Validate if questions are loaded and the array is non-empty
    if (!this.questionsArray || this.questionsArray.length === 0) {
      console.warn('Questions not loaded yet. Skipping explanation update.');
      return;
    }

    // Ensure the index is within valid bounds
    const adjustedIndex = Math.max(
      0,
      Math.min(questionIndex, this.questionsArray.length - 1)
    );
    const currentQuestion = this.questionsArray[adjustedIndex];

    // Validate that the current question exists
    if (!currentQuestion) {
      console.error(`Question not found at index: ${adjustedIndex}`);
      return;
    }

    try {
      // Set the question and trigger a re-render
      if (currentQuestion) {
        this.quizService.setCurrentQuestion(currentQuestion);
      }

      // Wait for the question to be rendered before updating the explanation
      this.waitForQuestionRendering()
        .then(async () => {
          if (
            this.shouldDisplayExplanation &&
            (await this.isAnyOptionSelected(adjustedIndex))
          ) {
            // Clear any previous explanation state
            this.clearExplanationState();
            this.explanationToDisplay = explanationText;
            this.emitExplanationToDisplayChange(this.explanationToDisplay);
            this.emitShowExplanationChange(true);

            // Update combined question data with the current explanation
            this.updateCombinedQuestionData(currentQuestion, explanationText);
            this.isAnswerSelectedChange.emit(true);
          } else {
            console.log(
              `Question ${adjustedIndex} is not answered. Skipping explanation update.`,
            );
          }
        })
        .catch((renderError: Error) => {
          console.error('Error during question rendering wait:', renderError);
        });
    } catch (error: any) {
      console.error('Error in setting current question or updating explanation:', error);
    }
  }

  private waitForQuestionRendering(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  private clearExplanationState(): void {
    this.emitExplanationToDisplayChange('');
    this.emitShowExplanationChange(false);
  }

  updateCombinedQuestionData(
    currentQuestion: QuizQuestion,
    explanationText: string
  ): void {
    this.combinedQuestionData$.next({
      questionText: currentQuestion?.questionText || '',
      explanationText: explanationText,
      correctAnswersText: this.quizService.getCorrectAnswersAsString(),
      currentOptions: this.currentOptions ?? []
    });
  }

  async onSubmit(): Promise<void> {
    if (!this.validateForm()) {
      return;
    }

    // Find which optionId is selected
    const entries = Object.entries(this.questionForm.value);
    const selectedEntry = entries.find(([_, value]) => value === true);

    if (!selectedEntry) {
      console.warn('[onSubmit] No option selected');
      return;
    }

    const selectedOptionId = Number(selectedEntry[0]);

    // Get the full SelectedOption object
    const selectedOptionObj = this.optionsToDisplay.find(
      (o: Option) => o.optionId === selectedOptionId
    );
    if (!selectedOptionObj) {
      console.error('[onSubmit] Selected option object not found');
      return;
    }

    // Pass the FULL SelectedOption, not the number
    await this.processAnswer(selectedOptionObj);

    this.questionAnswered.emit();
  }

  private validateForm(): boolean {
    if (this.questionForm.invalid) {
      console.log('Form is invalid');
      return false;
    }

    // Extract all control values (true/false)
    const values = Object.values(this.questionForm.value);

    // Check if any option was selected
    const anySelected = values.some((v) => v === true);

    if (!anySelected) {
      console.log('No option selected');
      return false;
    }

    return true;
  }

  private async processAnswer(
    selectedOption: SelectedOption,
  ): Promise<boolean> {
    if (!this.currentQuestion) {
      console.error('[processAnswer] currentQuestion is null or undefined');
      return false;
    }

    if (
      !selectedOption ||
      !this.currentQuestion.options.find(
        (opt: Option) => opt.optionId === selectedOption.optionId
      )
    ) {
      console.error('Invalid or unselected option.');
      return false;
    }

    this.answers.push({
      question: this.currentQuestion,
      questionIndex: this.currentQuestionIndex,
      selectedOption: selectedOption
    });

    // Sync the selected option to QuizService so checkIfAnsweredCorrectly has the data
    this.quizService.updateAnswersForOption(selectedOption);

    let isCorrect = false;
    try {
      // ROBUST INDEX RESOLUTION: Prefer Service Index if > 0, else Input Index
      const effectiveIndex = this.quizService.currentQuestionIndex > 0
        ? this.quizService.currentQuestionIndex
        : this.currentQuestionIndex;

      isCorrect = await this.quizService.checkIfAnsweredCorrectly(effectiveIndex);
    } catch (error: any) {
      console.error('Error checking answer correctness:', error);
    }

    const explanationText = this.currentQuestion.explanation;
    const quizId = this.quizService.getCurrentQuizId();
    const questionId = this.currentQuestionIndex;

    // Update the state to include the selected option and adjust the number of correct answers
    const selectedOptions = this.currentQuestion.selectedOptions || [];
    selectedOptions.push(selectedOption); // add the newly selected option
    const numberOfCorrectAnswers = selectedOptions.filter(
      (opt: Option) => opt.correct
    ).length;

    this.quizStateService.setQuestionState(quizId, questionId, {
      isAnswered: true,
      isCorrect: isCorrect,
      explanationText: explanationText,
      selectedOptions: selectedOptions,
      numberOfCorrectAnswers: numberOfCorrectAnswers
    });

    return isCorrect;
  }

  // Helper method to handle question and selectedOptions changes
  private handleQuestionAndOptionsChange(
    currentQuestionChange: SimpleChange,
    optionsChange: SimpleChange
  ): void {
    const nextQuestion =
      (currentQuestionChange
        ? (currentQuestionChange.currentValue as QuizQuestion) : null) ?? null;

    if (nextQuestion) this.currentQuestion = nextQuestion;

    const incomingOptions =
      (optionsChange?.currentValue as Option[]) ??
      nextQuestion?.options ??
      currentQuestionChange?.currentValue?.options ??
      null;

    const effectiveQuestion = nextQuestion ?? this.currentQuestion ?? null;
    const normalizedOptions = this.refreshOptionsForQuestion(
      effectiveQuestion,
      incomingOptions
    );

    const selectedOptionValues = (effectiveQuestion?.selectedOptions ?? [])
      .map((opt: any) => {
        if (opt == null) return null;

        if (typeof opt === 'object') {
          return opt.value ?? opt.optionId ?? opt.text ?? null;
        }

        return opt;
      })
      .filter((value) => value != null);

    if (effectiveQuestion) {
      this.quizService.handleQuestionChange(
        effectiveQuestion,
        selectedOptionValues,
        normalizedOptions
      );
    } else if (optionsChange) {
      this.quizService.handleQuestionChange(
        null,
        selectedOptionValues,
        normalizedOptions
      );
      console.warn(
        'QuizQuestionComponent - ngOnChanges - Question is undefined after change.'
      );
    }

    // DIRECT SYNC: Ensure dynamic component is loaded with the new data
    // This bypasses unreliable QuizNavigationService events
    if (effectiveQuestion && normalizedOptions?.length) {
      void this.loadDynamicComponent(effectiveQuestion, normalizedOptions);
    }
  }

  // Synchronizes the local option inputs with the currently active question,
  // important for randomization/shuffling
  private refreshOptionsForQuestion(
    question: QuizQuestion | null,
    providedOptions?: Option[] | null
  ): Option[] {
    const baseOptions =
      Array.isArray(providedOptions) && providedOptions.length
        ? providedOptions
        : Array.isArray(question?.options)
          ? question!.options
          : [];

    if (!baseOptions.length) {
      console.warn(
        '[refreshOptionsForQuestion] No options found for the current question.'
      );
      this.optionsToDisplay = [];
      this.options = [];
      return [];
    }

    const normalizedOptions = this.quizService.assignOptionIds(
      baseOptions.map((option) => ({ ...option })),
      this.currentQuestionIndex
    );

    this.options = normalizedOptions;
    this.optionsToDisplay = normalizedOptions.map((option, index) => ({
      ...option,
      optionId: option.optionId ?? index + 1,
      selected: !!option.selected,
      showIcon: option.showIcon ?? false
    }));

    // Propagate the updated list through the quiz service so downstream consumers stay in sync.
    if (this.optionsToDisplay.length > 0) {
      this.quizService.setOptions(
        this.optionsToDisplay.map((option) => ({ ...option }))
      );
    }

    this.cdRef.markForCheck();
    return normalizedOptions;
  }

  clearSoundFlagsForCurrentQuestion(index: number): void {
    this.soundService.clearPlayedOptionsForQuestion(index);
  }

  private clearOptionStateForQuestion(index: number): void {
    this.selectedOptionService.clearSelectionsForQuestion(index);

    for (const opt of this.optionsToDisplay ?? []) {
      opt.selected = false;
      opt.showIcon = false;
    }

    this.cdRef.detectChanges();
  }

  restoreSelectionsAndIconsForQuestion(index: number) {
    const selectedOptions =
      this.selectedOptionService.getSelectedOptionsForQuestion(index);
    for (const opt of this.optionsToDisplay ?? []) {
      const match = selectedOptions.find(
        sel => sel.optionId === opt.optionId
      );

      opt.selected = !!match;
      opt.showIcon = !!match?.showIcon;
    }

    this.cdRef.detectChanges();
  }

  private hardResetClickGuards(): void {
    this._clickGate = false;
    this.waitingForReady = false;
    this.deferredClick = undefined;
    this.lastLoggedQuestionIndex = -1;
    this.lastLoggedIndex = -1;
    this.selectedIndices.clear();
  }

  // Per-question next and selections reset done from the child, timer
  public resetPerQuestionState(index: number): void {
    const i0 = this.normalizeIndex(index);
    const existingSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(i0) ?? [];
    const hasSelections = existingSelections.length > 0;

    // Stop any in-flight UI work
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }
    this._skipNextAsyncUpdates = false;

    // Unlock and clear per-question selection/locks
    this.selectedOptionService.resetLocksForQuestion(i0);
    if (!hasSelections) {
      this.selectedOptionService.clearSelectionsForQuestion(i0);
    } else {
      this.selectedOptionService.republishFeedbackForQuestion(i0);
    }

    this.sharedOptionComponent?.clearForceDisableAllOptions();

    // Ensure any previous expiry guards are cleared for this question
    this.handledOnExpiry.delete(i0);
    this.timerService.resetTimerFlagsFor(i0);

    // Reset disable/feedback maps
    this.feedbackConfigs = {};
    this.lastFeedbackOptionId = -1;

    if (hasSelections) {
      const feedbackMap = this.selectedOptionService.getFeedbackForQuestion(i0);
      this.showFeedbackForOption = { ...feedbackMap };
      this.restoreSelectionsAndIconsForQuestion(i0);
    } else {
      this.showFeedbackForOption = {};
    }

    // Explanation and display mode
    if (hasSelections) {
      this.displayExplanation = true;
      this.showExplanationChange?.emit(true);
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
      this.quizStateService.setAnswered(true);
      this.quizStateService.setAnswerSelected(true);
      this.displayMode = 'explanation';
      this.displayMode$.next('explanation');
    } else {
      this.displayExplanation = false;
      this.explanationToDisplay = '';
      this.explanationToDisplayChange?.emit('');
      this.showExplanationChange?.emit(false);
      this.explanationOwnerIdx = -1;

      this.explanationTextService.unlockExplanation?.();
      this.explanationTextService.resetExplanationText();
      this.explanationTextService.setShouldDisplayExplanation(false);

      this.quizStateService.setDisplayState({ mode: 'question', answered: false });
      this.quizStateService.setAnswered(false);
      this.quizStateService.setAnswerSelected(false);
      this.displayMode = 'question';
      this.displayMode$.next('question');
    }

    // “Fresh question” guard so nothing is disabled on load
    this.questionFresh = true;
    this.timedOut = false;

    // Fresh question: clear timer guards
    this._timerStoppedForQuestion = false;
    this._lastAllCorrect = false;

    // Form state
    try {
      this.questionForm?.enable({ emitEvent: false });
    } catch { }

    // Clear any click dedupe/log cosmetics
    this.lastLoggedIndex = -1;
    this.lastLoggedQuestionIndex = -1;

    // Prewarm explanation cache (no UI toggles here)
    void this.resolveFormatted(i0, { useCache: true, setCache: true });

    // Timer reset/restart
    this.timerService.stopTimer(undefined, { force: true });
    this.timerService.resetTimer();
    requestAnimationFrame(() =>
      this.timerService.startTimer(this.timerService.timePerQuestion, true, true)
    );
    queueMicrotask(() => this.applyPassiveWriteGate(index));

    // Render
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }

  // One call to reset everything the child controls for a given question
  public resetForQuestion(index: number): void {
    this.hardResetClickGuards();
    this.resetExplanation(true);
    this.resetPerQuestionState(index);
  }

  // Called when the countdown hits zero
  private async onTimerExpiredFor(index: number): Promise<void> {
    const i0 = this.normalizeIndex(index);
    if (this.handledOnExpiry.has(i0)) return;
    this.handledOnExpiry.add(i0);

    // Ensure the active question locks immediately when time runs out,
    // even if the timer service's expired$ signal is delayed.
    this.onQuestionTimedOut(i0);

    // Flip into explanation mode and enable Next immediately
    this.ngZone.run(() => {
      this.timerService.stopTimer(undefined, { force: true });

      this.explanationTextService.setShouldDisplayExplanation(true);
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
      this.quizStateService.setAnswered(true);
      this.quizStateService.setAnswerSelected(true);

      const qType = this.questions[i0]?.type ?? this.currentQuestion?.type;
      if (qType === QuestionType.MultipleAnswer) {
        try {
          this.selectedOptionService.evaluateNextButtonStateForQuestion(
            i0,
            true,
            true
          );
        } catch { }
      } else {
        try {
          this.selectedOptionService.setAnswered(true);
        } catch { }
        try {
          this.nextButtonStateService.setNextButtonState(true);
        } catch { }
      }

      // Wipe any leftover feedback text
      this.feedbackText = '';
      this.displayExplanation = true;
      this.showExplanationChange?.emit(true);

      this.cdRef.markForCheck();
    });

    // Pin context to this index and try to get formatted NOW
    const prevFixed = this.fixedQuestionIndex;
    const prevCur = this.currentQuestionIndex;
    try {
      this.fixedQuestionIndex = i0;
      this.currentQuestionIndex = i0;

      const ets = this.explanationTextService;

      // Wait if the explanation gate is still locked
      if (ets._fetLocked) {
        console.log(
          `[onOptionClicked] Waiting for FET unlock before processing Q${this.currentQuestionIndex + 1}`
        );
        await new Promise((res) => setTimeout(res, 60));
      }

      // Compute formatted by index; this now uses the proper formatter signature
      const formattedNow =
        (await this.updateExplanationText(i0))?.toString().trim() ?? '';

      // Guard: skip empty or placeholder text, but wait one frame before giving up
      if (
        !formattedNow || formattedNow === 'No explanation available for this question.'
      ) {
        console.log(
          `[QQC] 💤 Explanation not ready for Q${i0 + 1} — deferring emit by one frame.`,
        );

        // Wait one paint frame before re-checking
        await new Promise(requestAnimationFrame);

        const retry =
          (await this.updateExplanationText(i0))?.toString().trim() ?? '';
        if (!retry || retry === 'No explanation available for this question.') {
          console.log(
            `[QQC] ⚠️ Still no explanation for Q${i0 + 1} — skipping emit.`,
          );
          return;  // don’t emit placeholder
        }

        // Use the retried value instead
        ets.emitFormatted(i0, retry);
        this.ngZone.run(() => {
          this.explanationToDisplay = retry;
          this.emitExplanationToDisplayChange(retry);
          this.cdRef.markForCheck();
          this.cdRef.detectChanges();
        });
        return;
      }

      ets.emitFormatted(i0, formattedNow);

      // We already wrote to the stream inside updateExplanationText if still on i0,
      // but ensure the local mirrors are updated too.
      this.ngZone.run(() => {
        this.explanationToDisplay = formattedNow;
        this.emitExplanationToDisplayChange(formattedNow);
        this.cdRef.markForCheck();
        this.cdRef.detectChanges();
      });

      // If no formatted text exists, fall back to the best available raw value to keep the UI stable
      const rawBest =
        ((this.questions[i0]?.explanation ?? '') as string).toString().trim() ||
        ((ets.formattedExplanations[i0].explanation ?? '') as string).toString().trim() ||
        'Explanation not available.';

      this.ngZone.run(() => {
        ets.setExplanationText(rawBest);
        this.explanationToDisplay = rawBest;
        this.emitExplanationToDisplayChange(rawBest);
        this.cdRef.markForCheck();
        this.cdRef.detectChanges();
      });

      this.resolveFormatted(i0, { useCache: true, setCache: true, timeoutMs: 6000 })
        .then((clean) => {
          const out = (clean ?? '').toString().trim();
          if (!out) return;
          const active =
            this.normalizeIndex?.(
              this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0
            ) ??
            this.currentQuestionIndex ??
            0;
          if (active !== i0) return;
          this.ngZone.run(() => {
            ets.setExplanationText(out);
            this.explanationToDisplay = out;
            this.emitExplanationToDisplayChange(out);
            this.cdRef.markForCheck();
            this.cdRef.detectChanges();
          });
        })
        .catch(() => { });
    } catch (err: any) {
      console.warn('[onTimerExpiredFor] failed; using raw', err);
    } finally {
      this.fixedQuestionIndex = prevFixed;
      this.currentQuestionIndex = prevCur;
    }
  }

  // Always return a 0-based index that exists in `this.questions`
  private normalizeIndex(idx: number): number {
    if (!Number.isFinite(idx)) return 0;

    const normalized = Math.trunc(idx);

    if (!this.questions || this.questions.length === 0)
      return normalized >= 0 ? normalized : 0;
    if (this.questions[normalized] != null) return normalized;

    const potentialOneBased = normalized - 1;
    const looksOneBased =
      normalized === potentialOneBased + 1 &&
      potentialOneBased >= 0 &&
      potentialOneBased < this.questions.length &&
      this.questions[potentialOneBased] != null;

    if (looksOneBased) return potentialOneBased;

    return Math.min(Math.max(normalized, 0), this.questions.length - 1);
  }

  private async resolveFormatted(
    index: number,
    opts: { useCache?: boolean; setCache?: boolean; timeoutMs?: number } = {}
  ): Promise<string> {
    const i0 = this.normalizeIndex(index);
    const { useCache = true, setCache = true, timeoutMs = 1200 } = opts;

    if (useCache) {
      const hit = this._formattedByIndex.get(i0);
      if (hit) return hit;
    }

    const prevFixed = this.fixedQuestionIndex;
    const prevCur = this.currentQuestionIndex;

    try {
      // Force the formatter to operate on this question
      this.fixedQuestionIndex = i0;
      this.currentQuestionIndex = i0;

      // Try direct return first
      const out = await this.updateExplanationText(i0);
      let text = (out ?? '').toString().trim();

      // Fallback: formatter writes to a stream
      if (
        (!text || text === 'No explanation available for this question.') &&
        this.explanationTextService.formattedExplanation$
      ) {
        const src$ = this.explanationTextService
          .formattedExplanation$ as Observable<string | null | undefined>;

        const formatted$: Observable<string> = src$.pipe(
          filter(
            (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0
          ),
          map((s: any) => s.trim()),
          timeout(timeoutMs),
          take(1)
        );

        try {
          text = await firstValueFrom(formatted$);
        } catch {
          text = '';
        }
      }

      // Final check — only emit real explanation text
      if (!text || text === 'No explanation available for this question.') {
        console.log(`[QQC] 💤 Explanation not ready for Q${i0 + 1} — skipping emit.`);
        return '';
      }

      if (text && setCache) this._formattedByIndex.set(i0, text);
      return text;
    } catch (err) {
      console.warn('[resolveFormatted] failed', i0, err);
      return '';
    } finally {
      this.fixedQuestionIndex = prevFixed;
      this.currentQuestionIndex = prevCur;
    }
  }

  private applyPassiveWriteGate(index: number): void {
    const i0 = this.normalizeIndex ? this.normalizeIndex(index) : index;

    // Apply a short write-gate (helps prevent flicker)
    this.selectionMessageService.beginWrite(i0, 200);
  }

  public revealFeedbackForAllOptions(canonicalOpts: Option[], timedOut = false): void {
    // Reveal feedback for EVERY option before any locking/disable runs
    for (let i = 0; i < canonicalOpts.length; i++) {
      const o = canonicalOpts[i];

      // Prefer numeric optionId; fall back to a stable key WITH index
      const rawKey = o.optionId ?? this.selectionMessageService.stableKey(o, i);
      const key = Number(rawKey);

      // Decide how to handle numeric vs. string keys safely
      if (Number.isFinite(key)) {
        // Numeric key path
        this.feedbackConfigs[key] = {
          ...(this.feedbackConfigs[key] ?? {}),
          showFeedback: true,
          icon: o.correct ? 'check_circle' : 'cancel',
          isCorrect: !!o.correct,
          timedOut
        };

        this.showFeedbackForOption[key] = true;

        // Also update sharedOptionComponent.feedbackConfigs for FeedbackComponent
        if (this.sharedOptionComponent?.feedbackConfigs) {
          this.sharedOptionComponent.feedbackConfigs[key] = {
            ...(this.sharedOptionComponent.feedbackConfigs[key] ?? {}),
            showFeedback: true,
            timedOut
          } as any;
        }
      } else {
        // Fallback: non-numeric key path
        const sk = String(rawKey);
        if (!sk) return;

        this.feedbackConfigs[sk] = {
          ...(this.feedbackConfigs[sk] ?? {}),
          showFeedback: true,
          icon: o.correct ? 'check_circle' : 'cancel',
          isCorrect: !!o.correct,
          timedOut
        };

        this.showFeedbackForOption[sk] = true;

        // Also update sharedOptionComponent.feedbackConfigs for FeedbackComponent
        if (this.sharedOptionComponent?.feedbackConfigs) {
          this.sharedOptionComponent.feedbackConfigs[sk] = {
            ...(this.sharedOptionComponent.feedbackConfigs[sk] ?? {}),
            showFeedback: true,
            timedOut
          } as any;
        }
      }

      this.feedbackConfigs[key] = {
        ...(this.feedbackConfigs[key] ?? {}),
        showFeedback: true,
        icon: o.correct ? 'check_circle' : 'cancel',
        isCorrect: !!o.correct,
        timedOut
      };
      this.showFeedbackForOption[key] = true;
    }

    // Trigger view update
    this.cdRef.markForCheck();
  }

  private updateShouldRenderOptions(
    options: Option[] | null | undefined
  ): void {
    const hasRenderableOptions = Array.isArray(options) && options.length > 0;

    if (this.shouldRenderOptions !== hasRenderableOptions) {
      this.shouldRenderOptions = hasRenderableOptions;
      this.cdRef.markForCheck();
    }
  }

  private applyDisplayOrder(options: Option[] | null | undefined): Option[] {
    if (!Array.isArray(options)) return [];
    return options.map((option, index) => ({
      ...option,
      displayOrder: index
    }));
  }

  private normalizeQuestionIndex(idx: number): number {
    if (!Number.isFinite(idx as number)) return 0;
  
    const n = Math.trunc(idx as number);
  
    // If something passes 1-based (Q1 = 1), convert to 0-based (Q1 = 0)
    // This prevents Q1-only mismatches between storage/read pipelines.
    if (n >= 1) return n - 1;
  
    return n;
  }
}
