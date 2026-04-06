import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component,
  EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
  Output, SimpleChanges, ViewChild, ViewEncapsulation
} from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, ParamMap, Params, Router } from '@angular/router';
import {
  BehaviorSubject, combineLatest, EMPTY, firstValueFrom, merge, Observable, of,
  Subject, Subscription } from 'rxjs';
import {
  catchError, debounceTime, distinctUntilChanged, filter, map, retry, shareReplay,
  startWith, switchMap, take, takeUntil, tap
} from 'rxjs/operators';
import { MatCardModule } from '@angular/material/card';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';

import { QuizQuestionComponent } from '../../components/question/quiz-question/quiz-question.component';
import { SharedOptionComponent } from '../../components/question/answer/shared-option-component/shared-option.component';
import { CodelabQuizContentComponent } from './quiz-content/codelab-quiz-content.component';
import { CodelabQuizHeaderComponent } from './quiz-header/quiz-header.component';
import { ScoreboardComponent } from '../scoreboard/scoreboard.component';
import { QuizStatus } from '../../shared/models/quiz-status.enum';
import { QuestionType } from '../../shared/models/question-type.enum';
import { QuestionPayload } from '../../shared/models/QuestionPayload.model';
import { QuestionState } from '../../shared/models/QuestionState.model';
import { CombinedQuestionDataType } from '../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../shared/models/Option.model';
import { Quiz } from '../../shared/models/Quiz.model';
import { QuizComponentData } from '../../shared/models/QuizComponentData.model';
import { QuizQuestion } from '../../shared/models/QuizQuestion.model';
import { QuizQuestionConfig } from '../../shared/models/QuizQuestionConfig.interface';
import { QuizQuestionEvent } from '../../shared/models/QuizQuestionEvent.type';
import { SelectedOption } from '../../shared/models/SelectedOption.model';
import { QuizService } from '../../shared/services/data/quiz.service';
import { QuizDataService } from '../../shared/services/data/quizdata.service';
import { QuizInitializationService } from '../../shared/services/flow/quiz-initialization.service';
import { QuizNavigationService } from '../../shared/services/flow/quiz-navigation.service';
import { QuizStateService } from '../../shared/services/state/quizstate.service';
import { QuizQuestionLoaderService } from '../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../shared/services/flow/quizquestionmgr.service';
import { ExplanationTextService } from '../../shared/services/features/explanation-text.service';
import { NextButtonStateService } from '../../shared/services/state/next-button-state.service';
import { RenderStateService } from '../../shared/services/ui/render-state.service';
import { SelectedOptionService } from '../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../shared/services/features/selection-message.service';
import { TimerService } from '../../shared/services/features/timer.service';
import { ResetStateService } from '../../shared/services/state/reset-state.service';
import { SharedVisibilityService } from '../../shared/services/ui/shared-visibility.service';
import { QuizDotStatusService } from '../../shared/services/flow/quiz-dot-status.service';
import { QuizQuestionDataService } from '../../shared/services/flow/quiz-question-data.service';
import { QuizResetService } from '../../shared/services/flow/quiz-reset.service';
import { QuizRouteService } from '../../shared/services/flow/quiz-route.service';
import { QuizScoringService } from '../../shared/services/flow/quiz-scoring.service';
import { QuizOptionProcessingService } from '../../shared/services/flow/quiz-option-processing.service';
import { QuizContentLoaderService } from '../../shared/services/flow/quiz-content-loader.service';
import { QuizPersistenceService } from '../../shared/services/state/quiz-persistence.service';

import { ChangeRouteAnimation } from '../../animations/animations';

type AnimationState = 'animationStarted' | 'none';

interface Override {
  idx: number,
  html: string
}

