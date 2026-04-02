import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ComponentRef, ComponentFactoryResolver, ElementRef, EventEmitter, HostListener,
  Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChange, SimpleChanges, ViewChild, ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, from, Observable, of, ReplaySubject, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, skip, switchMap, take, takeUntil, tap, timeout } from 'rxjs/operators';
import { MatCheckbox, MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioButton, MatRadioModule } from '@angular/material/radio';
import { firstValueFrom } from '../../../shared/utils/rxjs-compat';
import { AnswerComponent } from '../answer/answer-component/answer.component';

import { QuestionType } from '../../../shared/models/question-type.enum';
import { Utils } from '../../../shared/utils/utils';
import { CanonicalOption } from '../../../shared/models/CanonicalOption.model';
import { FormattedExplanation } from '../../../shared/models/FormattedExplanation.model';
import { FeedbackProps } from '../../../shared/models/FeedbackProps.model';
import { Option } from '../../../shared/models/Option.model';
import { OptionBindings } from '../../../shared/models/OptionBindings.model';
import { QuestionPayload } from '../../../shared/models/QuestionPayload.model';
import { QuestionState } from '../../../shared/models/QuestionState.model';
import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { SelectedOption } from '../../../shared/models/SelectedOption.model';
import { QuizQuestionEvent } from '../../../shared/models/QuizQuestionEvent.type';
import { SharedOptionConfig } from '../../../shared/models/SharedOptionConfig.model';
import { FeedbackService } from '../../../shared/services/features/feedback.service';
import { QuizService } from '../../../shared/services/data/quiz.service';
import { QuizDataService } from '../../../shared/services/data/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/flow/quiz-navigation.service';
import { QuizStateService } from '../../../shared/services/state/quizstate.service';
import { QuizQuestionLoaderService } from '../../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/flow/quizquestionmgr.service';
import { DynamicComponentService } from '../../../shared/services/ui/dynamic-component.service';
import { ExplanationTextService } from '../../../shared/services/features/explanation-text.service';
import { NextButtonStateService } from '../../../shared/services/state/next-button-state.service';
import { ResetBackgroundService } from '../../../shared/services/ui/reset-background.service';
import { ResetStateService } from '../../../shared/services/state/reset-state.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../../shared/services/features/selection-message.service';
import { SharedVisibilityService } from '../../../shared/services/ui/shared-visibility.service';
import { SoundService } from '../../../shared/services/ui/sound.service';
import { TimerService } from '../../../shared/services/features/timer.service';
import { QqcStatePersistenceService } from '../../../shared/services/state/qqc-state-persistence.service';
import { QqcExplanationManagerService } from '../../../shared/services/features/qqc-explanation-manager.service';
import { QqcTimerEffectService } from '../../../shared/services/features/qqc-timer-effect.service';
import { QqcFeedbackManagerService } from '../../../shared/services/features/qqc-feedback-manager.service';
import { QqcOptionSelectionService } from '../../../shared/services/features/qqc-option-selection.service';
import { QqcExplanationDisplayService } from '../../../shared/services/features/qqc-explanation-display.service';
import { QqcResetManagerService } from '../../../shared/services/features/qqc-reset-manager.service';
import { QqcOptionClickOrchestratorService } from '../../../shared/services/features/qqc-option-click-orchestrator.service';
import { QqcNavigationHandlerService } from '../../../shared/services/features/qqc-navigation-handler.service';
import { QqcInitializerService } from '../../../shared/services/features/qqc-initializer.service';
import { QqcQuestionLoaderService } from '../../../shared/services/features/qqc-question-loader.service';
import { QuizShuffleService } from '../../../shared/services/flow/quiz-shuffle.service';
import { BaseQuestion } from '../base/base-question';
import { SharedOptionComponent } from '../../../components/question/answer/shared-option-component/shared-option.component';

type FeedbackKey = number | string;

export interface FeedbackConfig {
  showFeedback: boolean,
  isCorrect?: boolean,
  icon?: string,
  text?: string
}


