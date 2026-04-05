import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ComponentRef, EventEmitter, HostListener,
  Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChange, SimpleChanges, ViewChild, ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, Observable, of, Subject, Subscription } from 'rxjs';
import { debounceTime, filter, take } from 'rxjs/operators';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { AnswerComponent } from '../answer/answer-component/answer.component';

import { QuestionType } from '../../../shared/models/question-type.enum';
import { Utils } from '../../../shared/utils/utils';
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
import { QuizStateService } from '../../../shared/services/state/quizstate.service';
import { QuizQuestionLoaderService } from '../../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/flow/quizquestionmgr.service';
import { DynamicComponentService } from '../../../shared/services/ui/dynamic-component.service';
import { ExplanationTextService } from '../../../shared/services/features/explanation-text.service';
import { NextButtonStateService } from '../../../shared/services/state/next-button-state.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../../shared/services/features/selection-message.service';
import { TimerService } from '../../../shared/services/features/timer.service';
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
import { QqcDisplayStateManagerService } from '../../../shared/services/features/qqc-display-state-manager.service';
import { QqcExplanationFlowService } from '../../../shared/services/features/qqc-explanation-flow.service';
import { QqcSubscriptionWiringService } from '../../../shared/services/features/qqc-subscription-wiring.service';
import { QqcLifecycleService } from '../../../shared/services/features/qqc-lifecycle.service';
import { QuizShuffleService } from '../../../shared/services/flow/quiz-shuffle.service';
import { BaseQuestion } from '../base/base-question';
import { SharedOptionComponent } from '../answer/shared-option-component/shared-option.component';
import { FeedbackKey, FeedbackConfig } from '../../../shared/models/FeedbackConfig.model';

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
  answer = new EventEmitter<number>();
  answeredChange = new EventEmitter<boolean>();
  selectionChanged: EventEmitter<{
    question: QuizQuestion,
    selectedOptions: Option[]
  }> = new EventEmitter();
  questionAnswered = new EventEmitter<QuizQuestion>();
  isAnswerSelectedChange = new EventEmitter<boolean>();
  override explanationToDisplayChange = new EventEmitter<string>();
  showExplanationChange = new EventEmitter<boolean>();
  selectionMessageChange = new EventEmitter<string>();
  isAnsweredChange = new EventEmitter<boolean>();
  feedbackTextChange = new EventEmitter<string>();
  isAnswered = false;
  answerSelected = new EventEmitter<boolean>();
  optionSelected = new EventEmitter<SelectedOption>();
  displayStateChange = new EventEmitter<{
    mode: 'question' | 'explanation',
    answered: boolean
  }>();
  feedbackApplied = new EventEmitter<number>();
  nextButtonState = new EventEmitter<boolean>();
  questionAndOptionsReady = new EventEmitter<void>();

  @Input() data!: {
    questionText: string,
    explanationText?: string,
    correctAnswersText?: string,
    options: Option[]
  };
  @Input() questionData!: QuizQuestion;
  @Input() override question!: QuizQuestion;
  @Input() options!: Option[];
  @Input() override optionsToDisplay: Option[] = [];
  @Input() currentQuestion: QuizQuestion | null = null;
  @Input() currentQuestion$: Observable<QuizQuestion | null> = of(null);
  @Input() currentQuestionIndex = 0;
  @Input() previousQuestionIndex!: number;
  @Input() quizId: string | null | undefined = '';
  @Input() explanationText!: string | null;
  @Input() isOptionSelected = false;
  @Input() override showFeedback = false;
  @Input() selectionMessage!: string;
  @Input() reset!: boolean;
  @Input() override explanationToDisplay = '';
  @Input() questionToDisplay$!: Observable<string>;
  @Input() displayState$!: Observable<{ mode: 'question' | 'explanation'; answered: boolean }>;
  @Input() explanation!: string;
  @Input() shouldRenderOptions = false;
  quiz!: Quiz | null;
  questions: QuizQuestion[] = [];
  questionsArray: QuizQuestion[] = [];
  questionsObservableSubscription!: Subscription;
  override questionForm: FormGroup = new FormGroup({});
  questionToDisplay = '';
  private _questionPayload: QuestionPayload | null = null;
  totalQuestions!: number;
  private lastProcessedQuestionIndex: number | null = null;
  fixedQuestionIndex = 0;
  lastLoggedIndex = -1;
  private lastLoggedQuestionIndex = -1;
  private _clickGate = false;  // same-tick re-entrancy guard
  @Output() events = new EventEmitter<QuizQuestionEvent>();
  public selectedIndices = new Set<number>();

  override selectedOption: SelectedOption | null = null;
  selectedOptions: SelectedOption[] = [];
  currentOptions: Option[] | undefined;
  correctAnswers: number[] | undefined;
  override correctMessage = '';
  optionChecked: { [optionId: number]: boolean } = {};
  answers: any[] = [];
  shuffleOptions = true;
  override optionBindings: OptionBindings[] = [];
  override showFeedbackForOption: { [optionId: number]: boolean } = {};
  resetFeedbackSubscription!: Subscription;
  resetStateSubscription!: Subscription;
  sharedVisibilitySubscription!: Subscription;
  shufflePreferenceSubscription!: Subscription;
  private idxSub!: Subscription;
  isMultipleAnswer!: boolean;
  isLoading = true;
  private initialized = false;
  feedbackText = '';
  displayExplanation = false;
  override sharedOptionConfig: SharedOptionConfig | null = null;
  shouldRenderFinalOptions = false;
  public renderReady = false;
  explanationLocked = false;  // flag to lock explanation
  explanationVisible = false;
  displayMode: 'question' | 'explanation' = 'question';
  private displayMode$ = new BehaviorSubject<'question' | 'explanation'>('question');
  private displaySubscriptions: Subscription[] = [];
  private displayModeSubscription!: Subscription;
  private lastOptionsQuestionSignature: string | null = null;
  shouldDisplayExplanation = false;
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
  private forceQuestionDisplay = true;
  readyForExplanationDisplay = false;
  isExplanationReady = false;
  isExplanationLocked = true;
  private _formattedByIndex = new Map<number, string>();
  private handledOnExpiry = new Set<number>();
  private lastSerializedOptions = '';
  private payloadSubject = new BehaviorSubject<QuestionPayload | null>(null);
  private hydrationInProgress = false;

  public finalRenderReadySubject = new BehaviorSubject<boolean>(false);
  public finalRenderReady$ = this.finalRenderReadySubject.asObservable();
  public finalRenderReady = false;

  private _fetEarlyShown = new Set<number>();


  private questionPayloadSubject = new BehaviorSubject<QuestionPayload | null>(null);

  private renderReadySubject = new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();
  private renderReadySubscription?: Subscription;

  waitingForReady = false;
  deferredClick?: { option: SelectedOption | null, index: number, checked: boolean, wasReselected?: boolean };

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

  private _abortController: AbortController | null = null;

  private _visibilityRestoreInProgress = false;
  private _suppressDisplayStateUntil = 0;

  private destroy$: Subject<void> = new Subject<void>();

  constructor(
    protected override quizService: QuizService,
    protected override quizStateService: QuizStateService,
    protected quizQuestionLoaderService: QuizQuestionLoaderService,
    protected quizQuestionManagerService: QuizQuestionManagerService,
    protected override dynamicComponentService: DynamicComponentService,
    protected explanationTextService: ExplanationTextService,
    protected override feedbackService: FeedbackService,
    protected nextButtonStateService: NextButtonStateService,
    protected override selectedOptionService: SelectedOptionService,
    protected selectionMessageService: SelectionMessageService,
    protected timerService: TimerService,
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
    protected activatedRoute: ActivatedRoute,
    protected quizShuffleService: QuizShuffleService,
    protected displayStateManager: QqcDisplayStateManagerService,
    protected explanationFlow: QqcExplanationFlowService,
    protected subscriptionWiring: QqcSubscriptionWiringService,
    protected lifecycle: QqcLifecycleService,
    protected override fb: FormBuilder,
    protected override cdRef: ChangeDetectorRef,
    protected router: Router,
    protected ngZone: NgZone
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
      // manual test call purgeAndDefer(99)
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
    if (!value) return;

    try {
      this._questionPayload = value;
      this.questionPayloadSubject.next(value);
      this.hydrateFromPayload(value);
    } catch {
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
    this.lifecycle.performRefTrace({ questions: this.quizService.questions, qIndex });

    this.idxSub = this.lifecycle.createIndexTimerSubscription({
      currentQuestionIndex$: this.quizService.currentQuestionIndex$,
      elapsedTime$: this.timerService.elapsedTime$,
      timePerQuestion: this.timerService.timePerQuestion,
      normalizeIndex: (idx) => this.normalizeIndex(idx),
      resetPerQuestionState: (i0) => this.resetPerQuestionState(i0),
      deleteHandledOnExpiry: (i0) => this.handledOnExpiry.delete(i0),
      emitPassiveNow: (i0) => this.emitPassiveNow(i0),
      prewarmResolveFormatted: (i0) => {
        if (!this._formattedByIndex?.has?.(i0)) {
          this.resolveFormatted(i0, { useCache: true, setCache: true }).catch(() => {});
        }
      },
      onTimerExpiredFor: (i0) => this.onTimerExpiredFor(i0),
    });

    this.subscriptionWiring.createCurrentQuestionIndexSubscription(
      (index: number) => {
        this.currentQuestionIndex = index;
      }
    );

    this.subscriptionWiring.createQuestionPayloadSubscription({
      onPayload: (payload: QuestionPayload) => {
        this.currentQuestion = payload.question;
        this.optionsToDisplay = payload.options;
        this.explanationToDisplay = payload.explanation ?? '';
        this.updateShouldRenderOptions(this.optionsToDisplay);
      },
    });

    this.shufflePreferenceSubscription = this.subscriptionWiring.createShufflePreferenceSubscription(
      (shouldShuffle) => {
        this.shuffleOptions = shouldShuffle;
      }
    );

    const navSubs = this.subscriptionWiring.createNavigationEventSubscriptions({
      onNavigationSuccess: () => this.resetUIForNewQuestion(),
      onNavigatingBack: () => {
        if (this.sharedOptionComponent) {
          this.sharedOptionComponent.isNavigatingBackwards = true;
        }
        this.resetUIForNewQuestion();
      },
      onNavigationToQuestion: ({ question, options }) => {
        if (!this.containerInitialized && this.dynamicAnswerContainer) {
          this.loadDynamicComponent(question, options);
          this.containerInitialized = true;
        }

        this.sharedOptionConfig = null;
      },
      onExplanationReset: () => this.resetExplanation(),
      onRenderReset: () => { this.renderReady = false; },
      onResetUIForNewQuestion: () => this.resetUIForNewQuestion(),
    });
    navSubs.forEach(sub => this.displaySubscriptions.push(sub));

    this.subscriptionWiring.createPreResetSubscription({
      destroy$: this.destroy$,
      onPreReset: (idx) => this.resetPerQuestionState(idx),
      getLastResetFor: () => this.lastResetFor,
      setLastResetFor: (idx) => { this.lastResetFor = idx; },
    });

    this.subscriptionWiring.createRouteParamSubscription({
      activatedRoute: this.activatedRoute,
      onRouteChange: async (questionIndex: number) => {
        this.explanationVisible = false;
        this.explanationText = '';

        try {
          const question = await firstValueFrom(
            this.quizService.getQuestionByIndex(questionIndex)
          );
          if (!question) return;
        } catch { }
      },
    });

    const initialIdx = this.lifecycle.computeInitialQuestionIndex(this.activatedRoute);
    this.currentQuestionIndex = initialIdx.currentQuestionIndex;
    this.fixedQuestionIndex = initialIdx.fixedQuestionIndex;

    const loaded = await this.loadQuestion();
    if (!loaded) return;

    this.subscriptionWiring.createTimerExpiredSubscription({
      destroy$: this.destroy$,
      timerExpired$: this.timerService.expired$,
      onExpired: () => {
        const idx = this.normalizeIndex(this.currentQuestionIndex ?? 0);
        this.onQuestionTimedOut(idx);
      },
    });

    this.subscriptionWiring.createTimerStopSubscription({
      destroy$: this.destroy$,
      timerStop$: this.timerService.stop$,
      onTimerStopped: () => {
        const reason = this.timedOut ? 'timeout' : 'stopped';
        this.handleTimerStoppedForActiveQuestion(reason);
      },
    });

    try {
      // Call the parent class's ngOnInit method
      super.ngOnInit();

      this.populateOptionsToDisplay();

      // Initialize display mode subscription for reactive updates
      this.displayModeSubscription = this.subscriptionWiring.createDisplayModeSubscription(
        this.currentQuestionIndex,
        false
      );

      this.renderReady$ = this.lifecycle.createRenderReadyObservable({
        questionPayloadSubject: this.questionPayloadSubject,
        setCurrentQuestion: (q) => { this.currentQuestion = q; },
        setOptionsToDisplay: (opts) => { this.optionsToDisplay = opts; },
        setExplanationToDisplay: (text) => { this.explanationToDisplay = text; },
        setRenderReady: (val) => { this.renderReady = val; },
        emitRenderReady: (val) => this.renderReadySubject.next(val),
      });
      this.renderReadySubscription = this.renderReady$.subscribe();

      // Add the visibility change listener
      document.addEventListener(
        'visibilitychange',
        this.onVisibilityChange.bind(this)
      );

      // Initial component setups
      this.questionLoader.initializeComponentState({
        questionsArray: this.questionsArray,
        currentQuestionIndex: this.currentQuestionIndex,
      }).then((result) => {
        if (!result) return;
        this.questionsArray = result.questionsArray;
        this.currentQuestionIndex = result.currentQuestionIndex;
        this.currentQuestion = result.currentQuestion;
        this.generateFeedbackText(this.currentQuestion).then(
          (text) => { this.feedbackText = text; },
          () => { this.feedbackText = 'Unable to generate feedback.'; }
        );
      });
      // Initialize component state
      this.questionLoader.waitForQuestionData({
        currentQuestionIndex: this.currentQuestionIndex,
        quizId: this.quizService.quizId,
      }).then((waitResult) => {
        if (!waitResult.currentQuestion) return;
        this.currentQuestionIndex = waitResult.currentQuestionIndex;
        this.currentQuestion = waitResult.currentQuestion;
        this.optionsToDisplay = waitResult.optionsToDisplay;
        this.quizService
          .getCurrentOptions(this.currentQuestionIndex)
          .pipe(take(1))
          .subscribe((options: Option[]) => {
            this.optionsToDisplay = Array.isArray(options) ? options : [];
            const previouslySelectedOption = this.optionsToDisplay.find((opt) => opt.selected);
            if (previouslySelectedOption) {
              this.applyOptionFeedback(previouslySelectedOption);
            }
          });
        this.initializeForm();
        this.questionForm.updateValueAndValidity();
        window.scrollTo(0, 0);
      });
      if (this.question) {
        this.data = this.questionLoader.buildInitialData(this.question, this.options);
      }
      this.initializeForm();
      this.quizStateService.setLoading(true);

      // Initialize quiz data and routing
      await this.initializeQuiz();
      await this.initializeQuizDataAndRouting();

      // Initialize questions
      const quizQuestionSub = this.initializer.initializeQuizQuestion({
        onQuestionsLoaded: (_questions: QuizQuestion[]) => {
          // Questions loaded callback - state updates handled by initializer
        },
      });
      if (quizQuestionSub) {
        this.questionsObservableSubscription = quizQuestionSub;
      }
      // Initialize first question from route
      const questionIndexParam = this.activatedRoute.snapshot.paramMap.get('questionIndex');
      const firstQuestionIndex = this.initializer.parseQuestionIndexFromRoute(questionIndexParam);
      const firstQResult = this.initializer.setQuestionFirst({
        index: firstQuestionIndex,
        questionsArray: this.questionsArray,
      });
      if (firstQResult) {
        this.currentQuestion = firstQResult.currentQuestion;
        this.optionsToDisplay = firstQResult.optionsToDisplay;
        if (this.lastProcessedQuestionIndex !== firstQResult.questionIndex || firstQResult.questionIndex === 0) {
          this.lastProcessedQuestionIndex = firstQResult.questionIndex;
        }
        setTimeout(() => {
          this.updateExplanationIfAnswered(firstQResult.questionIndex, firstQResult.currentQuestion!);
        }, 50);
      }
      // Initialize question state
      if (this.currentQuestionIndex === 0) {
        const initialMessage = 'Please start the quiz by selecting an option.';
        if (this.selectionMessage !== initialMessage) {
          this.selectionMessage = initialMessage;
        }
      } else {
        this.resetManager.clearSelection(this.correctAnswers, this.currentQuestion);
      }

      // Setup for visibility and routing
      this.sharedVisibilitySubscription = this.subscriptionWiring.createVisibilitySubscription({
        onHidden: () => this.handlePageVisibilityChange(true),
        onVisible: () => this.handlePageVisibilityChange(false),
      });

      this.subscriptionWiring.createRouteListener({
        activatedRoute: this.activatedRoute,
        getQuestionsLength: () => this.questions?.length ?? 0,
        onRouteChange: (adjustedIndex: number) => {
          this.quizService.updateCurrentQuestionIndex(adjustedIndex);
          this.fetchAndSetExplanationText(adjustedIndex);
        },
      });

      // Additional subscriptions and state tracking
      const resetSubs = this.subscriptionWiring.createResetSubscriptions({
        onResetFeedback: () => this.resetFeedback(),
        onResetState: () => this.resetState(),
      });
      this.resetFeedbackSubscription = resetSubs[0];
      this.resetStateSubscription = resetSubs[1];

      this.subscriptionWiring.createTotalQuestionsSubscription({
        quizId: this.quizId!,
        destroy$: this.destroy$,
        onTotal: (totalQuestions: number) => {
          this.totalQuestions = totalQuestions;
        },
      });
    } catch (error) {
      console.error('Error in ngOnInit:', error);
    }
  }

  async ngAfterViewInit(): Promise<void> {
    const idx = this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0;
    this.resetForQuestion(idx);  // starts timer for Q1

    this.lifecycle.deferRenderReadySubscription({
      sharedOptionComponent: this.sharedOptionComponent,
      subscribeToRenderReady: () => {
        if (!this.sharedOptionComponent) return;
        this.sharedOptionComponent.renderReady$
          .pipe(filter((ready) => ready === true), take(1))
          .subscribe(() => this.cdRef.detectChanges());
      },
    });

    this.lifecycle.createOptionsLoaderSubscription({
      options$: this.quizQuestionLoaderService.options$,
      setCurrentOptions: (opts) => { this.currentOptions = opts; },
    });

    // Hydrate from payload via question loader service
    this.questionLoader.createPayloadHydrationSubscription({
      payloadSubject: this.payloadSubject,
      getHydrationInProgress: () => this.hydrationInProgress,
      setHydrationInProgress: (val) => { this.hydrationInProgress = val; },
      setRenderReady: (val) => { this.renderReady = val; },
      setCurrentQuestion: (q) => { this.currentQuestion = q; },
      setExplanationToDisplay: (text) => { this.explanationToDisplay = text; },
      setOptionsToDisplay: (opts) => { this.optionsToDisplay = opts; },
      initializeOptionBindings: () => {
        if (this.sharedOptionComponent) {
          this.sharedOptionComponent.initializeOptionBindings();
        }
      },
      releaseBaseline: (idx) => this.selectionMessageService.releaseBaseline(idx),
      getCurrentQuestionIndex: () => this.currentQuestionIndex,
      detectChanges: () => this.cdRef.detectChanges(),
    });

    const index = this.currentQuestionIndex;

    // Perform post-view-init question setup via question loader service
    const setupResult = await this.questionLoader.performAfterViewInitQuestionSetup({
      questionsArray: this.questionsArray,
      currentQuestionIndex: index,
      getFormattedExplanation: (q, idx) => this.explanationManager.getFormattedExplanation(q, idx),
      updateExplanationUI: (idx, text) => this.updateExplanationUI(idx, text),
    });

    if (!setupResult) {
      setTimeout(() => this.ngAfterViewInit(), 50);  // retry after a short delay
      return;
    }
  }

  override async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // Guard: safely reset _fetEarlyShown only when truly moving to a different question
    // (not during hydration or first render)
    const fetClear = this.displayStateManager.shouldClearFetEarlyShown({
      newIndex: changes['currentQuestionIndex']?.currentValue,
      prevIndex: changes['currentQuestionIndex']?.previousValue,
    });
    if (fetClear.shouldClear && this._fetEarlyShown instanceof Set) {
      this._fetEarlyShown.delete(fetClear.indexToClear);
    }

    if (changes['questionPayload'] && this.questionPayload) {
      this.hydrateFromPayload(this.questionPayload);
      this.questionPayloadSubject.next(this.questionPayload);
      setTimeout(() => {
        if (this.displayStateManager.shouldTriggerHydrationFallback({
          renderReady: this.renderReady,
          options: this.optionsToDisplay,
        })) {
          this.renderReady = true;
          this.cdRef.detectChanges();
        }
      }, 150);
    }

    if (
      changes['currentQuestionIndex'] &&
      !changes['currentQuestionIndex'].firstChange
    ) {
      this.explanationVisible = false;
      this.explanationText = '';
    }

    if (changes['question']) {
      this.optionsToDisplay = this.resetManager.clearOptionStateForQuestion(this.previousQuestionIndex, this.optionsToDisplay);
      this.cdRef.detectChanges();
    }

    if (changes['question'] || changes['options']) {
      this.unselectOption();  // clears per-question UI state
      this.handleQuestionAndOptionsChange(
        changes['question'],
        changes['options']
      );

      if (this.currentQuestionIndex != null) {
        this.restoreSelectionsAndIconsForQuestion(
          this.quizService.currentQuestionIndex
        );
      }

      this.previousQuestionIndex = this.currentQuestionIndex;
    }

    const isRenderReady = this.displayStateManager.computeRenderReadyFromInputs({
      questionDataText: this.questionData?.questionText,
      currentQuestionText: this.currentQuestion?.questionText,
      options: this.options,
    });

    if (isRenderReady) {
      // Use setTimeout to allow DOM update cycle
      setTimeout(() => {
        this.renderReadySubject.next(true);
      }, 0);
    } else {
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
    this.sharedVisibilitySubscription?.unsubscribe();
    this.resetFeedbackSubscription?.unsubscribe();
    this.resetStateSubscription?.unsubscribe();
    this.displayModeSubscription?.unsubscribe();
    this.renderReadySubscription?.unsubscribe();
    this.shufflePreferenceSubscription?.unsubscribe();
    this.nextButtonStateService.cleanupNextButtonStateStream();
  }

  @HostListener('window:visibilitychange', [])
  async onVisibilityChange(): Promise<void> {
    if (document.visibilityState === 'hidden') {
      this.navigationHandler.persistStateOnHide({ quizId: this.quizId!, currentQuestionIndex: this.currentQuestionIndex ?? 0, displayExplanation: this.displayExplanation });
      this.navigationHandler.resetExplanationStateOnHide();
      await this.navigationHandler.captureElapsedOnHide();
      return;
    }

    try {
      const { shouldExpire, expiredIndex } = await this.navigationHandler.handleFastPathExpiry({
        currentQuestionIndex: this.currentQuestionIndex ?? 0, displayExplanation: this.displayExplanation,
        normalizeIndex: (idx) => this.normalizeIndex(idx),
      });
      if (shouldExpire) {
        this.timerService.stopTimer?.(undefined, { force: true });
        this.ngZone.run(() => this.onTimerExpiredFor(expiredIndex));
        return;
      }
    } catch {}

    try {
      if (document.visibilityState !== 'visible') return;
      this._visibilityRestoreInProgress = true;
      (this.explanationTextService as any)._visibilityLocked = true;
      this._suppressDisplayStateUntil = performance.now() + 300;

      const restoreResult = await this.navigationHandler.performFullVisibilityRestore({
        quizId: this.quizId!, currentQuestionIndex: this.currentQuestionIndex ?? 0,
        optionsToDisplay: this.optionsToDisplay, currentQuestion: this.currentQuestion,
        generateFeedbackText: (q) => this.generateFeedbackText(q),
        applyOptionFeedback: (opt) => this.applyOptionFeedback(opt),
        restoreFeedbackState: () => { this.optionsToDisplay = this.feedbackManager.restoreFeedbackState(this.currentQuestion, this.optionsToDisplay, this.correctMessage); },
      });

      this.displayState.mode = restoreResult.displayMode as 'question' | 'explanation';
      this.optionsToDisplay = restoreResult.optionsToDisplay;
      this.feedbackText = restoreResult.feedbackText;
      this.displayExplanation = restoreResult.shouldShowExplanation;
      this.safeSetDisplayState(restoreResult.shouldShowExplanation ? { mode: 'explanation', answered: true } : { mode: 'question', answered: false });

      setTimeout(() => {
        (this.explanationTextService as any)._visibilityLocked = false;
        this._visibilityRestoreInProgress = false;
        setTimeout(() => this.navigationHandler.refreshExplanationStatePostRestore(this.currentQuestionIndex ?? 0), 400);
      }, 350);
    } catch {}
  }


  private applyExplanationTextInZone(text: string): void {
    this.ngZone.run(() => {
      this.explanationToDisplay = text;
      this.explanationToDisplayChange.emit(text);
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();
    });
  }

  private applyExplanationFlags(flags: {
    forceQuestionDisplay: boolean;
    readyForExplanationDisplay: boolean;
    isExplanationReady: boolean;
    isExplanationLocked: boolean;
    explanationLocked: boolean;
    explanationVisible: boolean;
    displayExplanation: boolean;
    shouldDisplayExplanation: boolean;
    isExplanationTextDisplayed: boolean;
  }): void {
    this.forceQuestionDisplay = flags.forceQuestionDisplay;
    this.readyForExplanationDisplay = flags.readyForExplanationDisplay;
    this.isExplanationReady = flags.isExplanationReady;
    this.isExplanationLocked = flags.isExplanationLocked;
    this.explanationLocked = flags.explanationLocked;
    this.explanationVisible = flags.explanationVisible;
    this.displayExplanation = flags.displayExplanation;
    this.shouldDisplayExplanation = flags.shouldDisplayExplanation;
  }

  private applyDisplayState(state: { mode: 'question' | 'explanation'; answered: boolean }): void {
    this.displayState = state;
    this.displayStateSubject.next(this.displayState);
    this.displayStateChange.emit(this.displayState);
  }

  private emitExplanationChange(text: string, show: boolean): void {
    this.explanationToDisplayChange.emit(text);
    this.showExplanationChange.emit(show);
  }

  private updateDisplayMode(mode: 'question' | 'explanation'): void {
    this.displayMode = mode;
    this.displayMode$.next(mode);
  }

  private markRenderReady(): void {
    this.finalRenderReady = true;
    this.renderReady = true;
    this.renderReadySubject.next(true);
    this.cdRef.markForCheck();
  }

  public updateOptionsSafely(newOptions: Option[]): void {
    const result = this.displayStateManager.prepareOptionSwap({
      newOptions,
      currentOptionsJson: JSON.stringify(this.optionsToDisplay),
    });

    if (result.needsSwap) {
      this.renderReadySubject.next(false);
      this.finalRenderReady = false;
      this.questionForm = result.formGroup;
      if (result.serialized !== this.lastSerializedOptions) {
        this.lastSerializedOptions = result.serialized;
      }
      this.optionsToDisplay = result.cleanedOptions;
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.initializeOptionBindings();
      }
      setTimeout(() => {
        if (this.displayStateManager.computeRenderReadiness(this.optionsToDisplay)) {
          this.markRenderReady();
        }
      }, 0);
    } else if (this.displayStateManager.computeRenderReadiness(this.optionsToDisplay) && !this.finalRenderReady) {
      this.markRenderReady();
    }
  }

  private hydrateFromPayload(payload: QuestionPayload): void {
    const result = this.displayStateManager.hydrateFromPayload({
      payload, currentQuestionText: this.currentQuestion?.questionText?.trim(), isAlreadyRendered: this.finalRenderReady,
    });
    if (!result) return;

    this.renderReady = false;
    this.finalRenderReady = false;
    this.renderReadySubject.next(false);
    this.finalRenderReadySubject.next(false);
    this.cdRef.detectChanges();

    this.currentQuestion = result.currentQuestion;
    this.optionsToDisplay = result.optionsToDisplay;
    this.updateShouldRenderOptions(this.optionsToDisplay);
    this.explanationToDisplay = result.explanationToDisplay;

    if (!this.containerInitialized && this.dynamicAnswerContainer) {
      this.loadDynamicComponent(this.currentQuestion, this.optionsToDisplay);
      this.containerInitialized = true;
    }
    this.sharedOptionComponent?.initializeOptionBindings();

    setTimeout(() => {
      const bindingsReady = Array.isArray(this.sharedOptionComponent?.optionBindings) &&
        this.sharedOptionComponent.optionBindings.length > 0 &&
        this.sharedOptionComponent.optionBindings.every((b) => !!b.option);
      if (this.displayStateManager.computeRenderReadiness(this.optionsToDisplay) && bindingsReady) {
        this.sharedOptionComponent?.markRenderReady('✅ Hydrated from new payload');
      }
    }, 0);
  }

  async initializeQuizDataAndRouting(): Promise<void> {
    const result = await this.questionLoader.performQuizDataAndRoutingInit({ quizId: this.quizId });
    if (!result) return;

    this.questions = result.questions;
    this.questionsArray = result.questions;
    if (result.quiz) this.quiz = result.quiz;
    if (!this.quiz) return;

    this.quizService.questionsLoaded$
      .pipe(take(1), debounceTime(100))
      .subscribe((loaded) => {
        if (loaded) this.setupRouteChangeHandler();
      });
  }

  private setupRouteChangeHandler(): void {
    this.subscriptionWiring.createRouteChangeHandlerSubscription({
      activatedRoute: this.activatedRoute,
      getTotalQuestions: () => this.totalQuestions,
      parseRouteIndex: (rawParam) => this.initializer.handleRouteChangeParsing({ rawParam, totalQuestions: this.totalQuestions }),
      onRouteChange: async (zeroBasedIndex, displayIndex) => {
        this.currentQuestionIndex = zeroBasedIndex;
        this.explanationVisible = false;
        this.explanationText = '';

        const routeResult = await this.questionLoader.performRouteChangeUpdate({
          zeroBasedIndex, questionsArray: this.questionsArray,
          loadQuestion: () => this.loadQuestion(),
          isAnyOptionSelected: (idx) => this.isAnyOptionSelected(idx),
          updateExplanationText: (idx) => this.updateExplanationText(idx),
          shouldDisplayExplanation: this.shouldDisplayExplanation,
          questionForm: this.questionForm,
        });

        if (!routeResult) return;
        this.currentQuestion = routeResult.currentQuestion;
        this.optionsToDisplay = routeResult.optionsToDisplay;

        if (this.shouldDisplayExplanation) {
          this.showExplanationChange.emit(true);
          const transition = this.explanationDisplay.computeExplanationModeTransition(this.shouldDisplayExplanation, this.displayMode$.getValue());
          if (transition) {
            this.applyDisplayState(transition.displayState);
            this.updateDisplayMode(transition.displayMode);
            const f = transition.explanationFlags;
            this.shouldDisplayExplanation = f.shouldDisplayExplanation;
            this.explanationVisible = f.explanationVisible;
            this.forceQuestionDisplay = f.forceQuestionDisplay;
            this.readyForExplanationDisplay = f.readyForExplanationDisplay;
            this.isExplanationReady = f.isExplanationReady;
            this.isExplanationLocked = f.isExplanationLocked;
          }
        }
      },
    });
  }


  private async updateExplanationIfAnswered(index: number, question: QuizQuestion): Promise<void> {
    const result = await this.explanationFlow.updateExplanationIfAnswered({
      index, question, shouldDisplayExplanation: this.shouldDisplayExplanation,
      isAnyOptionSelected: (idx) => this.isAnyOptionSelected(idx),
      getFormattedExplanation: (q, idx) => this.explanationManager.getFormattedExplanation(q, idx),
    });
    if (result.shouldUpdate) {
      this.explanationToDisplay = result.explanationText;
      this.emitExplanationChange(this.explanationToDisplay, true);
      this.isAnswerSelectedChange.emit(true);
    }
  }

  private handlePageVisibilityChange(isHidden: boolean): void {
    const action = this.navigationHandler.computeVisibilityAction(isHidden);
    if (action.shouldClearSubscriptions) {
      this.displaySubscriptions?.forEach(sub => sub.unsubscribe());
      this.displaySubscriptions = [];
      const cleanup = this.navigationHandler.computeDisplaySubscriptionCleanup();
      this.explanationToDisplay = cleanup.explanationToDisplay;
      this.emitExplanationChange('', cleanup.showExplanation);
    }
    if (action.shouldRefreshExplanation) this.prepareAndSetExplanationText(this.currentQuestionIndex);
  }

  public override async loadDynamicComponent(question: QuizQuestion, options: Option[]): Promise<void> {
    try {
      if (!question || !Array.isArray(options) || !options.length || !this.dynamicAnswerContainer || !('questionText' in question)) return;
      let isMultipleAnswer = false;
      try {
        isMultipleAnswer = await firstValueFrom(this.quizQuestionManagerService.isMultipleAnswerQuestion(question));
      } catch {
        return;
      }

      this.dynamicAnswerContainer.clear();
      await Promise.resolve();
      const componentRef: ComponentRef<AnswerComponent> = await this.dynamicComponentService.loadComponent(this.dynamicAnswerContainer, isMultipleAnswer, this.onOptionClicked.bind(this));
      if (!componentRef?.instance) return;
      const instance = componentRef.instance;

      const configured = this.questionLoader.configureDynamicInstance({ instance, question, options, isMultipleAnswer, currentQuestionIndex: this.currentQuestionIndex, navigatingBackwards: false, defaultConfig: this.getDefaultSharedOptionConfig?.(), onOptionClicked: this.onOptionClicked.bind(this) });
      this.questionData = configured.questionData;
      this.sharedOptionConfig = configured.sharedOptionConfig;
      this.cdRef.markForCheck();
      await (instance as any).initializeSharedOptionConfig(configured.clonedOptions);
      if (!Object.prototype.hasOwnProperty.call(instance, 'onOptionClicked')) instance.onOptionClicked = this.onOptionClicked.bind(this);
      this.updateShouldRenderOptions(instance.optionsToDisplay);
      if (this.displayStateManager.computeRenderReadiness(instance.optionsToDisplay)) this.shouldRenderOptions = true;
    } catch (error) { console.error('[loadDynamicComponent] Failed:', error); }
  }

  public async loadQuestion(signal?: AbortSignal): Promise<boolean> {
    // ABSOLUTE LOCK: prevent stale FET display
    this.readyForExplanationDisplay = false;
    this.isExplanationReady = false;
    this.isExplanationLocked = true;
    this.forceQuestionDisplay = true;

    const shouldPreserveVisualState = this.questionLoader.canRenderQuestionInstantly(this.questionsArray, this.currentQuestionIndex);
    const explanationSnapshot = this.explanationManager.captureExplanationSnapshot({
      preserveVisualState: shouldPreserveVisualState, index: this.currentQuestionIndex,
      explanationToDisplay: this.explanationToDisplay, quizId: this.quizId,
      isAnswered: this.isAnswered as boolean, displayMode: this.displayMode$.getValue(),
      shouldDisplayExplanation: this.shouldDisplayExplanation, explanationVisible: this.explanationVisible,
      displayExplanation: this.displayExplanation, displayStateAnswered: this.displayState?.answered,
    });
    const shouldKeepExplanationVisible = explanationSnapshot.shouldRestore;

    this.questionLoader.performPreLoadReset({ shouldPreserveVisualState, shouldKeepExplanationVisible, currentQuestionIndex: this.currentQuestionIndex });

    if (shouldPreserveVisualState) { this.isLoading = false; }
    else {
      this.isLoading = true;
      this.quizStateService.setLoading(true);
      this.quizStateService.setAnswerSelected(false);
      if (!this.quizStateService.isLoading()) this.quizStateService.startLoading();
    }

    try {
      this.selectedOptionId = null;
      const lockedIndex = this.currentQuestionIndex;

      await this.resetQuestionStateBeforeNavigation({ preserveVisualState: shouldPreserveVisualState, preserveExplanation: shouldKeepExplanationVisible });

      if (!shouldKeepExplanationVisible) {
        const clearResult = this.questionLoader.performPostResetExplanationClear();
        this.renderReadySubject.next(false);
        this.displayState = clearResult.displayState;
        this.forceQuestionDisplay = clearResult.forceQuestionDisplay;
        this.readyForExplanationDisplay = clearResult.readyForExplanationDisplay;
        this.isExplanationReady = clearResult.isExplanationReady;
        this.isExplanationLocked = clearResult.isExplanationLocked;
        this.feedbackText = clearResult.feedbackText;
      } else {
        const restoreResult = this.explanationFlow.computeRestoreAfterReset({
          questionIndex: lockedIndex, explanationText: explanationSnapshot.explanationText,
          questionState: explanationSnapshot.questionState, quizId: this.quizId,
          quizServiceQuizId: this.quizService.quizId, currentQuizId: this.quizService.getCurrentQuizId(),
        });
        if (!restoreResult.shouldSkip) {
          this.explanationToDisplay = restoreResult.explanationText;
          this.updateDisplayMode(restoreResult.displayMode);
          this.applyDisplayState(restoreResult.displayState);
          this.applyExplanationFlags(restoreResult);
          this.emitExplanationChange(restoreResult.explanationText, true);
        }
      }

      // Core loading via service (timer start, fetch, validate, prepare, emit)
      const loadResult = await this.questionLoader.performLoadQuestionPostReset({
        currentQuestionIndex: this.currentQuestionIndex, questionsArray: this.questionsArray,
        quizId: this.quizId, signal, questions: this.questions,
      });

      if (!loadResult) return false;
      if (loadResult.shouldRedirect) {
        await this.router.navigate(['/results', this.quizId]);
        return false;
      }

      this.questionsArray = loadResult.questionsArray;
      this.currentQuestion = loadResult.currentQuestion;
      this.optionsToDisplay = loadResult.optionsToDisplay;
      this.questionToDisplay = loadResult.questionToDisplay;
      this.updateShouldRenderOptions(this.optionsToDisplay);

      const banner = this.feedbackManager.computeCorrectAnswersBanner({ currentQuestion: this.currentQuestion, currentQuestionIndex: this.currentQuestionIndex });
      this.quizService.updateCorrectAnswersText(banner.bannerText);

      if (this.sharedOptionComponent) this.sharedOptionComponent.initializeOptionBindings();
      this.cdRef.markForCheck();

      if (this.currentQuestion && this.optionsToDisplay?.length > 0) {
        this.questionAndOptionsReady.emit();
        this.quizService.emitQuestionAndOptions(this.currentQuestion, this.optionsToDisplay, this.currentQuestionIndex);
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

  public async generateFeedbackText(question: QuizQuestion): Promise<string> {
    if (!this.optionsToDisplay?.length) this.populateOptionsToDisplay();
    this.feedbackText = this.feedbackManager.generateFeedbackText(question, this.optionsToDisplay);
    this.feedbackTextChange.emit(this.feedbackText); return this.feedbackText;
  }

  private async initializeQuiz(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.quizId = this.activatedRoute.snapshot.paramMap.get('quizId');
    this.isLoading = true;
    try {
      const result = await this.initializer.performFullQuizInit({
        currentQuestionIndex: this.currentQuestionIndex,
        questionsArray: this.questionsArray,
        routeQuizId: this.quizId,
        setQuestionOptions: () => this.setQuestionOptions(),
        questionLoader: this.questionLoader,
        prepareExplanationForQuestion: (p) => this.initializer.prepareExplanationForQuestion(p),
        getExplanationText: (idx) => this.explanationManager.getExplanationText(idx),
      });
      if (result) {
        this.questionsArray = result.questionsArray;
        this.questions = result.questions;
        this.quizId = result.quizId;
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async isAnyOptionSelected(questionIndex: number): Promise<boolean> {
    const rs = this.optionSelection.resetStateForNewQuestion();
    this.showFeedbackForOption = rs.showFeedbackForOption;
    this.showFeedback = rs.showFeedback;
    this.correctMessage = rs.correctMessage;
    this.selectedOption = rs.selectedOption;
    this.isOptionSelected = rs.isOptionSelected;
    this.emitExplanationChange('', false);
    try {
      return await firstValueFrom(this.quizService.isAnswered(questionIndex));
    } catch {
      return false;
    }
  }

  setQuestionOptions(): void {
    this.quizService.getQuestionByIndex(this.currentQuestionIndex).pipe(take(1)).subscribe((currentQuestion: QuizQuestion | null) => {
      if (!currentQuestion) return;
      this.currentQuestion = currentQuestion;
      this.currentOptions = this.displayStateManager.buildOptionsWithCorrectness(currentQuestion);
      if (this.currentOptions.length === 0) return;
      if (this.shuffleOptions) Utils.shuffleArray(this.currentOptions);
      this.currentOptions = this.displayStateManager.applyDisplayOrder(this.currentOptions);
      this.optionsToDisplay = this.currentOptions.map((o) => ({ ...o }));
      this.updateShouldRenderOptions(this.optionsToDisplay);
      this.quizService.nextOptionsSubject.next(this.optionsToDisplay.map((o) => ({ ...o })));
      this.cdRef.markForCheck();
    });
  }

  public resetState(): void {
    const result = this.resetManager.resetState();
    this.selectedOption = result.selectedOption;
    this.options = result.options;
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

    this._skipNextAsyncUpdates = false;  // reset skip flag at start of each click

    // Cancel pending RAF
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }

    // Wait if interaction is not ready yet
    if (!this.quizStateService.isInteractionReady()) {
      await firstValueFrom(
        this.quizStateService.interactionReady$.pipe(filter(Boolean), take(1))
      );
    }

    if (!this.currentQuestion || !this.currentOptions) return;

    const idx = this.quizService.getCurrentQuestionIndex() ?? 0;
    const q = this.questions?.[idx];
    const evtIdx = event.index;
    const evtOpt = event.option;

    this.explanationDisplay.resetExplanationStateForClick(idx);

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
      const clickResult = this.clickOrchestrator.performSynchronousClickFlow({
        question: q!,
        questionIndex: idx,
        evtIdx,
        evtOpt,
        checked: event.checked,
        optionsToDisplay: this.optionsToDisplay,
        currentQuestionOptions: this.currentQuestion?.options,
        totalQuestions: this.totalQuestions,
        msgTok: this._msgTok,
      });

      const { canonicalOpts, selectedKeysSet: selOptsSetImmediate, isMultiForSelection, allCorrect } = clickResult;
      this._msgTok = clickResult.msgTok;
      this._lastAllCorrect = allCorrect;

      this.updateOptionHighlighting(selOptsSetImmediate);
      this.refreshFeedbackFor(evtOpt ?? undefined);
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();

      const lockedIndex = this.currentQuestionIndex ?? idx;

      if (allCorrect && isMultiForSelection && !this._fetEarlyShown.has(lockedIndex)) {
        if (this.timerEffect.safeStopTimer('completed', this._timerStoppedForQuestion, this._lastAllCorrect)) {
          this._timerStoppedForQuestion = true;
        }
        this._fetEarlyShown.add(lockedIndex);
        this.explanationFlow.triggerMultiAnswerFet({ lockedIndex, question: q }).then((fetResult) => {
          if (this.currentQuestionIndex !== lockedIndex || !fetResult) return;
          this.displayExplanation = true;
          this.displayStateSubject?.next({ mode: 'explanation', answered: true });
          this.showExplanationChange.emit(true);
          this.explanationToDisplay = fetResult.formatted;
          this.explanationToDisplayChange?.emit(fetResult.formatted);
        }).catch(() => {});
      }

      queueMicrotask(() => {
        if (this._skipNextAsyncUpdates) return;
        this.updateOptionHighlighting(selOptsSetImmediate);
        this.refreshFeedbackFor(evtOpt ?? undefined);
        this.cdRef.markForCheck();
        this.cdRef.detectChanges();
      });

      requestAnimationFrame(() => {
        if (this._skipNextAsyncUpdates || idx !== this.currentQuestionIndex) return;
        const resolvedQuizId = this.quizService.quizId || this.activatedRoute.snapshot.paramMap.get('quizId') || 'dependency-injection';
        this.clickOrchestrator.performPostClickRafTasks({
          idx,
          evtOpt: evtOpt ?? undefined,
          evtIdx,
          question: q!,
          event,
          quizId: resolvedQuizId,
          generateFeedbackText: (question) => this.generateFeedbackText(question),
          postClickTasks: (opt, i, checked, wasPrev, qIdx) => this.postClickTasks(opt, i, checked, wasPrev, qIdx),
          handleCoreSelection: (ev, i) => {
            this.performInitialSelectionFlow(ev, ev.option);
            const coreResult = this.optionSelection.handleCoreSelectionState({
              option: ev.option, questionIndex: i,
              currentQuestionIndex: this.currentQuestionIndex,
              questionType: this.question?.type,
              forceQuestionDisplay: this.forceQuestionDisplay,
              lastAllCorrect: this._lastAllCorrect,
            });
            if (coreResult.isAnswered) this.isAnswered = true;
            this.forceQuestionDisplay = coreResult.forceQuestionDisplay;
            if (coreResult.displayStateAnswered) {
              this.displayState.answered = coreResult.displayStateAnswered;
              this.displayState.mode = coreResult.displayStateMode;
            }
            this.cdRef.detectChanges();
          },
          markBindingSelected: (opt) => {
            const b = this.feedbackManager.markBindingSelected(opt, this.currentQuestionIndex, this.optionBindings);
            if (!b) return;
            this.optionBindings = this.optionBindings.map((ob) => ob.option.optionId === b.option.optionId ? b : ob);
            b.directiveInstance?.updateHighlight();
          },
          refreshFeedbackFor: (opt) => this.refreshFeedbackFor(opt),
        }).catch(() => { });
      });

    } finally {
      queueMicrotask(() => {
        this._clickGate = false;


        this.selectionMessageService.releaseBaseline(this.currentQuestionIndex);

        const selectionComplete =
          q?.type === QuestionType.SingleAnswer ? !!evtOpt?.correct : this._lastAllCorrect;

        this.selectionMessageService.setSelectionMessage(selectionComplete);
      });
    }
  }

  public async onSubmitMultiple(): Promise<void> {
    const idx = this.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex() ?? 0;
    const computed = this.explanationFlow.computeSubmitMultipleExplanation({ currentQuestionIndex: idx });
    if (!computed) return;
    await this.explanationFlow.applySubmitMultipleExplanation({ currentQuestionIndex: idx, formatted: computed.formatted, correctAnswersText: computed.correctAnswersText, questionType: computed.questionType });
    this.displayStateSubject?.next({ mode: 'explanation', answered: true });
    this.displayExplanation = true;
    this.explanationToDisplay = computed.formatted;
    this.explanationToDisplayChange?.emit(computed.formatted);
  }

  private onQuestionTimedOut(targetIndex?: number): void {
    if (this.timedOut) return;
    this.timedOut = true;
    const result = this.timerEffect.onQuestionTimedOut({
      targetIndex, currentQuestionIndex: this.currentQuestionIndex, questions: this.questions, currentQuestion: this.currentQuestion,
      optionsToDisplay: this.optionsToDisplay, sharedOptionBindings: this.sharedOptionComponent?.optionBindings, totalQuestions: this.totalQuestions,
      formattedByIndex: this._formattedByIndex, lastAllCorrect: this._lastAllCorrect, normalizeIndex: (idx) => this.normalizeIndex(idx),
      setExplanationFor: (_idx, html) => {
        this.explanationTextService.setExplanationText(html);
        this.cdRef.markForCheck();
      },
      resolveFormatted: (idx) => this.resolveFormatted(idx), revealFeedbackForAllOptions: (opts) => this.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => this.forceDisableSharedOption(), updateBindingsAndOptions: () => this.disableAllBindingsAndOptions(), markForCheck: () => this.cdRef.markForCheck(),
    });
    this.displayExplanation = true;
    this.showExplanationChange.emit(true);
    this.explanationToDisplay = result.explanationToDisplay;
    this.explanationToDisplayChange?.emit(result.explanationToDisplay);
    this._timerStoppedForQuestion = result.timerStoppedForQuestion;
  }

  private handleTimerStoppedForActiveQuestion(reason: 'timeout' | 'stopped'): void {
    const stopped = this.timerEffect.handleTimerStoppedForActiveQuestion({
      reason, timerStoppedForQuestion: this._timerStoppedForQuestion, currentQuestionIndex: this.currentQuestionIndex,
      questions: this.questions, questionFresh: this.questionFresh, optionsToDisplay: this.optionsToDisplay,
      sharedOptionBindings: this.sharedOptionComponent?.optionBindings, currentQuestion: this.currentQuestion,
      normalizeIndex: (idx) => this.normalizeIndex(idx), revealFeedbackForAllOptions: (opts) => this.revealFeedbackForAllOptions(opts),
      forceDisableSharedOption: () => this.forceDisableSharedOption(), updateBindingsAndOptions: () => this.disableAllBindingsAndOptions(),
      markForCheck: () => this.cdRef.markForCheck(), detectChanges: () => this.cdRef.detectChanges(),
    });
    if (stopped) this._timerStoppedForQuestion = true;
  }

  private updateOptionHighlighting(selectedKeys: Set<string | number>): void {
    this.optionsToDisplay = this.feedbackManager.updateOptionHighlighting(this.optionsToDisplay, selectedKeys, this.currentQuestionIndex, this.question?.type);
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }

  private refreshFeedbackFor(opt: Option): void {
    if (!this.sharedOptionComponent) return;
    if (opt.optionId !== undefined) this.sharedOptionComponent.lastFeedbackOptionId = opt.optionId;
    const cfg = this.feedbackManager.buildFeedbackConfigForOption(opt, this.optionBindings, this.currentQuestion!, this.sharedOptionComponent.feedbackConfigs);
    this.sharedOptionComponent.feedbackConfigs = { ...this.sharedOptionComponent.feedbackConfigs, [opt.optionId!]: cfg };
    this.cdRef.markForCheck();
  }

  private async postClickTasks(opt: SelectedOption, idx: number, checked: boolean, wasPreviouslySelected: boolean, questionIndex?: number): Promise<void> {
    const lockedIndex = questionIndex ?? this.currentQuestionIndex;
    const { sel, shouldUpdateGlobalState } = this.optionSelection.performPostClickTasks({ opt, idx, questionIndex: lockedIndex, quizId: this.quizId!, lastAllCorrect: this._lastAllCorrect, currentQuestionIndex: this.currentQuestionIndex });
    await this.finalizeSelection(opt, idx, wasPreviouslySelected);
    this.optionSelected.emit(sel);
    this.events.emit({ type: 'optionSelected', payload: sel });
    if (shouldUpdateGlobalState) this.nextButtonStateService.setNextButtonState(true);
    this.cdRef.markForCheck();
  }

  private async performInitialSelectionFlow(event: any, option: SelectedOption): Promise<void> {
    const prevSelected = !!option.selected;
    this.optionSelection.updateOptionSelection(event, option, this.currentQuestionIndex);
    await this.handleOptionSelection(option, event.index, this.currentQuestion!);
    this.applyFeedbackIfNeeded(option);
    const nowSelected = !!option.selected;
    const transition = this.feedbackManager.computeSelectionTransition({ prevSelected, nowSelected, option, currentQuestionIndex: this.currentQuestionIndex });
    this.optionSelection.handleSelectionTransitionAndMessage({ prevSelected, nowSelected, transition, currentQuestionIndex: this.currentQuestionIndex, optionsToDisplay: this.optionsToDisplay, currentQuestionOptions: this.currentQuestion?.options, isAnswered: this.isAnswered as boolean });
  }

  private async applyFeedbackIfNeeded(option: SelectedOption): Promise<void> {
    if (!this.optionsToDisplay?.length) this.populateOptionsToDisplay();
    const result = this.feedbackManager.applyFeedbackIfNeeded({ option, optionsToDisplay: this.optionsToDisplay, showFeedbackForOption: this.showFeedbackForOption });
    if (!result) return;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOptionIndex = result.selectedOptionIndex;
    if (result.shouldTriggerExplanation) {
      this.explanationTextService.triggerExplanationEvaluation();
    }
    this.cdRef.detectChanges();
  }

  public populateOptionsToDisplay(): Option[] {
    const result = this.questionLoader.populateOptionsToDisplay(this.currentQuestion, this.optionsToDisplay, this.lastOptionsQuestionSignature);
    this.optionsToDisplay = result.options;
    this.lastOptionsQuestionSignature = result.signature;
    return this.optionsToDisplay;
  }

  public async applyOptionFeedback(selectedOption: Option): Promise<void> {
    if (!this.optionsToDisplay?.length) this.populateOptionsToDisplay();
    const result = this.feedbackManager.applyOptionFeedback(selectedOption, this.optionsToDisplay, this.showFeedbackForOption);
    if (!result) return;
    this.optionsToDisplay = result.optionsToDisplay;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOptionIndex = result.selectedOptionIndex;
    this.feedbackApplied.emit(selectedOption.optionId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.cdRef.markForCheck();
  }


  private async finalizeSelection(option: SelectedOption, index: number, wasPreviouslySelected: boolean): Promise<void> {
    const result = await this.optionSelection.performFinalizeSelection({
      option, index, wasPreviouslySelected, currentQuestionIndex: this.currentQuestionIndex, quizId: this.quizId!, lastAllCorrect: this._lastAllCorrect,
      fetchAndProcessCurrentQuestion: () => this.fetchAndProcessCurrentQuestion(),
      selectOption: (q, opt, idx) => this.selectOption(q, opt, idx),
      processCurrentQuestion: (q) => this.explanationFlow.processCurrentQuestion({ currentQuestion: q, currentQuestionIndex: this.currentQuestionIndex, quizId: this.quizId!, lastAllCorrect: this._lastAllCorrect, getExplanationText: (idx) => this.explanationManager.getExplanationText(idx) }),
      handleOptionSelection: (opt, idx, q) => this.handleOptionSelection(opt, idx, q),
    });
    if (!result) return;
    this.updateExplanationDisplay(result.shouldDisplay);
    this.questionAnswered.emit();
    this.timerEffect.stopTimerIfAllCorrectSelected({ currentQuestionIndex: this.currentQuestionIndex, questions: this.questions, optionsToDisplay: this.optionsToDisplay });
  }

  public async fetchAndProcessCurrentQuestion(): Promise<QuizQuestion | null> {
    const result = await this.optionSelection.fetchAndProcessCurrentQuestion({
      currentQuestionIndex: this.currentQuestionIndex,
      isAnyOptionSelectedFn: (idx) => this.isAnyOptionSelected(idx),
      shouldUpdateMessageOnAnswerFn: async (isAnswered) => this.selectionMessage !== this.selectionMessageService.determineSelectionMessage(this.currentQuestionIndex, this.totalQuestions, isAnswered),
    });
    if (!result) return null;
    this.currentQuestion = result.currentQuestion;
    this.optionsToDisplay = result.optionsToDisplay;
    this.data = result.data;
    return result.currentQuestion;
  }

  private async updateExplanationDisplay(shouldDisplay: boolean): Promise<void> {
    this.showExplanationChange.emit(shouldDisplay);
    this.displayExplanation = shouldDisplay;
    if (shouldDisplay) {
      setTimeout(async () => {
        const result = await this.explanationDisplay.performUpdateExplanationDisplay({ shouldDisplay: true, currentQuestionIndex: this.currentQuestionIndex });
        this.explanationToDisplay = result.explanationToDisplay;
        this.explanationToDisplayChange.emit(result.explanationToDisplay);
        this.cdRef.markForCheck();
      }, 50);
    } else {
      const result = await this.explanationDisplay.performUpdateExplanationDisplay({ shouldDisplay: false, currentQuestionIndex: this.currentQuestionIndex });
      if (result.explanationToDisplay !== undefined) {
        this.explanationToDisplay = result.explanationToDisplay;
        this.explanationToDisplayChange.emit(result.explanationToDisplay);
      }
      if (result.shouldResetQuestionState) this.resetQuestionStateBeforeNavigation();
    }
  }

  public async resetQuestionStateBeforeNavigation(options?: { preserveVisualState?: boolean; preserveExplanation?: boolean }): Promise<void> {
    const result = this.resetManager.computeResetQuestionStateBeforeNavigation(options);
    this.currentQuestion = result.currentQuestion;
    this.selectedOption = result.selectedOption;
    this.options = result.resetOptions;

    if (!result.preserveExplanation) {
      this.feedbackText = result.feedbackText;
      this.applyDisplayState(result.displayState);
      this.quizStateService.setDisplayState(this.displayState);
      this.updateDisplayMode(result.displayMode);
      this.applyExplanationFlags(result);
      this.explanationToDisplay = result.explanationToDisplay;
      this.emitExplanationChange('', false);
    }
    if (!result.preserveVisualState) {
      this.questionToDisplay = '';
      this.updateShouldRenderOptions([]);
      this.shouldRenderOptions = false;
    }

    this.finalRenderReadySubject.next(false);
    this.renderReadySubject.next(false);
    setTimeout(() => {
      if (this.sharedOptionComponent) {
        this.sharedOptionComponent.freezeOptionBindings = false;
        this.sharedOptionComponent.showFeedbackForOption = {};
      }
    }, 0);

    const resetDelay = this.resetManager.computeResetDelay(result.preserveVisualState);
    if (resetDelay > 0) await new Promise((resolve) => setTimeout(resolve, resetDelay));
  }

  private async updateExplanationText(index: number): Promise<string> {
    return this.explanationDisplay.updateExplanationText({ index, normalizeIndex: (idx) => this.normalizeIndex(idx), questionsArray: this.questionsArray, currentQuestionIndex: this.currentQuestionIndex, currentQuestion: this.currentQuestion, optionsToDisplay: this.optionsToDisplay, options: this.options });
  }

  public async handleOptionSelection(option: SelectedOption, optionIndex: number, currentQuestion: QuizQuestion): Promise<void> {
    const result = await this.optionSelection.handleFullOptionSelection({
      option, optionIndex, currentQuestion, currentQuestionIndex: this.currentQuestionIndex, quizId: this.quizId!, lastAllCorrect: this._lastAllCorrect, optionsToDisplay: this.optionsToDisplay,
      handleOptionClickedFn: async (q, idx) => {
        const r = this.optionSelection.handleOptionClicked({
          currentQuestion: q,
          optionIndex: idx,
          currentQuestionIndex: this.currentQuestionIndex,
        });
        if (r) {
          this.cdRef.markForCheck();
        }
      },
      updateExplanationTextFn: (idx) => this.updateExplanationText(idx),
    });
    if (!result) return;
    this.selectedOption = result.selectedOption;
    this.showFeedback = result.showFeedback;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOptionIndex = result.selectedOptionIndex;
    this.explanationText = result.explanationText;
    this.applyFeedbackIfNeeded(option);
    this.optionSelection.setAnsweredAndDisplayState(this._lastAllCorrect);
  }

  initializeForm(): void {
    const form = this.initializer.buildFormFromOptions(this.currentQuestion, this.fb);
    if (form) {
      this.questionForm = form;
    }
  }

  async selectOption(currentQuestion: QuizQuestion, option: SelectedOption, optionIndex: number): Promise<void> {
    const result = await this.optionSelection.performSelectOption({
      currentQuestion, option, optionIndex, currentQuestionIndex: this.currentQuestionIndex, isMultipleAnswer: this.isMultipleAnswer,
      optionsToDisplay: this.optionsToDisplay, selectedOptionsCount: this.selectedOptions.length,
      getExplanationText: (idx) => this.explanationManager.getExplanationText(idx),
    });
    if (!result) return;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.selectedOption = result.selectedOption;
    this.isOptionSelected = result.isOptionSelected;
    this.isAnswered = result.isAnswered;
    this.quizQuestionManagerService.setExplanationText(currentQuestion.explanation || '');
    this.isAnswerSelectedChange.emit(this.isAnswered);
    this.optionSelected.emit(result.selectedOption);
    this.events.emit({ type: 'optionSelected', payload: result.selectedOption });
    this.selectionChanged.emit({ question: currentQuestion, selectedOptions: this.selectedOptions });
  }

  unselectOption(): void {
    const result = this.optionSelection.unselectOption(this.currentQuestionIndex);
    this.selectedOptions = result.selectedOptions;
    this.optionChecked = result.optionChecked;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.showFeedback = result.showFeedback;
    this.selectedOption = result.selectedOption;
  }

  resetExplanation(force = false): void {
    const result = this.explanationFlow.performResetExplanation({ force, questionIndex: this.fixedQuestionIndex ?? this.currentQuestionIndex ?? 0 });
    this.displayExplanation = result.displayExplanation;
    this.explanationToDisplay = result.explanationToDisplay;
    if (!result.blocked) {
      this.emitExplanationChange('', false);
      this.cdRef?.markForCheck?.();
    }
  }

  async prepareAndSetExplanationText(questionIndex: number): Promise<string> {
    this.explanationToDisplay = await this.explanationFlow.prepareExplanationText(questionIndex);
    return this.explanationToDisplay;
  }

  public async fetchAndSetExplanationText(questionIndex: number): Promise<void> {
    this.resetExplanation();

    const ensureLoaded = async () => {
      const r = await this.questionLoader.ensureQuestionsLoaded(this.questionsArray, this.quizId);
      if (r.loaded && r.questions) {
        this.questions = r.questions;
        this.questionsArray = r.questions;
      }
      return r.loaded;
    };

    const result = await this.explanationFlow.performFetchAndSetExplanation({
      questionIndex, questionsArray: this.questionsArray, quizId: this.quizId,
      isAnswered: this.isAnswered as boolean, shouldDisplayExplanation: this.shouldDisplayExplanation,
      ensureQuestionsLoaded: ensureLoaded,
      ensureQuestionIsFullyLoaded: (idx) => this.questionLoader.ensureQuestionIsFullyLoaded(idx, this.questionsArray, this.quizId),
      prepareExplanationText: (idx) => this.prepareAndSetExplanationText(idx),
      isAnyOptionSelected: (idx) => this.isAnyOptionSelected(idx),
    });

    if (result.success) {
      this.currentQuestionIndex = questionIndex;
      this.explanationToDisplay = result.explanationToDisplay;
      this.explanationTextService.updateFormattedExplanation(this.explanationToDisplay);
      this.explanationToDisplayChange.emit(this.explanationToDisplay);
    } else if (result.explanationToDisplay) {
      this.explanationToDisplay = this.explanationFlow.getExplanationErrorText();
      if (this.isAnswered && this.shouldDisplayExplanation) this.emitExplanationChange(this.explanationToDisplay, true);
    }
  }

  private updateExplanationUI(questionIndex: number, explanationText: string): void {
    const validated = this.explanationFlow.performUpdateExplanationUI({ questionsArray: this.questionsArray, questionIndex });
    if (!validated) return;

    try {
      this.quizService.setCurrentQuestion(validated.currentQuestion);
      new Promise<void>((resolve) => setTimeout(resolve, 100)).then(async () => {
        if (this.shouldDisplayExplanation && await this.isAnyOptionSelected(validated.adjustedIndex)) {
          this.emitExplanationChange('', false);
          this.explanationToDisplay = explanationText;
          this.emitExplanationChange(this.explanationToDisplay, true);
          this.isAnswerSelectedChange.emit(true);
        }
      }).catch(() => {});
    } catch {}
  }

  async onSubmit(): Promise<void> {
    if (!this.initializer.validateFormForSubmission(this.questionForm)) return;
    const selectedOption = this.questionForm.get('selectedOption')?.value;
    await this.initializer.processAnswer({ selectedOption, currentQuestion: this.currentQuestion!, currentQuestionIndex: this.currentQuestionIndex, answers: this.answers });
    this.questionAnswered.emit();
  }

  private handleQuestionAndOptionsChange(currentQuestionChange: SimpleChange, optionsChange: SimpleChange): void {
    const { nextQuestion, effectiveQuestion, incomingOptions } = this.displayStateManager.handleQuestionAndOptionsChange({ currentQuestionChange, optionsChange, currentQuestion: this.currentQuestion });
    if (nextQuestion) this.currentQuestion = nextQuestion;
    const normalizedOptions = this.refreshOptionsForQuestion(effectiveQuestion, incomingOptions);
    const selectedOptionValues = this.displayStateManager.extractSelectedOptionValues(effectiveQuestion);
    if (effectiveQuestion) { this.quizService.handleQuestionChange(effectiveQuestion, selectedOptionValues, normalizedOptions); }
    else if (optionsChange) { this.quizService.handleQuestionChange(null, selectedOptionValues, normalizedOptions); }
  }

  private refreshOptionsForQuestion(question: QuizQuestion | null, providedOptions?: Option[] | null): Option[] {
    const result = this.displayStateManager.refreshOptionsForQuestion({ question, providedOptions, currentQuestionIndex: this.currentQuestionIndex });
    this.options = result.options;
    this.optionsToDisplay = result.optionsToDisplay;
    if (this.optionsToDisplay.length > 0) {
      this.quizService.setOptions(this.optionsToDisplay.map((option) => ({ ...option })));
    }
    this.cdRef.markForCheck();
    return result.normalizedOptions;
  }


  restoreSelectionsAndIconsForQuestion(index: number) {
    this.optionsToDisplay = this.resetManager.restoreSelectionsAndIcons(index, this.optionsToDisplay);
    this.cdRef.detectChanges();
  }


  // Per-question next and selections reset done from the child, timer
  public resetPerQuestionState(index: number): void {
    if (this._pendingRAF != null) {
      cancelAnimationFrame(this._pendingRAF);
      this._pendingRAF = null;
    }
    this._skipNextAsyncUpdates = false;

    const result = this.resetManager.resetPerQuestionState({
      index, normalizeIndex: (idx) => this.normalizeIndex(idx),
      formattedByIndex: this._formattedByIndex,
      clearSharedOptionForceDisable: () => this.sharedOptionComponent?.clearForceDisableAllOptions?.(),
      resolveFormatted: (idx, opts) => this.resolveFormatted(idx, opts),
    });

    this.handledOnExpiry.delete(result.i0);
    this.feedbackConfigs = result.feedbackConfigs;
    this.lastFeedbackOptionId = result.lastFeedbackOptionId;
    this.showFeedbackForOption = result.showFeedbackForOption;

    if (result.hasSelections) {
      this.optionsToDisplay = this.resetManager.restoreSelectionsAndIcons(result.i0, this.optionsToDisplay);
      this.cdRef.detectChanges();
    }

    this.displayExplanation = result.displayExplanation;
    this.updateDisplayMode(result.displayMode);
    if (result.hasSelections) {
      this.showExplanationChange?.emit(true);
    } else {
      this.explanationToDisplay = '';
      this.emitExplanationChange('', false);
    }

    this.questionFresh = result.questionFresh;
    this.timedOut = result.timedOut;
    this._timerStoppedForQuestion = result.timerStoppedForQuestion;
    this._lastAllCorrect = result.lastAllCorrect;
    this.lastLoggedIndex = result.lastLoggedIndex;
    this.lastLoggedQuestionIndex = result.lastLoggedQuestionIndex;

    try { this.questionForm?.enable({ emitEvent: false }); } catch {}
    queueMicrotask(() => this.emitPassiveNow(index));
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }


  public resetForQuestion(index: number): void {
    const guards = this.resetManager.hardResetClickGuards();
    this._clickGate = guards.clickGate;
    this.waitingForReady = guards.waitingForReady;
    this.deferredClick = guards.deferredClick;
    this.lastLoggedQuestionIndex = guards.lastLoggedQuestionIndex;
    this.lastLoggedIndex = guards.lastLoggedIndex;
    this.resetExplanation(true);
    this.resetPerQuestionState(index);
  }

  // Called when the countdown hits zero
  private async onTimerExpiredFor(index: number): Promise<void> {
    const i0 = this.normalizeIndex(index);
    if (this.handledOnExpiry.has(i0)) return;
    this.handledOnExpiry.add(i0);
    this.onQuestionTimedOut(i0);

    this.ngZone.run(() => {
      const expiryState = this.timerEffect.applyTimerExpiryState({ i0, questions: this.questions, currentQuestionType: this.currentQuestion?.type });
      this.feedbackText = expiryState.feedbackText;
      this.displayExplanation = expiryState.displayExplanation;
      this.showExplanationChange?.emit(true);
      this.cdRef.markForCheck();
    });

    const { formattedText, needsAsyncRepair } = await this.timerEffect.performTimerExpiredForAsync({
      i0, normalizeIndex: (idx) => this.normalizeIndex(idx), questions: this.questions,
      currentQuestionIndex: this.currentQuestionIndex, currentQuestion: this.currentQuestion,
      formattedByIndex: this._formattedByIndex, fixedQuestionIndex: this.fixedQuestionIndex,
      updateExplanationText: (idx) => this.updateExplanationText(idx),
    });

    if (formattedText) this.applyExplanationTextInZone(formattedText);
    if (needsAsyncRepair) {
      this.timerEffect.repairExplanationAsync({
        index: i0, normalizeIndex: (idx) => this.normalizeIndex(idx),
        formattedByIndex: this._formattedByIndex, fixedQuestionIndex: this.fixedQuestionIndex,
        currentQuestionIndex: this.currentQuestionIndex, updateExplanationText: (idx) => this.updateExplanationText(idx),
      }).then((repaired) => { if (repaired) this.applyExplanationTextInZone(repaired); }).catch(() => {});
    }
  }

  private normalizeIndex(idx: number): number { return this.explanationManager.normalizeIndex(idx, this.questions); }

  private async resolveFormatted(index: number, opts: { useCache?: boolean; setCache?: boolean; timeoutMs?: number } = {}): Promise<string> {
    return this.timerEffect.resolveFormatted({ index, normalizeIndex: (idx) => this.normalizeIndex(idx), formattedByIndex: this._formattedByIndex, useCache: opts.useCache, setCache: opts.setCache, timeoutMs: opts.timeoutMs, updateExplanationText: (idx) => this.updateExplanationText(idx) });
  }

  private emitPassiveNow(index: number): void {
    this.optionSelection.emitPassiveNow({
      index,
      normalizeIndex: (idx) => this.normalizeIndex(idx),
      optionsToDisplay: this.optionsToDisplay,
      currentQuestionType: this.currentQuestion?.type,
    });
  }
  private disableAllBindingsAndOptions(): { optionBindings: OptionBindings[]; optionsToDisplay: Option[] } {
    const result = this.displayStateManager.disableAllBindingsAndOptions(this.optionBindings, this.optionsToDisplay);
    this.optionBindings = result.optionBindings;
    this.optionsToDisplay = result.optionsToDisplay;
    return result;
  }
  private forceDisableSharedOption(): void {
    this.sharedOptionComponent?.forceDisableAllOptions?.();
    this.sharedOptionComponent?.triggerViewRefresh?.();
  }

  public revealFeedbackForAllOptions(canonicalOpts: Option[]): void {
    const result = this.feedbackManager.revealFeedbackForAllOptions(canonicalOpts, this.feedbackConfigs, this.showFeedbackForOption);
    this.feedbackConfigs = result.feedbackConfigs;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.cdRef.markForCheck();
  }

  private updateShouldRenderOptions(options: Option[] | null | undefined): void {
    const v = this.displayStateManager.computeRenderReadiness(options);
    if (this.shouldRenderOptions !== v) {
      this.shouldRenderOptions = v;
      this.cdRef.markForCheck();
    }
  }

  private safeSetDisplayState(state: { mode: 'question' | 'explanation', answered: boolean }): void {
    if (this.displayStateManager.shouldSuppressDisplayState({
      visibilityRestoreInProgress: this._visibilityRestoreInProgress,
      suppressDisplayStateUntil: this._suppressDisplayStateUntil,
    })) {
      return;
    }
    this.displayStateSubject?.next(state);
  }
}