@Component({
  selector: 'codelab-quiz-component',
  standalone: true,
  imports: [
    CommonModule,
    AsyncPipe,
    MatCardModule,
    MatTooltipModule,
    QuizQuestionComponent,
    CodelabQuizHeaderComponent,
    CodelabQuizContentComponent,
    ScoreboardComponent
  ],
  templateUrl: './quiz.component.html',
  styleUrls: ['./quiz.component.scss'],
  animations: [ChangeRouteAnimation.changeRoute],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuizComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  @ViewChild(QuizQuestionComponent, { static: false })
  quizQuestionComponent!: QuizQuestionComponent;
  @ViewChild(SharedOptionComponent, { static: false })
  sharedOptionComponent!: SharedOptionComponent;
  @ViewChild('nextButton', { static: false })
  nextButtonTooltip!: MatTooltip;

  @Output() selectionMessageChange = new EventEmitter<string>();
  @Input() data: QuizQuestion | null = null;
  @Input() selectedQuiz: Quiz | null = null;
  @Input() currentQuestion: QuizQuestion | null = null;
  @Input() shouldDisplayNumberOfCorrectAnswers = false;
  @Input() form!: FormGroup;
  quiz!: Quiz;
  quizComponentData: QuizComponentData;
  quizId = '';
  question: QuizQuestion | null = null;
  questions: QuizQuestion[] = [];
  questionsArray: QuizQuestion[] = [];
  questions$: Observable<QuizQuestion[]> = this.quizService.questions$;

  questionPayload: QuestionPayload | null = null;
  currentQuestion$: Observable<QuizQuestion | null> =
    this.quizStateService.currentQuestion$;
  currentQuestionType: QuestionType | null = null;
  currentOptions: Option[] = [];
  options$: Observable<Option[]>;
  options: Option[] = [];
  pendingOptions: Option[] | null = null;
  questionData!: QuizQuestion;

  currentQuiz: Quiz | null = null;
  routeSubscription!: Subscription;
  routerSubscription!: Subscription;
  questionAndOptionsSubscription!: Subscription;
  optionSelectedSubscription!: Subscription;
  indexSubscription!: Subscription;
  subscriptions: Subscription = new Subscription();

  answers: Option[] = [];
  answered = false;
  multipleAnswer = false;
  status!: QuizStatus;
  disabled = true;

  selectedOptions: Option[] = [];
  selectedOption$ = new BehaviorSubject<Option | null>(null);
  selectionMessage = '';
  selectionMessage$: Observable<string>;
  isAnswered = false;
  correctAnswers: any[] = [];
  correctAnswersText = '';
  cardFooterClass = '';
  showScrollIndicator = false;

  showExplanation = false;
  displayExplanation = false;
  explanationText = '';

  public explanationTextLocal = '';
  public explanationVisibleLocal = false;
  public explanationOverride: Override = { idx: -1, html: '' };

  private combinedQuestionDataSubject =
    new BehaviorSubject<QuestionPayload | null>(null);
  combinedQuestionData$: Observable<QuestionPayload | null> =
    this.combinedQuestionDataSubject.asObservable();

  private correctAnswersTextSource = new BehaviorSubject<string>('');

  questionIndex = 0;
  currentQuestionIndex = 0;
  lastLoggedIndex = -1;
  totalQuestions = 0;
  progress = 0;

  correctCount = 0;
  numberOfCorrectAnswers = 0;
  score = 0;
  elapsedTimeDisplay = 0;
  feedbackText = '';
  showFeedback = false;
  showFeedbackForOption: { [key: number]: boolean } = {};

  questionToDisplay = '';
  private questionToDisplaySource = new BehaviorSubject<string>('');
  public questionToDisplay$ = this.questionToDisplaySource.asObservable();

  optionsToDisplay: Option[] = [];
  optionsToDisplay$ = new BehaviorSubject<Option[]>([]);
  explanationToDisplay = '';
  displayVariables = { question: '', explanation: '' };
  displayText = '';

  private isLoading = false;
  private isQuizLoaded = false;  // tracks if the quiz data has been loaded
  private isQuizDataLoaded = false;
  public isQuizRenderReady$ = new BehaviorSubject<boolean>(false);
  private quizAlreadyInitialized = false;
  questionInitialized = false;
  questionTextLoaded = false;
  public hasOptionsLoaded = false;
  public shouldRenderOptions = false;
  private resetComplete = false;

  isOptionSelected = false;
  isCurrentQuestionAnswered = false;

  previousIndex: number | null = null;

  private isNavigatedByUrl = false;
  private navigatingToResults = false;

  private nextButtonTooltipSubject = new BehaviorSubject<string>(
    'Please click an option to continue...',
  );
  nextButtonTooltip$ = this.nextButtonTooltipSubject.asObservable();

  // Match the template's async pipe variable name
  nextButtonEnabled$: Observable<boolean> = this.nextButtonStateService.isButtonEnabled$;

  isButtonEnabled$: Observable<boolean>;  // (Legacy, keeping to avoid breaks if referenced)
  isButtonEnabled = false;
  isAnswered$: Observable<boolean>;
  isNextButtonEnabled = false;
  isContentAvailable$: Observable<boolean>;

  animationState$ = new BehaviorSubject<AnimationState>('none');
  unsubscribe$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  // Saved display state for tab visibility restoration (question vs FET)
  private _savedDisplayState: { mode: 'question' | 'explanation'; answered: boolean } | null = null;

  currentQuestionAnswered = false;

  private questionTextSubject = new BehaviorSubject<string>('');
  private explanationTextSubject = new BehaviorSubject<string>('');

  // Use the display state from QuizStateService instead of local state
  displayState$ = this.quizStateService.displayState$;

  shouldRenderQuestionComponent = false;

  qaToDisplay?: { question: QuizQuestion; options: Option[] };

  // Dot status maps are owned by QuizDotStatusService
  private _processingOptionClick = false;

  // clickConfirmedDotStatus lives on selectedOptionService (singleton)
  // to survive component destruction/recreation during navigation.

  constructor(
    public quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizInitializationService: QuizInitializationService,
    private quizNavigationService: QuizNavigationService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private quizStateService: QuizStateService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private nextButtonStateService: NextButtonStateService,
    private selectionMessageService: SelectionMessageService,
    private selectedOptionService: SelectedOptionService,
    private renderStateService: RenderStateService,
    private resetStateService: ResetStateService,
    private sharedVisibilityService: SharedVisibilityService,
    private dotStatusService: QuizDotStatusService,
    private quizPersistence: QuizPersistenceService,
    private quizQuestionDataService: QuizQuestionDataService,
    private quizResetService: QuizResetService,
    private quizRouteService: QuizRouteService,
    private quizScoringService: QuizScoringService,
    private quizOptionProcessingService: QuizOptionProcessingService,
    private quizContentLoaderService: QuizContentLoaderService,

    private activatedRoute: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone,
    private cdRef: ChangeDetectorRef
  ) {
    if (this.quizQuestionComponent) {
      this.quizQuestionComponent.renderReady = false;
    }

    // Tab visibility change handler - preserve display state (question vs FET)
    this.sharedVisibilityService.pageVisibility$.subscribe((isHidden: boolean) => {
      if (isHidden) {
        // Tab hidden: Save the current display state to preserve it
        const currentDisplayState =
          this.quizStateService.displayStateSubject?.value;
        if (currentDisplayState) {
          this._savedDisplayState = { ...currentDisplayState };
          console.log('[VISIBILITY] Saved display state on hide:',
            this._savedDisplayState);
        }
      } else {
        // Tab visible: Lock display state changes, then restore the saved state
        if (this._savedDisplayState) {
          console.log('[VISIBILITY] Restoring saved display state:',
            this._savedDisplayState);

          // Lock display state changes for 500ms to prevent other components from
          // overriding
          this.quizStateService.lockDisplayStateForVisibilityRestore(500);

          // Re-apply the exact same state that was active before with force to bypass lock
          this.quizStateService.setDisplayState(this._savedDisplayState, { force: true });

          // Sync explanation service flags with the saved state
          const showingExplanation = this._savedDisplayState.mode === 'explanation';
          this.explanationTextService.setShouldDisplayExplanation(showingExplanation);
          this.explanationTextService.setIsExplanationTextDisplayed(showingExplanation);

          // Force re-emit of question data to ensure UI renders
          if (this.currentQuestion) {
            console.log('[VISIBILITY] Re-emitting question data to force ' +
              're-render');
            const currentPayload =
              this.combinedQuestionDataSubject.getValue();

            // Prefer existing payload if available, otherwise reconstruct it
            const payloadToEmit: QuestionPayload = currentPayload || {
              question: this.currentQuestion,
              options: this.optionsToDisplay || [],
              explanation: this.explanationToDisplay || ''
            };

            this.combinedQuestionDataSubject.next(payloadToEmit);

            // Ensure options are also re-pushed to optionsToDisplay$
            if (this.optionsToDisplay && this.optionsToDisplay.length > 0) {
              this.optionsToDisplay$.next(this.optionsToDisplay);
            }
          }

          this.cdRef.markForCheck();
        }
      }
    });

    this.options$ = this.getOptions(this.currentQuestionIndex);
    this.isContentAvailable$ = this.getContentAvailability();

    this.isAnswered$ = this.selectedOptionService.isAnswered$;
    this.selectionMessage$ = this.selectionMessageService.selectionMessage$;

    this.subscriptions.add(
      this.quizService.quizReset$.subscribe(() => {
        this.refreshQuestionOnReset();
      }),
    );

    // Keep local questions in sync with service (handles shuffle toggle)
    this.subscriptions.add(
      this.quizService.questions$.subscribe((questions: QuizQuestion[]) => {
        // Only update if questions are for the current quiz (prevent stale cross-quiz data)
        const serviceQuizId = this.quizService.getCurrentQuizId();
        if (questions && questions.length > 0 &&
          (!this.quizId || serviceQuizId === this.quizId)) {
          this.questions = questions;
          this.questionsArray = [...questions];
          this.totalQuestions = questions.length;
          console.log(
            `[QUIZ COMPONENT] totalQuestions set to ${this.totalQuestions} from 
            questions$.length for quiz ${this.quizId}`
          );
          this.cdRef.markForCheck();
        } else if (questions && questions.length > 0 && serviceQuizId !== this.quizId) {
          console.warn(
            `[QUIZ COMPONENT] Ignoring questions$ emission - quiz mismatch: ` +
            `service=${serviceQuizId}, component=${this.quizId}`
          );
        }
      })
    );

    this.quizComponentData = {
      data: this.data,
      currentQuestion: this.currentQuestion ?? ({} as QuizQuestion),
      question: this.currentQuestion ?? ({} as QuizQuestion),
      questions: [],
      options: this.optionsToDisplay,
      optionsToDisplay: this.optionsToDisplay,
      selectedOption: null,
      currentQuestionIndex: this.currentQuestionIndex,
      multipleAnswer: this.multipleAnswer,
      showFeedback: this.showFeedback,
      selectionMessage: this.selectionMessage
    };

    // Use debounceTime to delay emission of isOptionSelected$ to handle rapid selection
    this.isButtonEnabled$ = this.selectedOptionService
      .isOptionSelected$()
      .pipe(debounceTime(300), shareReplay(1));

    // Subscribe to the isNextButtonEnabled$ observable
    this.selectedOptionService.isNextButtonEnabled$.subscribe((enabled: boolean) => {
      this.isNextButtonEnabled = enabled;
    });

    this.selectedOptionService.isOptionSelected$().subscribe((isSelected: boolean) => {
      this.isCurrentQuestionAnswered = isSelected;
      this.cdRef.markForCheck();
    });

    // Trigger CD on any selection change (e.g. Red -> Green transition)
    // Also update the dot status cache for persistence
    this.selectedOptionService.selectedOption$.subscribe((selections: SelectedOption[]) => {
      // Skip automatic re-evaluation while onOptionSelected is actively processing.
      // onOptionSelected sets the dot status based on the CLICKED option's correctness;
      // allowing this subscription to re-evaluate the full selection set mid-processing
      // would override the intended per-click dot color with a cumulative result.
      if (this._processingOptionClick) {
        return;
      }
      // Update cache for the current question whenever selection changes (even if cleared)
      const qIndex = selections?.[0]?.questionIndex ?? this.currentQuestionIndex;

      this.updateDotStatus(qIndex);
      this.updateProgressValue();
      this.cdRef.detectChanges();
    });

    this.quizService.currentQuestion.subscribe({
      next: (newQuestion: QuizQuestion | null) => {
        if (!newQuestion) return;

        this.currentQuestion = null;

        setTimeout(() => {
          this.currentQuestion = { ...newQuestion };
        }, 10);
      },
      error: (error: Error) =>
        console.error('Error in currentQuestion subscription:', error),
      complete: () => console.log('currentQuestion subscription completed.')
    });

    this.isContentAvailable$ = this.quizDataService.isContentAvailable$;
  }

  @HostListener('window:keydown', ['$event'])
  async onGlobalKey(event: KeyboardEvent): Promise<void> {
    // Ignore keystrokes originating in text inputs / textarea's
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (event.key) {
      // Arrow Right & Enter → advance forward
      case 'ArrowRight':
      case 'Enter': {
        // “Next” button visible? — go to next question
        if (this.shouldShowNextButton) {
          event.preventDefault();
          await this.advanceToNextQuestion();
          return;
        }

        // Otherwise, “Show Results” visible? — go to results
        if (this.shouldShowResultsButton) {
          event.preventDefault();
          this.advanceToResults();
          return;
        }

        // Any other state: do nothing
        break;
      }

      // Arrow Left ← – move to previous question
      case 'ArrowLeft': {
        const idx = this.quizService.getCurrentQuestionIndex();  // 0-based
        if (idx > 0) {
          event.preventDefault();
          await this.advanceToPreviousQuestion();
        } else {
          console.warn('Already at first question — cannot go back');
        }
        break;
      }

      default:
        break;  // ignore other keys
    }
  }

  @HostListener('window:focus', ['$event'])
  onTabFocus(): void {
    if (!this.isLoading && !this.quizStateService.isLoading()) {
      // Restore display state from saved state (already handled by visibilitychange)
      // Only update badge to ensure it shows correct question number
      const idx = this.quizService.getCurrentQuestionIndex();
      if (idx >= 0 && idx < this.totalQuestions) {
        this.quizService.updateBadgeText(idx + 1, this.totalQuestions);
      }
      this.cdRef.markForCheck();
    }
  }

  // Scroll indicator - detect if content overflows the viewport
  @HostListener('window:scroll')
  onScroll(): void {
    this.checkScrollIndicator();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkScrollIndicator();
  }

  checkScrollIndicator(): void {
    // Find the quiz card element
    const quizCard = document.querySelector('.quiz-card');
    if (!quizCard) {
      this.showScrollIndicator = false;
      return;
    }

    const cardRect = quizCard.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    // Show indicator if the card's bottom extends more than 80px below the viewport
    const cardBottomBelowViewport = cardRect.bottom - windowHeight;
    const shouldShow = cardBottomBelowViewport > 80;

    if (this.showScrollIndicator !== shouldShow) {
      this.showScrollIndicator = shouldShow;
      this.cdRef.detectChanges();
    }
  }

  scrollToBottom(): void {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  }

  async ngOnInit(): Promise<void> {
    console.error(`[LIFECYCLE] ngOnInit fired. clickConfirmedDotStatus map:`, Array.from(this.selectedOptionService.clickConfirmedDotStatus.entries()));
    this.subscribeToQuestions();
    this.subscribeToRouteEvents();

    const quizId = await this.initializeQuizId();
    if (!quizId) {
      return;
    }
    this.quizId = quizId;

    const initialRouteQuestionNumber = this.getRouteQuestionNumber();
    const initialRouteIndex = initialRouteQuestionNumber != null ? initialRouteQuestionNumber - 1 : this.getRouteQuestionIndex();

    // IMPORTANT: Do not reset score/session state in ngOnInit.
    // The component can be recreated during in-quiz navigation (Q1 -> Q2),
    // and any reset here can snap a real score (e.g. 1/6) back to 0/6.
    // Session resets are handled by explicit quiz-start/restart flows.

    this.initializeQuestionIndex();
    this.clearStaleProgressAndDotStateForFreshStart();
    this.fetchTotalQuestions();
    this.subscribeToQuestionIndex();

    await this.loadQuestions();
    this.isQuizLoaded = true; // Mark as loaded AFTER first success

    // Common logic after loading
    const initialIndex = this.currentQuestionIndex || 0;
    this.quizService.setCurrentQuestionIndex(initialIndex);

    // Explicitly update progress and dots for Q1
    this.updateProgressValue();
    this.updateDotStatus(initialIndex);

    Promise.resolve().then(() => this.cdRef.detectChanges());

    this.initializeCorrectExpectedCounts();
    this.subscribeToNextButtonState();
    this.subscribeToTimerExpiry();
    this.initializeServices();
  }

  private subscribeToQuestions(): void {
    this.questions$ = this.quizService.questions$;
    this.quizService.questions$.pipe(takeUntil(this.destroy$)).subscribe((q) => {
      this.questionsArray = q;
      if (Array.isArray(q) && q.length > 0) {
        this.totalQuestions = q.length;
        this.updateProgressValue();
      }
    });
  }

  private subscribeToRouteEvents(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(async () => {
        const params = this.activatedRoute.snapshot.paramMap;
        const routeQuizId = params.get('quizId');
        const raw = params.get('questionIndex');
        const idx = Math.max(0, (Number(raw) || 1) - 1);

        const previousQuizId = this.quizId || this.quizService.quizId || localStorage.getItem('lastQuizId') || '';
        console.log(`[DEBUG] NavigationEnd: routeQuizId=${routeQuizId}, previousQuizId=${previousQuizId}`);

        if (routeQuizId && previousQuizId && routeQuizId !== previousQuizId) {
          this.quizNavigationService.resetForNewQuiz();
          console.log(`[QuizComponent] Quiz INIT/SWITCH: ${this.quizId} -> ${routeQuizId}. Resetting state for clean start.`);

          // Service-level resets
          this.quizResetService.resetForQuizSwitch(routeQuizId);
          this.clearAllPersistedDotStatus();

          // Component-local state
          this.questionsArray = [];
          this.currentQuestion = null;
          this.optionsToDisplay = [];
          this.optionsToDisplay$.next([]);
          this.combinedQuestionDataSubject.next(null);
          this.questionToDisplaySource.next('');
          this.explanationToDisplay = '';
          this.currentQuestionIndex = 0;
          this.lastLoggedIndex = -1;

          this.dotStatusService.clearAllMaps();
          this.clearClickConfirmedDotStatus();

          this.showExplanation = false;
          this.navigatingToResults = false;
          this.isQuizLoaded = false;
          this.isQuizDataLoaded = false;
          this.totalQuestions = 0;
          this.progress = 0;

          // Update quiz ID and fetch new questions
          this.quizId = routeQuizId;
          this.quizService.setQuizId(routeQuizId);
          try { localStorage.setItem('lastQuizId', routeQuizId); } catch { }
          await this.loadQuestions();
          this.isQuizLoaded = true;
        }

        this.quizService.setCurrentQuestionIndex(idx);
        this.updateProgressValue(); // Ensure progress stays updated across navigations
        this.updateDotStatus(idx);
      });
  }

  private async initializeQuizId(): Promise<string | null> {
    let quizId = this.quizService.getCurrentQuizId();
    if (!quizId) {
      const routeQuizId = this.activatedRoute.snapshot.paramMap.get('quizId');
      if (routeQuizId) {
        quizId = routeQuizId;
        this.quizService.setQuizId(routeQuizId);
        console.warn('[QuizComponent] quizId recovered from route params.');
      }
    }

    if (!quizId) {
      console.error('[QuizComponent] Missing quizId.');
      await this.router.navigate(['/select']);
      return null;
    }
    return quizId;
  }

  private getRouteQuestionNumber(): number | null {
    return this.quizRouteService.getRouteQuestionNumber(this.activatedRoute, this.router);
  }

  private getRouteQuestionIndex(): number {
    return this.quizRouteService.getRouteQuestionIndex(this.activatedRoute, this.router);
  }

  private initializeQuestionIndex(): void {
    // const routeParamIndex = this.activatedRoute.snapshot.paramMap.get('questionIndex');
    // const idx = Math.max(0, (Number(routeParamIndex) || 1) - 1);
    const idx = this.getRouteQuestionIndex();
    this.currentQuestionIndex = idx;
    this.quizService.setCurrentQuestionIndex(idx);

    // DANGER: We CANNOT reset score unconditionally here. 
    // This wipes score when navigating backward to Q1!
    // ONLY IntroductionComponent or restartQuiz actions should dictate fresh starts!
    if (idx === 0) {
      try {
        localStorage.setItem('savedQuestionIndex', '0');
      } catch { }
    } else {
      localStorage.setItem('savedQuestionIndex', JSON.stringify(idx));
    }
  }

  private clearStaleProgressAndDotStateForFreshStart(): void {
    const cleared = this.quizResetService.clearStaleProgressAndDotStateForFreshStart(
      this.currentQuestionIndex,
      this.quizId,
      this.totalQuestions
    );
    if (cleared) {
      this.progress = 0;
    }
  }

  private fetchTotalQuestions(): void {
    this.quizService.getTotalQuestionsCount(this.quizId)
      .pipe(take(1))
      .subscribe((total: number) => {
        this.totalQuestions = total;
        this.updateProgressValue();
        this.cdRef.markForCheck();
      });
  }

  private subscribeToQuestionIndex(): void {
    this.indexSubscription = this.quizService.currentQuestionIndex$
      .pipe(distinctUntilChanged())
      .subscribe((idx: number) => {
        const prevIdx = this.lastLoggedIndex;
        this.lastLoggedIndex = idx;
        this.currentQuestionIndex = idx;

        // Delegate service-level state transitions
        const { question, isNavigation } = this.quizContentLoaderService.handleQuestionIndexTransition({
          idx, prevIdx, quizId: this.quizId, questionsArray: this.questionsArray,
        });

        // Update component-local state from result
        if (question) {
          this.currentQuestion = question;
          this.questionToDisplaySource.next(question.questionText?.trim() ?? '');
          this.combinedQuestionDataSubject.next({
            question, options: question.options, explanation: question.explanation,
          });
        }
        this.cdRef.markForCheck();

        // Handle navigation-specific resets
        if (isNavigation) {
          this.showExplanation = false;
          this.explanationToDisplay = '';
          this.explanationVisibleLocal = false;
          this.optionsToDisplay = [];
          this.updateProgressValue();
          this.updateDotStatus(idx);

          if (!this.selectedOptionService.isQuestionAnswered(idx)) {
            this.timerService.restartForQuestion(idx);
          }
        }
      });
  }

  private async loadQuestions(): Promise<void> {
    try {
      // Delegate fetching/caching to QuizService which now has length-based validation.
      // This ensures that IF a quiz has been updated (e.g. Q6 added), we always get 
      // the fresh metadata-validated array instead of reusing a stale 5-question cache.
      const questions = await this.quizService.fetchQuizQuestions(this.quizId);
      if (!questions?.length) {
        console.error('[QuizComponent] No quiz questions returned.');
        return;
      }

      this.questionsArray = [...questions];
      this.totalQuestions = questions.length;
      this.isQuizDataLoaded = true;
      this.updateProgressValue();

      console.log(`[QuizComponent] Questions loaded: ${this.totalQuestions} questions for quiz ${this.quizId}`);
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();
    } catch (error) {
      console.error('[QuizComponent] Error loading questions:', error);
    }

    // Push initial question data immediately after questions are loaded
    // This fixes Stackblitz timing issue where options weren't displaying because
    // subscribeToQuestionIndex subscription wasn't triggered for initial question
    if (this.questionsArray?.length > 0) {
      const initialIdx = this.currentQuestionIndex || 0;
      const initialQuestion = this.questionsArray[initialIdx];
      if (initialQuestion && initialQuestion.options?.length > 0) {
        console.log(`[QuizComponent] Pushing initial Q${initialIdx + 1} to combinedQuestionDataSubject`);
        this.currentQuestion = initialQuestion;
        this.questionToDisplaySource.next(initialQuestion.questionText?.trim() ?? '');

        const payload = {
          question: initialQuestion,
          options: initialQuestion.options,
          explanation: initialQuestion.explanation
        };

        // Push synchronously
        this.combinedQuestionDataSubject.next(payload);

        // Force synchronous change detection to ensure template updates
        this.cdRef.detectChanges();
        console.log('[QuizComponent] Forced detectChanges after initial push');

        // Also schedule a microtask push as backup for Stackblitz
        Promise.resolve().then(() => {
          // Re-emit in case the first one was missed
          if (this.combinedQuestionDataSubject.getValue()?.options?.length === 0 ||
            !this.combinedQuestionDataSubject.getValue()) {
            console.log('[QuizComponent] Re-emitting payload in microtask');
            this.combinedQuestionDataSubject.next(payload);
            this.cdRef.detectChanges();
          }
        });
      } else {
        console.warn('[QuizComponent] Initial question has no options!', initialQuestion);
      }
    }
  }

  private initializeCorrectExpectedCounts(): void {
    this.quizScoringService.initializeCorrectExpectedCounts(this.questionsArray);
  }

  private subscribeToNextButtonState(): void {
    this.nextButtonStateService.isButtonEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe((enabled: boolean) => {
        this.isNextButtonEnabled = enabled;
        this.cdRef.markForCheck();  // force UI update when button state changes
      });
  }

  private subscribeToTimerExpiry(): void {
    this.timerService.expired$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const idx = this.currentQuestionIndex;
        const selections = this.getSelectionsForQuestion(idx);
        if (selections.length === 0) {
          this.dotStatusService.timerExpiredUnanswered.add(idx);
          this.cdRef.markForCheck();
        }
      });
  }

  private initializeServices(): void {
    this.setupQuiz();
    this.initializeRouteParameters();
    this.initializeDisplayVariables();

    this.quizInitializationService.initializeAnswerSync(
      (enabled: boolean) => (this.isNextButtonEnabled = enabled),
      (answered: boolean) => (this.isCurrentQuestionAnswered = answered),
      (message: string) => (this.selectionMessage = message),
      this.destroy$
    );

    this.initializeTooltip();
    this.resetStateHandlers();
    this.initializeExplanationText();
  }

  private setupQuiz(): void {
    this.initializeQuizData();
    this.initializeCurrentQuestion();
    void this.handleNavigationToQuestion(this.currentQuestionIndex);
  }

  private resetStateHandlers(): void {
    this.resetQuestionState();
  }

  private initializeExplanationText(): void {
    this.explanationTextService.explanationText$
      .pipe(takeUntil(this.destroy$))
      .subscribe((text: string | null) => {
        this.explanationToDisplay = text || '';
        // Force change detection because this update comes from a service (child component action)
        // and QuizComponent is OnPush. Without this, the bound input to QuizContentComponent won't update.
        this.cdRef.markForCheck();
      });
  }

  async ngAfterViewInit(): Promise<void> {
    // Check scroll indicator on initial load
    setTimeout(() => this.checkScrollIndicator(), 500);

    void this.quizQuestionLoaderService.loadQuestionContents(
      this.currentQuestionIndex
    );

    // If the loader queued options before the child existed, apply them now
    if (this.quizQuestionLoaderService.pendingOptions?.length) {
      const opts = this.quizQuestionLoaderService.pendingOptions;
      this.quizQuestionLoaderService.pendingOptions = null;  // clear the queue

      // Push into child
      Promise.resolve().then(() => {
        if (this.quizQuestionComponent && opts?.length) {
          this.quizQuestionComponent.optionsToDisplay = [...opts];
        }
      });
    }

    setTimeout(() => {
      if (this.quizQuestionComponent?.renderReady$) {
        this.quizQuestionComponent.renderReady$
          .pipe(debounceTime(10))
          .subscribe((isReady: boolean) => {
            this.isQuizRenderReady$.next(isReady);

            // This waits for question, options and child ready
            if (isReady) {
              this.renderStateService.setupRenderGateSync();
            }
          });
      }
    }, 0);
  }

  initializeDisplayVariables(): void {
    this.displayVariables = {
      question: this.questionToDisplay || 'No question available',
      explanation: this.explanationToDisplay || 'Explanation unavailable'
    };
  }

  private async restoreSelectionState(): Promise<void> {
    this.quizContentLoaderService.restoreSelectionState(this.currentQuestionIndex);
  }

  private async handleNavigationToQuestion(questionIndex: number): Promise<void> {
    this.quizService.getCurrentQuestion(questionIndex).subscribe({
      next: async (question: QuizQuestion | null) => {
        if (question) {
          if (question.type != null) {
            this.quizDataService.setQuestionType(question);
          } else {
            console.error('Question type is undefined or null:', question);
          }
        } else {
          console.warn('No question data available for the given index.');
        }

        // Restore previously selected options, if any
        await this.restoreSelectionState();

        // Re-evaluate the Next button state
        this.nextButtonStateService.evaluateNextButtonState(
          this.isAnswered,
          this.quizStateService.isLoadingSubject.getValue(),
          this.quizStateService.isNavigatingSubject.getValue()
        );
      },
      error: (error: Error) => {
        console.error('Error fetching question:', error);
      }
    });
  }

  // Tooltip for next button
  private initializeTooltip(): void {
    this.nextButtonTooltip$ = combineLatest([
      this.selectedOptionService
        .isOptionSelected$()
        .pipe(startWith(false), distinctUntilChanged()),
      this.isButtonEnabled$.pipe(startWith(false), distinctUntilChanged())
    ]).pipe(
      map(([isSelected, isEnabled]) => {
        console.log('Combined Tooltip State:', { isSelected, isEnabled });
        return isSelected && isEnabled
          ? 'Next Question »'
          : 'Please click an option to continue...';
      }),
      distinctUntilChanged(),
      catchError((error: any) => {
        console.error('Tooltip error:', error);
        return of('Please click an option to continue...');
      })
    );

    // Subscribe to the tooltip and trigger a tooltip update.
    this.nextButtonTooltip$.subscribe(() => this.showTooltip());
  }

  private showTooltip(): void {
    if (this.nextButtonTooltip) {
      this.nextButtonTooltip.show();  // show the tooltip programmatically
    } else {
      console.warn('Tooltip not available');
    }
  }

  private normalizeQuestionIndex(rawIndex: number | undefined): number {
    if (!Number.isInteger(rawIndex)) return this.currentQuestionIndex;

    const idx = Number(rawIndex);
    const total = this.totalCount;

    if (idx === this.currentQuestionIndex) return idx;

    // Some payloads send 1-based index; normalize to 0-based.
    if (idx === this.currentQuestionIndex + 1) {
      return this.currentQuestionIndex;
    }

    if (total > 0 && idx >= total && idx - 1 >= 0 && idx - 1 < total) {
      return idx - 1;
    }

    return idx;
  }

  public async onOptionSelected(
    option: SelectedOption,
    isUserAction: boolean = true
  ): Promise<void> {
    if (!isUserAction) return;
    const id = option?.optionId ?? (option as any)?.id ?? (option as any)?.displayOrder ?? -1;
    const now = Date.now();
    if (id !== -1 && id === ((this as any)._lastOptionId ?? -1) && (now - ((this as any)._lastClickTime ?? 0)) < 200) return;
    (this as any)._lastClickTime = now;
    (this as any)._lastOptionId = id;
    this._processingOptionClick = true;
    const idx = this.normalizeQuestionIndex(option?.questionIndex);
    this.showExplanationForQuestion(idx);
    const isAnswered = this.selectedOptionService.isQuestionAnswered(idx);
    this.nextButtonStateService.setNextButtonState(isAnswered);
    if (this.quizStateService) {
      this.quizStateService.markUserInteracted(idx);
      if (isAnswered) this.quizStateService.markQuestionAnswered(idx);
    }
    const liveSelections = this.getSelectionsForQuestion(idx);
    const immediate = this.quizOptionProcessingService.evaluateImmediateCorrectness({
      option, idx, liveSelections,
      questionsArray: this.questionsArray, currentQuestion: this.currentQuestion,
      optionsToDisplay: this.optionsToDisplay, quizId: this.quizId,
      currentQuestionIndex: this.currentQuestionIndex,
    });
    if (immediate.canPersistOptimisticStatus) {
      this.setPersistedDotStatus(idx, 'correct');
      this.dotStatusService.pendingDotStatusOverrides.set(idx, 'correct');
    }
    if (immediate.isSingleAnswerQuestion) {
      this.quizOptionProcessingService.evaluateSingleAnswer({
        option, idx, optionsForImmediateScoring: immediate.optionsForImmediateScoring,
        liveCorrectness: immediate.liveCorrectness, quizId: this.quizId,
      });
    }
    let immediateMultiDotStatus: 'correct' | 'wrong' | null = null;
    if (!immediate.isSingleAnswerQuestion) {
      const multiResult = this.quizOptionProcessingService.evaluateMultiAnswer({
        option, idx, immediateSelections: immediate.immediateSelections,
        questionForSelection: immediate.questionForSelection,
        optionsForImmediateScoring: immediate.optionsForImmediateScoring,
        correctOptionsForQuestion: immediate.correctOptionsForQuestion,
        quizId: this.quizId,
      });
      immediateMultiDotStatus = multiResult.immediateMultiDotStatus;
    }
    await this.quizOptionProcessingService.handleAuthoritativeCheck({
      idx, isSingleAnswerQuestion: immediate.isSingleAnswerQuestion,
      immediateMultiDotStatus, quizId: this.quizId,
    });
    this.updateProgressValue();
    this.updateDotStatus(idx);
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
    const prev = this.quizStateService.getQuestionState(this.quizId, idx);
    if (prev) {
      this.quizStateService.setQuestionState(this.quizId, idx, {
        ...prev, isAnswered: true,
        explanationText: this.explanationToDisplay || prev.explanationText || ''
      });
    }
    this.quizOptionProcessingService.persistOptionSelection({
      idx, quizId: this.quizId, explanationToDisplay: this.explanationToDisplay,
      option,
    });
    this._processingOptionClick = false;
    setTimeout(() => {
      this.nextButtonStateService.evaluateNextButtonState(
        this.selectedOptionService.isAnsweredSubject.getValue(),
        this.quizStateService.isLoadingSubject.getValue(),
        this.quizStateService.isNavigatingSubject.getValue()
      );
      this.updateDotStatus(idx);
      this.updateProgressValue();
      this.cdRef.markForCheck();
      this.cdRef.detectChanges();
    }, 150);
  }

  private resetQuestionState(): void {
    // Service-level resets
    this.quizResetService.resetQuestionServiceState();

    // Component-local state
    this.currentQuestion = null;
    this.question = null;
    this.optionsToDisplay = [];
    this.questionInitialized = false;
    this.isAnswered = false;
    this.selectedOptions = [];
    this.currentQuestionAnswered = false;
    this.isNextButtonEnabled = false;
    this.isButtonEnabled = false;
    this.showFeedbackForOption = {};

    // Child component reset
    if (this.quizQuestionComponent) {
      if (typeof this.quizQuestionComponent.resetFeedback === 'function') {
        this.quizQuestionComponent.resetFeedback();
      }
      if (typeof this.quizQuestionComponent.resetState === 'function') {
        this.quizQuestionComponent.resetState();
      }
    }

    this.cdRef.detectChanges();
  }

  ngOnDestroy(): void {
    console.error(`[LIFECYCLE] ngOnDestroy fired. clickConfirmedDotStatus map:`, Array.from(this.selectedOptionService.clickConfirmedDotStatus.entries()));
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
    this.destroy$.next();
    this.destroy$.complete();
    this.subscriptions.unsubscribe();
    this.dotStatusService.dotStatusCache.clear();
    this.dotStatusService.pendingDotStatusOverrides.clear();
    this.dotStatusService.activeDotClickStatus.clear();
    // Do NOT clear timerExpiredUnanswered or clickConfirmedDotStatus here —
    // they live on the singleton service to survive component destroy/recreate.
    // this.selectedOptionService.resetAllOptions(); // REMOVED: Breaks persistence on navigation
    this.routeSubscription?.unsubscribe();
    this.routerSubscription?.unsubscribe();
    this.indexSubscription?.unsubscribe();
    this.questionAndOptionsSubscription?.unsubscribe();
    this.optionSelectedSubscription?.unsubscribe();
    this.timerService.stopTimer(undefined, { force: true });

    this.nextButtonStateService.cleanupNextButtonStateStream();

    // Route-exit cleanup: NO LONGER force reset FET state here
    // to allow persistence during router-outlet recreations.
    // this.explanationTextService.resetExplanationState(); // REMOVED

    if (this.nextButtonTooltip) {
      this.nextButtonTooltip.disabled = true;  // disable tooltips
      this.nextButtonTooltip.hide();  // hide any active tooltip
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuestionIndex']) {
      this.loadCurrentQuestion();
    }

    if (changes['currentQuestion']) {
      console.log(
        '[QuizComponent] currentQuestion changed:',
        changes['currentQuestion'].currentValue
      );
    }

    if (changes['question'] && changes['question'].currentValue) {
      console.log('Question updated:', changes['question'].currentValue);
    } else {
      console.error('Question is not defined or updated properly.');
    }
  }

  // Public getter methods for determining UI state based on current quiz and question data.
  public get showPaging(): boolean {
    return this.isQuizDataLoaded && this.totalQuestions > 0;
  }

  public get shouldShowPrevButton(): boolean {
    return this.currentQuestionIndex > 0;
  }

  public get shouldShowRestartButton(): boolean {
    return (
      this.currentQuestionIndex > 0 &&
      this.currentQuestionIndex <= this.totalQuestions - 1
    );
  }

  public get shouldShowNextButton(): boolean {
    // Use the maximum known question count from all sources
    const serviceCount = this.quizService.questions?.length || 0;
    const effectiveTotal = Math.max(this.totalQuestions, serviceCount);
    return this.currentQuestionIndex < effectiveTotal - 1;
  }

  public get shouldShowResultsButton(): boolean {
    const serviceCount = this.quizService.questions?.length || 0;
    const effectiveTotal = Math.max(this.totalQuestions, serviceCount);

    const isLast =
      effectiveTotal > 0 &&
      this.currentQuestionIndex === effectiveTotal - 1;

    if (!isLast) return false;

    const question: QuizQuestion | null =
      (this.question as QuizQuestion | null) ??
      ((this.quizService as any).currentQuestion?.value as QuizQuestion | null) ??
      (this.quizService.questions?.[this.currentQuestionIndex] ?? null) ??
      ((this.quizService as any).shuffledQuestions?.[this.currentQuestionIndex] ?? null);

    if (!question) return false;

    const selected =
      this.selectedOptionService.getSelectedOptionsForQuestion(this.currentQuestionIndex) ?? [];

    return selected.length > 0;
  }

  // Creates the unified config object for QuizQuestionComponent.
  // This getter encapsulates all the individual input bindings.
  public get quizQuestionConfig(): QuizQuestionConfig | null {
    const qa = this.combinedQuestionDataSubject?.getValue();
    if (!qa) return null;

    return {
      questionPayload: qa,
      currentQuestionIndex: this.currentQuestionIndex,
      displayState$: this.displayState$,
      shouldRenderOptions: this.shouldRenderOptions,
      questionToDisplay$: this.questionToDisplay$,
      explanationToDisplay: this.explanationToDisplay
    };
  }

  // Unified event handler for QuizQuestionComponent events.
  // Dispatches to existing individual handlers based on event type.
  public handleQuizQuestionEvent(event: QuizQuestionEvent): void {
    switch (event.type) {
      case 'answer':
        this.selectedAnswer(event.payload);
        break;
      case 'optionSelected':
        if (event.payload && (event.payload as any).option) {
          void this.onOptionSelected((event.payload as any).option);
        } else {
          void this.onOptionSelected(event.payload as any);
        }
        break;
      case 'selectionMessageChange':
        this.onSelectionMessageChange(event.payload);
        break;
      case 'explanationToDisplayChange':
        this.onExplanationChanged(event.payload, event.index);
        break;
      case 'showExplanationChange':
        this.onShowExplanationChanged(event.payload);
        break;
    }
  }

  /*************** Shuffle and initialize questions ******************/
  /*************** ngOnInit barrel functions ******************/
  private initializeRouteParameters(): void {
    this.fetchRouteParams();
    this.subscribeRouterAndInit();
    this.subscribeToRouteParams();
  }

  private initializeQuizData(): void {
    this.resolveQuizData();
    void this.fetchQuizData();
    this.initializeQuizFromRoute();
  }

  private initializeCurrentQuestion(): void {
    this.initializeQuestionStreams();
    this.loadQuizQuestionsForCurrentQuiz();
    this.createQuestionData();
    void this.getQuestion();
    this.subscribeToCorrectAnswersText();
    this.subscribeToCurrentQuestion();
  }

  /******* Initialize route parameters and subscribe to updates **************/
  fetchRouteParams(): void {
    this.activatedRoute.params
      .pipe(takeUntil(this.destroy$))
      .subscribe((params: Params) => {
        this.quizId = params['quizId'];
        this.questionIndex = +params['questionIndex'];
        this.currentQuestionIndex = this.questionIndex - 1;  // ensure it's 0-based
        void this.loadQuizData();
      });
  }

  private async loadQuizData(): Promise<boolean> {
    if (this.isQuizLoaded) {
      console.log('Quiz data already loaded, skipping load.');
      return true;
    }

    if (!this.quizId) {
      console.error('Quiz ID is missing. Cannot fetch quiz data.');
      return false;
    }

    try {
      // Use QuizService to fetch questions, ensures we get the SHUFFLED questions
      // if shuffle is active.
      const questions =
        await this.quizService.fetchQuizQuestions(this.quizId);

      if (!questions || questions.length === 0) {
        console.error('Quiz has no questions or failed to load via ' +
          'QuizService.');
        return false;
      }

      // We still need the Quiz metadata (title, etc.)
      const quiz =
        await firstValueFrom(this.quizDataService.getQuiz(this.quizId)
          .pipe(take(1))
        );

      if (!quiz) {
        console.error('Quiz metadata not found.');
        return false;
      }

      this.quiz = quiz;

      // Initialize session properly to generate correct FETs for shuffled order
      // This calculates "Option X is correct" based on the SHUFFLED array index,
      // matching the UI.
      this.applyQuestionsFromSession(questions);

      const safeIndex = Math.min(
        Math.max(this.currentQuestionIndex ?? 0, 0),
        this.questions.length - 1
      );
      this.currentQuestionIndex = safeIndex;
      this.currentQuestion = this.questions[safeIndex] ?? null;

      // applyQuestionsFromSession updates local this.quiz, ensuring it has the
      // shuffled questions
      this.quizService.setCurrentQuiz(this.quiz);
      this.isQuizLoaded = true;

      return true;
    } catch (error: any) {
      console.error('Error loading quiz data:', error);
      return false;
    } finally {
      if (!this.isQuizLoaded) {
        console.warn(
          'Quiz loading failed. Resetting questions to an empty array.'
        );
        this.questions = [];
      }
    }
  }

  private subscribeRouterAndInit(): void {
    this.routerSubscription = this.activatedRoute.data
      .pipe(takeUntil(this.destroy$))
      .subscribe((data: any) => {
        const quizData: Quiz = data['quizData'];
        if (
          !quizData ||
          !Array.isArray(quizData.questions) ||
          quizData.questions.length === 0
        ) {
          console.error('Quiz data is undefined, or there are no questions');
          this.router.navigate(['/select']).then(() => {
            console.log('No quiz data available.');
          });
          return;
        }

        this.currentQuiz = quizData;
        this.quizId = quizData.quizId;
        this.questionIndex = +this.activatedRoute.snapshot.params['questionIndex'];
      });
  }

  /****       Initialize route parameters functions *********/
  private subscribeToRouteParams(): void {
    this.activatedRoute.paramMap
      .pipe(
        tap((p) =>
          console.log('[ROUTE] paramMap emitted →',
            p.get('questionIndex'))
        ),
        distinctUntilChanged(
          (prev, curr) =>
            prev.get('questionIndex') === curr.get('questionIndex') &&
            prev.get('quizId') === curr.get('quizId')
        )
      )
      .subscribe(async (params: ParamMap) => {
        const quizId = params.get('quizId') ?? '';
        const indexParam = params.get('questionIndex');
        const index = Number(indexParam) - 1;

        if (!quizId || isNaN(index) || index < 0) {
          console.error('[Invalid route params]', { quizId, indexParam });
          return;
        }

        this.cdRef.markForCheck();

        if (this.quizId && this.quizId !== quizId) {
          console.log(`[ROUTE] Quiz Changed: ${this.quizId} -> ${quizId}. Resetting progress & cache.`);
          this.dotStatusService.clearAllMaps();
          this.clearClickConfirmedDotStatus();
          this.progress = 0;
          this.quizStateService.reset();
        }

        // Update indices (local and services) before async calls
        this.quizId = quizId;
        this.currentQuestionIndex = index;
        // this.quizService.quizId = quizId;
        this.quizService.setQuizId(quizId);
        this.quizService.setCurrentQuestionIndex(index);
        this.timerService.stopTimer?.(undefined, { force: true });
        this.timerService.resetTimer();
        this.timerService.resetTimerFlagsFor(index);

        try {
          // Fetch current quiz meta (unchanged)
          const currentQuiz: Quiz = await firstValueFrom(
            this.quizDataService.getQuiz(quizId).pipe(
              filter((q): q is Quiz => !!q && Array.isArray(q.questions)),
              take(1)
            )
          );
          if (!currentQuiz) {
            console.error('[Failed to fetch quiz with quizId]', quizId);
            return;
          }
          // Cache it in the service
          this.quizService.setCurrentQuiz(currentQuiz);

          // Set loader context
          this.quizQuestionLoaderService.activeQuizId = quizId;
          const totalQ = currentQuiz.questions?.length ?? 0;
          this.quizQuestionLoaderService.totalQuestions = totalQ;
          this.totalQuestions = totalQ; // Ensure local total is updated immediately

          // Now let the loader fetch question + options and emit payload
          const success =
            await this.quizQuestionLoaderService.loadQuestionAndOptions(index);
          if (success) {

          } else {
            console.warn(`[Failed to load Q${index}]`);
          }

          await this.quizQuestionLoaderService.loadQA(index);

          // Use the correct question source (shuffled or original)
          const shouldUseShuffled =
            this.quizService.isShuffleEnabled() &&
            this.quizService.shuffledQuestions?.length > 0;
          const effectiveQuestions = shouldUseShuffled
            ? this.quizService.shuffledQuestions : currentQuiz.questions;
          const question = effectiveQuestions?.[index] ?? null;

          if (!question) {
            console.error('[No question at index]', { index });
            return;
          }

          // Now it's safe to clear previous headline data
          this.quizQuestionLoaderService.resetHeadlineStreams(index);

          // Local state still needed elsewhere in the component
          this.currentQuestion = question;
          this.question = question;

          // Update combinedQuestionDataSubject so the template gets the new question
          const options = question.options ?? [];
          const explanation = question.explanation ?? '';
          const payload: QuestionPayload = {
            question: question,
            options: options,
            explanation: explanation
          };
          this.combinedQuestionDataSubject.next(payload);

          // Also update related state for consistency
          this.quizService.updateCurrentQuestion(question);
          this.questionToDisplaySource.next(question.questionText?.trim() ?? '');
          this.optionsToDisplay = [...options];
          this.optionsToDisplay$.next([...options]);
          this.explanationToDisplay = explanation;
          this.qaToDisplay = { question, options };
          this.shouldRenderOptions = true;

          const optionIdSet = new Set(
            options
              .map((opt) => opt.optionId)
              .filter((id): id is number => typeof id === 'number')
          );
          const validSelections =
            (this.selectedOptionService.getSelectedOptionsForQuestion(index) ?? [])
              .filter((opt) => optionIdSet.has(opt.optionId ?? -1));

          console.log(`[SOS] subscribeToRouteParams for Q${index + 1}: validSelections.length=${validSelections.length}`);

          if (validSelections.length === 0) {
            this.timerService.restartForQuestion(index);
          }

          this.updateProgressValue();
          localStorage.setItem('savedQuestionIndex', index.toString());
        } catch (error) {
          console.error('[Error in paramMap subscribe]', error);
        }
      });
  }

  /**** Initialize route parameters and subscribe to updates ****/
  resolveQuizData(): void {
    this.activatedRoute.data
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(async (data: any) => {
        const quizData = data['quizData'];

        if (quizData && Array.isArray(quizData.questions) &&
          quizData.questions.length > 0) {
          this.selectedQuiz = quizData;

          this.quizService.setSelectedQuiz(quizData);

          // CRITICAL FIX: For shuffled quizzes, defer FET initialization until AFTER
          // the shuffle is applied in initializeQuiz(). This ensures FET indices
          // match the shuffled question order, not the original order.
          const isShuffled = this.quizService.isShuffleEnabled();

          if (!isShuffled) {
            // Unshuffled: Initialize FET immediately with original order
            this.explanationTextService.initializeExplanationTexts(
              quizData.questions.map((q: QuizQuestion) => q.explanation)
            );
          }

          await this.initializeQuiz();

          if (isShuffled) {
            // Shuffled: Initialize FET AFTER shuffle is applied
            // Use the shuffled questions array which is now ready
            const shuffledQuestions = this.quizService.questions ?? [];
            if (shuffledQuestions.length > 0) {
              this.explanationTextService.initializeExplanationTexts(
                shuffledQuestions.map((q: QuizQuestion) => q.explanation)
              );
              console.log('[resolveQuizData] FET initialized with SHUFFLED question order');
            }
          }
        } else {
          console.error('Quiz data is undefined, or there are no questions');
          this.router.navigate(['/select']).then(() => {
            console.log('No quiz data available.');
          });
        }
      });
  }

  // REMOVE!!
  async fetchQuizData(): Promise<void> {
    try {
      const quizId = this.activatedRoute.snapshot.params['quizId'];
      const questionIndexParam = this.activatedRoute.snapshot.params['questionIndex'];
      const questionIndex = parseInt(questionIndexParam, 10);

      if (isNaN(questionIndex)) {
        console.error('Invalid question index:', questionIndexParam);
        return;
      }

      const zeroBasedQuestionIndex = questionIndex - 1;

      const selectedQuiz: Quiz | null = await firstValueFrom(
        this.quizDataService.getQuiz(quizId).pipe(
          takeUntil(this.destroy$),
          catchError((err: Error) => {
            console.error('Error fetching quiz:', err);
            return of(null);  // return null to handle the empty case
          }),
          // Ensure that only valid, non-null quizzes are passed
          filter((quiz: Quiz | null): quiz is Quiz => !!quiz)
        )
      );

      if (!selectedQuiz) {
        console.error('Selected quiz not found for quizId:', quizId);
        return;
      }

      this.selectedQuiz = selectedQuiz;
      if (!selectedQuiz.questions) return;

      if (zeroBasedQuestionIndex < 0 ||
        zeroBasedQuestionIndex >= selectedQuiz.questions.length) {
        console.error('Invalid question index:', zeroBasedQuestionIndex);
        return;
      }

      // Ensure the current question is set
      const currentQuestion =
        selectedQuiz.questions[zeroBasedQuestionIndex];
      if (!currentQuestion) {
        console.error(`Question not found at index ${zeroBasedQuestionIndex} for 
          quizId ${quizId}`);
        return;
      }
      this.currentQuestion = currentQuestion;

      this.processQuizData(zeroBasedQuestionIndex, this.selectedQuiz);
      this.quizService.initializeSelectedQuizData(this.selectedQuiz);

      const questionData =
        await this.fetchQuestionData(quizId, zeroBasedQuestionIndex);
      if (!questionData) {
        console.error('Question data could not be fetched.');
        this.data = null;
        return;
      }

      this.initializeAndPrepareQuestion(questionData, quizId);
    } catch (error) {
      console.error('Error in fetchQuizData:', error);
    }
  }

  private async initializeQuiz(): Promise<void> {
    if (this.quizAlreadyInitialized) {
      console.warn('[initializeQuiz] Already initialized. Skipping...');
      return;
    }

    console.log('[initializeQuiz] Starting quiz init...');
    this.quizAlreadyInitialized = true;

    // Initialize quiz session, dependencies, and routing
    // CRITICAL: Await prepareQuizSession to ensure shuffle state is ready before loading Q1
    await this.prepareQuizSession();
    this.initializeQuizDependencies();
    this.initializeQuizBasedOnRouteParams();

    // Set index to the first question
    const initialIndex = 0;
    this.quizService.setCurrentQuestionIndex(initialIndex);

    // Load the first question (now shuffle is guaranteed to be ready)
    const firstQuestion: QuizQuestion | null = await firstValueFrom(
      this.quizService.getQuestionByIndex(initialIndex)
    );
    if (firstQuestion) {
      this.quizService.setCurrentQuestion(firstQuestion);

      // FIX: Force-regenerate explanation for the initial question to ensure correct option #s
      this.quizQuestionDataService.forceRegenerateExplanation(firstQuestion, initialIndex);
    } else {
      console.warn(`[No question found at index ${initialIndex}]`);
    }
  }

  private applyQuestionsFromSession(questions: QuizQuestion[]): void {
    const hydratedQuestions = this.quizScoringService.hydrateQuestionSet(questions);
    this.questions = hydratedQuestions;

    if (hydratedQuestions.length === 0) {
      this.explanationTextService.initializeExplanationTexts([]);
      this.explanationTextService.initializeFormattedExplanations([]);
      this.syncQuestionSnapshotFromSession(hydratedQuestions);
      return;
    }

    const explanations = hydratedQuestions.map((question) =>
      (question.explanation ?? '').trim()
    );

    this.explanationTextService.initializeExplanationTexts(explanations);

    // Clear FET cache to ensure we don't serve stale explanations,
    // critical when switching between shuffled/unshuffled or re-shuffling
    this.explanationTextService.fetByIndex.clear();
    console.log('[QuizComponent] Cleared FET cache (fetByIndex) before ' +
      'regenerating.');

    const formattedExplanations =
      this.quizQuestionDataService.formatExplanationsForQuestions(hydratedQuestions);

    this.explanationTextService.initializeFormattedExplanations(formattedExplanations);

    if (this.quiz) {
      this.quiz = {
        ...this.quiz,
        questions: hydratedQuestions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({ ...option }))
        }))
      };
    }

    if (this.selectedQuiz) {
      this.selectedQuiz = {
        ...this.selectedQuiz,
        questions: hydratedQuestions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({ ...option }))
        }))
      };
    }

    this.syncQuestionSnapshotFromSession(hydratedQuestions);
  }

  private syncQuestionSnapshotFromSession(hydratedQuestions: QuizQuestion[]): void {
    const result = this.quizContentLoaderService.syncQuestionSnapshot({
      hydratedQuestions, currentQuestionIndex: this.currentQuestionIndex,
      previousIndex: this.previousIndex, serviceCurrentIndex: this.quizService?.currentQuestionIndex,
    });
    if (result.isEmpty) {
      this.questionToDisplay = '';
      this.questionToDisplaySource.next('');
      this.qaToDisplay = undefined;
      this.currentQuestion = null;
      this.optionsToDisplay = [];
      this.optionsToDisplay$.next([]);
      this.currentOptions = [];
      this.pendingOptions = null;
      this.hasOptionsLoaded = false;
      this.shouldRenderOptions = false;
      this.explanationToDisplay = '';
      this.explanationTextService.setExplanationText('', { index: this.currentQuestionIndex ?? 0 });
      return;
    }
    this.currentQuestionIndex = result.normalizedIndex;
    this.question = result.question;
    this.currentQuestion = result.question;
    this.questionData = result.question!;
    this.qaToDisplay = { question: result.question!, options: result.normalizedOptions };
    this.questionToDisplay = result.trimmedQuestionText;
    this.questionToDisplaySource.next(result.trimmedQuestionText);
    this.optionsToDisplay = [...result.normalizedOptions];
    this.optionsToDisplay$.next([...result.normalizedOptions]);
    this.currentOptions = [...result.normalizedOptions];
    this.pendingOptions = null;
    this.hasOptionsLoaded = result.normalizedOptions.length > 0;
    this.shouldRenderOptions = this.hasOptionsLoaded;
    this.explanationToDisplay = result.trimmedExplanation;
    if (this.quizQuestionComponent) this.quizQuestionComponent.optionsToDisplay = [...result.normalizedOptions];
  }

  private async prepareQuizSession(): Promise<void> {
    this.currentQuestionIndex = 0;
    this.quizId = this.activatedRoute.snapshot.paramMap.get('quizId') ?? '';
    await this.quizContentLoaderService.prepareQuizSession({
      quizId: this.quizId,
      applyQuestionsFromSession: (questions) => this.applyQuestionsFromSession(questions),
    });
  }

  // REMOVE!!
  private initializeQuizDependencies(): void {
    this.initializeSelectedQuiz();
    this.initializeObservables();

    if (this.questionIndex >= 0) {
      this.fetchQuestionAndOptions();
    }
  }

  // REMOVE!!
  private initializeSelectedQuiz(): void {
    this.quizDataService.getQuiz(this.quizId).subscribe({
      next: (quiz: Quiz | null) => {
        if (!quiz) {
          console.error('Quiz data is null or undefined');
          return;
        }
        this.selectedQuiz = quiz;
        if (
          !this.selectedQuiz.questions ||
          this.selectedQuiz.questions.length === 0
        ) {
          console.error('Quiz has no questions');
          return;
        }
        const currentQuestionOptions =
          this.selectedQuiz.questions[this.currentQuestionIndex].options;
        this.numberOfCorrectAnswers =
          this.quizQuestionManagerService.calculateNumberOfCorrectAnswers(
            currentQuestionOptions
          );
      },
      error: (error: any) => {
        console.error(error);
      }
    });
  }

  // REMOVE!!
  private initializeObservables(): void {
    const quizId = this.activatedRoute.snapshot.paramMap.get('quizId')
      ?? '';
    this.quizDataService.setSelectedQuizById(quizId);
    this.quizDataService.selectedQuiz$.subscribe((quiz: Quiz | null) => {
      this.selectedQuiz = quiz;
    });
  }

  private fetchQuestionAndOptions(): void {
    if (document.hidden) {
      console.log('Document is hidden, not loading question');
      return;
    }

    if (!this.quizId || this.quizId.trim() === '') {
      console.error('Quiz ID is required but not provided.');
      return;
    }

    if (this.questionIndex < 0) {
      console.error(`Invalid question index: ${this.questionIndex}`);
      return;
    }

    this.quizDataService.getQuestionAndOptions(this.quizId, this.questionIndex)
      .pipe(
        map((data: any): [QuizQuestion | null, Option[] | null] => {
          return Array.isArray(data)
            ? (data as [QuizQuestion | null, Option[] | null])
            : [null, null];
        }),
        catchError(
          (error: Error): Observable<[QuizQuestion | null, Option[] | null]> => {
            console.error('Error fetching question and options:', error);
            return of<[QuizQuestion | null, Option[] | null]>([null, null]);
          }
        )
      )
      .subscribe({
        next: ([question, options]: [QuizQuestion | null, Option[] | null]) => {
          if (question && options) {
            this.quizStateService.updateCurrentQuizState(of(question));
          } else {
            console.log('Question or options not found');
          }
        },
        error: (error: Error) => {
          console.error('Subscription error:', error);
        }
      });
  }

  /****** Start of functions responsible for handling navigation to a particular question using the URL. ******/
  setupNavigation(): void {
    this.activatedRoute.params
      .pipe(
        takeUntil(this.destroy$),
        map((params: Params) => +params['questionIndex']),
        distinctUntilChanged(),
        tap((currentIndex: number) => {
          this.isNavigatedByUrl = true;
          void this.updateContentBasedOnIndex(currentIndex);
        })
      )
      .subscribe();
  }

  // This function updates the content based on the provided index. It validates the
  // index, checks if navigation is needed, and loads the appropriate question.
  async updateContentBasedOnIndex(index: number): Promise<void> {
    const adjustedIndex = index - 1;
    const total = this.quiz?.questions?.length ?? 0;
    if (adjustedIndex < 0 || adjustedIndex >= total) {
      console.warn(`[updateContentBasedOnIndex] Invalid index: 
        ${adjustedIndex}`);
      return;
    }

    // Purge immediately before anything else
    // Rejects all old FET emissions before new load starts
    const ets = this.explanationTextService;
    try {
      ets._fetLocked = true;
      ets.purgeAndDefer(adjustedIndex);
      console.log(`[updateContentBasedOnIndex] Locked + purged FET for 
        Q${adjustedIndex + 1}`);
    } catch (error: any) {
      console.warn(`[updateContentBasedOnIndex] purgeAndDefer failed`, error);
    }

    // Skip redundant reloads
    if (this.previousIndex === adjustedIndex && !this.isNavigatedByUrl) {
      console.log('[updateContentBasedOnIndex] No navigation needed.');
      return;
    }

    // Broadcast the new active index downstream
    this.currentQuestionIndex = adjustedIndex;
    this.previousIndex = adjustedIndex;
    this.quizService.currentQuestionIndexSource.next(adjustedIndex);

    // Reset all transient UI and selection state
    this.resetExplanationText();
    try {
      for (const q of this.quizService.questions ?? []) {
        for (const o of q.options ?? []) {
          o.selected = false;
          o.highlight = false;
          o.showFeedback = false;
          o.showIcon = false;
        }
      }
      this.nextButtonStateService.setNextButtonState(false);
      console.log(
        `[updateContentBasedOnIndex] Cleared option states for 
          Q${adjustedIndex + 1}`
      );
    } catch (error: any) {
      console.warn('[updateContentBasedOnIndex] ⚠️ State reset failed', error);
    }

    // Wait for purge to settle visually
    await this.nextFrame();

    // Load & render the new question. Purge ensures clean state before load begins.
    try {
      await this.loadQuestionByRouteIndex(index);

      // Keep gate closed while feedback renders
      ets._fetLocked = true;
      ets.setShouldDisplayExplanation(false);
      ets.setIsExplanationTextDisplayed(false);
      ets.latestExplanation = '';

      // Wait for feedback and Angular's stabilization before unlocking
      setTimeout(() => {
        this.displayFeedback();

        this.ngZone.onStable.pipe(take(1)).subscribe(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              const stillCurrent =
                ets._gateToken === ets._currentGateToken &&
                adjustedIndex === this.currentQuestionIndex;

              if (!stillCurrent) {
                console.log(
                  `[updateContentBasedOnIndex] stale unlock skipped for 
                   Q${adjustedIndex + 1}`
                );
                return;
              }

              ets._fetLocked = false;
              console.log(
                `[updateContentBasedOnIndex] FET gate unlocked cleanly for Q${adjustedIndex + 1}`
              );
            }, 100);
          });
        });
      }, 140);

      // Ensure all options are clickable again
      setTimeout(() => {
        for (const btn of Array.from(
          document.querySelectorAll(
            '.option-button,.mat-radio-button,.mat-checkbox'
          )
        )) {
          (btn as HTMLElement).style.pointerEvents = 'auto';
        }
      }, 200);
    } catch (error: any) {
      console.error('[updateContentBasedOnIndex] Failed to load question',
        error);
    } finally {
      this.isNavigatedByUrl = false;
    }
  }

  // Utility: await next animation frame
  private nextFrame(): Promise<void> {
    return new Promise((res) =>
      requestAnimationFrame(() => res())
    );
  }

  resetExplanationText(): void {
    this.explanationToDisplay = '';
    this.showExplanation = false;

    // Ensure the shared explanation state is fully cleared before the next question
    // renders so we don't momentarily show the previous explanation (which caused the
    // flicker and stale text issues reported for Q1/Q2 transitions).
    this.explanationTextService.unlockExplanation();
    this.explanationTextService.setExplanationText('', { force: true, index: this.currentQuestionIndex });
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });
    this.explanationTextService.setIsExplanationTextDisplayed(false, {
      force: true
    });
  }

  // This function loads the question corresponding to the provided index.
  async loadQuestionByRouteIndex(routeIndex: number): Promise<void> {
    try {
      const result = await this.quizContentLoaderService.loadQuestionByRoute({
        routeIndex, quiz: this.quiz, quizId: this.quizId, totalQuestions: this.totalQuestions,
      });
      if (result.questionIndex === -1) { void this.router.navigate(['/question/', this.quizId, 1]); return; }
      if (!result.success || !result.question) return;
      this.currentQuestionIndex = result.questionIndex;
      this.timerService.resetTimer();
      this.timerService.startTimer(this.timerService.timePerQuestion, this.timerService.isCountdown, true);
      if (result.totalCount > 0) this.updateProgressValue();
      this.resetFeedbackState();
      this.currentQuestion = result.question;
      this.combinedQuestionDataSubject.next({
        question: result.question, options: result.question.options ?? [], explanation: result.question.explanation ?? ''
      });
      this.questionToDisplay = result.questionText;
      this.questionToDisplaySource.next(result.questionText);
      this.optionsToDisplay = result.optionsWithIds;
      setTimeout(() => {
        this.restoreSelectedOptions();
        setTimeout(() => {
          const prev = this.optionsToDisplay.find((opt) => opt.selected);
          if (prev) this.selectedOptionService.reapplySelectionForQuestion(prev, this.currentQuestionIndex);
        }, 50);
      }, 50);
      try { this.feedbackText = await (this.quizQuestionComponent?.generateFeedbackText(result.question) ?? ''); }
      catch { this.feedbackText = 'Could not generate feedback.'; }
    } catch { this.feedbackText = 'Error loading question details.'; this.cdRef.markForCheck(); }
    setTimeout(() => this.checkScrollIndicator(), 300);
  }

  private restoreSelectedOptions(): void {
    const selectedOptionsData = sessionStorage.getItem(`selectedOptions`);
    if (!selectedOptionsData) return;

    try {
      const selectedOptions = JSON.parse(selectedOptionsData);
      if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        console.warn('[restoreSelectedOptions] No valid selected options to restore.');
        return;
      }

      for (const option of selectedOptions) {
        const restoredOption = this.optionsToDisplay.find(
          opt => opt.optionId === option.optionId
        );

        if (restoredOption) {
          restoredOption.selected = true;  // set option as selected
          console.log(
            '[restoreSelectedOptions] Restored option as selected:',
            restoredOption
          );
        } else {
          console.warn(
            '[restoreSelectedOptions] Option not found in optionsToDisplay:',
            option
          );
        }
      }
    } catch (error: any) {
      console.error('[restoreSelectedOptions] Error parsing selected options:', error);
    }
  }

  private resetFeedbackState(): void {
    this.showFeedback = false;
    this.showFeedbackForOption = {};
    for (const option of this.optionsToDisplay) {
      option.feedback = '';
      option.showIcon = false;
      option.selected = false;  // reset selection before reapplying
    }
    this.cdRef.detectChanges();
  }

  refreshQuestionOnReset(): void {
    const firstQuestion = this.quizService.getQuestionByIndex(0);
    if (!firstQuestion) {
      console.error('[refreshQuestionOnReset] No question found at index 0.');
      return;
    }

    // Update the current question
    firstValueFrom(firstQuestion)
      .then((question: QuizQuestion | null) => {
        if (question) {
          this.quizService.setCurrentQuestion(question);
          this.loadCurrentQuestion();
        } else {
          console.error('[refreshQuestionOnReset] Failed to fetch question at ' +
            'index 0.');
        }
      })
      .catch((error: Error) => {
        console.error('[refreshQuestionOnReset] Error fetching first ' +
          'question:', error);
      });
  }

  private async fetchQuestionData(quizId: string, questionIndex: number): Promise<any> {
    return this.quizQuestionDataService.fetchQuestionData(quizId, questionIndex);
  }

  // REMOVE!!
  private initializeAndPrepareQuestion(
    questionData: CombinedQuestionDataType,
    quizId: string,
  ): void {
    if (!quizId) {
      console.error('Quiz ID is not provided or is empty');
      return;
    }

    // Assign only valid `QuizQuestion` fields
    this.data = {
      questionText: questionData.questionText,
      explanation: questionData.explanation || '',
      options: questionData.options || [],
      type: (questionData.type as QuestionType) ?? QuestionType.SingleAnswer
    };

    // Set Quiz ID
    this.quizService.setQuizId(quizId);

    // Fetch and set quiz questions
    this.quizService
      .fetchQuizQuestions(quizId)
      .then((questions) => {
        this.quizService.setQuestionData(questions);
      })
      .catch((error) => {
        console.error('Error fetching questions:', error);
      });

    // Log received questionData
    console.log('Initializing question with data:', this.data);

    // Subscribe to current options with filter and take
    this.quizStateService.currentOptions$
      .pipe(
        // Only process non-empty options
        filter((options: Option[]) => options && options.length > 0),
        take(1)  // automatically unsubscribe after the first valid emission
      )
      .subscribe({
        next: (options: Option[]) => {
          console.log('Received options from currentOptions$:', options);

          // Create currentQuestion object
          const currentQuestion: QuizQuestion = {
            questionText: this.data?.questionText ?? '',
            options: options.map((option) => ({
              ...option,
              correct: option.correct ?? false  // default to false if `correct` is undefined
            })),
            explanation:
              this.explanationTextService.getLatestFormattedExplanation()?.trim() ?? '',
            type: this.quizDataService.questionType as QuestionType
          };
          this.question = currentQuestion;

          // Filter correct answers
          const correctAnswerOptions = currentQuestion.options.filter(
            (option: Option) => option.correct
          );

          if (correctAnswerOptions.length === 0) {
            console.error(
              `No correct options found for question: "${currentQuestion.questionText}". Options:`,
              currentQuestion.options
            );
            return;  // exit early to avoid setting invalid correct answers
          }

          // Set correct answers if valid options are found
          this.quizService.setCorrectAnswers(currentQuestion, correctAnswerOptions)
            .subscribe({
              next: () => {
                this.displayFeedback();
              },
              error: (err: Error) => {
                console.error('Error setting correct answers:', err);
              }
            });

          // Mark correct answers as loaded
          this.quizService.setCorrectAnswersLoaded(true);
          this.quizService.correctAnswersLoadedSubject.next(true);

          console.log('Correct Answer Options:', correctAnswerOptions);
        },
        error: (error: Error) => {
          console.error('Error subscribing to currentOptions$:', error);
        },
        complete: () => {
          console.log('Subscription to currentOptions$ completed after first ' +
            'valid emission.');
        }
      });
  }

  // REMOVE!!
  private displayFeedback(): void {
    console.log('[prepareFeedback] Triggered.');

    // Validate that options are available for feedback preparation
    if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) return;

    try {
      // Apply feedback to options through QuizQuestionComponent
      this.showFeedback = true;  // enable feedback display

      // Trigger change detection to update the UI
      this.cdRef.detectChanges();

      console.log('[displayFeedback] Feedback successfully prepared for ' +
        'options:', this.optionsToDisplay);
    } catch (error: any) {
      console.error('[displayFeedback] Error while applying feedback:', error);
    }
  }

  private initializeQuizBasedOnRouteParams(): void {
    this.activatedRoute.paramMap
      .pipe(
        takeUntil(this.destroy$),
        switchMap((params: ParamMap) => {
          const quizId = params.get('quizId');
          const questionIndexParam = params.get('questionIndex');
          const routeIndex = Number(questionIndexParam);
          const internalIndex = isNaN(routeIndex)
            ? 0
            : Math.max(routeIndex - 1, 0);  // 0-based

          if (!quizId) {
            console.error('[Route Init] No quizId found in URL.');
            return EMPTY;
          }
          this.quizId = quizId;

          return this.handleRouteParams(params).pipe(
            switchMap(({ quizData }: any) => {
              if (!quizData || !Array.isArray(quizData.questions)) {
                console.error('[Route Init] Invalid quiz data or missing ' +
                  'questions array.');
                return EMPTY;
              }

              const lastIndex = quizData.questions.length - 1;
              const adjustedIndex =
                Math.min(Math.max(internalIndex, 0), lastIndex);

              this.currentQuestionIndex = adjustedIndex;
              this.totalQuestions = quizData.questions.length;

              this.quizService.setActiveQuiz(quizData);
              this.quizService.setCurrentQuestionIndex(adjustedIndex);
              this.quizService.updateBadgeText(
                adjustedIndex + 1,
                quizData.questions.length
              );

              this.initializeQuizState();

              return this.quizService.getQuestionByIndex(adjustedIndex);
            }),
            catchError((error: Error) => {
              console.error('[Route Init] Error during quiz initialization:', error);
              return EMPTY;
            })
          );
        }),
      )
      .subscribe({
        next: async (question) => {
          if (!question) {
            console.error('[Route Init] No question returned.');
            return;
          }

          this.currentQuiz = this.quizService.getActiveQuiz();

          await this.resetAndLoadQuestion(this.currentQuestionIndex);
        },
        complete: () => {
          console.log('[Route Init] Initialization complete.');
        }
      });
  }

  initializeQuizFromRoute(): void {
    this.activatedRoute.data
      .pipe(
        takeUntil(this.destroy$),  // tear down when component is destroyed

        // Extract quizData and pre-load explanations in one flow
        switchMap((data: { quizData?: Quiz }) => {
          if (!data.quizData) {
            console.error('Quiz data is unavailable.');
            void this.router.navigate(['/select']);
            return EMPTY;
          }

          // Store the quiz
          this.quiz = data.quizData;

          // Reset ExplanationTextService state before loading
          // Ensures no stale FET (e.g., Q1) persists across sessions or restarts
          try {
            const ets = this.explanationTextService;
            ets._activeIndex = -1;
            ets._fetLocked = true;
            ets.latestExplanation = '';
            ets.setShouldDisplayExplanation(false);
            ets.setIsExplanationTextDisplayed(false);
            ets.formattedExplanationSubject?.next('');

            // Defer clear emission one frame to avoid race with subject recreation
            requestAnimationFrame(() => ets.emitFormatted(-1, null));

            console.log('[INIT] Cleared old FET state before first render');
          } catch (error) {
            console.warn('[INIT] FET clear failed', error);
          }

          // Skip ensureExplanationsLoaded - applyQuestionsFromSession already
          // generates FET Calling both causes overwrites with different option
          // orders for single-answer Qs
          console.log(
            '[INIT] Skipping ensureExplanationsLoaded ' +
            '(applyQuestionsFromSession handles FET)'
          );
          return of(true);
        })
      )
      .subscribe(() => {
        // Once explanations are ready, wire up navigation
        this.setupNavigation();

        // Seed the first question text immediately
        try {
          const firstQuestion = this.quizService.questions?.[0];
          if (firstQuestion) {
            const trimmed = (firstQuestion.questionText ?? '').trim();
            if (trimmed.length > 0) {
              this.questionToDisplaySource.next(trimmed);
              console.log('[QUIZ INIT] Seeded initial question text for Q1');

              // Unlock gate only AFTER first text is stable
              setTimeout(() => {
                this.explanationTextService._fetLocked = false;
                console.log('[INIT] FET gate opened after first-question ' +
                  'seed');
              }, 80);
            }
          }

          // Delay reopening FET gates slightly so preload emissions don't leak
          this.explanationTextService.setShouldDisplayExplanation(false);
          this.explanationTextService.setIsExplanationTextDisplayed(false);
        } catch (error: any) {
          console.warn('[QUIZ INIT] Could not seed initial question text', error);
        }

        // Trigger a single CD cycle so the UI (quiz/question/options/navigation)
        // appears together, with no flicker
        this.cdRef.markForCheck();
      });
  }

  /************* Fetch and display the current question ***************/
  initializeQuestionStreams(): void {
    // Initialize questions stream
    this.questions$ = this.quizDataService.getQuestionsForQuiz(this.quizId);

    this.questions$.subscribe((questions: QuizQuestion[]) => {
      if (questions && questions.length > 0) {
        this.currentQuestionIndex = 0;

        // Reset and set initial state for each question
        for (const [index] of questions.entries()) {
          const defaultState: QuestionState =
            this.quizStateService.createDefaultQuestionState();
          this.quizStateService.setQuestionState(this.quizId, index, defaultState);
        }

        // Set initial question and options
        this.currentQuestion = questions[this.currentQuestionIndex];

        // Ensure options have the `correct` property explicitly set
        this.options = this.currentQuestion.options.map((option) => ({
          ...option,
          correct: option.correct ?? false  // default `correct` to false if undefined
        }));

        this.quizService.getCurrentQuiz()
          .pipe(
            filter((quiz: Quiz | null): quiz is Quiz => !!quiz),
            take(1)
          )
          .subscribe(async () => {
            // Fetch the current question by index
            try {
              const question = await firstValueFrom(
                this.quizService
                  .getQuestionByIndex(this.currentQuestionIndex)
                  .pipe(take(1))
              );

              if (question) {
                console.log('Current question:', question);
              } else {
                console.warn(
                  'No question found at index', this.currentQuestionIndex
                );
              }
            } catch (error: any) {
              console.error('Error fetching question:', error);
            }

            // Fetch the options for that same question
            try {
              const options: Option[] = await firstValueFrom(
                this.quizService
                  .getOptions(this.currentQuestionIndex)
                  .pipe(take(1))
              );

              if (options && options.length) {
                const updatedOptions =
                  options.map((opt: Option) => ({
                    ...opt,
                    correct: opt.correct ?? false
                  }));
                console.log('Options with correct property:', updatedOptions);
              } else {
                console.warn('No options found at index', this.currentQuestionIndex);
              }
            } catch (error: any) {
              console.error('Error fetching options:', error);
            }
          });
      }
    });
  }

  // Function to load all questions for the current quiz
  private loadQuizQuestionsForCurrentQuiz(): void {
    this.isQuizDataLoaded = false;
    this.quizDataService.getQuestionsForQuiz(this.quizId).subscribe({
      next: (questions: QuizQuestion[]) => {
        this.applyQuestionsFromSession(questions);
        this.isQuizDataLoaded = true;
        console.log('Loaded questions:', this.questions);
      },
      error: (error: Error) => {
        console.error('Failed to load questions:', error);
        this.isQuizDataLoaded = true;
      }
    });
  }

  createQuestionData(): void {
    // Internal fallback question to ensure consistent type
    const fallbackQuestion: QuizQuestion = {
      questionText: 'No question available',
      type: QuestionType.SingleAnswer,
      explanation: '',
      options: []
    };

    const fallbackPayload: QuestionPayload = {
      question: fallbackQuestion,
      options: [],
      explanation: ''
    };

    const combinedSub = this.quizService.questionPayload$
      .pipe(
        map((payload) => {
          const baseQuestion = payload?.question ?? fallbackQuestion;
          const safeOptions = Array.isArray(payload?.options)
            ? payload.options.map((option: Option) => ({
              ...option,
              correct: option.correct ?? false
            }))
            : [];

          const explanation = (
            payload?.explanation ??
            baseQuestion.explanation ??
            ''
          ).trim();

          const normalizedQuestion: QuizQuestion = {
            ...baseQuestion,
            options: safeOptions,
            explanation
          };

          return {
            question: normalizedQuestion,
            options: safeOptions,
            explanation
          } as QuestionPayload;
        }),
        catchError((error: Error) => {
          console.error('[Error in createQuestionData]', error);
          return of(fallbackPayload);
        })
      )
      .subscribe((payload: QuestionPayload) => {
        this.combinedQuestionDataSubject.next(payload);

        this.qaToDisplay = {
          question: payload.question,
          options: payload.options
        };

        const trimmedQuestionText =
          payload.question?.questionText?.trim() ??
          fallbackQuestion.questionText;

        this.questionToDisplay = trimmedQuestionText;
        this.questionToDisplaySource.next(trimmedQuestionText);

        this.explanationToDisplay = payload.explanation ?? '';

        this.question = payload.question;
        this.currentQuestion = payload.question;
        this.currentOptions = [...payload.options];
        this.optionsToDisplay = [...payload.options];
        this.optionsToDisplay$.next([...payload.options]);
      });

    this.subscriptions.add(combinedSub);
  }

  private async getQuestion(): Promise<void | null> {
    try {
      const quizId = this.activatedRoute.snapshot.params['quizId'];
      const currentQuestionIndex = this.currentQuestionIndex;

      if (!quizId || quizId.trim() === '') {
        console.error('Quiz ID is required but not provided.');
        return null;
      }

      const result = await firstValueFrom(
        of(
          this.quizDataService.fetchQuestionAndOptionsFromAPI(
            quizId,
            currentQuestionIndex
          )
        )
      );

      if (!result) {
        console.error('No valid question found');
        return null;
      }

      const [question, options] = result ?? [null, null];
      this.handleQuestion({
        ...question,
        options: options?.map((option: Option) => ({
          ...option,
          correct: option.correct ?? false
        }))
      });
    } catch (error: any) {
      console.error('Error fetching question and options:', error);
      return null;
    }
  }

  getOptions(index: number): Observable<Option[]> {
    return this.quizService.getCurrentOptions(index).pipe(
      catchError((error: Error) => {
        console.error('Error fetching options:', error);
        return of([]);  // fallback to an empty array
      })
    );
  }

  getContentAvailability(): Observable<boolean> {
    return combineLatest([
      this.currentQuestion$,  // ensure this is initialized
      this.options$
    ]).pipe(
      map(([question, options]) =>
        !!question && options.length > 0),
      distinctUntilChanged()
    );
  }

  onSelectionMessageChange(message: string) {
    this.selectionMessage = message;
  }

  // REMOVE!! ????
  // Function to subscribe to changes in the current question and update the currentQuestionType
  public subscribeToCurrentQuestion(): void {
    const combinedQuestionObservable: Observable<QuizQuestion | null> = merge(
      this.quizService.getCurrentQuestionObservable().pipe(
        retry(2),
        catchError((error: Error) => {
          console.error(
            'Error subscribing to current question from quizService:',
            error
          );
          return of(null);  // emit null to continue the stream
        }),
      ),
      this.quizStateService.currentQuestion$
    ).pipe(
      // Explicitly cast to resolve merge typing ambiguity
      map((val) => val as QuizQuestion | null)
    );

    combinedQuestionObservable
      .pipe(
        filter((question: QuizQuestion | null):
          question is QuizQuestion => question !== null),
        map((question: QuizQuestion) => ({
          ...question,
          options: question.options.map((option: Option) => ({
            ...option,
            correct: option.correct ?? false
          }))
        }))
      )
      .subscribe({
        next: (question: QuizQuestion) => this.handleNewQuestion(question),
        error: (error: Error) => {
          console.error('Error processing the question streams:', error);
          this.resetCurrentQuestionState();
        }
      });
  }

  private subscribeToCorrectAnswersText(): void {
    this.quizService.correctAnswersText$
      .pipe(takeUntil(this.destroy$))
      .subscribe((text: string) => {
        this.correctAnswersText = text;
        this.correctAnswersTextSource.next(text);
      });
  }

  private async handleNewQuestion(question: QuizQuestion): Promise<void> {
    try {
      this.currentQuestion = question;
      this.options = question.options || [];  // initialize options safely
      this.currentQuestionType = question.type ?? null;

      // Handle correct answers text update
      await this.updateCorrectAnswersText(question, this.options);
    } catch (error: any) {
      console.error('Error handling new question:', error);
    }
  }

  private async isMultipleAnswer(question: QuizQuestion): Promise<boolean> {
    return await firstValueFrom(
      this.quizQuestionManagerService.isMultipleAnswerQuestion(question)
    );
  }

  // Helper method to reset the current question state
  private resetCurrentQuestionState(): void {
    this.currentQuestion = null;
    this.options = [];
    this.currentQuestionType = null;  // reset on error
    this.correctAnswersTextSource.next('');  // clear the correct answers text
    this.quizService.updateCorrectAnswersText('');
    console.warn('Resetting the current question state.');
  }

  private async updateCorrectAnswersText(
    question: QuizQuestion,
    options: Option[]
  ): Promise<void> {
    try {
      const [multipleAnswers, isExplanationDisplayed] = await Promise.all([
        this.isMultipleAnswer(question),
        this.explanationTextService.isExplanationTextDisplayedSource.getValue()
      ]);

      const correctAnswersText = multipleAnswers
        ? this.getCorrectAnswersText(options)
        : '';

      // Emit the correct answers text to subscribers
      this.correctAnswersTextSource.next(correctAnswersText);
      this.quizService.updateCorrectAnswersText('');
    } catch (error: any) {
      console.error('Error updating correct answers text:', error);
      const fallback = '';
      this.correctAnswersTextSource.next(fallback);  // clear text on error
      this.quizService.updateCorrectAnswersText(fallback);
    }
  }

  private getCorrectAnswersText(options: Option[]): string {
    const numCorrectAnswers =
      this.quizQuestionManagerService.calculateNumberOfCorrectAnswers(options);
    const totalOptions = Array.isArray(options) ? options.length : 0;

    return this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
      numCorrectAnswers,
      totalOptions
    );
  }

  private processQuizData(questionIndex: number, selectedQuiz: Quiz): void {
    if (
      !selectedQuiz ||
      !Array.isArray(selectedQuiz.questions) ||
      selectedQuiz.questions.length === 0
    ) {
      console.error(
        `Quiz data is invalid or not loaded for Quiz ID ${this.quizId}`
      );
      return;
    }

    if (!this.quizService.isValidQuestionIndex(questionIndex, selectedQuiz.questions)) {
      console.error(`Invalid question index: ${questionIndex} for Quiz ID 
        ${this.quizId}`);
      return;
    }

    // Initialize the quiz state for the current question
    this.quizStateService.createDefaultQuestionState();
  }

  // REMOVE!!
  private initializeQuizState(): void {
    // Call findQuizByQuizId and subscribe to the observable to get the quiz data
    this.quizService.findQuizByQuizId(this.quizId).subscribe({
      next: (currentQuiz) => {
        // Validate the quiz object
        if (!currentQuiz) {
          console.error(`Quiz not found: Quiz ID ${this.quizId}`);
          return;
        }

        // Check if the questions property exists, is an array, and is not empty
        if (
          !Array.isArray(currentQuiz.questions) ||
          currentQuiz.questions.length === 0
        ) {
          console.error(`Questions data is invalid or not loaded for Quiz ID 
            ${this.quizId}`);
          return;
        }

        // Assign selectedQuiz before proceeding (must be done before update)
        this.selectedQuiz = currentQuiz;
        console.log('[selectedQuiz.questions]', this.selectedQuiz.questions);

        // Ensure the currentQuestionIndex is valid for the currentQuiz's questions array
        if (
          !this.quizService.isValidQuestionIndex(
            this.currentQuestionIndex,
            currentQuiz.questions
          )
        ) {
          console.error(
            `Invalid question index: Quiz ID ${this.quizId}, Question Index 
              (0-based) ${this.currentQuestionIndex}`
          );
          return;
        }

        // Retrieve the current question using the valid index
        const currentQuestion = currentQuiz.questions[this.currentQuestionIndex];

        // Check if the currentQuestion is defined before proceeding
        if (!currentQuestion) {
          console.error(
            `Current question is undefined: Quiz ID ${this.quizId}, Question Index ${this.currentQuestionIndex}`
          );
          return;
        }

        // Proceed to update the UI for the new question if all checks pass
        setTimeout(() => {
          this.quizInitializationService.updateQuizUIForNewQuestion(currentQuestion);
        }, 0);
      },
      error: (error: Error) => {
        console.error(`Error retrieving quiz: ${error.message}`);
      }
    });
  }

  private async updateQuestionStateAndExplanation(questionIndex: number): Promise<void> {
    const result = await this.quizContentLoaderService.evaluateQuestionStateAndExplanation({
      quizId: this.quizId, questionIndex,
    });
    if (!result.handled) return;
    this.explanationToDisplay = result.explanationText;
    this.showExplanation = result.showExplanation;
    if (result.showExplanation) this.cdRef.detectChanges();
  }

  handleRouteParams(
    params: ParamMap
  ): Observable<{ quizId: string; questionIndex: number; quizData: Quiz }> {
    return this.quizRouteService.handleRouteParams(params);
  }

  handleQuestion(question: QuizQuestion | null): void {
    if (!question) {
      console.error('Invalid question provided.');
      this.question = null;  // reset the question to avoid stale data
      return;
    }

    this.question = question;
  }

  selectedAnswer(optionIndex: number): void {
    this.updateProgressValue();  // update progress on selection

    // Look up the Option from the index
    const option =
      this.question?.options?.[optionIndex] ?? this.optionsToDisplay?.[optionIndex];
    if (!option) {
      console.warn(`[selectedAnswer] No option found at index ${optionIndex}`);
      return;
    }

    // Mark the question as answered
    this.answered = true;

    // Check if the answer is correct
    // void this.quizService.checkIfAnsweredCorrectly(this.currentQuestionIndex);

    // Get all correct answers for the question
    this.correctAnswers = this.question?.options.filter((opt: Option) => opt.correct) ?? [];

    // Handle multiple correct answers
    if (this.correctAnswers.length > 1) {
      // Add the option to answers if it's not already included
      if (!this.answers.includes(option)) {
        this.answers.push(option);
      }
    } else {
      // For single correct answer, replace the first element
      this.answers = [option];
    }

    // Sync selected answers into QuizService before scoring.
    // Previously checkIfAnsweredCorrectly() ran before this.answers was updated,
    // which delayed +1 updates until later navigation/state refresh.
    const answerIds = this.answers
      .map((ans: Option) => ans.optionId)
      .filter((id): id is number => typeof id === 'number');
    this.quizService.answers = [...this.answers];
    this.quizService.updateUserAnswer(this.currentQuestionIndex, answerIds);

    // Check if the answer is correct using updated answer state.
    // Use updateScore=false: OIS scoreDirectly already handles score mutation.
    void this.quizService.checkIfAnsweredCorrectly(this.currentQuestionIndex, false);

    // Notify subscribers of the selected option
    this.selectedOption$.next(option);

    // Display explanation after selecting an answer
    void this.updateQuestionStateAndExplanation(this.currentQuestionIndex);
  }

  loadCurrentQuestion(): void {
    this.quizService.getQuestionByIndex(this.currentQuestionIndex)
      .pipe(
        tap((question: QuizQuestion | null) => {
          if (question) {
            this.question = question;

            // Fetch options for this question
            this.quizService.getOptions(this.currentQuestionIndex).subscribe({
              next: (options: Option[]) => {
                this.optionsToDisplay = options || [];
                console.log('Loaded options:', this.optionsToDisplay);

                const answered =
                  this.selectedOptionService.isQuestionAnswered(this.currentQuestionIndex);
                if (!answered) {
                  this.timerService.restartForQuestion(this.currentQuestionIndex);
                }
              },
              error: (error: Error) => {
                console.error('Error fetching options:', error);
                this.optionsToDisplay = [];
              }
            });
          } else {
            console.error('Failed to load question at index:', this.currentQuestionIndex);
          }
        }),
        catchError((error: Error) => {
          console.error('Error fetching question:', error);
          return of(null);
        }),
      )
      .subscribe();
  }

  /************************ paging functions *********************/
  private async advanceQuestion(direction: 'next' | 'previous'): Promise<void> {
    this.quizContentLoaderService.snapshotLeavingQuestion({
      leavingIdx: this.currentQuestionIndex,
      leavingDotClass: this.getDotClass(this.currentQuestionIndex),
      quizId: this.quizId,
      getScoringKey: (idx) => this.dotStatusService.getScoringKey(this.quizId, idx),
    });
    const leavingDotClass = this.getDotClass(this.currentQuestionIndex);
    if (leavingDotClass.includes('correct')) this.setPersistedDotStatus(this.currentQuestionIndex, 'correct');
    else if (leavingDotClass.includes('wrong')) this.setPersistedDotStatus(this.currentQuestionIndex, 'wrong');
    this.triggerAnimation();
    this.selectedOptionService.setAnswered(false);
    this.quizStateService.resetInteraction();
    if (direction === 'next') {
      const destIndex = this.currentQuestionIndex + 1;
      if (destIndex < this.totalQuestions) {
        this.dotStatusService.clearForIndex(destIndex);
        this.selectedOptionService.lastClickedCorrectByQuestion.delete(destIndex);
        this.clearPersistedDotStatus(destIndex);
      }
    }
    await this.ngZone.run(async () => {
      if (direction === 'next') await this.quizNavigationService.advanceToNextQuestion();
      else await this.quizNavigationService.advanceToPreviousQuestion();
      this.updateProgressValue();
      this.cdRef.markForCheck();
    });
  }

  public advanceToNextQuestion(): Promise<void> {
    console.log('[QUIZ COMPONENT] advanceToNextQuestion triggered ' +
      '(Simplified)');
    return this.advanceQuestion('next');
  }

  public advanceToPreviousQuestion(): Promise<void> {
    return this.advanceQuestion('previous');
  }

  advanceToResults(): void {
    console.log('[advanceToResults] CALLED - quizId:', this.quizId);

    if (this.navigatingToResults) {
      console.warn('[advanceToResults] BLOCKED - navigatingToResults is true');
      return;
    }

    this.navigatingToResults = true;

    // Record elapsed time
    const currentIndex = this.quizService.getCurrentQuestionIndex?.() ?? this.currentQuestionIndex;
    const currentElapsed = (this.timerService as any).elapsedTime ?? 0;
    if (currentIndex != null && currentIndex >= 0 &&
      !this.timerService.elapsedTimes[currentIndex] && currentElapsed > 0) {
      this.timerService.elapsedTimes[currentIndex] = currentElapsed;
    }

    // Stop timer
    if (this.timerService.isTimerRunning) {
      this.timerService.stopTimer(() => { }, { force: true });
    }

    // Delegate navigation to QuizNavigationService
    this.quizNavigationService.navigateToResults();
    this.navigatingToResults = false;
  }

  private async fetchAndSetQuestionData(questionIndex: number): Promise<boolean> {
    this.questionTextLoaded = false;
    this.hasOptionsLoaded = false;
    this.shouldRenderOptions = false;
    this.isLoading = true;
    if (this.quizQuestionComponent) this.quizQuestionComponent.renderReady = true;
    this.currentQuestion = null;
    this.resetQuestionState();
    this.resetQuestionDisplayState();
    this.explanationTextService.resetExplanationState();
    this.resetComplete = false;
    const result = await this.quizContentLoaderService.fetchAndPrepareQuestion({
      questionIndex, totalQuestions: this.totalQuestions, quizId: this.quizId,
    });
    if (!result.success) return false;
    this.questionToDisplay = result.trimmedText;
    this.questionTextLoaded = true;
    this.isAnswered = result.isAnswered;
    Promise.resolve().then(() => {
      this.questionToDisplaySource.next(result.trimmedText);
      this.optionsToDisplay = result.clonedOptions;
      this.shouldRenderOptions = true;
      this.cdRef.markForCheck();
    });
    this.question = result.question;
    this.currentQuestion = result.currentQuestion;
    this.optionsToDisplay = structuredClone(result.clonedOptions);
    if (this.quizQuestionComponent) {
      this.quizQuestionComponent.updateOptionsSafely(result.clonedOptions);
    } else {
      requestAnimationFrame(() => { this.pendingOptions = result.clonedOptions; });
    }
    this.hasOptionsLoaded = true;
    this.shouldRenderOptions = true;
    this.timerService.stopTimer?.(undefined, { force: true });
    this.timerService.resetTimer();
    this.timerService.resetTimerFlagsFor(questionIndex);
    if (result.isAnswered) {
      this.timerService.isTimerRunning = false;
    } else if (result.shouldStartTimer) {
      this.timerService.startTimer(this.timerService.timePerQuestion, this.timerService.isCountdown, true);
    }
    this.setQuestionDetails(result.trimmedText, result.finalOptions, result.explanationText);
    this.currentQuestionIndex = questionIndex;
    this.explanationToDisplay = result.explanationText;
    this.questionPayload = result.questionPayload;
    this.shouldRenderQuestionComponent = true;
    this.resetComplete = true;
    return true;
  }

  private setQuestionDetails(questionText: string, options: Option[], explanationText: string): void {
    // Use fallback if question text is empty
    this.questionToDisplay = questionText?.trim() || 'No question text available';

    // Ensure options are a valid array
    this.optionsToDisplay = Array.isArray(options) ? options : [];

    // Set explanation fallback
    this.explanationToDisplay = explanationText?.trim() || 'No explanation available';

    // Emit latest values to any subscribers (template/UI)
    this.questionTextSubject.next(this.questionToDisplay);
    this.explanationTextSubject.next(this.explanationToDisplay);

    if (
      !this.explanationToDisplay ||
      this.explanationToDisplay === 'No explanation available'
    ) {
      console.warn('[setQuestionDetails] Explanation fallback triggered');
    }
  }

  private async resetAndLoadQuestion(questionIndex: number): Promise<void> {
    try {
      const currentBadgeNumber = this.quizService.getCurrentBadgeNumber();
      if (currentBadgeNumber !== questionIndex) {
        console.warn(
          `Badge number (${currentBadgeNumber}) does not match question index 
          (${questionIndex}). Correcting...`
        );
      }

      this.resetQuestionState();

      this.explanationTextService.unlockExplanation();
      this.explanationTextService.resetStateBetweenQuestions();

      this.optionsToDisplay = [];
      this.currentQuestion = null;

      await this.handleQuestionLoad(questionIndex);
    } catch (error: any) {
      console.error('Error during acquireAndNavigateToQuestion():', error);
    }
  }

  private async handleQuestionLoad(index: number): Promise<boolean> {
    if (!this.isValidIndex(index)) return false;

    this.resetSharedUIState();
    this.syncCurrentIndex(index);

    const fetched = await this.acquireQuestionData(index);
    if (!fetched) return false;

    // Compute and emit "# of correct answers" banner
    requestAnimationFrame(() => this.emitCorrectAnswersBanner(index));

    this.injectDynamicComponent();
    this.updateBadgeText();

    return true;
  }

  private async acquireQuestionData(index: number): Promise<boolean> {
    const fetched = await this.fetchAndSetQuestionData(index);
    if (!fetched || !this.question || !this.optionsToDisplay?.length) {
      console.error(`[Q${index}] Incomplete data`, {
        fetched,
        question: this.question
      });
      return false;
    }
    return true;
  }

  private isValidIndex(index: number): boolean {
    const valid = index >= 0 && index < this.totalQuestions;
    if (!valid) console.warn(`[Invalid index]: ${index}`);
    return valid;
  }

  private resetSharedUIState(): void {
    this.quizQuestionComponent &&
      (this.quizQuestionComponent.renderReady = false);
    this.sharedOptionComponent?.resetUIForNewQuestion();
  }

  private syncCurrentIndex(index: number): void {
    this.currentQuestionIndex = index;
    this.quizService.setCurrentQuestionIndex(index);
    localStorage.setItem('savedQuestionIndex', JSON.stringify(index));
  }

  private updateBadgeText(): void {
    const index = this.quizService.getCurrentQuestionIndex();
    if (index >= 0 && index < this.totalQuestions) {
    } else {
      console.warn('[Badge update skipped] Invalid index or totalQuestions');
    }
  }

  private injectDynamicComponent(): void {
    // Only inject if the container is empty
    if (
      !this.quizQuestionComponent ||
      !this.currentQuestion?.questionText ||
      !this.optionsToDisplay?.length
    ) {
      return;  // nothing to inject with
    }

    const viewRef = this.quizQuestionComponent.dynamicAnswerContainer;
    if (!viewRef || viewRef.length) return;  // already has a child → skip

    console.log('[Reinjection] Dynamic container was empty – reinjecting');
    this.quizQuestionComponent.containerInitialized = false;
    this.quizQuestionComponent.sharedOptionConfig = null;
    this.quizQuestionComponent.shouldRenderFinalOptions = false;

    void this.quizQuestionComponent.loadDynamicComponent(this.currentQuestion, this.optionsToDisplay);
  }


  private resetQuestionDisplayState(): void {
    this.questionToDisplay = '';
    this.explanationToDisplay = '';
    this.optionsToDisplay = [];
  }

  restartQuiz(): void {
    console.log('[QuizComponent] restartQuiz: performing full reset');

    // Service-level resets
    this.quizResetService.performRestartServiceResets(
      this.quizId,
      this.totalQuestions
    );

    // Component-local state
    this.dotStatusService.clearAllMaps();
    this.quizQuestionComponent?.selectedIndices?.clear();
    this.timerService.stopTimer?.(undefined, { force: true });
    this.progress = 0;
    this.clearClickConfirmedDotStatus();
    this.updateProgressValue();

    // Navigate to Q1
    this.router.navigate(['/quiz/question', this.quizId, 1])
      .then(() => {
        this.currentQuestionIndex = 0;
        this.quizService.setCurrentQuestionIndex(0);
        this.quizService.updateBadgeText(1, this.totalQuestions);

        this.resetStateService.triggerResetFeedback();
        this.resetStateService.triggerResetState();
        this.quizService.setCurrentQuestionIndex(0);

        this.nextButtonStateService.setNextButtonState(false);
        this.quizStateService.setAnswerSelected(false);

        queueMicrotask(() => {
          this.quizStateService.setInteractionReady(true);
          requestAnimationFrame(() => {
            this.timerService.resetTimer();
            this.timerService.startTimer(
              this.timerService.timePerQuestion,
              this.timerService.isCountdown,
              true
            );
          });
        });

        queueMicrotask(() => {
          this.sharedOptionComponent?.generateOptionBindings();
          this.cdRef.detectChanges();
        });
      })
      .catch((error: Error) =>
        console.error('Navigation error on restart:', error)
      );
  }

  triggerAnimation(): void {
    this.animationState$.next('animationStarted');
  }

  public showExplanationForQuestion(qIdx: number): void {
    const { explanationHtml } = this.quizContentLoaderService.prepareExplanationForQuestion({
      qIdx, questionsArray: this.questionsArray, quiz: this.quiz,
      currentQuestionIndex: this.currentQuestionIndex, currentQuestion: this.currentQuestion,
    });
    this.explanationToDisplay = explanationHtml;
    this.explanationOverride = { idx: qIdx, html: explanationHtml };
    this.showExplanation = true;
    this.cdRef.detectChanges();
  }

  // Compute and emit the "# of correct answers" banner text for a given question index.
  private emitCorrectAnswersBanner(index: number): void {
    this.quizContentLoaderService.emitCorrectAnswersBanner(
      index,
      (numCorrect, totalOpts) => this.quizQuestionManagerService.getNumberOfCorrectAnswersText(numCorrect, totalOpts)
    );
  }

  onExplanationChanged(explanation: string | any, index?: number): void {
    let finalExplanation: string;
    let finalIndex = index;

    if (explanation && typeof explanation === 'object' && 'payload' in explanation) {
      finalExplanation = explanation.payload;
      finalIndex = ('index' in explanation) ? explanation.index : index;
    } else {
      finalExplanation = explanation;
    }

    if (finalExplanation) {
      // Guard: Don't let non-formatted text overwrite an already-formatted FET
      // that contains "Option X is correct because...". The child component may
      // emit raw explanation text (via performUpdateExplanationDisplay) when
      // explanationsInitialized is false after resetExplanationState().
      const currentHasPrefix = this.explanationToDisplay?.toLowerCase().includes('correct because');
      const incomingHasPrefix = finalExplanation.toLowerCase().includes('correct because');
      if (currentHasPrefix && !incomingHasPrefix) {
        return;
      }

      this.explanationToDisplay = finalExplanation;
      this.explanationTextService.setExplanationText(finalExplanation, { index: finalIndex });
      this.explanationTextService.setShouldDisplayExplanation(true);
    }
  }

  onShowExplanationChanged(shouldShow: boolean): void {
    if (shouldShow) {
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    }
  }

  updateProgressValue(): void {
    const total = this.totalCount;
    if (total <= 0) {
      console.warn('[PROGRESS] updateProgressValue: totalCount is 0; keeping previous progress', this.progress);
      this.cdRef.markForCheck();
      return;
    }

    if (this.dotStatusService.isQuizFreshAtQuestionOne(this.currentQuestionIndex)) {
      for (let i = 0; i < total; i++) {
        this.dotStatusService.dotStatusCache.set(i, 'pending');
      }
      this.progress = 0;
      this.cdRef.detectChanges();
      this.cdRef.markForCheck();
      return;
    }

    let answeredCount = 0;
    for (let i = 0; i < total; i++) {
      const status = this.getQuestionStatus(i, { forceRecompute: true });
      this.dotStatusService.dotStatusCache.set(i, status);
      if (status !== 'pending') {
        answeredCount += 1;
      }
    }

    this.progress = Math.round((answeredCount / total) * 100);

    console.log(`[PROGRESS] Q${this.currentQuestionIndex + 1} SUMMARY: answeredCount=${answeredCount}/${total}, progress=${this.progress}%`);

    this.cdRef.detectChanges();
    this.cdRef.markForCheck();
  }

  // Consistent total count getter
  private get totalCount(): number {
    const serviceCount = (this.quizService as any).questions?.length || 0;
    if (this.totalQuestions > 0) return this.totalQuestions;
    if (serviceCount > 0) return serviceCount;
    return (this.quiz?.questions?.length || 0);
  }

  // Calculate percentage based on answered questions
  // Includes questions that are fully correct/wrong, OR have active selections (interacted)
  calculateAnsweredCount(): number {
    return this.quizScoringService.calculateAnsweredCount({
      totalCount: this.totalCount,
      totalQuestions: this.totalQuestions,
      quizQuestionsLength: this.quiz?.questions?.length ?? 0
    });
  }

  // Delegate persistence helpers to QuizPersistenceService
  private setPersistedDotStatus(index: number, status: 'correct' | 'wrong'): void {
    this.quizPersistence.setPersistedDotStatus(this.quizId, index, status);
  }

  private clearPersistedDotStatus(index: number): void {
    this.quizPersistence.clearPersistedDotStatus(this.quizId, index);
  }

  /** Remove ALL persisted dot status entries (used on quiz restart). */
  private clearAllPersistedDotStatus(): void {
    this.quizPersistence.clearAllPersistedDotStatus(this.quizId);
  }

  // Delegate dot/selection logic to QuizDotStatusService
  private get _dotParams() {
    return {
      quizId: this.quizId,
      currentQuestionIndex: this.currentQuestionIndex,
      optionsToDisplay: this.optionsToDisplay,
      currentQuestion: this.currentQuestion,
      questionsArray: this.questionsArray,
    };
  }

  private getSelectionsForQuestion(index: number): SelectedOption[] {
    return this.dotStatusService.getSelectionsForQuestion({
      index,
      ...this._dotParams,
    });
  }

  // Delegate to QuizDotStatusService
  getQuestionStatus(index: number, options?: { forceRecompute?: boolean }): 'correct' | 'wrong' | 'pending' {
    return this.dotStatusService.getQuestionStatusSimple({
      index,
      ...this._dotParams,
      options,
    });
  }

  // Call this when user selects an answer to update the cache
  updateDotStatus(index: number): void {
    console.log(`[DOT UPDATE] Re-evaluating Q${index + 1}`);
    // If user selects an option, this question is no longer "unanswered expired"
    this.dotStatusService.timerExpiredUnanswered.delete(index);
    // Use forceRecompute to bypass stale cache entries
    const status = this.getQuestionStatus(index, { forceRecompute: true });
    this.dotStatusService.dotStatusCache.set(index, status);

    // Ensure CD runs to update UI colors immediately
    this.cdRef.detectChanges();
    this.cdRef.markForCheck();
  }

  getDotClass(index: number): string {
    return this.dotStatusService.getDotClassSimple({
      index,
      ...this._dotParams,
    });
  }

  /** Clear clickConfirmedDotStatus map AND its sessionStorage backing. */
  private clearClickConfirmedDotStatus(): void {
    this.quizPersistence.clearClickConfirmedDotStatus(this.totalQuestions);
  }

  navigateToDot(index: number): void {
    // Only allow navigation to questions that have been answered (or current question)
    if (!this.isDotClickable(index)) {
      console.log(
        `[DOT NAV] Blocked navigation to Q${index + 1} - question not yet answered`
      );
      return;
    }

    // Simple navigation - update index and use router, quizId needed for route
    const quizId = this.quizService.quizId || this.quizService.getCurrentQuizId();
    console.log(`[DOT NAV] Navigating to Q${index + 1} for quiz ${quizId}`);

    // Clear click-based dot state so the destination dot starts as blue
    this.dotStatusService.clearForIndex(index);
    this.selectedOptionService.lastClickedCorrectByQuestion.clear();
    this.clearPersistedDotStatus(index);

    // Clear option lock state for the destination question so all options are enabled
    this.selectedOptionService.resetLocksForQuestion(index);

    // Update the service state
    this.quizService.setCurrentQuestionIndex(index);

    // Navigate via router (route change triggers question loading)
    this.router.navigate(['/quiz/question', quizId, index + 1]);
  }

  // Check if a dot is clickable (answered, current question, or next after answering
  // current)
  isDotClickable(index: number): boolean {
    // Always allow clicking current question
    if (index === this.currentQuestionIndex) return true;

    // Allow clicking if this specific question has been answered
    const status = this.getQuestionStatus(index);
    if (status === 'correct' || status === 'wrong') return true;

    // Allow free navigation to any question (even unanswered ones)
    // Visual styling still shows answered/unanswered state
    return true;
  }
}