@Component({
  selector: 'codelab-quiz-question',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule
  ],
  templateUrl: './quiz-question.component.html',
  styleUrls: ['./quiz-question.component.scss'],
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
    mode: 'question' | 'explanation',
    answered: boolean
  }>();
  @Output() feedbackApplied = new EventEmitter<number>();
  @Output() nextButtonState = new EventEmitter<boolean>();
  @Output() questionAndOptionsReady = new EventEmitter<void>();

  @Input() data!: {
    questionText: string,
    explanationText?: string,
    correctAnswersText?: string,
    options: Option[]
  };
  @Input() questionData!: QuizQuestion;
  @Input() override question!: QuizQuestion;
  @Input() question$!: Observable<QuizQuestion>;
  @Input() questions$: Observable<QuizQuestion[]> = new Observable<QuizQuestion[]>();
  @Input() options!: Option[];
  @Input() override optionsToDisplay: Option[] = [];
  @Input() currentQuestion: QuizQuestion | null = null;
  @Input() currentQuestion$: Observable<QuizQuestion | null> = of(null);
  @Input() currentQuestionIndex = 0;
  @Input() previousQuestionIndex!: number;
  @Input() quizId: string | null | undefined = '';
  @Input() multipleAnswer: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  @Input() explanationText!: string | null;
  @Input() isOptionSelected = false;
  @Input() override showFeedback = false;
  @Input() selectionMessage!: string;
  @Input() reset!: boolean;
  @Input() override explanationToDisplay = '';
  @Input() passedOptions: Option[] | null = null;
  @Input() questionToDisplay$!: Observable<string>;
  @Input() displayState$!: Observable<{ mode: 'question' | 'explanation'; answered: boolean }>;
  @Input() explanation!: string;
  @Input() shouldRenderOptions = false;
  quiz!: Quiz | null;
  private _multiAnswerSelections = new Map<number, Set<number>>();
  selectedQuiz = new ReplaySubject<Quiz>(1);
  questions: QuizQuestion[] = [];
  questionsArray: QuizQuestion[] = [];
  questionsObservableSubscription!: Subscription;
  override questionForm: FormGroup = new FormGroup({});
  questionRenderComplete = new EventEmitter<void>();
  questionToDisplay = '';
  private _questionPayload: QuestionPayload | null = null;
  latestQuestionText$!: Observable<string>;
  totalQuestions!: number;
  private lastProcessedQuestionIndex: number | null = null;
  fixedQuestionIndex = 0;
  private navigatingBackwards = false;
  lastLoggedIndex = -1;
  private lastLoggedQuestionIndex = -1;
  private _clickGate = false;  // same-tick re-entrancy guard
  @Output() events = new EventEmitter<QuizQuestionEvent>();
  public selectedIndices = new Set<number>();

  combinedQuestionData$: Subject<{
    questionText: string,
    explanationText?: string,
    correctAnswersText?: string,
    currentOptions: Option[]
  }> = new Subject();

  override selectedOption: SelectedOption | null = null;
  selectedOptions: SelectedOption[] = [];
  selectedOption$ = new BehaviorSubject<Option | null>(null);
  public wasReselected = false;
  options$!: Observable<Option[]>;
  currentOptions: Option[] | undefined;
  correctAnswers: number[] | undefined;
  override correctMessage = '';
  alreadyAnswered = false;
  optionChecked: { [optionId: number]: boolean } = {};
  answers: any[] = [];
  correctOptionIndex!: number;
  shuffleOptions = true;
  shuffledOptions!: Option[];
  override optionBindings: OptionBindings[] = [];
  feedbackIcon!: string;
  feedbackVisible: { [optionId: number]: boolean } = {};
  override showFeedbackForOption: { [optionId: number]: boolean } = {};
  isFeedbackApplied = false;
  displayOptions: Option[] = [];
  correctAnswersLoaded = false;
  resetFeedbackSubscription!: Subscription;
  resetStateSubscription!: Subscription;
  sharedVisibilitySubscription!: Subscription;
  optionSelectionSubscription!: Subscription;
  shufflePreferenceSubscription!: Subscription;
  private idxSub!: Subscription;
  isMultipleAnswer!: boolean;
  isExplanationTextDisplayed = false;
  isNavigatingToPrevious = false;
  isLoading = true;
  isLoadingQuestions = false;
  isFirstQuestion = true;
  isPaused = false;
  isQuizLoaded = false;
  lastMessage = '';
  private initialized = false;
  shouldDisplayAnswers = false;
  feedbackText = '';
  displayExplanation = false;
  override sharedOptionConfig: SharedOptionConfig | null = null;
  shouldRenderComponent = false;
  shouldRenderFinalOptions = false;
  areOptionsReadyToRender = false;
  public renderReady = false;
  private _canRenderFinalOptions = false;
  explanationLocked = false;  // flag to lock explanation
  explanationVisible = false;
  displayMode: 'question' | 'explanation' = 'question';
  private displayMode$ = new BehaviorSubject<'question' | 'explanation'>('question');
  private displaySubscriptions: Subscription[] = [];
  private displayModeSubscription!: Subscription;
  private lastOptionsQuestionSignature: string | null = null;
  shouldDisplayExplanation = false;
  isContentAvailable$!: Observable<boolean>;
  private isRestoringState = false;
  private displayState = {
    mode: 'question' as 'question' | 'explanation',
    answered: false
  };
  public displayStateSubject = new BehaviorSubject<{
    mode: 'question' | 'explanation',
    answered: boolean
  }>({
    mode: 'question',
    answered: false
  });
  displayedExplanationIndex: number | null = null;

  private forceQuestionDisplay = true;
  readyForExplanationDisplay = false;
  isExplanationReady = false;
  isExplanationLocked = true;
  currentExplanationText = '';
  lastExplanationShownIndex = -1;
  explanationInFlight = false;
  private explanationOwnerIdx = -1;

  private _expl$ = new BehaviorSubject<string | null>(null);
  public explanation$ = this._expl$.asObservable();

  private _formattedByIndex = new Map<number, string>();
  private _timerForIndex: number | null = null;
  private handledOnExpiry = new Set<number>();
  public isFormatting = false;

  private lastSerializedOptions = '';
  lastSerializedPayload = '';
  private payloadSubject = new BehaviorSubject<QuestionPayload | null>(null);
  private hydrationInProgress = false;

  public finalRenderReadySubject = new BehaviorSubject<boolean>(false);
  public finalRenderReady$ = this.finalRenderReadySubject.asObservable();
  public finalRenderReady = false;
  public internalBufferReady = false;

  explanationTextSubject = new BehaviorSubject<string>('');
  explanationText$ = this.explanationTextSubject.asObservable();
  private _fetEarlyShown = new Set<number>();

  feedbackTextSubject = new BehaviorSubject<string>('');
  feedbackText$ = this.feedbackTextSubject.asObservable();

  selectionMessageSubject = new BehaviorSubject<string>('');
  selectionMessage$ = this.selectionMessageSubject.asObservable();
  selectionMessageSubscription: Subscription = new Subscription();

  private questionPayloadSubject = new BehaviorSubject<QuestionPayload | null>(null);
  public questionPayload$ = this.questionPayloadSubject.asObservable();

  private renderReadySubject = new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();
  private renderReadySubscription?: Subscription;

  private timerSub!: Subscription;

  waitingForReady = false;
  deferredClick?: { option: SelectedOption | null, index: number, checked: boolean, wasReselected?: boolean };

  private _wasHidden = false;
  private _hiddenAt: number | null = null;
  private _elapsedAtHide: number | null = null;
  private _pendingRAF: number | null = null;
  _pendingPassiveRaf: number | null = null;
  canonicalOptions: CanonicalOption[] = [];
  private _msgTok = 0;

  private questionFresh = true;
  private flashDisabledSet: Set<FeedbackKey> = new Set();
  public feedbackConfigs: Record<FeedbackKey, FeedbackConfig> = {};
  public lastFeedbackOptionId: FeedbackKey = -1 as const;
  private lastResetFor = -1;
  private timedOut = false;

  // Tracks whether we already stopped for this question
  private _timerStoppedForQuestion = false;
  private _skipNextAsyncUpdates = false;

  // Last computed "allCorrect" (used across microtasks/finally)
  private _lastAllCorrect = false;

  private _submittingMulti = false;  // prevents re-entry

  private isUserClickInProgress = false;

  private _abortController: AbortController | null = null;
  private indexChange$ = new Subject<void>();

  private _visibilityRestoreInProgress = false;
  private _suppressDisplayStateUntil = 0;

  private destroy$: Subject<void> = new Subject<void>();

  constructor(
    protected override quizService: QuizService,
    protected quizDataService: QuizDataService,
    protected quizNavigationService: QuizNavigationService,
    protected override quizStateService: QuizStateService,
    protected quizQuestionLoaderService: QuizQuestionLoaderService,
    protected quizQuestionManagerService: QuizQuestionManagerService,
    protected override dynamicComponentService: DynamicComponentService,
    protected explanationTextService: ExplanationTextService,
    protected override feedbackService: FeedbackService,
    protected nextButtonStateService: NextButtonStateService,
    protected resetBackgroundService: ResetBackgroundService,
    protected resetStateService: ResetStateService,
    protected override selectedOptionService: SelectedOptionService,
    protected selectionMessageService: SelectionMessageService,
    protected sharedVisibilityService: SharedVisibilityService,
    protected soundService: SoundService,
    protected timerService: TimerService,
    protected statePersistence: QqcStatePersistenceService,
    protected explanationManager: QqcExplanationManagerService,
    protected timerEffect: QqcTimerEffectService,
    protected feedbackManager: QqcFeedbackManagerService,
    protected optionSelection: QqcOptionSelectionService,
    protected explanationDisplay: QqcExplanationDisplayService,
    protected resetManager: QqcResetManagerService,
    protected questionLoader: QqcQuestionLoaderService,
    protected clickOrchestrator: QqcOptionClickOrchestratorService,
    protected navigationHandler: QqcNavigationHandlerService,
    protected initializer: QqcInitializerService,
    protected componentFactoryResolver: ComponentFactoryResolver,
    protected activatedRoute: ActivatedRoute,
    protected quizShuffleService: QuizShuffleService,
    protected override fb: FormBuilder,
    protected override cdRef: ChangeDetectorRef,
    protected router: Router,
    protected ngZone: NgZone,
    protected el: ElementRef
  ) {
    super(
      fb,
      dynamicComponentService,
      feedbackService,
      quizService,
      quizStateService,
      selectedOptionService,
      cdRef
    );

    setTimeout(() => {
      console.log('[QQC] 🔧 manual test call purgeAndDefer(99)');
      this.explanationTextService.purgeAndDefer(99);
    }, 500);
  }

  @Input() set questionIndex(value: number) {
    // Cancel any previous request
    this._abortController?.abort();

    // Create a new AbortController for this load
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Save the new index locally if needed
    this.currentQuestionIndex = value;

    // Call loader with the signal
    this.loadQuestion(signal);
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
    } catch (err) {
      console.error('[❌ Error during hydrateFromPayload]', err);
    }
  }

  get questionPayload(): QuestionPayload | null {
    return this._questionPayload;
  }

  private resetUIForNewQuestion(): void {
    this.sharedOptionComponent?.resetUIForNewQuestion();
    this.updateShouldRenderOptions([]);
  }

  override async ngOnInit(): Promise<void> {
    const qIndex = this.quizService.getCurrentQuestionIndex();
    const current = this.quizService.questions?.[qIndex];
    const next = this.quizService.questions?.[qIndex + 1];

    if (current && next && current.options && next.options) {
      const shared = current.options.some((o: Option, i: number) => o === next.options[i]);
      console.log(`[REF TRACE] Shared option refs between Q${qIndex} and Q${qIndex + 1}:`, shared);
    }

    this.clearSoundFlagsForCurrentQuestion(0);

    this.idxSub = this.quizService.currentQuestionIndex$.pipe(
      map((i: number) => this.normalizeIndex(i)),
      distinctUntilChanged(),

      // On every question: hard reset view and restart visible countdown
      tap((i0: number) => {
        // DO NOT overwrite @Input currentQuestionIndex here. 
        // We use i0 for the local reaction.
        this.resetPerQuestionState(i0);   // this must NOT arm any expiry
        this.handledOnExpiry.delete(i0);  // clear any one-shot guards
        requestAnimationFrame(() => this.emitPassiveNow(i0));

        // Prewarm formatted text for THIS question (non-blocking; no UI writes)
        // Cache hit → no-op; miss → compute & store for first-click
        try {
          const hasCache = this._formattedByIndex?.has?.(i0);
          if (!hasCache) {
            // Don’t await—keep nav snappy
            this.resolveFormatted(i0, { useCache: true, setCache: true })
              .catch(err => console.warn('[prewarm resolveFormatted]', err));
          }
        } catch (err) {
          console.warn('[prewarm] skipped', err);
        }
      }),

      // Wait for the SAME clock the UI renders: elapsedTime$
      // When it reaches the duration once, expire this question.
      switchMap((i0: number) =>
        this.timerService.elapsedTime$.pipe(
          filter((elapsed: number) => elapsed >= this.timerService.timePerQuestion),
          take(1),
          map((): number => i0)
        )
      )
    )
      .subscribe((i0: number) => this.onTimerExpiredFor(i0));

    this.quizService.currentQuestionIndex$.subscribe((index: number) => {
      // Log a stack trace for tracing unexpected emissions
      if (index === 1) {
        console.warn('[🧵 Stack trace for index === 1]', {
          stack: new Error().stack
        });
      }

      this.currentQuestionIndex = index;
    });

    if (this.questionToDisplay$) {
      this.latestQuestionText$ = this.questionToDisplay$.pipe(distinctUntilChanged());
    }

    this.quizService.questionPayload$
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        tap((payload: QuestionPayload) => {
          this.currentQuestion = payload.question;
          this.optionsToDisplay = payload.options;
          this.explanationToDisplay = payload.explanation ?? '';
          this.updateShouldRenderOptions(this.optionsToDisplay);
        })
      )
      .subscribe((payload: QuestionPayload) => {
        console.time('[📥 QQC received QA]');
        console.log('[📥 QQC got payload]', payload);
        console.timeEnd('[📥 QQC received QA]');
      });

    this.shufflePreferenceSubscription = this.quizService.checkedShuffle$
      .subscribe((shouldShuffle) => {
        this.shuffleOptions = shouldShuffle;
      });

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
          if (!this.containerInitialized && this.dynamicAnswerContainer) {
            this.loadDynamicComponent(question, options);
            this.containerInitialized = true;
            console.log('[✅ Component injected dynamically from navigation]');
          } else {
            console.log('[🧊 Skipping re-injection — already initialized]');
          }

          this.sharedOptionConfig = null;
          this.shouldRenderFinalOptions = false;
        } else {
          console.warn('[🚫 Dynamic injection skipped]', {
            questionText: question?.questionText,
            optionsLength: options?.length,
          });
        }
      }
    );

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
        filter(idx => Number.isFinite(idx as number) && (idx as number) >= 0),
        filter(idx => idx !== this.lastResetFor),  // optional de-dupe
        tap(idx => this.lastResetFor = idx as number)
      )
      .subscribe(idx => {
        this.resetPerQuestionState(idx as number);  // reset for the incoming question
      });

    this.activatedRoute.paramMap.subscribe(async (params) => {
      this.explanationVisible = false;
      this.explanationText = '';
      this._expl$.next(null);

      const rawParam = params.get('questionIndex');
      const routeIndex = Number(rawParam);
      const questionIndex = Math.max(0, routeIndex - 1); // Normalize to 0-based

      try {
        const question = await firstValueFrom(
          this.quizService.getQuestionByIndex(questionIndex)
        );
        if (!question) {
          console.warn(
            `[⚠️ No valid question returned for route index ${routeIndex} (normalized: ${questionIndex})]`
          );
          return;
        }
      } catch (err) {
        console.error('[❌ Error during question fetch]', err);
      }
    });

    const questionIndexParam = this.activatedRoute.snapshot.paramMap.get('questionIndex');
    const routeIndex = questionIndexParam !== null ? +questionIndexParam : 1;
    this.currentQuestionIndex = Math.max(0, routeIndex - 1);  // Normalize to 0-based
    this.fixedQuestionIndex = this.currentQuestionIndex;

    const loaded = await this.loadQuestion();
    if (!loaded) {
      console.error('[❌ Failed to load initial question]');
      return;
    }

    this.timerService.expired$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
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

    try {
      // Call the parent class's ngOnInit method
      super.ngOnInit();

      this.populateOptionsToDisplay();

      // Initialize display mode subscription for reactive updates
      this.initializeDisplayModeSubscription();

      this.renderReady$ = this.questionPayloadSubject.pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((payload: QuestionPayload) => {
          // Assign all data at once
          const { question, options, explanation } = payload;
          this.currentQuestion = question;
          this.optionsToDisplay = [...options];
          this.explanationToDisplay = explanation?.trim() || '';

          // Show everything together — Q + A in one paint pass
          setTimeout(() => {
            this.renderReady = true;
            this.renderReadySubject.next(true);
          }, 0);

          console.log('[✅ renderReady triggered with Q&A]');
        }),
        map(() => true)
      );
      this.renderReadySubscription = this.renderReady$.subscribe();

      // Add the visibility change listener
      document.addEventListener(
        'visibilitychange',
        this.onVisibilityChange.bind(this)
      );

      // Initial component setups
      this.initializeComponent();
      this.initializeComponentState();

      // Initialize quiz data and routing
      await this.initializeQuiz();
      await this.initializeQuizDataAndRouting();

      // Initialize questions
      this.initializeQuizQuestion();
      this.initializeFirstQuestion();
      this.loadInitialQuestionAndMessage();

      // Setup for visibility and routing
      this.setupVisibilitySubscription();
      this.initializeRouteListener();

      // Additional subscriptions and state tracking
      this.setupSubscriptions();
      this.subscribeToNavigationFlags();
      this.subscribeToTotalQuestions();
    } catch (error) {
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
      .pipe(
        filter((arr) => Array.isArray(arr) && arr.length > 0)  // skip empties
      )
      .subscribe((opts: Option[]) => {
        // NEW array reference
        const fresh = [...opts];
        this.currentOptions = fresh;  // parent’s public field
      });

    // Hydrate from payload
    this.payloadSubject
      .pipe(
        filter((payload): payload is QuestionPayload => !!payload),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
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
      setTimeout(() => this.ngAfterViewInit(), 50);  // retry after a short delay
      return;
    }

    const question = this.questionsArray[index];
    if (question) {
      this.quizService.setCurrentQuestion(question);

      setTimeout(async () => {
        const formatted = await this.getFormattedExplanation(question, index);
        const explanationText = formatted?.explanation || question.explanation || 'No explanation available';
        this.updateExplanationUI(index, explanationText);
      }, 50);
    } else {
      console.error(`[ngAfterViewInit] ❌ No question found at index ${index}`);
    }
  }

  override async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // Guard: safely reset _fetEarlyShown only when truly moving to a different question
    // (not during hydration or first render)
    const newIndex = changes['currentQuestionIndex']?.currentValue;
    const prevIndex = changes['currentQuestionIndex']?.previousValue;

    if (
      typeof newIndex === 'number' &&
      typeof prevIndex === 'number' &&
      newIndex !== prevIndex &&
      this._fetEarlyShown instanceof Set
    ) {
      this._fetEarlyShown.delete(prevIndex);  // only clear the last one, not all
      console.log(`[QQC] 🔄 Reset _fetEarlyShown for transition ${prevIndex + 1} → ${newIndex + 1}`);
    }

    if (changes['questionPayload'] && this.questionPayload) {
      this.hydrateFromPayload(this.questionPayload);
      this.questionPayloadSubject.next(this.questionPayload);
      this.enforceHydrationFallback();
    }

    if (
      changes['currentQuestionIndex'] &&
      !changes['currentQuestionIndex'].firstChange
    ) {
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
      this.handleQuestionAndOptionsChange(
        changes['question'],
        changes['options']
      );

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

    const hasValidOptions =
      Array.isArray(this.options) && this.options.length > 0;

    if (hasValidQuestion && hasValidOptions) {
      // Use setTimeout to allow DOM update cycle
      setTimeout(() => {
        this.renderReadySubject.next(true);  // conditions met, emitting true
      }, 0);
    } else {
      console.warn('[⏸️ renderReady] Conditions not met:', {
        hasValidQuestion,
        hasValidOptions,
      });
      this.renderReadySubject.next(false);
    }
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    document.removeEventListener(
      'visibilitychange',
      this.onVisibilityChange.bind(this)
    );
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
    this.shufflePreferenceSubscription?.unsubscribe();
  }

  @HostListener('window:visibilitychange', [])
  async onVisibilityChange(): Promise<void> {
    // ───────────────────────────────────────
    //  HIDDEN PHASE — persist state before backgrounding
    // ───────────────────────────────────────
    if (document.visibilityState === 'hidden') {
      this._wasHidden = true;

      // Delegate state persistence to navigation handler
      this.navigationHandler.persistStateOnHide({
        quizId: this.quizId!,
        currentQuestionIndex: this.currentQuestionIndex ?? 0,
        displayExplanation: this.displayExplanation,
      });

      // Reset explanation state before backgrounding
      this.navigationHandler.resetExplanationStateOnHide();

      // Capture elapsed timer
      await this.navigationHandler.captureElapsedOnHide();
      return;
    }

    // ───────────────────────────────────────
    //  FAST-PATH EXPIRY CHECK
    // ───────────────────────────────────────
    try {
      const { shouldExpire, expiredIndex } = await this.navigationHandler.handleFastPathExpiry({
        currentQuestionIndex: this.currentQuestionIndex ?? 0,
        displayExplanation: this.displayExplanation,
        normalizeIndex: (idx) => this.normalizeIndex(idx),
      });

      if (shouldExpire) {
        this.timerService.stopTimer?.(undefined, { force: true });
        this.ngZone.run(() => {
          this.onTimerExpiredFor(expiredIndex);
        });
        return;
      }
    } catch (err) {
      console.warn('[onVisibilityChange] fast-path expiry check failed', err);
    }

    // ───────────────────────────────────────
    //  RESTORE FLOW (LOCKED)
    // ───────────────────────────────────────
    try {
      if (document.visibilityState === 'visible') {
        console.log('[onVisibilityChange] 🟢 Restoring quiz state...');

        // LOCK RESTORATION PHASE
        this._visibilityRestoreInProgress = true;
        (this.explanationTextService as any)._visibilityLocked = true;
        this._suppressDisplayStateUntil = performance.now() + 300;

        // Delegate core restore logic to navigation handler
        const { restoredState, fetState } = this.navigationHandler.handleVisibilityRestore({
          quizId: this.quizId!,
          currentQuestionIndex: this.currentQuestionIndex ?? 0,
          optionsToDisplay: this.optionsToDisplay,
        });

        // Apply restored state to component
        this.currentExplanationText = restoredState.explanationText;
        this.displayState.mode = restoredState.displayMode as 'question' | 'explanation';
        this.optionsToDisplay = restoredState.optionsToDisplay;
        this.feedbackText = restoredState.feedbackText;

        // ✅ Mark that restoration has occurred
        this.quizStateService.hasRestoredOnce = true;

        // Ensure options are ready (fallback if restore returned empty)
        if (!Array.isArray(this.optionsToDisplay) || this.optionsToDisplay.length === 0) {
          console.warn('[onVisibilityChange] ⚠️ optionsToDisplay empty → repopulating');
          if (this.currentQuestion && Array.isArray(this.currentQuestion.options)) {
            this.optionsToDisplay = this.currentQuestion.options.map((option, index) => ({
              ...option,
              optionId: option.optionId ?? index,
              correct: option.correct ?? false
            }));
          } else {
            console.error('[onVisibilityChange] ❌ Failed to repopulate optionsToDisplay');
            return;
          }
        }

        // Restore feedback and selection
        if (this.currentQuestion) {
          this.restoreFeedbackState();

          setTimeout(() => {
            const prevOpt = this.optionsToDisplay.find(o => o.selected);
            if (prevOpt) {
              this.applyOptionFeedback(prevOpt);
            }
          }, 50);

          try {
            const feedbackText = await this.generateFeedbackText(this.currentQuestion);
            this.feedbackText = feedbackText;
          } catch (error) {
            console.error('[onVisibilityChange] ❌ Error generating feedback text:', error);
          }
        }

        // Debounce before applying FET state (ensures no race)
        await new Promise(res => setTimeout(res, 60));

        // Apply FET display state from navigation handler
        try {
          if (fetState.shouldShowExplanation) {
            this.displayExplanation = true;
            this.safeSetDisplayState({ mode: 'explanation', answered: true });
            console.log(`[onVisibilityChange] ✅ Restored FET for Q${(this.currentQuestionIndex ?? 0) + 1}`);
          } else {
            this.displayExplanation = false;
            this.safeSetDisplayState({ mode: 'question', answered: false });
            console.log(`[onVisibilityChange] ↩️ Restored question text for Q${(this.currentQuestionIndex ?? 0) + 1}`);
          }
        } catch (fetErr) {
          console.warn('[onVisibilityChange] ⚠️ FET restore failed:', fetErr);
        } finally {
          // Unlock after a short delay — ensures streams stabilize
          setTimeout(() => {
            (this.explanationTextService as any)._visibilityLocked = false;
            this._visibilityRestoreInProgress = false;

            setTimeout(() => {
              this.navigationHandler.refreshExplanationStatePostRestore(
                this.currentQuestionIndex ?? 0
              );
            }, 400);

            console.log('[VISIBILITY] 🔓 Restore complete, reactive updates re-enabled');
          }, 350);
        }
      }
    } catch (error) {
      console.error('[onVisibilityChange] ❌ Error during state restoration:', error);
    }
  }


  setOptionsToDisplay(): void {
    const context = '[setOptionsToDisplay]';
    const sourceQuestion = this.currentQuestion || this.question;

    if (!sourceQuestion || !Array.isArray(sourceQuestion.options)) {
      console.warn(
        `${context} ❌ No valid currentQuestion or options. Skipping option assignment.`
      );
      return;
    }

    const validOptions = (sourceQuestion.options ?? []).filter((o: Option) => !!o && typeof o === 'object');
    if (!validOptions.length) {
      console.warn(`${context} ❌ All options were invalid.`);
      return;
    }

    this.optionsToDisplay = validOptions.map((opt: Option, index: number) => ({
      ...opt,
      optionId: opt.optionId ?? index,
      active: opt.active ?? true,
      feedback: opt.feedback ?? '',
      showIcon: opt.showIcon ?? false,
      selected: false,
      highlighted: false
    }));
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

      // Clear previous highlight / form flags before we clone
      newOptions.forEach((o: Option) => {
        o.selected = false;
        o.highlight = false;
        o.showIcon = false;
      });
      // Rebuild the reactive form
      this.questionForm = new FormGroup({});
      newOptions.forEach((o: Option) =>
        this.questionForm.addControl(
          `opt_${o.optionId}`,
          new FormControl(false)
        )
      );

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
          Array.isArray(this.optionsToDisplay) &&
          this.optionsToDisplay.length > 0;

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

    this.currentQuestion = question;
    this.optionsToDisplay = structuredClone(options);
    this.updateShouldRenderOptions(this.optionsToDisplay);

    this.explanationToDisplay = explanation?.trim() || '';

    // Now inject the AnswerComponent
    if (!this.containerInitialized && this.dynamicAnswerContainer) {
      this.loadDynamicComponent(this.currentQuestion, this.optionsToDisplay);
      this.containerInitialized = true;
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
        Array.isArray(this.optionsToDisplay) && this.optionsToDisplay.length > 0 && bindingsReady;

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

  private restoreQuizState(): void {
    try {
      const restored = this.statePersistence.restoreState(this.currentQuestionIndex);

      // Apply restored values to component state
      this.currentExplanationText = restored.explanationText;
      this.displayState.mode = restored.displayMode;

      // Restore options
      if (restored.parsedOptions) {
        const storageIndex =
          typeof this.currentQuestionIndex === 'number' && !Number.isNaN(this.currentQuestionIndex)
            ? this.currentQuestionIndex
            : 0;
        this.optionsToDisplay = this.quizService.assignOptionIds(restored.parsedOptions, storageIndex);
      }

      // Fallback: use last known options if still empty
      if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
        const lastKnownOptions = this.quizService.getLastKnownOptions();
        if (lastKnownOptions && lastKnownOptions.length > 0) {
          this.optionsToDisplay = [...lastKnownOptions];
        }
      }

      // Restore selected options and apply feedback
      for (const option of restored.selectedOptions) {
        this.selectedOptionService.setSelectedOption(option);
        const restoredOption = this.optionsToDisplay.find(
          (opt) => opt.optionId === option.optionId
        );
        if (restoredOption) {
          this.applyOptionFeedback(restoredOption);
        }
      }

      // Restore feedback text
      this.feedbackText = restored.feedbackText;

      // Mark that at least one full restore has occurred
      this.quizStateService.hasRestoredOnce = true;
      console.log('[restoreQuizState] hasRestoredOnce set -> true');

      // Force feedback to be applied even if state wasn't restored properly
      setTimeout(() => {
        if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
          console.warn('[restoreQuizState] optionsToDisplay is still empty! Attempting repopulation...');
          this.populateOptionsToDisplay();
        }

        setTimeout(() => {
          const previouslySelectedOption = this.optionsToDisplay.find(
            (opt) => opt.selected
          );
          if (previouslySelectedOption) {
            this.applyOptionFeedback(previouslySelectedOption);
          } else {
            console.log('[restoreQuizState] No previously selected option found. Skipping feedback reapply.');
          }
        }, 50);
      }, 100);
    } catch (error) {
      console.error('[restoreQuizState] Error restoring quiz state:', error);
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
        catchError((error) => {
          console.error('❌ Error in display mode subscription:', error);
          return of('question');  // safe fallback
        })
      )
      .subscribe();
  }

  // Function to set up shared visibility subscription
  private setupVisibilitySubscription(): void {
    this.sharedVisibilitySubscription =
      this.sharedVisibilityService.pageVisibility$.subscribe((isHidden) => {
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

        const adjustedIndex = Math.max(0, Math.min(index - 1, this.questions.length - 1));
        this.quizService.updateCurrentQuestionIndex(adjustedIndex);

        // Use the adjusted index for explanation text to ensure sync
        this.fetchAndSetExplanationText(adjustedIndex);
      });
  }

  // Function to subscribe to navigation flags
  private subscribeToNavigationFlags(): void {
    this.quizNavigationService.getIsNavigatingToPrevious().subscribe(
      (isNavigating: boolean) => (this.isNavigatingToPrevious = isNavigating)
    );
  }

  // Function to subscribe to total questions count
  private subscribeToTotalQuestions(): void {
    this.quizService.getTotalQuestionsCount(this.quizId!)
      .pipe(takeUntil(this.destroy$))
      .subscribe((totalQuestions: number) => {
        this.totalQuestions = totalQuestions;
      });
  }

  private subscribeToRenderReady(): void {
    if (!this.sharedOptionComponent) return;

    this.sharedOptionComponent.renderReady$
      .pipe(
        filter((ready) => ready === true),
        take(1)  // only care about first true
      )
      .subscribe(() => {
        console.log('[🟢 QuizQuestionComponent] Render ready confirmed by SOC');
        this.afterRenderReadyTasks();
      });
  }

  private afterRenderReadyTasks(): void {
    // defer highlighting, feedback checks, etc. here
    console.log('[✨ Performing post-render actions]');
    this.cdRef.detectChanges();
  }

  private initializeComponentState(): void {
    this.waitForQuestionData();
    this.initializeData();
    this.initializeForm();
    this.quizStateService.setLoading(true);
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
          console.warn(
            'Questions are not loaded yet. Skipping explanation update.....'
          );
        }
      });
  }

  private initializeFirstQuestion(): void {
    // Delegate route index parsing to initializer service
    const questionIndexParam = this.activatedRoute.snapshot.paramMap.get('questionIndex');
    const index = this.initializer.parseQuestionIndexFromRoute(questionIndexParam);

    // Set the initial question and load options
    this.setQuestionFirst(index);
  }

  private async loadQuizData(): Promise<boolean> {
    const questions = await this.questionLoader.loadQuizData(this.quizId);
    if (!questions) return false;

    this.questions = questions;
    this.questionsArray = questions;

    const activeQuiz = this.quizService.getActiveQuiz();
    if (activeQuiz) {
      this.quiz = activeQuiz;
    }
    if (!this.quiz) {
      console.error('Failed to get the active quiz.');
      return false;
    }

    this.isQuizLoaded = true;
    return true;
  }

  private async handleRouteChanges(): Promise<void> {
    this.activatedRoute.paramMap.subscribe(async (params) => {
      const rawParam = params.get('questionIndex');

      // Delegate route parsing to initializer service
      const zeroBasedIndex = this.initializer.handleRouteChangeParsing({
        rawParam,
        totalQuestions: this.totalQuestions,
      });
      const displayIndex = zeroBasedIndex + 1; // 1-based for logging

      try {
        // Sync state before loadQuestion() so it sees the correct 0-based index.
        this.currentQuestionIndex = zeroBasedIndex;
        this.quizService.setCurrentQuestionIndex(zeroBasedIndex);

        // Reset explanation UI for every new question
        this.explanationVisible = false;
        this.explanationText = '';
        this._expl$.next(null);

        // Load the question using correct index
        const loaded = await this.loadQuestion(); // now uses new index
        if (!loaded) {
          console.error(
            `[handleRouteChanges] ❌ Failed to load data for Q${displayIndex}`
          );
          return;
        }

        // Reset form and assign question
        this.resetForm();

        this.currentQuestion = this.questionsArray?.[zeroBasedIndex];
        if (!this.currentQuestion) {
          console.warn(
            `[handleRouteChanges] ⚠️ No currentQuestion for Q${displayIndex}`
          );
          return;
        }

        // Prepare options
        const originalOptions = this.currentQuestion.options ?? [];
        this.optionsToDisplay = originalOptions.map((opt) => ({
          ...opt,
          active: true,
          feedback: undefined,
          showIcon: false,
        }));

        if (!this.optionsToDisplay.length) {
          console.warn(`[⚠️ Q${displayIndex}] No options to display.`);
        } else {
          console.log(
            `[✅ Q${displayIndex}] optionsToDisplay:`,
            this.optionsToDisplay
          );
        }

        const isAnswered = await this.isAnyOptionSelected(zeroBasedIndex);
        if (isAnswered) {
          await this.updateExplanationText(zeroBasedIndex);

          if (this.shouldDisplayExplanation) {
            this.showExplanationChange.emit(true);
            this.updateDisplayStateToExplanation();
          }
        }
      } catch (error) {
        console.error('[handleRouteChanges] ❌ Unexpected error:', error);
      }
    });
  }

  private setQuestionFirst(index: number): void {
    if (!this.questionsArray || this.questionsArray.length === 0) {
      console.error(
        `[setQuestionFirst] ❌ questionsArray is empty or undefined.`
      );
      return;
    }

    // Directly use and clamp index to prevent negative values
    const questionIndex = Math.max(
      0,
      Math.min(index, this.questionsArray.length - 1)
    );

    if (questionIndex >= this.questionsArray.length) {
      console.error(
        `[setQuestionFirst] ❌ Invalid question index: ${questionIndex}`
      );
      return;
    }

    const question = this.questionsArray[questionIndex];
    if (!question) {
      console.error(
        `[setQuestionFirst] ❌ No question data available at index: ${questionIndex}`
      );
      return;
    }

    // Update the current question
    this.currentQuestion = question;
    this.quizService.setCurrentQuestion(question);

    // Ensure options are set immediately to prevent async issues
    this.optionsToDisplay = [...(question.options ?? [])];

    // Ensure option feedback is updated correctly
    if (
      this.lastProcessedQuestionIndex !== questionIndex ||
      questionIndex === 0
    ) {
      this.lastProcessedQuestionIndex = questionIndex;
    }

    // Force explanation update for correct question
    setTimeout(() => {
      // Explicitly pass questionIndex to avoid shifting
      this.updateExplanationIfAnswered(questionIndex, question);

      this.questionRenderComplete.emit();
    }, 50);
  }

  public loadOptionsForQuestion(question: QuizQuestion): void {
    // Block interaction while options are (re)binding
    this.quizStateService.setInteractionReady(false);
    this.quizStateService.setLoading(true);

    const enrichedOptions = this.questionLoader.enrichOptionsForDisplay(question);
    if (enrichedOptions.length === 0) {
      queueMicrotask(() => {
        this.quizStateService.setLoading(false);
      });
      return;
    }

    // If incoming list length differs, clear current list to avoid stale bleed-through
    if (this.optionsToDisplay.length !== question.options.length) {
      console.warn('[DEBUG] ❌ Clearing optionsToDisplay at:', new Error().stack);
      this.optionsToDisplay = [];
    }

    // Bind to UI
    this.optionsToDisplay = enrichedOptions;

    // 👉 Keep the service's snapshot in sync so passive messages can read it
    this.selectionMessageService.setOptionsSnapshot?.(enrichedOptions);

    if (this.lastProcessedQuestionIndex !== this.currentQuestionIndex) {
      this.lastProcessedQuestionIndex = this.currentQuestionIndex;
    } else {
      console.debug('[loadOptionsForQuestion] ⚠️ Feedback already processed. Skipping.');
    }

    // AFTER options are set, wait one microtask so bindings/DOM settle,
    // then flip loading→false and interactionReady→true so first click counts.
    // Also reset click dedupe and pre-evaluate Next.
    queueMicrotask(() => {
      this.sharedOptionComponent?.generateOptionBindings();
      this.cdRef?.detectChanges();

      // UI is now interactive
      this.quizStateService.setLoading(false);
      this.quizStateService.setInteractionReady(true);

      // Reset “same index” dedupe so the first click on a new question isn’t ignored
      this.lastLoggedIndex = -1;

      // Ensure first-click explanation fires for the new question
      this.lastExplanationShownIndex = -1;
      this.explanationInFlight = false;

      // ❗ Start with Next disabled for ALL questions until first selection
      this.quizStateService.setAnswerSelected(false);
      this.nextButtonStateService.setNextButtonState(false);

      // 🔔 Now that the DOM is bound and interaction is enabled,
      // emit the passive message from the same array the UI just rendered.
      // rAF ensures we read the exact list post-render, preventing “flash”.
      this._pendingPassiveRaf = requestAnimationFrame(
        () => this.emitPassiveNow(this.currentQuestionIndex)
      );
    });
  }

  // Method to conditionally update the explanation when the question is answered
  private async updateExplanationIfAnswered(
    index: number,
    question: QuizQuestion
  ): Promise<void> {
    if (await this.isAnyOptionSelected(index) && this.shouldDisplayExplanation) {
      const formatted = await this.getFormattedExplanation(question, index);
      const explanationText = formatted?.explanation
        || this.explanationTextService.prepareExplanationText(question);
      this.explanationToDisplay = explanationText;
      this.explanationToDisplayChange.emit(this.explanationToDisplay);
      this.showExplanationChange.emit(true);

      this.updateCombinedQuestionData(question, explanationText);
      this.isAnswerSelectedChange.emit(true);
    } else {
      console.log(
        `Question ${index} is not answered. Skipping explanation update.`
      );
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

    document.addEventListener(
      'visibilitychange',
      this.onVisibilityChange.bind(this)
    );
  }

  // Unsubscribing to prevent multiple triggers
  private handlePageVisibilityChange(isHidden: boolean): void {
    if (isHidden) {
      // Page is now hidden, so pause updates and clear/reset necessary subscriptions
      this.isPaused = true; // updates are paused
      this.clearDisplaySubscriptions();
    } else {
      // Page is now visible, so resume updates, reinitialize subscriptions, and refresh explanation text
      this.isPaused = false; // updates are no longer paused
      this.prepareAndSetExplanationText(this.currentQuestionIndex);
    }
  }

  private clearDisplaySubscriptions(): void {
    // Unsubscribe from any active subscriptions to avoid memory leaks and unnecessary processing
    if (this.displaySubscriptions) {
      for (const sub of this.displaySubscriptions) {
        sub.unsubscribe();
      }
    }

    // Reset the array to prepare for new subscriptions when the page becomes visible again
    this.displaySubscriptions = [];

    // Additional clean-up logic
    this.explanationToDisplay = ''; // clear any currently displayed explanation text
    this.explanationToDisplayChange.emit(''); // emit empty string to reset UI elements
    this.showExplanationChange.emit(false); // ensure explanation display is hidden
  }

  private async initializeComponent(): Promise<void> {
    const result = await this.questionLoader.initializeComponentState({
      questionsArray: this.questionsArray,
      currentQuestionIndex: this.currentQuestionIndex,
    });

    if (!result) return;

    this.questionsArray = result.questionsArray;
    this.currentQuestionIndex = result.currentQuestionIndex;
    this.currentQuestion = result.currentQuestion;

    try {
      this.feedbackText = await this.generateFeedbackText(this.currentQuestion);
      console.info('[initializeComponent] Feedback text generated for the first question:', this.feedbackText);
    } catch (feedbackError) {
      console.error('[initializeComponent] Error generating feedback:', feedbackError);
      this.feedbackText = 'Unable to generate feedback.';
    }
  }

  public override async loadDynamicComponent(
    question: QuizQuestion,
    options: Option[]
  ): Promise<void> {
    try {
      // Guard –- missing question or options
      if (!question || !Array.isArray(options) || options.length === 0) {
        console.warn('[⚠️ Early return A] Missing question or options', {
          question: question ?? '[undefined]',
          options,
          optionsLength: options?.length,
        });
        return;
      }

      // Guard –- missing container
      if (!this.dynamicAnswerContainer) {
        console.warn(
          '[⚠️ Early return B] dynamicAnswerContainer not available'
        );
        return;
      }

      let isMultipleAnswer = false;
      try {
        if (!question || !('questionText' in question)) {
          console.warn(
            '[⚠️ Early return C] Invalid question object before isMultipleAnswer',
            question
          );
          return;
        }

        isMultipleAnswer = await firstValueFrom(
          this.quizQuestionManagerService.isMultipleAnswerQuestion(question)
        );
      } catch (err) {
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
          this.onOptionClicked.bind(this)
        );

      if (!componentRef || !componentRef.instance) {
        console.warn(
          '[❌ loadDynamicComponent] ComponentRef or instance is undefined'
        );
        return;
      }

      const instance = componentRef.instance;
      if (!instance) {
        console.warn('[⚠️ Early return F] ComponentRef has no instance');
        return;
      }

      // Set backward nav flag if supported
      if ((instance as any)?.hasOwnProperty('isNavigatingBackwards')) {
        (instance as any).isNavigatingBackwards = this.navigatingBackwards ?? false;
      }
      this.navigatingBackwards = false;

      const clonedOptions =
        structuredClone?.(options) ?? JSON.parse(JSON.stringify(options));

      try {
        (instance as any).question = { ...question };
        instance.optionsToDisplay = clonedOptions;
      } catch (error) {
        console.error('[❌ Assignment failed in loadDynamicComponent]', error, {
          question,
          options: clonedOptions,
        });
      }

      instance.optionBindings = clonedOptions.map((opt, idx) => ({
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
        change: (_: MatCheckbox | MatRadioButton) => { },
        index: idx,
        highlightIncorrect: false,
        highlightCorrect: false,
        disabled: false,
        ariaLabel: opt.text ?? `Option ${idx + 1}`,
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
        highlightCorrectAfterIncorrect: false,
        shouldResetBackground: false,
        showFeedbackForOption: {},
        isOptionSelected: false,
        correctMessage: '',
        feedback: '',
        idx: this.currentQuestionIndex
      };

      this.questionData = { ...(instance as any).question, options: clonedOptions };
      this.sharedOptionConfig = instance.sharedOptionConfig;
      this.cdRef.markForCheck();

      await (instance as any).initializeSharedOptionConfig(clonedOptions);

      if (!Object.prototype.hasOwnProperty.call(instance, 'onOptionClicked')) {
        instance.onOptionClicked = this.onOptionClicked.bind(this);
        console.log('[🔁 Bound onOptionClicked to instance]');
      }

      const hasRenderableOptions = Array.isArray(instance.optionsToDisplay)
        && instance.optionsToDisplay.length > 0;

      if (hasRenderableOptions) {
        this.updateShouldRenderOptions(instance.optionsToDisplay);
        this.shouldRenderOptions = true;
        this._canRenderFinalOptions = true;
      } else {
        this.updateShouldRenderOptions(instance.optionsToDisplay);
        console.warn('[⚠️ Skipping render — options not ready]', {
          optionBindings: instance.optionBindings?.length,
          options: instance.optionsToDisplay?.length,
          config: !!instance.sharedOptionConfig,
        });
      }
    } catch (error) {
      console.error(
        '[❌ loadDynamicComponent] Failed to load component:',
        error
      );
    }
  }

  // rename
  private async loadInitialQuestionAndMessage(): Promise<void> {
    await this.handleQuestionState();
  }

  public async loadQuestion(signal?: AbortSignal): Promise<boolean> {
    // ABSOLUTE LOCK: prevent stale FET display
    this.questionLoader.resetExplanationForLoad();
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
        this.currentQuestionIndex
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

      console.log(
        '[loadQuestion] currentQuestionIndex:',
        this.currentQuestionIndex
      );
      console.log(
        '[loadQuestion] calling updateExplanationText with lockedIndex =',
        lockedIndex
      );

      // Reset all relevant UI and quiz state
      await this.resetQuestionStateBeforeNavigation({
        preserveVisualState: shouldPreserveVisualState,
        preserveExplanation: shouldKeepExplanationVisible,
      });
      if (!shouldKeepExplanationVisible) {
        this.explanationTextService.resetExplanationState();
        this.explanationTextService.setExplanationText('');
        this.explanationTextService.setIsExplanationTextDisplayed(false);
        this.renderReadySubject.next(false);

        this.displayState = { mode: 'question', answered: false };
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
      this.timerService.startTimer(this.timerService.timePerQuestion, true);

      // Fetch questions if not already available
      this.questionsArray = await this.questionLoader.fetchQuestionsIfNeeded(this.questionsArray);

      // 🔧 FIX: set totalQuestions before selection messages are computed
      if (this.questionsArray?.length > 0) {
        this.quizService.totalQuestions = this.questionsArray.length;
        console.log('[loadQuestion] ✅ totalQuestions set', this.quizService.totalQuestions);
      }

      // If questionsArray still empty, bail out gracefully
      if (this.questionsArray.length === 0) {
        console.warn('[loadQuestion] questionsArray still empty – aborting load');
        return false;
      }

      // Defensive: only redirect to results if we truly have no more questions
      const { shouldRedirect, trueTotal } = this.questionLoader.checkEndOfQuiz({
        currentQuestionIndex: this.currentQuestionIndex,
        questionsArray: this.questionsArray,
        quizId: this.quizId!,
      });

      if (shouldRedirect) {
        console.log(`[loadQuestion] End of quiz (Index ${this.currentQuestionIndex} >= Total ${trueTotal}) → /results`);
        await this.router.navigate(['/results', this.quizId]);
        return false;
      }

      // Validate current index
      if (
        this.currentQuestionIndex < 0 ||
        this.currentQuestionIndex >= this.questionsArray.length
      ) {
        throw new Error(`Invalid question index: ${this.currentQuestionIndex}`);
      }

      const potentialQuestion = this.questionsArray[this.currentQuestionIndex];
      if (!potentialQuestion) {
        throw new Error(
          `No question found for index ${this.currentQuestionIndex}`
        );
      }

      // Abort before UI update
      if (signal?.aborted) {
        console.warn('[loadQuestion] Load aborted before UI update.');
        this.timerService.stopTimer(undefined, { force: true });
        return false;
      }

      // ───────────── Update Component State ─────────────
      console.group(`[QQC LOAD] Initializing Q${this.currentQuestionIndex}`);

      // 1️⃣ Purge all previous state before touching new data
      this.questionLoader.purgeSelectionState();

      // 2️⃣ Defensive clone of question data
      this.currentQuestion = { ...potentialQuestion };

      // 3️⃣ Deep clone options to guarantee new references
      this.optionsToDisplay = this.questionLoader.buildFreshOptions(potentialQuestion, this.currentQuestionIndex);

      console.group(`[QQC TRACE] Fresh options for Q${this.currentQuestionIndex}`);
      this.optionsToDisplay.forEach((o, j) =>
        console.log(`Opt${j}:`, o.text, '| id:', o.optionId, '| ref:', o)
      );
      console.groupEnd();

      // 4️⃣ Verify no shared references
      if (this.questionsArray?.[this.currentQuestionIndex - 1]?.options) {
        const prev = this.questionsArray[this.currentQuestionIndex - 1].options;
        const curr = this.optionsToDisplay;
        const shared = prev.some((p, i) => p === curr[i]);
        console.log(`[QQC REF CHECK] Between Q${this.currentQuestionIndex - 1} and Q${this.currentQuestionIndex}: shared=${shared}`);
      }

      // 5️⃣ Push early payload to services (all fresh data)
      this.quizService.questionPayloadSubject.next({
        question: this.currentQuestion!,
        options: this.optionsToDisplay,
        explanation: '',
      });

      // 6️⃣ Update render variables
      this.questionToDisplay = this.currentQuestion.questionText?.trim() || '';
      this.updateShouldRenderOptions(this.optionsToDisplay);

      // Emit "# of correct answers" text safely
      try {
        const q = this.currentQuestion;
        if (q?.options?.length) {
          const numCorrect = q.options.filter(o => o.correct).length;
          const totalOpts = q.options.length;
          const msg = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(numCorrect, totalOpts);

          if (numCorrect > 1) {
            this.quizService.updateCorrectAnswersText(msg);
            console.log(`[BANNER] Set multi-answer banner for Q${this.currentQuestionIndex + 1}:`, msg);
          } else {
            this.quizService.updateCorrectAnswersText('');
            console.log(`[BANNER] Cleared single-answer banner for Q${this.currentQuestionIndex + 1}`);
          }
        }
      } catch (err) {
        console.warn('[BANNER] Failed to emit correct-answers text', err);
      }


      // 7️⃣ Finalize bindings
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.initializeOptionBindings();
      }
      this.cdRef.markForCheck();

      console.groupEnd();
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
        requestAnimationFrame(async () => {
          if (this.optionsToDisplay?.length > 0) {
            console.log('[loadQuestion] Forcing baseline selection message after emit', {
              index: this.currentQuestionIndex,
              total: this.quizService.totalQuestions,
              opts: this.optionsToDisplay.map(o => ({
                text: o.text,
                correct: o.correct,
                selected: o.selected
              }))
            });
            const q = this.questions[this.currentQuestionIndex];
            if (q) {
              const totalCorrect = q.options.filter(o => !!o.correct).length;
              // Push the baseline immediately
              await this.selectionMessageService.enforceBaselineAtInit(this.currentQuestionIndex, q.type!, totalCorrect);
            }
          } else {
            console.warn('[loadQuestion] Skipped baseline recompute (no options yet)');
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
    } catch (error) {
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

  // Method to ensure loading of the correct current question
  private async loadCurrentQuestion(): Promise<boolean> {
    // Ensure questions array is loaded
    const questionsLoaded = await this.ensureQuestionsLoaded();
    if (!questionsLoaded) {
      console.error('[loadCurrentQuestion] No questions available.');
      return false;
    }

    // Validate current question index
    if (
      this.currentQuestionIndex < 0 ||
      this.currentQuestionIndex >= this.questions.length
    ) {
      console.error(
        `[loadCurrentQuestion] Invalid question index: ${this.currentQuestionIndex}`
      );
      return false;
    }

    try {
      // Fetch question data
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      );

      if (questionData) {
        console.log(
          `[loadCurrentQuestion] Loaded data for question index: ${this.currentQuestionIndex}`
        );

        // Assign unique IDs to options
        questionData.options = this.quizService.assignOptionIds(
          questionData.options,
          this.currentQuestionIndex
        );

        // Assign active states for options
        questionData.options = this.quizService.assignOptionActiveStates(
          questionData.options,
          false
        );

        // Set current question and options
        this.currentQuestion = questionData;
        this.optionsToDisplay = questionData.options ?? [];

        return true;
      } else {
        console.error(
          `[loadCurrentQuestion] No data found for question index: ${this.currentQuestionIndex}`
        );
        return false;
      }
    } catch (error) {
      console.error(
        '[loadCurrentQuestion] Error fetching question data:',
        error
      );
      return false;
    }
  }

  private async ensureQuestionsLoaded(): Promise<boolean> {
    const result = await this.questionLoader.ensureQuestionsLoaded(this.questionsArray, this.quizId);
    if (result.loaded && result.questions) {
      this.questions = result.questions;
      this.questionsArray = result.questions;
      this.isQuizLoaded = true;
    }
    return result.loaded;
  }

  private async handleExplanationDisplay(): Promise<void> {
    if (this.isAnswered) {
      await this.fetchAndSetExplanationText(this.currentQuestionIndex);
      this.updateExplanationDisplay(true);
    } else {
      this.updateExplanationDisplay(false);
    }
  }

  public async generateFeedbackText(question: QuizQuestion): Promise<string> {
    try {
      // Validate the question and its options
      if (!question || !question.options || question.options.length === 0) {
        console.warn(
          '[generateFeedbackText] Invalid question or options are missing.'
        );
        return 'No feedback available for the current question.';
      }

      // Ensure optionsToDisplay is set, falling back to question options if necessary
      if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
        console.warn(
          '[generateFeedbackText] optionsToDisplay is not set. Falling back to question options.'
        );
        this.populateOptionsToDisplay();

        // Log and validate the restored options
        if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
          console.error(
            '[generateFeedbackText] Failed to restore valid optionsToDisplay.'
          );
          return 'No options available to generate feedback.';
        } else {
          console.log(
            '[generateFeedbackText] Fallback optionsToDisplay:',
            this.optionsToDisplay
          );
        }
      }

      // Extract correct options from the question
      const correctOptions = question.options.filter(
        (option) => option.correct
      );
      if (correctOptions.length === 0) {
        console.info(
          '[generateFeedbackText] No correct options found for the question.'
        );
        return 'No correct answers defined for this question.';
      }

      // Generate feedback using the feedback service
      const feedbackText = this.feedbackService.setCorrectMessage(
        this.optionsToDisplay,
        question
      );

      // Emit the feedback text
      this.feedbackText =
        feedbackText || 'No feedback generated for the current question.';
      this.feedbackTextChange.emit(this.feedbackText); // emit to notify listeners

      return this.feedbackText;
    } catch (error) {
      console.error(
        '[generateFeedbackText] Error generating feedback:',
        error,
        {
          question,
          optionsToDisplay: this.optionsToDisplay,
        }
      );
      const fallbackText =
        'An error occurred while generating feedback. Please try again.';
      this.feedbackText = fallbackText;
      this.feedbackTextChange.emit(this.feedbackText);
      return fallbackText;
    }
  }

  private resetTexts(): void {
    this.explanationTextSubject.next('');
    this.feedbackTextSubject.next('');
  }

  isSelectedOption(option: Option): boolean {
    const isOptionSelected =
      this.selectedOptionService.isSelectedOption(option);
    return isOptionSelected;
  }

  public get canRenderFinalOptions(): boolean {
    return this._canRenderFinalOptions;
  }

  public get shouldDisplayTextContent(): boolean {
    return !!this.data?.questionText || !!this.data?.correctAnswersText;
  }

  public get shouldDisplayOptions(): boolean {
    return (
      Array.isArray(this.questionData?.options) &&
      this.questionData.options.length > 0 &&
      !!this.sharedOptionConfig
    );
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
      options: this.options || [],
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
        if (quiz) {
          this.selectedQuiz.next(quiz);
          this.setQuestionOptions();
        }
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

      this.questionsObservableSubscription = this.quizService
        .getAllQuestions()
        .pipe(
          map((questions: QuizQuestion[]) => {
            for (const quizQuestion of questions) {
              quizQuestion.selectedOptions = [];

              // Check if options exist and are an array before mapping
              if (Array.isArray(quizQuestion.options)) {
                quizQuestion.options = quizQuestion.options.map(
                  (option, index) => ({
                    ...option,
                    optionId: index,
                  })
                );
              } else {
                console.error(
                  `Options are not properly defined for question: ${quizQuestion.questionText}`
                );
                quizQuestion.options = []; // initialize as an empty array to prevent further errors
              }
            }
            return questions;
          })
        )
        .subscribe({
          next: (questions: QuizQuestion[]) => {
            if (questions && questions.length > 0) {
              // Only set answered state if selectedOptions is not null or empty
              const selectedOptions =
                this.selectedOptionService.getSelectedOptions();
              const hasAnswered =
                Array.isArray(selectedOptions) && selectedOptions.length > 0;

              if (hasAnswered) {
                this.selectedOptionService.setAnsweredState(true);
              } else {
                console.log(
                  'Skipping setAnsweredState(false) to avoid overwrite'
                );
              }
            }
          },
          error: (err) => {
            console.error('Error fetching questions:', err);
          },
        });
    }
  }

  private async initializeQuizQuestionsAndAnswers(): Promise<void> {
    this.quizId = this.activatedRoute.snapshot.paramMap.get('quizId');

    const result = await this.initializer.initializeQuizQuestionsAndAnswers({
      quizId: this.quizId,
      currentQuestionIndex: this.currentQuestionIndex,
      questionsArray: this.questionsArray,
      fetchAndProcessQuizQuestions: (id) => this.fetchAndProcessQuizQuestions(id),
    });

    if (result) {
      this.questionsArray = result.questionsArray;
      this.questions = result.questions;
    }
  }

  private async fetchAndProcessQuizQuestions(
    quizId: string
  ): Promise<QuizQuestion[]> {
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
    } catch (error) {
      console.error('Error loading questions:', error);
      return [];
    } finally {
      this.isLoading = false;
    }
  }

  private async prepareQuestion(
    quizId: string,
    question: QuizQuestion,
    index: number
  ): Promise<void> {
    await this.initializer.prepareExplanationForQuestion({
      quizId,
      questionIndex: index,
      question,
      getExplanationText: (idx) => this.getExplanationText(idx),
    });
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
    } catch (error) {
      console.error('Failed to determine if question is answered:', error);
      return false;
    }
  }

  updateCorrectMessageText(message: string): void {
    this.quizService.updateCorrectAnswersText(message);
  }

  public async getCorrectAnswers(): Promise<number[]> {
    if (!this.currentQuestion) {
      console.info('Current question not set. Attempting to load it...');
      try {
        this.currentQuestion = await firstValueFrom(
          this.quizService.getQuestionByIndex(this.currentQuestionIndex)
        );
      } catch (error) {
        console.error('Error loading current question:', error);
        return [];
      }
    }

    return this.quizService.getCorrectAnswers(this.currentQuestion!);
  }

  setQuestionOptions(): void {
    this.quizService
      .getQuestionByIndex(this.currentQuestionIndex)
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
            `[QuizQuestionComponent] No options available for question index ${this.currentQuestionIndex}`
          );
          this.currentOptions = [];
          return;
        }

        const answerValues = (currentQuestion.answer ?? [])
          .map((answer) => answer?.value)
          .filter((value): value is Option['value'] => value !== undefined && value !== null);

        const resolveCorrect = (option: Option): boolean => {
          if (option.correct === true) {
            return true;
          }

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

        if (this.shuffleOptions) {
          Utils.shuffleArray(this.currentOptions);
        }

        this.currentOptions = this.applyDisplayOrder(this.currentOptions);
        this.optionsToDisplay = this.currentOptions.map((option) => ({ ...option }));
        this.updateShouldRenderOptions(this.optionsToDisplay);
        this.quizService.nextOptionsSubject.next(
          this.optionsToDisplay.map((option) => ({ ...option }))
        );
        this.cdRef.markForCheck();
      });
  }

  private resetForm(): void {
    if (!this.questionForm) {
      return;
    }

    this.questionForm.patchValue({ answer: '' });
    this.alreadyAnswered = false;
  }

  private clearSelection(): void {
    this.resetManager.clearSelection(this.correctAnswers, this.currentQuestion);
  }

  public resetState(): void {
    const result = this.resetManager.resetState();
    this.selectedOption = result.selectedOption;
    this.options = result.options;
    this.areOptionsReadyToRender = result.areOptionsReadyToRender;
    this.resetFeedback();
  }

  public resetFeedback(): void {
    const result = this.resetManager.resetFeedback();
    this.correctMessage = result.correctMessage;
    this.showFeedback = result.showFeedback;
    this.selectedOption = result.selectedOption;
    this.showFeedbackForOption = result.showFeedbackForOption;
  }

  // Called when a user clicks an option row
  public override async onOptionClicked(event: {
    option: SelectedOption | null;
    index: number;
    checked: boolean;
    wasReselected?: boolean;
  }): Promise<void> {
    console.log('[QQC] 🖱 onOptionClicked triggered for', event.option?.optionId);
    this.isUserClickInProgress = true;
    this._skipNextAsyncUpdates = false;  // reset skip flag at start of each click

    // Cancel pending RAF
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }

    // Wait if interaction is not ready yet
    if (!this.quizStateService.isInteractionReady()) {
      console.warn('[onOptionClicked] Interaction not ready, waiting…');
      await firstValueFrom(
        this.quizStateService.interactionReady$.pipe(filter(Boolean), take(1))
      );
    }

    if (!this.currentQuestion || !this.currentOptions) {
      console.warn('[onOptionClicked] ❌ currentQuestion/currentOptions missing, returning early');
      return;
    }

    const idx = this.quizService.getCurrentQuestionIndex() ?? 0;
    const q = this.questions?.[idx];
    const evtIdx = event.index;
    const evtOpt = event.option;

    this.explanationTextService._activeIndex = idx;
    this.explanationTextService.updateFormattedExplanation('');
    this.explanationTextService.latestExplanation = '';
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setIsExplanationTextDisplayed(false);

    if (evtOpt == null) return;

    // [LOCK] Hard block re-clicks using NUMERIC optionId
    try {
      const lockIdNum = Number(evtOpt?.optionId);
      if (Number.isFinite(lockIdNum) && this.selectedOptionService.isOptionLocked(idx, lockIdNum)) {
        return; // already locked
      }
    } catch { }

    if (this._clickGate) return;
    this._clickGate = true;
    this.questionFresh = false;

    try {
      // Update local UI selection immediately via orchestrator
      const optionsNow: Option[] =
        this.optionsToDisplay?.map(o => ({ ...o })) ??
        this.currentQuestion?.options?.map(o => ({ ...o })) ??
        [];

      this.clickOrchestrator.applyLocalSelectionState({
        questionType: q?.type,
        optionsNow,
        optionsToDisplay: this.optionsToDisplay,
        evtIdx,
        checked: event.checked,
        questionIndex: idx,
      });

      // Detect multi-answer by type OR by having multiple correct options
      const isMultiForSelection = this.clickOrchestrator.isMultiForSelection(q);

      // Persist selection (isMultiForSelection ensures accumulation, not replacement)
      try {
        const selectionToPersist = { ...evtOpt, index: evtIdx };
        this.selectedOptionService.setSelectedOption(selectionToPersist, idx, undefined, isMultiForSelection);
      } catch { }

      // Self-contained multi-answer scoring via orchestrator
      if (isMultiForSelection && q?.options) {
        const { allCorrectSelected } = this.clickOrchestrator.trackMultiAnswerSelection({
          questionIndex: idx,
          evtIdx,
          checked: event.checked,
          question: q,
        });

        if (allCorrectSelected) {
          console.log(`[SCORE-FIX] Q${idx + 1} ✅ ALL CORRECT — calling scoreDirectly`);
          this.quizService.scoreDirectly(idx, true, true);
        }
      }

      // Track per-click dot color via orchestrator
      this.clickOrchestrator.trackClickedOptionCorrectness(idx, evtIdx, q);

      // Build canonical options via orchestrator
      const canonicalOpts = this.clickOrchestrator.buildCanonicalOptions({
        question: q!,
        questionIndex: idx,
        evtIdx,
        evtOpt,
        checked: event.checked,
      });

      // Apply option locks via orchestrator
      this.clickOrchestrator.applyOptionLocks({
        questionIndex: idx,
        evtOpt,
        question: q!,
        optionsToDisplay: this.optionsToDisplay,
      });

      // Feedback sync - use canonicalOpts to avoid service sync lag or ID collisions
      const getStableId = (o: Option | SelectedOption, idx?: number) => this.clickOrchestrator.getStableId(o, idx);
      const selOptsSetImmediate = new Set(
        canonicalOpts.filter(o => o.selected).map((o, i) => getStableId(o, i))
      );
      this.updateOptionHighlighting(selOptsSetImmediate);
      this.refreshFeedbackFor(evtOpt ?? undefined);
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();

      // Snapshot and message
      this.selectionMessageService.setOptionsSnapshot(canonicalOpts);

      this._msgTok = (this._msgTok ?? 0) + 1;
      const tok = this._msgTok;

      this.selectionMessageService.emitFromClick({
        index: idx,
        totalQuestions: this.totalQuestions,
        questionType: q?.type ?? QuestionType.SingleAnswer,
        options: optionsNow,
        canonicalOptions: canonicalOpts as CanonicalOption[],
        token: tok
      });

      // Compute correctness via orchestrator
      const { allCorrect, enableNext, hasAnySelection } = this.clickOrchestrator.computeCorrectness({
        canonicalOpts,
        question: q!,
        questionIndex: idx,
        evtOpt,
        isMultiForSelection,
      });

      this._lastAllCorrect = allCorrect;

      if (enableNext) {
        // Use forceEnable for multi-answer to prevent the reactive stream
        // from overriding the button state during async processing.
        if (isMultiForSelection) {
          this.nextButtonStateService.forceEnable(800);
        } else {
          this.nextButtonStateService.setNextButtonState(true);
        }
      } else {
        this.nextButtonStateService.setNextButtonState(false);
      }
      this.quizStateService.setAnswered(enableNext);
      this.quizStateService.setAnswerSelected(enableNext);
      this.selectedOptionService.setAnswered(enableNext);

      // Stop timer + trigger FET immediately (legally awaited)

      // ────────────────────────────────────────────────
      // FET trigger for multi-answer (only when fully correct)
      // ────────────────────────────────────────────────
      // Lock the question index immediately to avoid drift
      const lockedIndex = this.currentQuestionIndex ?? idx;

      // Don’t rely on live reactive index after this point
      console.log(`[QQC] 🔒 Locked index for FET trigger: Q${lockedIndex + 1}`);

      if (allCorrect && isMultiForSelection && !this._fetEarlyShown.has(lockedIndex)) {
        this.safeStopTimer('completed');
        this._fetEarlyShown.add(lockedIndex);

        console.log(`[QQC] 🧠 Immediate FET trigger for multi-answer Q${lockedIndex + 1}`);

        (async () => {
          try {
            // Guard: stop if user navigated away during the 40ms wait
            if (this.currentQuestionIndex !== lockedIndex) {
              console.log(`[QQC] ⏭ Aborting FET trigger for Q${lockedIndex + 1} (navigated away)`);
              return;
            }

            // Always use lockedIndex here
            const svc: any = this.explanationTextService;
            svc._activeIndex = lockedIndex;
            svc.readyForExplanation = true;
            svc._fetLocked = true;
            svc.setShouldDisplayExplanation(true);
            svc.setIsExplanationTextDisplayed(false);

            await new Promise(res => setTimeout(res, 40));

            // Final safety check after wait
            if (this.currentQuestionIndex !== lockedIndex) return;

            // Retrieve canonical question using locked index
            const canonicalQ = this.quizService.questions?.[lockedIndex] ?? q;
            const raw = (canonicalQ?.explanation ?? '').trim();
            const correctIdxs = svc.getCorrectOptionIndices(canonicalQ);
            const formatted = svc.formatExplanation(canonicalQ, correctIdxs, raw).trim();

            // Always use lockedIndex here too
            svc.setExplanationText(formatted);
            svc.setIsExplanationTextDisplayed(true);
            svc.setShouldDisplayExplanation(true);

            this.displayExplanation = true;
            this.displayStateSubject?.next({ mode: 'explanation', answered: true });
            this.showExplanationChange.emit(true);
            this.explanationToDisplay = formatted;
            this.explanationToDisplayChange?.emit(formatted);

            console.log(`[QQC ✅] FET displayed for Q${lockedIndex + 1}`);
          } catch (err) {
            console.warn('[QQC] ⚠️ FET trigger failed', err);
          }
        })();
      }

      // Continue post-click microtasks for highlighting & feedback
      queueMicrotask(() => {
        if (this._skipNextAsyncUpdates) return;
        this.updateOptionHighlighting(selOptsSetImmediate);
        this.refreshFeedbackFor(evtOpt ?? undefined);
        this.cdRef.markForCheck();
        this.cdRef.detectChanges();
      });

      // Post-click tasks (feedback + message sync)
      requestAnimationFrame(() => {
        if (this._skipNextAsyncUpdates || idx !== this.currentQuestionIndex) return;
        (async () => {
          try {
            const resolvedQuizId = this.quizService.quizId || this.activatedRoute.snapshot.paramMap.get('quizId') || 'dependency-injection';
            const qIdx = this.quizService.getCurrentQuestionIndex();
            const quizSvc = this.quizService;
            const shuffleSvc = this.quizShuffleService;
            const qText = q?.questionText;

            if (quizSvc && shuffleSvc && typeof qIdx === 'number' && resolvedQuizId) {
              let origIdx = shuffleSvc.toOriginalIndex(resolvedQuizId, qIdx);
              let pristine = (origIdx !== null) ? quizSvc.getPristineQuestion(origIdx) : null;

              // 🧪 ROBUSTNESS FIX: Try to find origIdx by question text if mapping fails
              if (!pristine && qText) {
                const canonical = quizSvc.getCanonicalQuestions(resolvedQuizId);
                const normalize = (s: string) => s.replace(/\s/g, '').toLowerCase();
                const foundIdx = canonical.findIndex(q => normalize(q.questionText) === normalize(qText));
                if (foundIdx !== -1) {
                  origIdx = foundIdx;
                  pristine = canonical[foundIdx];
                }
              }
            }

            this.feedbackText = await this.generateFeedbackText(q!);
            await this.postClickTasks(evtOpt ?? undefined, evtIdx, true, false, idx);
            if (event.option) {
              this.handleCoreSelection(event as { option: SelectedOption, index: number, checked: boolean }, idx);
            }
            if (evtOpt) this.markBindingSelected(evtOpt);
            this.refreshFeedbackFor(evtOpt ?? undefined);
          } catch { }
        })().catch(() => { });
      });

    } finally {
      queueMicrotask(() => {
        this._clickGate = false;
        this.isUserClickInProgress = false;

        this.selectionMessageService.releaseBaseline(this.currentQuestionIndex);

        const selectionComplete =
          q?.type === QuestionType.SingleAnswer ? !!evtOpt?.correct : this._lastAllCorrect;

        this.selectionMessageService.setSelectionMessage(selectionComplete);
      });
    }
  }

  public async onSubmitMultiple(): Promise<void> {
    const idx = this.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex() ?? 0;
    const q = this.quizService.questions?.[idx];
    if (!q) {
      console.warn(`[onSubmitMultiple] ❌ No question found at index ${idx}`);
      return;
    }

    const correctIdxs = this.explanationTextService.getCorrectOptionIndices(q);
    const rawExpl = (q.explanation ?? '').trim() || 'Explanation not provided';
    const formatted = this.explanationTextService.formatExplanation(q, correctIdxs, rawExpl).trim();

    try {
      // Ensure active index points to this question only
      this.explanationTextService._activeIndex = idx;

      // Full reset before opening
      this.explanationTextService.resetForIndex(idx);
      await new Promise(res => requestAnimationFrame(() => setTimeout(res, 60)));

      // Open and emit cleanly, force all explanation signals to fire together for this index
      this.explanationTextService.openExclusive(idx, formatted);

      // Sync local + UI display
      this.displayStateSubject?.next({ mode: 'explanation', answered: true });
      this.displayExplanation = true;
      this.explanationToDisplay = formatted;
      this.explanationToDisplayChange?.emit(formatted);

      // Update “# of correct answers” text only for MultipleAnswer questions
      try {
        // Use a strict enum comparison instead of string includes
        if (q.type === QuestionType.MultipleAnswer) {
          const numCorrect = correctIdxs.length;
          const totalOpts = q.options?.length ?? 0;
          const msg = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
            numCorrect,
            totalOpts
          );

          // Emit banner text AND question text together (atomic frame)
          requestAnimationFrame(() => {
            try {
              // Push both banner and question text in the same frame
              this.quizService.updateCorrectAnswersText(msg);
            } catch (err) {
              console.warn('[NAV ⚠️] Failed to emit banner + question text', err);
            }
          });

          this.quizService.updateCorrectAnswersText(msg);
          console.log(`[onSubmitMultiple] 🧮 Correct answers text for Q${idx + 1}:`, msg);
        } else {
          // SingleAnswer → clear text explicitly
          this.quizService.updateCorrectAnswersText('');
        }
      } catch (err) {
        console.warn('[onSubmitMultiple] ⚠️ Failed to compute correct-answers text:', err);
        this.quizService.updateCorrectAnswersText('');
      }
    } catch (err) {
      console.warn('[onSubmitMultiple] ⚠️ FET open failed:', err);
    }
  }

  private onQuestionTimedOut(targetIndex?: number): void {
    // Ignore repeated signals
    if (this.timedOut) return;
    this.timedOut = true;

    const result = this.timerEffect.onQuestionTimedOut({
      targetIndex,
      currentQuestionIndex: this.currentQuestionIndex,
      questions: this.questions,
      currentQuestion: this.currentQuestion,
      optionsToDisplay: this.optionsToDisplay,
      sharedOptionBindings: this.sharedOptionComponent?.optionBindings,
      totalQuestions: this.totalQuestions,
      formattedByIndex: this._formattedByIndex,
      lastAllCorrect: this._lastAllCorrect,
      normalizeIndex: (idx) => this.normalizeIndex(idx),
      setExplanationFor: (idx, html) => this.setExplanationFor(idx, html),
      resolveFormatted: (idx) => this.resolveFormatted(idx),
      revealFeedbackForAllOptions: (opts) => this.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => {
        this.sharedOptionComponent?.forceDisableAllOptions?.();
        this.sharedOptionComponent?.triggerViewRefresh?.();
      },
      updateBindingsAndOptions: () => {
        this.optionBindings = (this.optionBindings ?? []).map(binding => {
          const updated = { ...binding, disabled: true } as OptionBindings;
          if (updated.option) {
            updated.option = { ...updated.option, active: false } as Option;
          }
          return updated;
        });
        this.optionsToDisplay = (this.optionsToDisplay ?? []).map(option => ({
          ...option, active: false,
        }));
        return { optionBindings: this.optionBindings, optionsToDisplay: this.optionsToDisplay };
      },
      markForCheck: () => this.cdRef.markForCheck(),
    });

    this.displayExplanation = true;
    this.showExplanationChange.emit(true);
    this.explanationToDisplay = result.explanationToDisplay;
    this.explanationToDisplayChange?.emit(result.explanationToDisplay);
    this._timerStoppedForQuestion = result.timerStoppedForQuestion;
  }

  private handleTimerStoppedForActiveQuestion(reason: 'timeout' | 'stopped'): void {
    const stopped = this.timerEffect.handleTimerStoppedForActiveQuestion({
      reason,
      timerStoppedForQuestion: this._timerStoppedForQuestion,
      currentQuestionIndex: this.currentQuestionIndex,
      questions: this.questions,
      questionFresh: this.questionFresh,
      optionsToDisplay: this.optionsToDisplay,
      sharedOptionBindings: this.sharedOptionComponent?.optionBindings,
      currentQuestion: this.currentQuestion,
      normalizeIndex: (idx) => this.normalizeIndex(idx),
      revealFeedbackForAllOptions: (opts) => this.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => {
        this.sharedOptionComponent?.forceDisableAllOptions?.();
        this.sharedOptionComponent?.triggerViewRefresh?.();
      },
      updateBindingsAndOptions: () => {
        this.optionBindings = (this.optionBindings ?? []).map(binding => {
          const updated = { ...binding, disabled: true } as OptionBindings;
          if (updated.option) {
            updated.option = { ...updated.option, active: false } as Option;
          }
          return updated;
        });
        this.optionsToDisplay = (this.optionsToDisplay ?? []).map(option => ({
          ...option, active: false,
        }));
        return { optionBindings: this.optionBindings, optionsToDisplay: this.optionsToDisplay };
      },
      markForCheck: () => this.cdRef.markForCheck(),
      detectChanges: () => this.cdRef.detectChanges(),
    });
    if (stopped) {
      this._timerStoppedForQuestion = true;
    }
  }

  private collectLockContextForQuestion(
    i0: number,
    context: { question?: QuizQuestion | null; fallbackOptions?: Option[] | null } = {}
  ): {
    canonicalOpts: Option[];
    lockKeys: Set<string | number>;
  } {
    return this.timerEffect.collectLockContextForQuestion(i0, {
      ...context,
      optionsToDisplay: this.optionsToDisplay,
      sharedOptionBindings: this.sharedOptionComponent?.optionBindings,
      currentQuestionIndex: this.currentQuestionIndex,
      currentQuestion: this.currentQuestion,
    });
  }

  private applyLocksAndDisableForQuestion(
    i0: number,
    canonicalOpts: Option[],
    lockKeys: Set<string | number>,
    options: { revealFeedback: boolean }
  ): void {
    this.timerEffect.applyLocksAndDisableForQuestion(i0, canonicalOpts, lockKeys, options, {
      revealFeedbackForAllOptions: (opts) => this.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => {
        this.sharedOptionComponent?.forceDisableAllOptions?.();
        this.sharedOptionComponent?.triggerViewRefresh?.();
      },
      updateBindingsAndOptions: () => {
        this.optionBindings = (this.optionBindings ?? []).map(binding => {
          const updated = { ...binding, disabled: true } as OptionBindings;
          if (updated.option) {
            updated.option = { ...updated.option, active: false } as Option;
          }
          return updated;
        });
        this.optionsToDisplay = (this.optionsToDisplay ?? []).map(option => ({
          ...option, active: false,
        }));
        return { optionBindings: this.optionBindings, optionsToDisplay: this.optionsToDisplay };
      },
    });
    this._timerStoppedForQuestion = true;
  }

  // Updates the highlighting, selected state, and feedback icons for options after a click
  private updateOptionHighlighting(selectedKeys: Set<string | number>): void {
    this.optionsToDisplay = this.feedbackManager.updateOptionHighlighting(
      this.optionsToDisplay,
      selectedKeys,
      this.currentQuestionIndex,
      this.question?.type
    );
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }

  private handleCoreSelection(ev: {
    option: SelectedOption;
    index: number;
    checked: boolean;
  }, questionIndex: number): void {
    const isMultiSelect = this.question?.type === QuestionType.MultipleAnswer;

    // Perform selection tracking immediately
    this.performInitialSelectionFlow(ev, ev.option);
    this.handleInitialSelection({
      option: ev.option,
      index: ev.index,
      checked: true,
    });

    // Guard: Only update global display state if we are still on the same question
    if (this.currentQuestionIndex === questionIndex) {
      // Force state update before Next button eval
      this.setAnsweredAndDisplayState();
    }

    // Call Next button logic immediately
    if (ev.option) {
      this.selectedOptionService.setSelectedOption(ev.option, questionIndex, undefined, isMultiSelect);
    }

    this.selectedOptionService.evaluateNextButtonStateForQuestion(
      questionIndex,
      this.question?.type === QuestionType.MultipleAnswer
    );

    // Final UI updates
    this.cdRef.detectChanges();
  }

  // Mark the binding and repaint highlight
  private markBindingSelected(opt: Option): void {
    const b = this.feedbackManager.markBindingSelected(
      opt,
      this.currentQuestionIndex,
      this.optionBindings
    );
    if (!b) return;

    this.updateOptionBinding(b);
    b.directiveInstance?.updateHighlight();
  }

  // Keep feedback only for the clicked row
  private refreshFeedbackFor(opt: Option): void {
    if (!this.sharedOptionComponent) {
      console.warn('[QQC] <app-shared-option> not ready');
      return;
    }

    if (opt.optionId !== undefined) {
      this.sharedOptionComponent.lastFeedbackOptionId = opt.optionId;
    }

    const cfg = this.feedbackManager.buildFeedbackConfigForOption(
      opt,
      this.optionBindings,
      this.currentQuestion!,
      this.sharedOptionComponent.feedbackConfigs
    );

    this.sharedOptionComponent.feedbackConfigs = {
      ...this.sharedOptionComponent.feedbackConfigs,
      [opt.optionId!]: cfg,
    };

    this.cdRef.markForCheck();
  }

  // Emit/display explanation
  private displayExplanationText(explanationText: string, qIdx: number): void {
    this.explanationDisplay.displayExplanationText(explanationText, this._lastAllCorrect);

    this.explanationText = explanationText;
    this.explanationVisible = true;
    this.cdRef.detectChanges();
  }

  // Any async follow-ups
  private async postClickTasks(
    opt: SelectedOption,
    idx: number,
    checked: boolean,
    wasPreviouslySelected: boolean,
    questionIndex?: number
  ): Promise<void> {
    const qIdx = questionIndex ?? this.currentQuestionIndex;
    console.log('[✅ finalizeAfterClick]', {
      idx,
      optionId: opt.optionId,
      questionIndex: qIdx,
    });

    const lockedIndex = qIdx;
    this.markQuestionAsAnswered(lockedIndex);

    console.log(
      '[🧪 QQC] finalizeAfterClick wasPreviouslySelected:',
      wasPreviouslySelected
    );
    await this.finalizeSelection(opt, idx, wasPreviouslySelected);

    const sel: SelectedOption = {
      ...opt,
      questionIndex: lockedIndex,
    };
    // Do NOT set clickConfirmedDotStatus here — this runs in an async
    // requestAnimationFrame callback AFTER the parent's onOptionSelected has
    // already written the authoritative value via robust multi-source evaluation.
    // Writing here with the unreliable opt.correct overwrites 'correct' with 'wrong'.

    this.optionSelected.emit(sel);
    this.events.emit({ type: 'optionSelected', payload: sel });

    // Guard global state updates
    if (this.currentQuestionIndex === lockedIndex) {
      this.selectedOptionService.setAnswered(true);
      this.nextButtonStateService.setNextButtonState(true);
    }
    this.cdRef.markForCheck();
  }

  // Utility: replace the changed binding and keep a fresh array ref
  private updateOptionBinding(binding: OptionBindings): void {
    this.optionBindings = this.optionBindings.map((b) =>
      b.option.optionId === binding.option.optionId ? binding : b
    );
  }

  private async performInitialSelectionFlow(
    event: any,
    option: SelectedOption
  ): Promise<void> {
    // Capture pre-toggle selection state BEFORE we mutate
    const prevSelected = !!option.selected;

    this.updateOptionSelection(event, option);
    await this.handleOptionSelection(option, event.index, this.currentQuestion!);
    this.applyFeedbackIfNeeded(option);

    // Tell SMS about this click (id-deduped)
    // Only bump when we have a true transition: unselected → selected AND it’s correct
    const nowSelected = !!option.selected;  // after updateOptionSelection()
    const becameSelected = !prevSelected && nowSelected;

    if (becameSelected) {
      const idx = this.currentQuestionIndex;
      const optId = Number(option.optionId);

      // Use fields that actually exist on your model
      const wasCorrect =
        option.correct === true ||
        (typeof option.feedback === 'string' && /correct/i.test(option.feedback));

      if (Number.isFinite(optId)) {
        this.selectionMessageService.registerClick(idx, optId, wasCorrect);
      }
    }

    // Reconcile deselects when selected → unselected
    const becameDeselected = prevSelected && !nowSelected;
    if (becameDeselected) {
      const idx = this.currentQuestionIndex;
      const optsNow = (this.optionsToDisplay?.length ? this.optionsToDisplay : this.currentQuestion?.options) as Option[] || [];
      this.selectionMessageService['reconcileObservedWithCurrentSelection']?.(idx, optsNow);
    }

    // Emit exactly once; service builds the message
    this.handleSelectionMessageUpdate();
  }

  private setAnsweredAndDisplayState(): void {
    this.selectedOptionService.setAnswered(true);
    this.quizStateService.setAnswered(true);
    this.quizStateService.setDisplayState({
      mode: this._lastAllCorrect ? 'explanation' : 'question',
      answered: true,
    });
  }

  private async enableNextButton(): Promise<void> {
    const shouldEnableNext = await this.isAnyOptionSelected(this.currentQuestionIndex);
    this.nextButtonStateService.setNextButtonState(shouldEnableNext);
  }

  private emitExplanationIfValid(explanationText: string, questionIndex: number): void {
    const currentIndex = this.fixedQuestionIndex ?? this.currentQuestionIndex;
    const valid = this.explanationDisplay.emitExplanationIfValid(
      explanationText, questionIndex, currentIndex
    );
    if (!valid) return;

    this.explanationText = explanationText;
    this.explanationVisible = true;
    this.cdRef.detectChanges();
  }

  private markAsAnsweredAndShowExplanation(index: number): void {
    this.quizService.setCurrentQuestionIndex(index);
    this.quizStateService.setDisplayState({
      mode: this._lastAllCorrect ? 'explanation' : 'question',
      answered: true,
    });
  }

  private async applyFeedbackIfNeeded(option: SelectedOption): Promise<void> {
    if (!option) {
      console.error('[applyFeedbackIfNeeded] ❌ ERROR: option is null or undefined! Aborting.');
      return;
    }

    // Ensure options are available before applying feedback
    if (
      !Array.isArray(this.optionsToDisplay) ||
      this.optionsToDisplay.length === 0
    ) {
      console.warn('[applyFeedbackIfNeeded] ⚠️ optionsToDisplay is empty! Attempting to repopulate...');
      this.populateOptionsToDisplay();
    }

    // Ensure UI-related states are initialized
    this.showFeedbackForOption = this.showFeedbackForOption || {};
    this.showFeedbackForOption[option.optionId!] = true;

    // Find index of the selected option safely
    this.selectedOptionIndex = this.optionsToDisplay.findIndex(
      (opt) => opt.optionId === option.optionId
    );
    if (this.selectedOptionIndex === -1) {
      console.error(`[applyFeedbackIfNeeded] ❌ ERROR: selectedOptionIndex not found for optionId: ${option.optionId}`);
      return;
    }

    const foundOption = this.optionsToDisplay[this.selectedOptionIndex];

    console.log(
      `[✅ applyFeedbackIfNeeded] Found Option at index ${this.selectedOptionIndex}:`,
      foundOption
    );

    // Always apply feedback for the clicked option — even if previously applied
    // this.displayFeedbackForOption(foundOption, index, foundOption.optionId);

    // Flag that feedback has been applied at least once (optional guard)
    this.isFeedbackApplied = true;

    // Explanation evaluation (optional)
    const ready = !!this.explanationTextService.latestExplanation?.trim();
    const show =
      this.explanationTextService.shouldDisplayExplanationSource.getValue();

    if (ready && show) {
      console.log('[📢 Triggering Explanation Evaluation]');
      this.explanationTextService.triggerExplanationEvaluation();
    } else {
      console.warn(
        '[⏭️ Explanation trigger skipped – not ready or not set to display]'
      );
    }

    // Ensure change detection
    this.cdRef.detectChanges();
  }

  public async handleSelectionMessageUpdate(): Promise<void> {
    // Wait a microtask so any selection mutations and state evals have landed
    queueMicrotask(() => {
      // Then wait a frame to ensure the rendered list reflects the latest flags
      requestAnimationFrame(async () => {
        const optionsNow = (this.optionsToDisplay?.length
          ? this.optionsToDisplay
          : this.currentQuestion?.options) as Option[] || [];

        // Notify the service that selection just changed (starts hold-off window)
        this.selectionMessageService.notifySelectionMutated(optionsNow);

        // 🚦 Upgrade: always recompute based on answered state
        await this.selectionMessageService.setSelectionMessage(this.isAnswered);
      });
    });
  }

  private async finalizeAfterClick(
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean,
    questionIndex?: number
  ): Promise<void> {
    const qIdx = questionIndex ?? this.currentQuestionIndex;
    console.log('[✅ finalizeAfterClick]', {
      index,
      optionId: option.optionId,
      questionIndex: qIdx,
    });

    const lockedIndex = qIdx;
    this.markQuestionAsAnswered(lockedIndex);

    console.log(
      '[🧪 QQC] finalizeAfterClick wasPreviouslySelected:',
      wasPreviouslySelected
    );
    await this.finalizeSelection(option, index, wasPreviouslySelected);

    const sel: SelectedOption = {
      ...option,
      questionIndex: lockedIndex,
    };
    this.optionSelected.emit(sel);
    this.events.emit({ type: 'optionSelected', payload: sel });

    // Guard global state updates
    if (this.currentQuestionIndex === lockedIndex) {
      this.selectedOptionService.setAnswered(true);
      this.nextButtonStateService.setNextButtonState(true);
    }
    this.cdRef.markForCheck();
  }

  private async fetchAndUpdateExplanationText(questionIndex: number): Promise<string> {
    // Lock the question index at the time of call
    console.log(`[QQC] 🔄 Unified: fetchAndUpdateExplanationText redirected to updateExplanationText Q${questionIndex + 1}`);
    const explanation = await this.updateExplanationText(questionIndex);
    this.applyExplanation(explanation);
    return explanation;
  }

  private applyExplanation(explanation: string): void {
    this.explanationToDisplay = explanation;

    if (this.shouldDisplayExplanation && this.isAnswered) {
      this.explanationToDisplayChange.emit(explanation);
      this.showExplanationChange.emit(true);
    }

    this.cdRef.detectChanges();
  }

  // ====================== Helper Functions ======================
  private async handleMultipleAnswerTimerLogic(option: Option): Promise<void> {
    this.showFeedback = true; // enable feedback display

    try {
      // Check if all correct options are selected
      // Update options state
      this.optionsToDisplay = this.optionsToDisplay.map((opt) => {
        const isSelected = opt.optionId === option.optionId;

        return {
          ...opt,
          feedback: isSelected && !opt.correct ? 'x' : opt.feedback,
          showIcon: isSelected,
          active: true  // keep all options active
        };
      });

      // Stop the timer if all correct options are selected
      this.timerService.allowAuthoritativeStop();
      const stopped = await this.timerService.attemptStopTimerForQuestion({
        questionIndex: this.currentQuestionIndex,
      });

      if (!stopped) {
        console.log('❌ Timer not stopped: Conditions not met.');
      }
    } catch (error) {
      console.error('[handleMultipleAnswerTimerLogic] Error:', error);
    }
  }

  public populateOptionsToDisplay(): Option[] {
    const result = this.questionLoader.populateOptionsToDisplay(
      this.currentQuestion,
      this.optionsToDisplay,
      this.lastOptionsQuestionSignature
    );
    this.optionsToDisplay = result.options;
    this.lastOptionsQuestionSignature = result.signature;
    return this.optionsToDisplay;
  }

  public async applyOptionFeedback(selectedOption: Option): Promise<void> {
    // Ensure options are available before applying feedback
    if (
      !Array.isArray(this.optionsToDisplay) ||
      this.optionsToDisplay.length === 0
    ) {
      console.warn('[applyOptionFeedback] ⚠️ optionsToDisplay is empty! Attempting to repopulate...');
      this.populateOptionsToDisplay();
    }

    const result = this.feedbackManager.applyOptionFeedback(
      selectedOption,
      this.optionsToDisplay,
      this.showFeedbackForOption
    );

    if (!result) return;

    this.optionsToDisplay = result.optionsToDisplay;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOptionIndex = result.selectedOptionIndex;

    // Emit event to notify SharedOptionComponent
    this.feedbackApplied.emit(selectedOption.optionId);

    // Add a slight delay to ensure UI refreshes properly
    await new Promise((resolve) => setTimeout(resolve, 50));

    this.cdRef.markForCheck();
  }

  private restoreFeedbackState(): void {
    this.optionsToDisplay = this.feedbackManager.restoreFeedbackState(
      this.currentQuestion,
      this.optionsToDisplay,
      this.correctMessage
    );
  }

  private generateFeedbackForOption(option: Option): string {
    return this.feedbackManager.generateFeedbackForOption(option, this.correctMessage);
  }

  private async updateOptionHighlightState(): Promise<void> {
    await this.feedbackManager.updateOptionHighlightState(
      this.currentQuestion,
      this.selectedIndices
    );
  }

  private deactivateIncorrectOptions(allCorrectSelected: boolean): void {
    const result = this.feedbackManager.deactivateIncorrectOptions(
      allCorrectSelected,
      this.currentQuestion,
      this.selectedIndices
    );
    if (result) {
      this.optionsToDisplay = result;
    }
  }

  private disableIncorrectOptions(): void {
    this.optionsToDisplay = this.feedbackManager.disableIncorrectOptions(this.optionsToDisplay);
  }

  // Handles single-answer lock logic. When returning early, returns true.
  private handleSingleAnswerLock(isMultipleAnswer: boolean): boolean {
    if (this.optionSelection.handleSingleAnswerLock(isMultipleAnswer, this.isOptionSelected)) {
      return true;
    }
    this.isOptionSelected = true;
    return false;
  }

  // Handles option selection logic to avoid duplicating "add/remove option" logic.
  private updateOptionSelection(
    event: { option: SelectedOption; checked: boolean; index?: number },
    option: SelectedOption
  ): void {
    this.optionSelection.updateOptionSelection(event, option, this.currentQuestionIndex);
  }

  // Handles logic for when the timer should stop.
  private async stopTimerIfApplicable(
    isMultipleAnswer: boolean,
    option: SelectedOption
  ): Promise<void> {
    await this.optionSelection.stopTimerIfApplicable(
      isMultipleAnswer,
      option,
      this.currentQuestion,
      this.currentQuestionIndex,
      this.selectedIndices
    );
  }

  // Updates the display to explanation mode.
  private updateDisplayStateToExplanation(): void {
    const transition = this.explanationDisplay.computeExplanationModeTransition(
      this.shouldDisplayExplanation,
      this.displayMode$.getValue()
    );
    if (!transition) return;

    this.displayState = transition.displayState;
    this.displayStateSubject.next(this.displayState);
    this.displayStateChange.emit(this.displayState);
    this.displayMode = transition.displayMode;
    this.displayMode$.next(transition.displayMode);

    const flags = transition.explanationFlags;
    this.shouldDisplayExplanation = flags.shouldDisplayExplanation;
    this.explanationVisible = flags.explanationVisible;
    this.isExplanationTextDisplayed = flags.isExplanationTextDisplayed;
    this.forceQuestionDisplay = flags.forceQuestionDisplay;
    this.readyForExplanationDisplay = flags.readyForExplanationDisplay;
    this.isExplanationReady = flags.isExplanationReady;
    this.isExplanationLocked = flags.isExplanationLocked;
  }

  // Handles the outcome after checking if all correct answers are selected.
  private async handleCorrectnessOutcome(
    allCorrectSelected: boolean,
    option: SelectedOption,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const result = await this.optionSelection.handleCorrectnessOutcome({
      allCorrectSelected,
      option,
      wasPreviouslySelected,
      currentQuestion: this.currentQuestion,
      currentQuestionIndex: this.currentQuestionIndex,
      isMultipleAnswer: this.isMultipleAnswer,
      explanationToDisplay: this.explanationToDisplay,
    });

    this.explanationToDisplay = result.explanationToDisplay;

    if (result.shouldEmitAnswerSelected) {
      this.answerSelected.emit(true);
    }

    // Ensure Next button state is correctly updated with slight delay
    setTimeout(() => {
      this.nextButtonState.emit(result.shouldEnableNext);
    }, 50);
  }

  private handleInitialSelection(event: {
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
    this.optionSelection.markQuestionAsAnswered(this.quizId!, questionIndex, this._lastAllCorrect);
  }

  private async processSelectedOption(
    option: SelectedOption,
    index: number,
    checked: boolean
  ): Promise<void> {
    await this.handleOptionProcessingAndFeedback(option, index, checked);
    await this.updateQuestionState(option);

    await this.handleCorrectAnswers(option);
    this.updateFeedback(option);
  }

  private async finalizeSelection(
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const currentQuestion = await this.fetchAndProcessCurrentQuestion();
    if (!currentQuestion) {
      console.error('Could not retrieve the current question.');
      return;
    }

    // Select the option and update the state
    this.selectOption(currentQuestion, option, index);

    await this.processCurrentQuestionState(currentQuestion, option, index);
    await this.handleCorrectnessAndTimer();
    this.stopTimerIfAllCorrectSelected();
  }

  private initializeQuestionState(questionIndex: number): QuestionState {
    return this.optionSelection.initializeQuestionState(this.quizId!, questionIndex);
  }

  private async handleOptionProcessingAndFeedback(
    option: SelectedOption,
    index: number,
    checked: boolean
  ): Promise<void> {
    try {
      const event = { option, index, checked };
      await super.onOptionClicked(event);

      this.selectedOptions = [
        { ...option, questionIndex: this.currentQuestionIndex },
      ];
      this.selectedOption = { ...option };
      this.showFeedback = true;
      this.showFeedbackForOption[option.optionId!] = true;

      this.isAnswered = true;

      if (this._lastAllCorrect) {
        await this.fetchAndSetExplanationText(this.currentQuestionIndex);
        this.updateExplanationDisplay(true);
      } else {
        this.shouldDisplayExplanation = false;
        this.showExplanationChange.emit(false);
        this.displayExplanation = false;
      }

      const questionData: any = await firstValueFrom(
        this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      );

      if (this.quizQuestionManagerService.isValidQuestionData(questionData!)) {
        if (this._lastAllCorrect) {
          const processedExplanation = await this.processExplanationText(
            questionData!,
            this.currentQuestionIndex
          );

          let explanationText =
            processedExplanation?.explanation ??
            questionData!.explanation ??
            'No explanation available';

          this.explanationToDisplay = explanationText;
          this.explanationTextService.updateFormattedExplanation(explanationText);

          if (this.isAnswered && this.shouldDisplayExplanation) {
            this.explanationToDisplayChange.emit(explanationText);
            this.showExplanationChange.emit(true);
            this.displayExplanation = true;
          }
        }

        const correctOptions = (questionData?.options ?? []).filter(
          (opt: Option) => opt.correct
        );
        this.correctMessage = this.feedbackService.setCorrectMessage(
          this.optionsToDisplay,
          questionData as QuizQuestion
        );
      } else {
        console.error(
          '[handleOptionProcessingAndFeedback] ❌ Invalid question data when handling option processing.'
        );
        throw new Error('Invalid question data');
      }
    } catch (error) {
      console.error('[handleOptionProcessingAndFeedback] ❌ Error:', error);
      this.explanationToDisplay =
        'Error processing question. Please try again.';
      this.explanationToDisplayChange.emit(this.explanationToDisplay);
    }
  }

  private async updateQuestionState(option: SelectedOption): Promise<void> {
    try {
      this.quizStateService.updateQuestionState(
        this.quizId!,
        this.currentQuestionIndex,
        {
          explanationDisplayed: this._lastAllCorrect,
          selectedOptions: [option],
          explanationText: this.explanationToDisplay,
        },
        this.correctAnswers?.length ?? 0
      );
      console.log(`Question state updated with explanationDisplayed: ${this._lastAllCorrect}`);
    } catch (stateUpdateError) {
      console.error('Error updating question state:', stateUpdateError);
    }
  }

  private async handleCorrectAnswers(option: SelectedOption): Promise<void> {
    try {
      console.log('Handling correct answers for option:', option);

      // Fetch correct answers asynchronously
      this.correctAnswers = await this.getCorrectAnswers();
      console.log('Fetched correct answers:', this.correctAnswers);

      // Check if the correct answers are available
      if (!this.correctAnswers || this.correctAnswers.length === 0) {
        console.warn('No correct answers available for this question.');
        return;
      }

      // Check if the selected option is among the correct answers
      const isSpecificAnswerCorrect = this.correctAnswers.includes(
        option.optionId!
      );
      console.log('Is the specific answer correct?', isSpecificAnswerCorrect);
    } catch (error) {
      console.error('An error occurred while handling correct answers:', error);
    }
  }

  private updateFeedback(option: SelectedOption): void {
    const result = this.feedbackManager.updateFeedback({
      option,
      isUserClickInProgress: this.isUserClickInProgress,
      showFeedback: this.showFeedback,
      selectedOption: this.selectedOption,
      optionsToDisplay: this.optionsToDisplay,
      currentQuestionIndex: this.currentQuestionIndex,
      isMultipleAnswer: this.isMultipleAnswer,
    });

    if (!result) return;

    this.showFeedbackForOption = result.showFeedbackForOption;

    if (result.selectedIndex !== -1) {
      this.processOptionSelectionAndUpdateState(result.selectedIndex);
    }
  }

  private async finalizeOptionSelection(
    option: SelectedOption,
    index: number,
    questionState: QuestionState
  ): Promise<void> {
    const currentQuestion = await this.fetchAndProcessCurrentQuestion();
    if (!currentQuestion) {
      console.error('Could not retrieve the current question.');
      return;
    }

    // Select the option and update the state
    this.selectOption(currentQuestion, option, index);

    await this.processCurrentQuestionState(currentQuestion, option, index);
    await this.handleCorrectnessAndTimer();
    this.stopTimerIfAllCorrectSelected();
  }

  private stopTimerIfAllCorrectSelected(): void {
    this.timerEffect.stopTimerIfAllCorrectSelected({
      currentQuestionIndex: this.currentQuestionIndex,
      questions: this.questions,
      optionsToDisplay: this.optionsToDisplay,
    });
  }

  // Helper method to update feedback for options
  private updateFeedbackForOption(option: SelectedOption): void {
    this.showFeedbackForOption = this.feedbackManager.resetFeedbackForOption(option.optionId!);
    this.showFeedbackForOption[option.optionId!] =
      this.showFeedback && this.selectedOption === option;
  }

  private resetStateForNewQuestion(): void {
    const resetState = this.optionSelection.resetStateForNewQuestion();
    this.showFeedbackForOption = resetState.showFeedbackForOption;
    this.showFeedback = resetState.showFeedback;
    this.correctMessage = resetState.correctMessage;
    this.selectedOption = resetState.selectedOption;
    this.isOptionSelected = resetState.isOptionSelected;
    this.explanationToDisplayChange.emit('');
    this.showExplanationChange.emit(false);
  }

  private processOptionSelectionAndUpdateState(index: number): void {
    const result = this.optionSelection.processOptionSelectionAndUpdateState(
      this.question,
      index,
      this.currentQuestionIndex,
      this.isMultipleAnswer,
      this.isUserClickInProgress
    );
    if (result) {
      this.answerSelected.emit(true);
      this.isFirstQuestion = false;
    }
  }

  public async fetchAndProcessCurrentQuestion(): Promise<QuizQuestion | null> {
    try {
      this.resetStateForNewQuestion();  // reset state before fetching new question

      const quizId = this.quizService.getCurrentQuizId();
      const currentQuestion = this.quizService.questions[this.currentQuestionIndex];
      // const currentQuestion = await firstValueFrom(
      //   this.quizService.getCurrentQuestionByIndex(
      //     quizId,
      //     this.currentQuestionIndex
      //   )
      // );

      if (!currentQuestion) return null;

      this.currentQuestion = currentQuestion;
      this.optionsToDisplay = [...(currentQuestion.options || [])];

      // Set this.data
      this.data = {
        questionText: currentQuestion.questionText,
        explanationText: currentQuestion.explanation,
        correctAnswersText: this.quizService.getCorrectAnswersAsString(),
        options: this.optionsToDisplay
      };

      // Determine if the current question is answered
      const isAnswered = await this.isAnyOptionSelected(this.currentQuestionIndex);

      // Update the selection message based on the current state
      if (await this.shouldUpdateMessageOnAnswer(isAnswered)) {
        // await this.updateSelectionMessageBasedOnCurrentState(isAnswered);
      } else {
        console.log('No update required for the selection message.');
      }

      // Return the fetched current question
      return currentQuestion;
    } catch (error) {
      console.error('[fetchAndProcessCurrentQuestion] An error occurred while fetching the current question:', error);
      return null;
    }
  }

  private async processCurrentQuestionState(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    index: number
  ): Promise<void> {
    this.processCurrentQuestion(currentQuestion);
    await this.handleOptionSelection(option, index, currentQuestion);
    this.quizStateService.updateQuestionStateForExplanation(
      this.quizId!,
      this.currentQuestionIndex
    );
    this.questionAnswered.emit();
  }

  private async handleCorrectnessAndTimer(): Promise<void> {
    // Check if the answer is correct and stop the timer if it is
    const isCorrect = await this.quizService.checkIfAnsweredCorrectly();
    if (isCorrect) {
      this.timerService.attemptStopTimerForQuestion({
        questionIndex: this.currentQuestionIndex,
      });
    }
  }

  private async processCurrentQuestion(
    currentQuestion: QuizQuestion
  ): Promise<void> {
    try {
      // Await the explanation text to ensure it resolves to a string
      const explanationText: string = await this.getExplanationText(
        this.currentQuestionIndex
      );

      // Set the current explanation text
      this.explanationTextService.setCurrentQuestionExplanation(explanationText);
      this.updateExplanationDisplay(this._lastAllCorrect);

      const totalCorrectAnswers = this.quizService.getTotalCorrectAnswers(currentQuestion);

      // Update the quiz state with the latest question information
      this.quizStateService.updateQuestionState(
        this.quizId!,
        this.currentQuestionIndex,
        { isAnswered: true },
        totalCorrectAnswers
      );
    } catch (error) {
      console.error('Error processing current question:', error);

      // Set a fallback explanation text on error
      this.explanationTextService.setCurrentQuestionExplanation(
        'Unable to load explanation.'
      );
    }
  }

  private async updateExplanationDisplay(
    shouldDisplay: boolean
  ): Promise<void> {
    // Notify UI about the display change
    this.showExplanationChange.emit(shouldDisplay);
    this.displayExplanation = shouldDisplay;

    if (shouldDisplay) {
      // Delay to avoid UI race conditions and flickering
      setTimeout(async () => {
        const result = await this.explanationDisplay.performUpdateExplanationDisplay({
          shouldDisplay: true,
          currentQuestionIndex: this.currentQuestionIndex,
        });

        this.explanationToDisplay = result.explanationToDisplay;
        this.explanationToDisplayChange.emit(result.explanationToDisplay);
        this.cdRef.markForCheck();
      }, 50);
    } else {
      const result = await this.explanationDisplay.performUpdateExplanationDisplay({
        shouldDisplay: false,
        currentQuestionIndex: this.currentQuestionIndex,
      });

      if (result.explanationToDisplay !== undefined) {
        this.explanationToDisplay = result.explanationToDisplay;
        this.explanationToDisplayChange.emit(result.explanationToDisplay);
      }

      if (result.shouldResetQuestionState) {
        this.resetQuestionStateBeforeNavigation();
      }
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
      this.quizStateService.setDisplayState(this.displayState);

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
      this.explanationToDisplayChange.emit('');
      this.explanationTextService.explanationText$.next('');
      this.explanationTextService.updateFormattedExplanation('');
      this.explanationTextService.setResetComplete(false);
      this.explanationTextService.unlockExplanation();
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.explanationTextService.setIsExplanationTextDisplayed(false);
      this.showExplanationChange.emit(false);
    }

    if (!preserveVisualState) {
      // Clear the currently rendered question/option references so that child
      // components (such as <app-answer>) do not keep stale options while the
      // next question is being fetched.
      this.questionToDisplay = '';
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
    return this.explanationManager.captureExplanationSnapshot({
      preserveVisualState,
      index,
      explanationToDisplay: this.explanationToDisplay,
      quizId: this.quizId,
      isAnswered: this.isAnswered as boolean,
      displayMode: this.displayMode$.getValue(),
      shouldDisplayExplanation: this.shouldDisplayExplanation,
      explanationVisible: this.explanationVisible,
      displayExplanation: this.displayExplanation,
      displayStateAnswered: this.displayState?.answered
    });
  }

  private restoreExplanationAfterReset(args: {
    questionIndex: number;
    explanationText: string;
    questionState?: QuestionState;
  }): void {
    const normalized = (args.explanationText ?? '').trim();
    if (!normalized) {
      return;
    }

    this.explanationToDisplay = normalized;
    this.explanationToDisplayChange.emit(normalized);
    this.explanationTextService.setExplanationText(normalized);
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.explanationTextService.setResetComplete(true);
    this.explanationTextService.lockExplanation();

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

    this.showExplanationChange.emit(true);

    const quizId =
      [this.quizId, this.quizService.getCurrentQuizId(), this.quizService.quizId]
        .find((id) => typeof id === 'string' && id.trim().length > 0) ?? null;

    if (quizId && args.questionState) {
      args.questionState.isAnswered = true;
      args.questionState.explanationDisplayed = true;
      this.quizStateService.setQuestionState(quizId, args.questionIndex, args.questionState);
    }
  }

  private canRenderQuestionInstantly(index: number): boolean {
    return this.questionLoader.canRenderQuestionInstantly(this.questionsArray, index);
  }

  private setExplanationFor(idx: number, html: string): void {
    this.explanationOwnerIdx = idx;                        // tag ownership
    this.explanationTextService.setExplanationText(html);  // single place that writes
    this.cdRef.markForCheck();
  }

  private async updateExplanationText(index: number): Promise<string> {
    return this.explanationDisplay.updateExplanationText({
      index,
      normalizeIndex: (idx) => this.normalizeIndex(idx),
      questionsArray: this.questionsArray,
      currentQuestionIndex: this.currentQuestionIndex,
      currentQuestion: this.currentQuestion,
      optionsToDisplay: this.optionsToDisplay,
      options: this.options,
    });
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
    if (typeof questionIndex !== 'number' || questionIndex < 0) {
      console.error(`Invalid question index: ${questionIndex}`);
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
      this.selectedOptionService.updateSelectedOptions(questionIndex, resolvedOptionId, 'add');

      // Immediate state synchronization and feedback application
      this.selectedOption = { ...option, correct: option.correct };
      this.showFeedback = true;

      // Apply feedback immediately for the selected option
      this.applyFeedbackIfNeeded(option);

      // ⚡ RE-GENERATE FET immediately on every click to ensure cache is fresh and prefix is correct
      const explanationText = await this.updateExplanationText(questionIndex);
      console.log(
        `[📢 Fresh FET for Q${questionIndex + 1}]: "${explanationText.slice(0, 50)}..."`
      );

      this.explanationText = explanationText;

      // Update the answers and check if the selection is correct
      this.quizService.updateAnswersForOption(option);
      this.checkAndHandleCorrectAnswer();

      const totalCorrectAnswers = this.quizService.getTotalCorrectAnswers(currentQuestion);

      // Update the question state in the QuizStateService
      this.quizStateService.updateQuestionState(
        this.quizId!,
        this.currentQuestionIndex,
        {
          selectedOptions: [option],
          isCorrect: option.correct ?? false,
        },
        totalCorrectAnswers
      );

      // Trigger explanation evaluation immediately
      this.explanationTextService.triggerExplanationEvaluation();

      // Update state
      this.setAnsweredAndDisplayState();
    } catch (error) {
      console.error('Error during option selection:', error);
    }
  }

  private processOptionSelection(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    index: number
  ): void {
    // Trigger selection logic (adds/removes selected option)
    this.handleOptionClicked(currentQuestion, index);

    // Check if this specific option is now selected
    const isOptionSelected =
      this.selectedOptionService.isSelectedOption(option);

    // Only update explanation display flag if not locked
    if (!this.explanationTextService.isExplanationLocked()) {
      // Only trigger explanation if selected and correct, otherwise ensure it's hidden
      this.explanationTextService.setShouldDisplayExplanation(isOptionSelected && this._lastAllCorrect);
    } else {
      console.warn('[processOptionSelection] 🛡️ Explanation is locked. Skipping display update.');
    }
  }

  private async waitForQuestionData(): Promise<void> {
    // Clamp bad incoming values (negative / NaN)
    if (
      !Number.isInteger(this.currentQuestionIndex) ||
      this.currentQuestionIndex < 0
    ) {
      this.currentQuestionIndex = 0;
    }

    this.quizService
      .getQuestionByIndex(this.currentQuestionIndex)
      .pipe(
        take(1),
        switchMap(async (question) => {
          if (!question) {
            console.warn(
              `[waitForQuestionData] Index ${this.currentQuestionIndex} out of range — clamping to last question`
            );

            // Get the total-question count (single emission)
            const total: number = await firstValueFrom(
              this.quizService
                .getTotalQuestionsCount(this.quizService.quizId)
                .pipe(take(1))
            );

            const lastIndex = Math.max(0, total - 1);
            this.currentQuestionIndex = lastIndex;

            // Re-query for the clamped index
            question = await firstValueFrom(
              this.quizService
                .getQuestionByIndex(this.currentQuestionIndex)
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
          this.quizService
            .getCurrentOptions(this.currentQuestionIndex)
            .pipe(take(1))
            .subscribe((options: Option[]) => {
              this.optionsToDisplay = Array.isArray(options) ? options : []; // ensure it's an array

              // Apply feedback immediately if an option was already selected
              const previouslySelectedOption = this.optionsToDisplay.find(
                (opt) => opt.selected
              );
              if (previouslySelectedOption) {
                this.applyOptionFeedback(previouslySelectedOption);
              }
            });

          this.initializeForm();
          this.questionForm.updateValueAndValidity();
          window.scrollTo(0, 0);
        })
      )
      .subscribe({
        error: (error) =>
          console.error(
            `[waitForQuestionData] ❌ Error loading question data for index ${this.currentQuestionIndex}:`,
            error
          ),
      });
  }

  initializeForm(): void {
    if (!this.currentQuestion?.options?.length) {
      console.warn('Question data not ready or options are missing.');
      return;
    }

    const controls = this.currentQuestion.options.reduce((acc: { [key: string]: any }, option: Option) => {
      acc[option.optionId!] = new FormControl(false);
      return acc;
    }, {});

    this.questionForm = this.fb.group(controls);
    console.log('Form initialized:', this.questionForm.value);

    this.questionForm.updateValueAndValidity();
    this.updateRenderComponentState();
  }

  private updateRenderComponentState(): void {
    // Check if both the form is valid and question data is available
    if (this.isFormValid()) {
      console.info(
        'Both form and question data are ready, rendering component.'
      );
      this.shouldRenderComponent = true;
    } else {
      console.log('Form or question data is not ready yet');
    }
  }

  private isFormValid(): boolean {
    return this.questionForm?.valid ?? false; // check form validity, ensure form is defined
  }

  private async checkAndHandleCorrectAnswer(): Promise<void> {
    await this.optionSelection.checkAndHandleCorrectAnswer(this.currentQuestionIndex);
  }

  conditionallyShowExplanation(questionIndex: number): void {
    this.quizDataService
      .getQuestionsForQuiz(this.quizService.quizId)
      .pipe(
        catchError((error: Error) => {
          console.error('There was an error loading the questions', error);
          return of([]);
        })
      )
      .subscribe((data: QuizQuestion[]) => {
        this.handleQuestionData(data, questionIndex);
      });
  }

  private async handleQuestionData(
    data: QuizQuestion[],
    questionIndex: number
  ): Promise<void> {
    this.questionsArray = data;

    const result = await this.explanationDisplay.handleQuestionData({
      questionsArray: this.questionsArray,
      questionIndex,
      quizId: this.quizId!,
      shouldDisplayExplanation: this.shouldDisplayExplanation,
      getExplanationText: (idx) => this.getExplanationText(idx),
    });

    this.explanationToDisplayChange.emit(result.explanationText);
    this.showExplanationChange.emit(result.shouldShowExplanation);
  }

  private async handleOptionClicked(
    currentQuestion: QuizQuestion,
    optionIndex: number
  ): Promise<void> {
    try {
      if (!currentQuestion || !Array.isArray(currentQuestion.options)) {
        console.warn(
          '[❌ handleOptionClicked] currentQuestion or options is null/invalid',
          currentQuestion
        );
        return;
      }

      // Ensure optionId is assigned to all options in the current question
      currentQuestion.options = this.quizService.assignOptionIds(
        currentQuestion.options, this.currentQuestionIndex
      );

      // Get selected options, but only include those with a valid optionId
      const selectedOptions: Option[] = this.selectedOptionService
        .getSelectedOptionIndices(this.currentQuestionIndex)
        .map((index: number) => currentQuestion.options[index])
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

      // Handle multiple-answer logic
      const timerStopped = this.timerService.attemptStopTimerForQuestion({
        questionIndex: this.currentQuestionIndex,
      });

      if (timerStopped) {
        console.log(
          '[handleOptionClicked] All correct options selected. Timer stopped successfully.'
        );
      }

      // Ensure the UI reflects the changes
      this.cdRef.markForCheck();
    } catch (error) {
      console.error('[handleOptionClicked] Unhandled error:', error);
    }
  }

  shouldShowIcon(option: Option): boolean {
    return this.selectedOptionService.isSelectedOption(option);
  }

  private resolveStableOptionId(option: Option | null | undefined, fallbackIndex: number): number {
    return this.optionSelection.resolveStableOptionId(option, fallbackIndex);
  }

  async selectOption(
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    optionIndex: number
  ): Promise<void> {
    const result = await this.optionSelection.performSelectOption({
      currentQuestion,
      option,
      optionIndex,
      currentQuestionIndex: this.currentQuestionIndex,
      isMultipleAnswer: this.isMultipleAnswer,
      optionsToDisplay: this.optionsToDisplay,
      selectedOptionsCount: this.selectedOptions.length,
      getExplanationText: (idx) => this.getExplanationText(idx),
    });

    if (!result) return;

    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOption = result.selectedOption;
    this.isOptionSelected = result.isOptionSelected;
    this.isAnswered = result.isAnswered;

    // Set explanation text in quiz question manager service
    this.quizQuestionManagerService.setExplanationText(
      currentQuestion.explanation || ''
    );

    // Emit events
    this.isAnswerSelectedChange.emit(this.isAnswered);
    this.optionSelected.emit(result.selectedOption);
    this.events.emit({ type: 'optionSelected', payload: result.selectedOption });
    this.selectionChanged.emit({
      question: currentQuestion,
      selectedOptions: this.selectedOptions,
    });
  }

  unselectOption(): void {
    this.selectedOptions = [];
    this.optionChecked = {};
    this.showFeedbackForOption = {};
    this.showFeedback = false;
    this.selectedOption = null;
    this.selectedOptionService.clearSelectionsForQuestion(
      this.currentQuestionIndex
    );
    this.quizQuestionManagerService.setExplanationText('');
  }

  async manageExplanationDisplay(): Promise<void> {
    const result = await this.explanationDisplay.manageExplanationDisplay({
      currentQuestionIndex: this.currentQuestionIndex,
      quizId: this.quizId!,
      lastAllCorrect: this._lastAllCorrect,
    });

    this.explanationToDisplay = result.explanationToDisplay;
    this.displayExplanation = result.displayExplanation;
    this.explanationToDisplayChange.emit(result.explanationToDisplay);
    this.showExplanationChange.emit(true);
  }

  // Helper method to clear explanation
  resetExplanation(force: boolean = false): void {
    // Reset local component state
    this.displayExplanation = false; // hide explanation display
    this.explanationToDisplay = ''; // clear local explanation text

    // Always reset the internal explanation text state (service first)
    this.explanationTextService.resetExplanationText();

    // Determine current question index for per-question locking (if supported)
    const qIndex = this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0;

    // If lock exists, only skip when *not* forced
    const locked =
      this.explanationTextService.isExplanationLocked?.() ??
      this.explanationTextService.isExplanationLocked?.(); // fallback to legacy
    if (!force && locked) {
      console.log('[🛡️ resetExplanation] Blocked — lock is active.', {
        qIndex,
      });
      return;
    }

    // Clear display flags in the service (do this BEFORE emitting to parent)
    this.explanationTextService.setShouldDisplayExplanation(false);

    // Reset display state so templates go back to question mode
    this.quizStateService.setDisplayState({
      mode: 'question',
      answered: false,
    });
    this.quizStateService.setAnswerSelected(false);

    // Emit cleared states to parent components
    this.explanationToDisplayChange.emit(''); // inform parent: explanation cleared
    this.showExplanationChange.emit(false); // inform parent: hide explanation

    // Mark reset complete (true, not false) so listeners don’t wait forever
    this.explanationTextService.setResetComplete?.(true);

    this.cdRef?.markForCheck?.();
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

      if (this.quizQuestionManagerService.isValidQuestionData(questionData!)) {
        const formattedExplanationObservable =
          this.explanationTextService.getFormattedExplanation(questionIndex);

        try {
          const formattedExplanation = await Promise.race([
            firstValueFrom(formattedExplanationObservable),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            ),
          ]);

          if (formattedExplanation) {
            this.explanationToDisplay = formattedExplanation;
          } else {
            const processedExplanation = await this.processExplanationText(
              questionData!,
              questionIndex
            );

            if (processedExplanation) {
              this.explanationToDisplay = processedExplanation.explanation;
              this.explanationTextService.updateFormattedExplanation(
                processedExplanation.explanation
              );
            } else {
              this.explanationToDisplay = 'No explanation available...';
            }
          }
        } catch (timeoutError) {
          console.error(
            'Timeout while fetching formatted explanation:',
            timeoutError
          );
          this.explanationToDisplay =
            'Explanation text unavailable at the moment.';
        }
      } else {
        console.error('Error: questionData is invalid');
        this.explanationToDisplay = 'No explanation available.';
      }
    } catch (error) {
      console.error('Error in fetching explanation text:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      this.explanationToDisplay = 'Error fetching explanation.';
    }

    return this.explanationToDisplay;
  }

  public async fetchAndSetExplanationText(
    questionIndex: number
  ): Promise<void> {
    // Clear any previous explanation state
    this.resetExplanation();

    try {
      // Ensure the questions array is loaded only once, without retries
      const questionsLoaded = await this.ensureQuestionsLoaded();

      // Exit early if loading was unsuccessful
      if (
        !questionsLoaded ||
        !this.questionsArray ||
        this.questionsArray.length === 0
      ) {
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
        debounceTime(100) // smooth out updates
      );

      explanation$.subscribe({
        next: async (explanationText: string) => {
          if (await this.isAnyOptionSelected(questionIndex)) {
            this.currentQuestionIndex = questionIndex;
            this.explanationToDisplay =
              explanationText || 'No explanation available';
            this.explanationTextService.updateFormattedExplanation(
              this.explanationToDisplay
            );
            this.explanationToDisplayChange.emit(this.explanationToDisplay);
          } else {
            console.log(
              `Skipping explanation for unanswered question ${questionIndex}.`
            );
          }
        },
        error: (error) => {
          console.error(
            `Error fetching explanation for question ${questionIndex}:`,
            error
          );
          this.handleExplanationError(questionIndex);
        },
      });
    } catch (error) {
      console.error(
        `Error fetching explanation for question ${questionIndex}:`,
        error
      );
      this.handleExplanationError(questionIndex);
    }
  }

  private handleExplanationError(questionIndex: number): void {
    this.explanationToDisplay = 'Error fetching explanation. Please try again.';
    if (this.isAnswered && this.shouldDisplayExplanation) {
      this.explanationToDisplayChange.emit(this.explanationToDisplay);
      this.showExplanationChange.emit(true);
    }
  }

  private async ensureQuestionIsFullyLoaded(index: number): Promise<void> {
    return this.questionLoader.ensureQuestionIsFullyLoaded(index, this.questionsArray, this.quizId);
  }

  public async getExplanationText(questionIndex: number): Promise<string> {
    return this.explanationManager.getExplanationText(questionIndex);
  }

  private async processExplanationText(
    questionData: QuizQuestion,
    questionIndex: number
  ): Promise<FormattedExplanation | null> {
    const result = await this.explanationManager.processExplanationText(
      questionData,
      questionIndex
    );

    if (result) {
      this.handleFormattedExplanation(result, result.questionIndex);
    }

    return result;
  }

  private async getFormattedExplanation(
    questionData: QuizQuestion,
    questionIndex: number
  ): Promise<{ questionIndex: number; explanation: string }> {
    return this.explanationManager.getFormattedExplanation(questionData, questionIndex);
  }

  private handleFormattedExplanation(
    formattedExplanation: FormattedExplanation,
    questionIndex: number
  ): void {
    const result = this.explanationDisplay.handleFormattedExplanation(
      formattedExplanation,
      this.isAnswered as boolean,
      this.shouldDisplayExplanation
    );
    if (!result.explanationToDisplay) return;

    this.explanationToDisplay = result.explanationToDisplay;
    if (result.shouldEmit) {
      this.explanationToDisplayChange.emit(this.explanationToDisplay);
      this.showExplanationChange.emit(true);
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
            await this.isAnyOptionSelected(adjustedIndex)
          ) {
            // Clear any previous explanation state
            this.clearExplanationState();
            this.explanationToDisplay = explanationText;
            this.explanationToDisplayChange.emit(this.explanationToDisplay);
            this.showExplanationChange.emit(true);

            // Update combined question data with the current explanation
            this.updateCombinedQuestionData(currentQuestion, explanationText);
            this.isAnswerSelectedChange.emit(true);
          } else {
            console.log(
              `Question ${adjustedIndex} is not answered. Skipping explanation update.`
            );
          }
        })
        .catch((renderError) => {
          console.error('Error during question rendering wait:', renderError);
        });
    } catch (error) {
      console.error(
        'Error in setting current question or updating explanation:',
        error
      );
    }
  }

  private waitForQuestionRendering(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  private clearExplanationState(): void {
    this.explanationToDisplayChange.emit('');
    this.showExplanationChange.emit(false);
  }

  updateCombinedQuestionData(
    currentQuestion: QuizQuestion,
    explanationText: string
  ): void {
    this.combinedQuestionData$.next({
      questionText: currentQuestion?.questionText || '',
      explanationText: explanationText,
      correctAnswersText: this.quizService.getCorrectAnswersAsString(),
      currentOptions: this.currentOptions ?? [],
    });
  }

  async onSubmit(): Promise<void> {
    if (!this.validateForm()) {
      return;
    }

    const selectedOption = this.questionForm.get('selectedOption')?.value;
    await this.processAnswer(selectedOption);

    // Emit an event to notify QuizComponent that processing is complete
    this.questionAnswered.emit();
  }

  private validateForm(): boolean {
    if (this.questionForm.invalid) {
      console.log('Form is invalid');
      return false;
    }

    const selectedOption = this.questionForm.get('selectedOption')?.value;
    if (selectedOption === null || selectedOption === undefined) {
      console.log('No option selected');
      return false;
    }

    return true;  // form is valid and option is selected
  }

  private async processAnswer(
    selectedOption: SelectedOption
  ): Promise<boolean> {
    if (
      !selectedOption ||
      !this.currentQuestion?.options.find(
        (opt) => opt.optionId === selectedOption.optionId
      )
    ) {
      console.error('Invalid or unselected option.');
      return false;
    }

    this.answers.push({
      question: this.currentQuestion,
      questionIndex: this.currentQuestionIndex,
      selectedOption: selectedOption,
    });

    let isCorrect = false;
    try {
      isCorrect = await this.quizService.checkIfAnsweredCorrectly();
    } catch (error) {
      console.error('Error checking answer correctness:', error);
    }

    const explanationText = this.currentQuestion?.explanation;

    const quizId = this.quizService.getCurrentQuizId();
    const questionId = this.currentQuestionIndex;

    // Update the state to include the selected option and adjust the number of correct answers
    const selectedOptions = this.currentQuestion?.selectedOptions || [];
    selectedOptions.push(selectedOption); // add the newly selected option
    const numberOfCorrectAnswers = selectedOptions.filter(
      (opt) => opt.correct
    ).length;

    this.quizStateService.setQuestionState(quizId, questionId, {
      isAnswered: true,
      isCorrect: isCorrect,
      explanationText: explanationText,
      selectedOptions: selectedOptions,
      numberOfCorrectAnswers: numberOfCorrectAnswers,
    });

    return isCorrect;
  }

  // Helper method to handle question and selectedOptions changes
  private handleQuestionAndOptionsChange(
    currentQuestionChange: SimpleChange,
    optionsChange: SimpleChange
  ): void {
    const nextQuestion = (currentQuestionChange
      ? (currentQuestionChange.currentValue as QuizQuestion)
      : null) ?? null;

    if (nextQuestion) {
      this.currentQuestion = nextQuestion;
    }

    const incomingOptions = (optionsChange?.currentValue as Option[]) ??
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
        if (opt == null) {
          return null;
        }

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
  }

  // Synchronizes the local option inputs with the currently active question, important for randomization/shuffling
  private refreshOptionsForQuestion(
    question: QuizQuestion | null,
    providedOptions?: Option[] | null
  ): Option[] {
    const baseOptions = Array.isArray(providedOptions) && providedOptions.length
      ? providedOptions
      : Array.isArray(question?.options)
        ? question!.options
        : [];

    if (!baseOptions.length) {
      console.warn('[refreshOptionsForQuestion] No options found for the current question.');
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
      this.quizService.setOptions(this.optionsToDisplay.map((option) => ({ ...option })));
    }

    this.cdRef.markForCheck();
    return normalizedOptions;
  }

  clearSoundFlagsForCurrentQuestion(index: number): void {
    // this.soundService.clearPlayedOptionsForQuestion(index);
  }

  public isQuestionReady(): boolean {
    return (
      !!this.currentQuestion &&
      Array.isArray(this.optionsToDisplay) &&
      this.optionsToDisplay.length > 0
    );
  }

  private clearOptionStateForQuestion(index: number): void {
    this.optionsToDisplay = this.resetManager.clearOptionStateForQuestion(index, this.optionsToDisplay);
    this.cdRef.detectChanges();
  }

  restoreSelectionsAndIconsForQuestion(index: number) {
    this.optionsToDisplay = this.resetManager.restoreSelectionsAndIcons(index, this.optionsToDisplay);
    this.cdRef.detectChanges();
  }

  private hardResetClickGuards(): void {
    const result = this.resetManager.hardResetClickGuards();
    this._clickGate = result.clickGate;
    this.waitingForReady = result.waitingForReady;
    this.deferredClick = result.deferredClick;
    this.lastLoggedQuestionIndex = result.lastLoggedQuestionIndex;
    this.lastLoggedIndex = result.lastLoggedIndex;
    this.selectedIndices?.clear?.();
  }

  // Per-question next and selections reset done from the child, timer
  public resetPerQuestionState(index: number): void {
    const i0 = this.normalizeIndex(index);
    const existingSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(i0) ?? [];
    const hasSelections = existingSelections.length > 0;

    // ── 0) Stop any in-flight UI work ─────────────────────────
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }
    this._skipNextAsyncUpdates = false;

    // Clear stale FET cache so it gets recomputed with the correct question's options.
    // Without this, a previous prewarm that used stale optionsToDisplay would persist.
    this._formattedByIndex.delete(i0);

    // ── 1) Unlock & clear per-question selection/locks ─────────
    this.selectedOptionService.resetLocksForQuestion(i0);
    if (!hasSelections) {
      this.selectedOptionService.clearSelectionsForQuestion(i0);
    } else {
      this.selectedOptionService.republishFeedbackForQuestion(i0);
    }
    this.sharedOptionComponent?.clearForceDisableAllOptions?.();

    // Ensure any previous expiry guards are cleared for this question
    this.handledOnExpiry.delete(i0);
    this.timerService.resetTimerFlagsFor?.(i0);

    // ── 2) Reset disable/feedback maps ─────────────────────────
    this.flashDisabledSet?.clear?.();
    this.feedbackConfigs = {};
    this.lastFeedbackOptionId = -1;

    if (hasSelections) {
      const feedbackMap = this.selectedOptionService.getFeedbackForQuestion(i0);
      this.showFeedbackForOption = { ...feedbackMap };
      this.restoreSelectionsAndIconsForQuestion(i0);
    } else {
      this.showFeedbackForOption = {};
    }

    // If you’re using per-question numeric keys:
    // try { this._idMap?.delete?.(i0); } catch {}

    // ── 3) Explanation & display mode ──────────────────────────
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

    // ── 4) “Fresh question” guard so nothing is disabled on load ─
    this.questionFresh = true;
    this.timedOut = false;

    // fresh question: clear timer guards
    this._timerStoppedForQuestion = false;
    this._lastAllCorrect = false;

    // ── 5) Form state ──────────────────────────────────────────
    try { this.questionForm?.enable({ emitEvent: false }); } catch { }

    // ── 6) Clear any click dedupe/log cosmetics ────────────────
    this.lastLoggedIndex = -1;
    this.lastLoggedQuestionIndex = -1;

    // ── 7) Prewarm explanation cache (no UI toggles here) ──────
    this.resolveFormatted(i0, { useCache: true, setCache: true });

    // ── 8) Timer reset/restart ─────────────────────────────────
    this.timerService.stopTimer?.(undefined, { force: true });
    this.timerService.resetTimer();
    requestAnimationFrame(() =>
      this.timerService.startTimer(this.timerService.timePerQuestion, true)
    );
    queueMicrotask(() => this.emitPassiveNow(index));

    // ── 9) Render ──────────────────────────────────────────────
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

      const qType = this.questions?.[i0]?.type ?? this.currentQuestion?.type;
      if (qType === QuestionType.MultipleAnswer) {
        try {
          this.selectedOptionService.evaluateNextButtonStateForQuestion(
            i0,
            true,
            true
          );
        } catch { }
      } else {
        try { this.selectedOptionService.setAnswered(true); } catch { }
        try { this.nextButtonStateService.setNextButtonState(true); } catch { }
      }

      // Wipe any leftover feedback text
      this.feedbackText = '';
      this.displayExplanation = true;
      this.showExplanationChange?.emit(true);

      this.cdRef.markForCheck();
    });

    // try-finally or just local use; DON'T pollute @Input state during async await
    try {
      const ets = this.explanationTextService;

      // ⏸ Wait if the explanation gate is still locked
      if (ets._fetLocked) {
        console.log(`[onTimerExpiredFor] Waiting for FET unlock before processing Q${this.currentQuestionIndex + 1}`);
        await new Promise(res => setTimeout(res, 60));
      }

      // PREFER cached FET to avoid calling updateExplanationText which triggers
      // purgeAndDefer — that destroys text$ subjects that quiz-content's
      // displayText$ pipeline is subscribed to via getExplanationText$.
      let formattedNow = '';
      const cachedFet = this._formattedByIndex.get(i0)
        ?? ets.fetByIndex?.get(i0)
        ?? ets.formattedExplanations?.[i0]?.explanation
        ?? '';
      if (cachedFet && cachedFet.toLowerCase().includes('correct because')) {
        formattedNow = cachedFet.trim();
        console.log(`[onTimerExpiredFor] Using cached FET for Q${i0 + 1}: "${formattedNow.slice(0, 40)}..."`);
      } else {
        // No cached FET — compute it (this calls purgeAndDefer internally)
        formattedNow = (await this.updateExplanationText(i0))?.toString().trim() ?? '';
      }

      // Guard: skip empty or placeholder text, but wait one frame before giving up
      if (!formattedNow || formattedNow === 'No explanation available for this question.') {
        console.log(`[QQC] 💤 Explanation not ready for Q${i0 + 1} — deferring emit by one frame.`);

        // Wait one paint frame before re-checking
        await new Promise(requestAnimationFrame);

        const retry = (await this.updateExplanationText(i0))?.toString().trim() ?? '';
        if (!retry || retry === 'No explanation available for this question.') {
          console.log(`[QQC] ⚠️ Still no explanation for Q${i0 + 1} — skipping emit.`);
          return; // don’t emit placeholder
        }

        // Use the retried value instead
        ets.emitFormatted(i0, retry);
        this.ngZone.run(() => {
          this.explanationToDisplay = retry;
          this.explanationToDisplayChange.emit(retry);
          this.cdRef.markForCheck();
          this.cdRef.detectChanges();
        });
        return;
      }

      // ⚡ ROBUSTNESS: If we have a valid formatted FET, use it and SKIP the raw fallback
      if (formattedNow && formattedNow !== 'No explanation available for this question.') {
        console.log(`[onTimerExpiredFor] ✅ Using FET on expiry for Q${i0 + 1}: "${formattedNow.slice(0, 40)}..."`);
        ets.emitFormatted(i0, formattedNow, { bypassGuard: true });

        this.ngZone.run(() => {
          this.explanationToDisplay = formattedNow;
          this.explanationToDisplayChange.emit(formattedNow);
          this.cdRef.markForCheck();
          this.cdRef.detectChanges();
        });
      } else {
        // Fallback ONLY if NO FET generated
        const rawBest =
          ((this.questions[i0]?.explanation ?? '') as string).toString().trim() ||
          ((ets.formattedExplanations[i0]?.explanation ?? '') as string).toString().trim() ||
          'Explanation not available.';

        console.warn(`[onTimerExpiredFor] 📄 No FET available on expiry for Q${i0 + 1}. Fallback to raw: "${rawBest.slice(0, 30)}..."`);

        this.ngZone.run(() => {
          ets.setExplanationText(rawBest);
          this.explanationToDisplay = rawBest;
          this.explanationToDisplayChange.emit(rawBest);
          this.cdRef.markForCheck();
          this.cdRef.detectChanges();
        });
      }

      // Final async resolve as double-check/lazy repair (only if we don't have a valid FET yet)
      if (!formattedNow || formattedNow === 'No explanation available for this question.' || !formattedNow.toLowerCase().includes('correct because')) {
        this.resolveFormatted(i0, { useCache: true, setCache: true, timeoutMs: 6000 })
          .then((clean) => {
            const out = (clean ?? '').toString().trim();
            if (!out || out === 'No explanation available for this question.') return;
            const active =
              this.normalizeIndex?.(this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0) ??
              (this.currentQuestionIndex ?? 0);
            if (active !== i0) return;

            console.log(`[onTimerExpiredFor] 🔄 Async resolve produced FET: "${out.slice(0, 30)}..."`);
            this.ngZone.run(() => {
              ets.setExplanationText(out);
              this.explanationToDisplay = out;
              this.explanationToDisplayChange.emit(out);
              this.cdRef.markForCheck();
              this.cdRef.detectChanges();
            });
          })
          .catch(() => { });
      } else {
        console.log(`[onTimerExpiredFor] ✅ FET "sticky" check passed. Skipping resolveFormatted.`);
      }
    } catch (err) {
      console.warn('[onTimerExpiredFor] failed; using raw', err);
    }
  }

  // Always return a 0-based index that exists in `this.questions`
  private normalizeIndex(idx: number): number {
    if (!Number.isFinite(idx)) return 0;

    const normalized = Math.trunc(idx);

    if (!this.questions || this.questions.length === 0) return normalized >= 0 ? normalized : 0;
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

    let text = '';

    try {
      // ────────────────────────────────────────────────
      // Resolve the FET using the specific index i0
      // ────────────────────────────────────────────────

      // Try direct return first
      const out = await this.updateExplanationText(i0);
      let text = (out ?? '').toString().trim();

      // ────────────────────────────────────────────────
      // Fallback: formatter writes to a stream
      // ────────────────────────────────────────────────
      if ((!text || text === 'No explanation available for this question.') &&
        this.explanationTextService.formattedExplanation$) {

        const src$ = this.explanationTextService.formattedExplanation$ as Observable<string | null | undefined>;

        const formatted$: Observable<string> = src$.pipe(
          filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0),
          map(s => s.trim()),
          timeout(timeoutMs),
          take(1)
        );

        try {
          text = await firstValueFrom(formatted$);
        } catch {
          text = '';
        }
      }

      // ────────────────────────────────────────────────
      // Final check — only emit real explanation text
      // ────────────────────────────────────────────────
      if (!text || text === 'No explanation available for this question.') {
        console.log(`[QQC] 💤 Explanation not ready for Q${i0 + 1} — skipping emit.`);
        return '';
      }

      if (text && setCache) this._formattedByIndex.set(i0, text);
      return text;
    } catch (err) {
      console.warn('[resolveFormatted] failed', i0, err);
      return '';
    }
  }

  private emitPassiveNow(index: number): void {
    const i0 = this.normalizeIndex ? this.normalizeIndex(index) : index;

    // Use the freshest live options list
    const opts = Array.isArray(this.optionsToDisplay) ? this.optionsToDisplay : [];

    const fallbackType =
      (opts.filter(o => !!o?.correct).length > 1)
        ? QuestionType.MultipleAnswer
        : QuestionType.SingleAnswer;

    const qType = this.currentQuestion?.type ?? fallbackType;

    // Use a short freeze only for Q1
    const token = this.selectionMessageService.beginWrite(i0, 200);
  }

  public areAllCorrectAnswersSelected(): boolean {
    return this.selectedOptionService.areAllCorrectAnswersSelected(
      this.currentQuestion!,
      this.selectedIndices
    );
  }

  private getStableId(o: Option, idx?: number): string | number {
    return o.optionId ?? o.value ?? `${o.text}-${idx ?? ''}`;
  }

  public revealFeedbackForAllOptions(canonicalOpts: Option[]): void {
    const result = this.feedbackManager.revealFeedbackForAllOptions(
      canonicalOpts,
      this.feedbackConfigs,
      this.showFeedbackForOption
    );
    this.feedbackConfigs = result.feedbackConfigs;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.cdRef.markForCheck();
  }

  private updateShouldRenderOptions(options: Option[] | null | undefined): void {
    const hasRenderableOptions = Array.isArray(options) && options.length > 0;

    if (this.shouldRenderOptions !== hasRenderableOptions) {
      this.shouldRenderOptions = hasRenderableOptions;
      this.cdRef.markForCheck();
    }
  }

  private applyDisplayOrder(options: Option[] | null | undefined): Option[] {
    if (!Array.isArray(options)) return [];
    return options.map((option, index) => ({ ...option, displayOrder: index }));
  }

  // Centralized, reasoned stop. Only stops when allowed.
  private safeStopTimer(reason: 'completed' | 'timeout' | 'navigate'): void {
    const stopped = this.timerEffect.safeStopTimer(reason, this._timerStoppedForQuestion, this._lastAllCorrect);
    if (stopped) {
      this._timerStoppedForQuestion = true;
    }
  }

  // Guard wrapper for display state changes
  private safeSetDisplayState(state: { mode: 'question' | 'explanation', answered: boolean }): void {
    // Suppress any update while restoration lock is active or within the debounce window
    if (this._visibilityRestoreInProgress || performance.now() < this._suppressDisplayStateUntil) {
      console.log('[safeSetDisplayState] 🚫 Suppressed reactive display update during restore:', state);
      return;
    }
    this.displayStateSubject?.next(state);
  }
}
