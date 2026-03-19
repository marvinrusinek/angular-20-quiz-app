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
  Subject, Subscription, throwError
} from 'rxjs';
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
import { ScoreAnalysisItem, FinalResult } from '../../shared/models/Final-Result.model';
import { QuestionPayload } from '../../shared/models/QuestionPayload.model';
import { QuestionState } from '../../shared/models/QuestionState.model';
import { CombinedQuestionDataType } from '../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../shared/models/Option.model';
import { QuestionData } from '../../shared/models/QuestionData.type';
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
import { QuizShuffleService } from '../../shared/services/flow/quiz-shuffle.service';
import { RenderStateService } from '../../shared/services/ui/render-state.service';
import { SelectedOptionService } from '../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../shared/services/features/selection-message.service';
import { TimerService } from '../../shared/services/features/timer.service';
import { ResetStateService } from '../../shared/services/state/reset-state.service';
import { ResetBackgroundService } from '../../shared/services/ui/reset-background.service';
import { SharedVisibilityService } from '../../shared/services/ui/shared-visibility.service';

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

  // Persistent Dot Status Cache - survives navigation and resets
  private dotStatusCache = new Map<number, 'correct' | 'wrong' | 'pending'>();

  constructor(
    public quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizInitializationService: QuizInitializationService,
    private quizNavigationService: QuizNavigationService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private quizStateService: QuizStateService,
    private quizShuffleService: QuizShuffleService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private nextButtonStateService: NextButtonStateService,
    private selectionMessageService: SelectionMessageService,
    private selectedOptionService: SelectedOptionService,
    private renderStateService: RenderStateService,
    private resetStateService: ResetStateService,
    private resetBackgroundService: ResetBackgroundService,
    private sharedVisibilityService: SharedVisibilityService,

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
          // ALWAYS reset navigation service on any quiz load (it's a singleton that persists)
          this.quizNavigationService.resetForNewQuiz();

          console.log(`[QuizComponent] Quiz INIT/SWITCH: ${this.quizId} -> ${routeQuizId}. Resetting state for clean start.`);

          // CRITICAL: Clear ALL question data - both service and local
          this.quizService.resetAll();
          this.quizStateService.reset();  // Reset quiz state service
          this.explanationTextService.resetExplanationState();  // Clear explanation caches
          this.selectedOptionService.clearAllSelectionsForQuiz(routeQuizId);

          // Clear local component state
          this.questionsArray = [];
          this.currentQuestion = null;
          this.optionsToDisplay = [];
          this.optionsToDisplay$.next([]);
          this.combinedQuestionDataSubject.next(null);
          this.questionToDisplaySource.next('');
          this.explanationToDisplay = '';
          this.currentQuestionIndex = 0;
          this.lastLoggedIndex = -1;

          // Clear dot status cache (Important to get gray dots)
          this.dotStatusCache.clear();

          // Reset display mode to question (not explanation)
          this.quizStateService.setDisplayState({ mode: 'question', answered: false });
          this.showExplanation = false;
          this.navigatingToResults = false;
          this.isQuizLoaded = false;
          this.isQuizDataLoaded = false;
          this.totalQuestions = 0;
          this.progress = 0;

          try {
            localStorage.removeItem('shuffledQuestions');
            localStorage.removeItem('userAnswers');
            localStorage.removeItem('selectedOptionsMap');
            localStorage.removeItem('questionCorrectness');
            localStorage.removeItem(this.getDotStatusStorageKey());
            localStorage.removeItem('quiz_dot_status_default');
            localStorage.removeItem(this.getProgressStorageKey());
            localStorage.removeItem('quiz_progress_default');
            localStorage.setItem('savedQuestionIndex', '0');
            sessionStorage.clear();  // clear session storage to reset dots
          } catch { }

          // Update quiz ID and fetch new questions
          this.quizId = routeQuizId;
          this.quizService.setQuizId(routeQuizId);
          try { localStorage.setItem('lastQuizId', routeQuizId); } catch { }
          await this.loadQuestions();
          this.isQuizLoaded = true; // Mark as loaded to prevent reset on within-quiz nav
          console.log(`[DEBUG] After loadQuestions, questionsArray[0]=${this.questionsArray[0]?.questionText?.substring(0, 30)}`);
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

  private resetQuizState(): void {
    this.quizService.resetQuestionPayload();
    this.quizQuestionLoaderService.resetUI();

    // Ensure each quiz start begins from clean scoring/selection state.
    this.quizService.resetScore();
    this.quizService.questionCorrectness?.clear();
    this.quizService.selectedOptionsMap?.clear();
    this.selectedOptionService.selectedOptionsMap?.clear();

    try {
      localStorage.setItem('correctAnswersCount', '0');
      localStorage.removeItem('questionCorrectness');
      localStorage.removeItem('selectedOptionsMap');
      localStorage.removeItem('userAnswers');
    } catch { }

    localStorage.removeItem('savedQuestionIndex');
  }

  private getRouteQuestionNumber(): number | null {
    const parseNum = (raw: string | null): number | null => {
      if (raw == null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const qn = Math.trunc(n);
      return qn >= 1 ? qn : null;
    };

    const fromCurrent = parseNum(this.activatedRoute.snapshot.paramMap.get('questionIndex'));
    if (fromCurrent !== null) return fromCurrent;

    const walk = (snapshot: any): number | null => {
      if (!snapshot) return null;
      const found = parseNum(snapshot.paramMap?.get?.('questionIndex') ?? null);
      if (found !== null) return found;
      for (const child of snapshot.children ?? []) {
        const childFound = walk(child);
        if (childFound !== null) return childFound;
      }
      return null;
    };

    const fromTree = walk(this.router.routerState.snapshot.root);
    if (fromTree !== null) return fromTree;

    const m = this.router.url.match(/\/(\d+)(?:\/)?(?:\?|$)/);
    if (m) {
      const fromUrl = parseNum(m[1]);
      if (fromUrl !== null) return fromUrl;
    }

    return null;
  }

  private getRouteQuestionIndex(): number {
    const toIndex = (raw: string | null): number | null => {
      if (raw == null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.trunc(n) - 1);
    };

    const fromCurrent = toIndex(this.activatedRoute.snapshot.paramMap.get('questionIndex'));
    if (fromCurrent !== null) return fromCurrent;

    const walk = (snapshot: any): number | null => {
      if (!snapshot) return null;
      const found = toIndex(snapshot.paramMap?.get?.('questionIndex') ?? null);
      if (found !== null) return found;
      for (const child of snapshot.children ?? []) {
        const childFound = walk(child);
        if (childFound !== null) return childFound;
      }
      return null;
    };

    const fromTree = walk(this.router.routerState.snapshot.root);
    if (fromTree !== null) return fromTree;

    const fromUrl = (() => {
      const m = this.router.url.match(/\/(\d+)(?:\?|$)/);
      if (!m) return null;
      return toIndex(m[1]);
    })();
    if (fromUrl !== null) return fromUrl;

    return 0;
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
    if (this.currentQuestionIndex !== 0) {
      return;
    }

    // Only clear for a truly fresh start. If any scored/selection state exists,
    // preserve it so score can continue incrementing across question navigation.
    const hasExistingState =
      (this.quizService.questionCorrectness?.size ?? 0) > 0 ||
      (this.quizService.selectedOptionsMap?.size ?? 0) > 0 ||
      (this.selectedOptionService.selectedOptionsMap?.size ?? 0) > 0;

    if (hasExistingState) {
      return;
    }

    this.dotStatusCache.clear();
    this.quizService.questionCorrectness?.clear();
    this.quizService.selectedOptionsMap?.clear();
    this.selectedOptionService.selectedOptionsMap?.clear();

    try {
      localStorage.removeItem(this.getDotStatusStorageKey());
      localStorage.removeItem('quiz_dot_status_default');
      localStorage.removeItem(this.getProgressStorageKey());
      localStorage.removeItem('quiz_progress_default');
      localStorage.removeItem('questionCorrectness');
      localStorage.removeItem('selectedOptionsMap');
      localStorage.removeItem('userAnswers');
    } catch { }

    this.progress = 0;

    // Ensure scoreboard starts from 0 on fresh quiz start (Q1).
    // this.quizService.resetScore();
    // try { localStorage.setItem('correctAnswersCount', '0'); } catch {}
    // Do NOT reset score here. This helper can run during component lifecycle
    // transitions where route/session state has not fully hydrated yet, and
    // resetting here causes valid scores (e.g. 1/6) to snap back to 0/6.
    // Explicit quiz-start/restart flows are responsible for score resets.
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
        const ets = this.explanationTextService;

        // Keep historical state for progress/dots
        if (prevIdx !== null && prevIdx !== idx) {
          console.warn('[STATE SYNC] Moving from Q', prevIdx + 1);
          // Only clear FET belonging to the previous question
          if (ets.latestExplanationIndex === prevIdx) {
            ets.latestExplanation = '';
            ets.latestExplanationIndex = null;
            ets.formattedExplanationSubject.next('');
            ets.shouldDisplayExplanationSource.next(false);
            ets.setIsExplanationTextDisplayed(false);
          }
        }

        // Hard Reset Question State (not just UI)
        const qState =
          this.quizId && Number.isFinite(idx)
            ? this.quizStateService.getQuestionState?.(this.quizId, idx)
            : null;

        if (qState) {
          console.warn('[QSTATE HARD RESET] Clearing stale explanation flags for ' +
            'Q', idx + 1);

          qState.explanationDisplayed = false;
          qState.explanationText = '';
        }

        // Do not clear the current question state
        ets._activeIndex = idx;
        ets.latestExplanationIndex = idx;  // ensure FET guard can match for new question
        ets._fetLocked = false;
        this.lastLoggedIndex = idx;

        // Update the component property so it propagates to children
        this.currentQuestionIndex = idx;

        // URL Navigation Sync. Manually update currentQuestion when index changes.
        if (this.questionsArray[idx]) {
          const question = this.questionsArray[idx];
          this.currentQuestion = question;
          console.log(
            `[QuizComponent] Synced currentQuestion to Q${idx + 1} from 
            URL/Index update`
          );

          // Update Display Source so the UI receives the new text
          this.questionToDisplaySource.next(question.questionText?.trim() ?? '');

          // Update Combined Data for the template (options, etc.)
          this.combinedQuestionDataSubject.next({
            question: question,
            options: question.options,
            explanation: question.explanation
          });

          // Ensure QuizStateService is also aligned
          this.quizStateService.updateCurrentQuestion(this.currentQuestion);
          // Ensure QuizService is also aligned
          this.quizService.updateCurrentQuestion(this.currentQuestion);  // sync Service too
        }
        this.cdRef.markForCheck();

        // Only reset display mode when navigating to a new question
        if (prevIdx !== null && prevIdx !== idx) {
          console.warn(
            '[NAVIGATION RESET] Moving from Q',
            prevIdx + 1,
            '→ Q',
            idx + 1
          );

          // Force question mode on navigation
          this.quizStateService.displayStateSubject.next({
            mode: 'question',
            answered: false
          });

          // Reset any local UI explanation flags
          this.showExplanation = false;
          this.explanationToDisplay = '';
          this.explanationVisibleLocal = false;

          // Ensure progress and dot colors are updated when arriving at new question
          this.updateProgressValue();
          this.updateDotStatus(idx);

          console.warn('[NAVIGATION COMPLETE]', idx + 1);
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
    this.questionsArray.forEach((qq: any, idx: number) => {
      // Prefer explicit expectedCorrect when valid (>0)
      const fromMeta =
        Number.isFinite(qq?.expectedCorrect) && qq.expectedCorrect > 0
          ? Math.floor(qq.expectedCorrect)
          : Array.isArray(qq?.answer)
            ? new Set(
              qq.answer.map((a: any) =>
                String(a ?? '')
                  .trim()
                  .toLowerCase()
              ),
            ).size
            : undefined;

      const fromFlags = Array.isArray(qq?.options)
        ? qq.options.reduce(
          (n: number, o: any) => n + (o?.correct ? 1 : 0),
          0
        )
        : 0;

      const totalCorrectFromOptions = Array.isArray(qq?.options)
        ? qq.options.filter((o: any) => o?.correct === true).length
        : 0;

      const expected = fromMeta ?? fromFlags ?? totalCorrectFromOptions;

      const qid =
        qq?.id ??
        qq?._id ??
        qq?.questionId ??
        qq?.uuid ??
        qq?.qid ??
        qq?.questionID ??
        null;

      if (Number.isFinite(expected) && (expected as number) > 1) {
        this.selectionMessageService.setExpectedCorrectCount(idx, expected as number);

        if (qid !== null && qid !== undefined) {
          this.selectionMessageService.setExpectedCorrectCountForId(
            qid,
            expected as number
          );
        }
      }
    });
  }

  private subscribeToNextButtonState(): void {
    this.nextButtonStateService.isButtonEnabled$
      .pipe(takeUntil(this.destroy$))
      .subscribe((enabled: boolean) => {
        this.isNextButtonEnabled = enabled;
        this.cdRef.markForCheck();  // force UI update when button state changes
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
    try {
      let selectedOptions =
        this.selectedOptionService.getSelectedOptionIndices(this.currentQuestionIndex);

      // If memory is empty (e.g. reload), check storage
      if (!selectedOptions || selectedOptions.length === 0) {
        const stored =
          sessionStorage.getItem(`quiz_selection_${this.currentQuestionIndex}`);
        if (stored) {
          try {
            const ids = JSON.parse(stored);
            if (Array.isArray(ids)) {
              selectedOptions = ids;
              console.log(`[restoreSelectionState] Restored selections from storage for Q${this.currentQuestionIndex}:`, ids);
            }
          } catch (error: any) {
            console.error(
              '[restoreSelectionState] Error parsing stored selections', error
            );
          }
        }
      }

      // Re-apply selected states to options
      for (const optionId of selectedOptions) {
        this.selectedOptionService.addSelectedOptionIndex(
          this.currentQuestionIndex, optionId
        );
      }

      // Get the question options to update the answered state
      const questionOptions =
        this.selectedOptionService.selectedOptionsMap.get(this.currentQuestionIndex) || [];

      // Update the answered state
      this.selectedOptionService.updateAnsweredState(
        questionOptions,
        this.currentQuestionIndex
      );
    } catch (error) {
      console.error('[restoreSelectionState] Unhandled error:', error);
    }
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

  private buildImmediateSelectionsForScoring(
    index: number,
    existingSelections: SelectedOption[],
    clickedOption: SelectedOption,
    isSingleAnswerQuestion: boolean,
  ): SelectedOption[] {
    const canonicalClicked: SelectedOption = {
      ...clickedOption,
      questionIndex: index,
      selected:
        clickedOption?.selected !== undefined
          ? clickedOption.selected
          : true,
    };

    if (isSingleAnswerQuestion) {
      if (canonicalClicked.selected === false) {
        return [];
      }
      return [canonicalClicked];
    }

    const merged = new Map<string, SelectedOption>();
    for (const selection of existingSelections) {
      const key = String(selection?.optionId ?? selection?.text ?? '').trim();
      if (!key) continue;
      merged.set(key, selection);
    }

    const clickedKey = String(
      canonicalClicked?.optionId ?? canonicalClicked?.text ?? '',
    ).trim();

    if (clickedKey) {
      if (canonicalClicked.selected === false) {
        merged.delete(clickedKey);
      } else {
        merged.set(clickedKey, canonicalClicked);
      }
    }

    return Array.from(merged.values());
  }

  public async onOptionSelected(
    option: SelectedOption,
    isUserAction: boolean = true
  ): Promise<void> {
    if (!isUserAction) return;

    // Use optionId or displayOrder for deduplication
    const id = option?.optionId ?? (option as any)?.id ?? (option as any)?.displayOrder ?? -1;
    const now = Date.now();
    const lastTime = (this as any)._lastClickTime ?? 0;
    const lastId = (this as any)._lastOptionId ?? -1;

    if (id !== -1 && id === lastId && (now - lastTime) < 200) {
      console.log('[onOptionSelected] Skipping duplicate.');
      return;
    }
    (this as any)._lastClickTime = now;
    (this as any)._lastOptionId = id;

    // Determine target question index
    const idx = this.normalizeQuestionIndex(option?.questionIndex);

    console.log(`[onOptionSelected] Processing Q${idx + 1}`, option);

    // 1. PROACTIVE UI UPDATE
    // Update dots and progress BEFORE any async work to ensure the app feels fast.
    console.log(`[onOptionSelected] Proactive update for Q${idx + 1}`);
    console.log(`[onOptionSelected] Service Map entry for Q${idx + 1}:`, this.selectedOptionService.selectedOptionsMap.get(idx));

    // 2. STATE PERSISTENCE & SERVICE SYNC
    this.showExplanationForQuestion(idx);

    // Sync Answered State
    const isAnswered = this.selectedOptionService.isQuestionAnswered(idx);
    this.nextButtonStateService.setNextButtonState(isAnswered);

    // CRITICAL: Mark interaction in QuizStateService (this is used by calculateAnsweredCount)
    if (this.quizStateService) {
      this.quizStateService.markUserInteracted(idx);
      if (isAnswered) this.quizStateService.markQuestionAnswered(idx);
    }

    // Persist immediate status from current in-memory selection so navigation to next
    // question keeps Q1 dot/progress even if async scoring internals lag.
    const liveSelections = this.getSelectionsForQuestion(idx);

    // Use the perfectly synced liveSelections from OIS rather than reconstructing stale object states
    const immediateSelections = liveSelections.length > 0 ? liveSelections : [option as SelectedOption];

    let liveCorrectness = this.evaluateSelectionCorrectness(
      idx,
      immediateSelections
    );
    let usedExplicitPayloadCorrectness = false;
    const hasExplicitCorrectFlag = option?.correct !== undefined && option?.correct !== null;

    const questionForSelection =
      this.questionsArray?.[idx] ||
      this.quizService.questions?.[idx] ||
      this.quizService.activeQuiz?.questions?.[idx] ||
      null;

    const optionsForImmediateScoring: Option[] =
      (questionForSelection?.options as Option[]) ||
      (this.currentQuestion?.options as Option[]) ||
      (this.optionsToDisplay as Option[]) ||
      [];

    const correctOptionsForQuestion = this.getResolvedCorrectOptions(
      questionForSelection as QuizQuestion | null | undefined,
      optionsForImmediateScoring
    );

    const correctCountForQuestion = correctOptionsForQuestion.length;

    const isSingleAnswerQuestion = correctCountForQuestion === 1;

    let immediateCorrectness = liveCorrectness;

    // For single-answer questions, a clicked option's explicit `correct` flag is the
    // most reliable immediate source for dot color state.
    /* if (isSingleAnswerQuestion && hasExplicitCorrectFlag) {
      liveCorrectness = option?.correct === true || String(option?.correct) === 'true';
      usedExplicitPayloadCorrectness = true;
    } else if (isSingleAnswerQuestion && liveCorrectness !== true && liveCorrectness !== false && hasExplicitCorrectFlag) { */
    // Only allow payload correctness override for single-answer questions.
    // For multi-answer questions, a single correct click does NOT mean the
    // question is fully correct — all correct answers must be selected.
    // Use the clicked option's explicit correctness flag for immediate visual
    // feedback when it is available. For multi-answer questions this is
    // intentionally visual-only: the score still waits until the full answer is
    // resolved, but the pagination dot should turn green on the first correct
    // click as requested.
    if (hasExplicitCorrectFlag) {
      const payloadCorrect = option?.correct === true || String(option?.correct) === 'true';
      //liveCorrectness = payloadCorrect;
      //usedExplicitPayloadCorrectness = true;
      if (isSingleAnswerQuestion) {
        liveCorrectness = payloadCorrect;
        usedExplicitPayloadCorrectness = true;
      } else if (payloadCorrect) {
        liveCorrectness = true;
        usedExplicitPayloadCorrectness = true;
      } else if (liveCorrectness !== true && liveCorrectness !== false) {
        liveCorrectness = false;
        usedExplicitPayloadCorrectness = true;
      }
    }

    /* const canPersistOptimisticStatus =
      liveCorrectness === true || (liveCorrectness === false && usedExplicitPayloadCorrectness); */
    const canPersistOptimisticStatus =
      isSingleAnswerQuestion && liveCorrectness === true;

    // const optimisticStatus = canPersistOptimisticStatus ? liveCorrectness === true : null;
    if (canPersistOptimisticStatus) {
      // Keep optimistic state visual-only for dots.
      // Single-answer questions can trust the clicked option immediately.
      // Multi-answer questions must wait until the merged selection set is
      // evaluated below so an immediately-following incorrect click can flip
      // the dot red without a stale optimistic green flash.
      // Do NOT write into questionCorrectness here, otherwise incrementScore()
      // may see `wasCorrect=true` and skip the first real +1 score update.
      // this.setPersistedDotStatus(idx, optimisticStatus ? 'correct' : 'wrong');
      this.setPersistedDotStatus(idx, 'correct');
    }

    // For single-answer questions, reflect a correct click in score immediately.
    // Do not rely only on optimistic dot persistence (selection sync can still be settling).
    if (isSingleAnswerQuestion) {
      const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
      const clickedOptionId = String(option?.optionId ?? '').trim();
      const clickedText = normalize(option?.text);
      const payloadSaysCorrect = option?.correct === true || String(option?.correct) === 'true';

      /* const sourceOptions: Option[] =
        (questionForSelection?.options as Option[]) ||
        (this.currentQuestion?.options as Option[]) ||
        (this.optionsToDisplay as Option[]) ||
        []; */
      const sourceOptions: Option[] = optionsForImmediateScoring;

      const matchedCorrectOption = sourceOptions.some((opt: Option) => {
        const optId = String(opt?.optionId ?? '').trim();
        const optText = normalize(opt?.text);
        const isCorrect = opt?.correct === true || String(opt?.correct) === 'true';

        const idMatch = clickedOptionId !== '' && optId !== '' && clickedOptionId === optId;
        const textMatch = clickedText !== '' && optText !== '' && clickedText === optText;
        return isCorrect && (idMatch || textMatch);
      });

      const payloadIndex = Number((option as any)?.index);
      const indexMatchedCorrect =
        Number.isInteger(payloadIndex) && payloadIndex >= 0 && payloadIndex < sourceOptions.length
          ? (sourceOptions[payloadIndex]?.correct === true || String(sourceOptions[payloadIndex]?.correct) === 'true')
          : false;

      const clickedIsCorrectForSingle = payloadSaysCorrect || matchedCorrectOption || indexMatchedCorrect || liveCorrectness === true;

      if (clickedIsCorrectForSingle) {
        // scoreDirectly handles deduplication internally via scoringKey
        this.quizService.scoreDirectly(idx, true, false);
      }
    }

    // For multi-answer questions, score when ALL correct answers are among the selections.
    // Uses a flipped approach: iterate through CORRECT OPTIONS and check if each one
    // has been selected, rather than iterating selections and checking correctness.
    // This correctly handles all scenarios including incorrect selections mixed with correct ones.
    let allCorrectSelectedForMulti = false;
    let hasAnyCorrectSelectionForMulti = false;
    let hasIncorrectSelectionForMulti = false;
    let immediateMultiDotStatus: 'correct' | 'wrong' | null = null;

    console.log(`[MULTI-DBG] Q${idx + 1} clicked option:`, {
      optionId: option?.optionId,
      text: option?.text,
      correct: option?.correct,
      isSingleAnswerQuestion,
      correctCountForQuestion,
      optionsForImmediateScoringLength: optionsForImmediateScoring?.length,
      optionsForImmediateScoring: optionsForImmediateScoring?.map((o: Option) => ({
        id: o.optionId, text: o.text, correct: o.correct
      }))
    });

    if (!isSingleAnswerQuestion) {
      const normalize = (v: unknown): string => String(v ?? '').trim().toLowerCase();
      const correctOpts = correctOptionsForQuestion;

      console.log(`[MULTI-DBG] Q${idx + 1} correctOpts (${correctOpts.length}):`,
        correctOpts.map((o: Option) => ({ id: o.optionId, text: o.text, correct: o.correct }))
      );

      if (correctOpts.length > 1) {
        // Gather all current selections, ensuring the just-clicked option is included
        const fromMap = this.selectedOptionService?.selectedOptionsMap?.get(idx);
        const fromMethod = this.selectedOptionService?.getSelectedOptionsForQuestion(idx);
        const currentSelections: SelectedOption[] = [
          ...(fromMap ?? fromMethod ?? [])
        ];

        console.log(`[MULTI-DBG] Q${idx + 1} selectionsFromMap (${fromMap?.length ?? 'null'}):`,
          fromMap?.map((s: any) => ({ id: s?.optionId, text: s?.text }))
        );
        console.log(`[MULTI-DBG] Q${idx + 1} selectionsFromMethod (${fromMethod?.length ?? 'null'}):`,
          fromMethod?.map((s: any) => ({ id: s?.optionId, text: s?.text }))
        );

        const clickedId = String(option?.optionId ?? '').trim();
        const clickedText = normalize(option?.text);
        const alreadyIncluded = currentSelections.some((s) => {
          const sId = String(s?.optionId ?? '').trim();
          const sText = normalize(s?.text);
          return (clickedId !== '' && sId !== '' && clickedId === sId) ||
            (clickedText !== '' && sText !== '' && clickedText === sText);
        });
        if (!alreadyIncluded && option) {
          currentSelections.push(option as SelectedOption);
        }

        console.log(`[MULTI-DBG] Q${idx + 1} currentSelections after merge (${currentSelections.length}):`,
          currentSelections.map((s: any) => ({ id: s?.optionId, text: s?.text }))
        );

        // Check: is every correct option represented in the current selections?
        const everyCorrectSelected = correctOpts.every((correctOpt) => {
          const cOptId = String(correctOpt.optionId ?? '').trim();
          const cOptText = normalize(correctOpt.text);
          const found = currentSelections.some((sel) => {
            const selId = String(sel?.optionId ?? '').trim();
            const selText = normalize(sel?.text);
            return (cOptId !== '' && selId !== '' && cOptId === selId) ||
              (cOptText !== '' && selText !== '' && cOptText === selText);
          });
          console.log(`[MULTI-DBG] Q${idx + 1} correctOpt id=${cOptId} text="${cOptText}" found=${found}`);
          return found;
        });

        allCorrectSelectedForMulti = everyCorrectSelected;
        //console.log(`[MULTI-DBG] Q${idx + 1} everyCorrectSelected=${everyCorrectSelected} -> allCorrectSelectedForMulti=${allCorrectSelectedForMulti}`);

        hasIncorrectSelectionForMulti = currentSelections.some((sel) => {
          const selId = String(sel?.optionId ?? '').trim();
          const selText = normalize(sel?.text);
          return !correctOpts.some((correctOpt) => {
            const cOptId = String(correctOpt.optionId ?? '').trim();
            const cOptText = normalize(correctOpt.text);
            return (cOptId !== '' && selId !== '' && cOptId === selId) ||
              (cOptText !== '' && selText !== '' && cOptText === selText);
          });
        });

        hasAnyCorrectSelectionForMulti =
          currentSelections.some((sel) => {
            const selId = String(sel?.optionId ?? '').trim();
            const selText = normalize(sel?.text);
            return correctOpts.some((correctOpt) => {
              const cOptId = String(correctOpt.optionId ?? '').trim();
              const cOptText = normalize(correctOpt.text);
              return (cOptId !== '' && selId !== '' && cOptId === selId) ||
                (cOptText !== '' && selText !== '' && cOptText === selText);
            });
          }) && !hasIncorrectSelectionForMulti;

        console.log(`[MULTI-DBG] Q${idx + 1} everyCorrectSelected=${everyCorrectSelected} hasIncorrectSelection=${hasIncorrectSelectionForMulti} hasAnyCorrectSelectionForMulti=${hasAnyCorrectSelectionForMulti} -> allCorrectSelectedForMulti=${allCorrectSelectedForMulti}`);

        // Sync userAnswers so checkIfAnsweredCorrectly has current data
        const syncIds = currentSelections
          .map((s: any) => s?.optionId)
          .filter((id: any) => id !== undefined && id !== null);
        if (syncIds.length > 0) {
          this.quizService.userAnswers[idx] = syncIds;
        }
      } else {
        console.log(`[MULTI-DBG] Q${idx + 1} SKIPPED: correctOpts.length=${correctOpts.length} (not > 1)`);
      }
    } else {
      console.log(`[MULTI-DBG] Q${idx + 1} SKIPPED: isSingleAnswerQuestion=true (correctCountForQuestion=${correctCountForQuestion})`);
    }

    if (allCorrectSelectedForMulti) {
      this.quizService.scoreDirectly(idx, true, true);
    }

    // UNIVERSAL DOT UPDATE — works for all question types.
    // Resolve the clicked option's correctness from the authoritative source
    // options array, NOT from the event payload's `correct` field (which may
    // be undefined depending on the emit path).
    {
      const normalize = (v: unknown): string => String(v ?? '').trim().toLowerCase();
      const clickedId = String(option?.optionId ?? '').trim();
      const clickedText = normalize(option?.text);

      const clickedOptionIsCorrectFromSource = optionsForImmediateScoring.some((srcOpt: Option) => {
        const sId = String(srcOpt.optionId ?? '').trim();
        const sText = normalize(srcOpt.text);
        const sCorrect = srcOpt.correct === true || String(srcOpt.correct) === 'true';
        const idMatch = clickedId !== '' && sId !== '' && clickedId === sId;
        const textMatch = clickedText !== '' && sText !== '' && clickedText === sText;
        return sCorrect && (idMatch || textMatch);
      });

      console.log(`[DOT-UPDATE] Q${idx + 1} clicked id=${clickedId} text="${clickedText}" correctFromSource=${clickedOptionIsCorrectFromSource} payload.correct=${option?.correct} isSingleAnswer=${isSingleAnswerQuestion} correctCount=${correctCountForQuestion}`);

      const clickDotStatus: 'correct' | 'wrong' = clickedOptionIsCorrectFromSource ? 'correct' : 'wrong';
      this.setPersistedDotStatus(idx, clickDotStatus);
      this.dotStatusCache.set(idx, clickDotStatus);
      immediateMultiDotStatus = clickDotStatus;
    }

    // Ensure scoring state is updated before evaluating dot color/progress.
    // Use updateScore=false: scoreDirectly() above already handled the score mutation.
    // Allowing score mutation here risks decrementing when async answer-ID evaluation
    // disagrees with the deterministic scoreDirectly result.
    const authoritativeCorrectness = await this.quizService.checkIfAnsweredCorrectly(idx, false);

    // Only persist authoritative TRUE immediately from this click path.
    // Authoritative FALSE can be transient right after navigation/click due async
    // answer-sync timing, which was flipping Q1 dot red before moving to Q2.
    if (authoritativeCorrectness === true) {
      // scoreDirectly handles deduplication internally via scoringKey
      this.quizService.scoreDirectly(idx, true, !isSingleAnswerQuestion);
      this.setPersistedDotStatus(idx, 'correct');
    } else if (!isSingleAnswerQuestion && immediateMultiDotStatus) {
      // Keep the pagination dot synced with the current multi-answer selection
      // set even when the authoritative correctness check has not resolved to
      // true yet.
      this.setPersistedDotStatus(idx, immediateMultiDotStatus);
    }

    // Now update progress AFTER state has been marked and scored
    this.updateProgressValue();
    this.updateDotStatus(idx);
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();

    // Update QuizStateService QuestionState
    const prev = this.quizStateService.getQuestionState(this.quizId, idx);
    if (prev) {
      this.quizStateService.setQuestionState(this.quizId, idx, {
        ...prev,
        isAnswered: true,
        explanationText: this.explanationToDisplay || prev.explanationText || ''
      });
    }

    // Persist to session
    try {
      sessionStorage.setItem('isAnswered', 'true');
      const currentIndices = this.selectedOptionService.getSelectedOptionIndices(idx);
      sessionStorage.setItem(`quiz_selection_${idx}`, JSON.stringify(currentIndices));
      sessionStorage.setItem(`displayMode_${idx}`, 'explanation');
    } catch (e) {
      console.warn('[onOptionSelected] Storage failed', e);
    }

    // 3. FINAL EVALUATION (Deferred to ensure service state has settled)
    setTimeout(() => {
      console.log(`[onOptionSelected] 🕒 DEFERRED UPDATE for Q${idx + 1}`);
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
    // Remove stale question so template can’t render old text
    this.currentQuestion = null;
    this.question = null;  // also clear this for consistency
    this.optionsToDisplay = [];

    // Clear local UI state
    this.questionInitialized = false;  // block during reset
    this.isAnswered = false;
    this.selectedOptions = [];
    this.currentQuestionAnswered = false;
    this.isNextButtonEnabled = false;
    this.isButtonEnabled = false;
    this.nextButtonStateService.reset();

    // Reset visual selection state
    this.showFeedbackForOption = {};

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
        '[resetQuestionState] ⚠️ quizQuestionComponent not initialized or dynamically loaded.'
      );
    }

    // Trigger global reset events and background reset
    this.resetBackgroundService.setShouldResetBackground(true);
    this.resetStateService.triggerResetFeedback();
    this.resetStateService.triggerResetState();

    // Clear selected options tracking
    this.selectedOptionService.clearOptions();

    // Reset explanation state if not locked
    if (!this.explanationTextService.isExplanationLocked()) {
      this.explanationTextService.resetExplanationState();
    } else {
      console.log(
        '[resetQuestionState] Skipping explanation reset — lock is active.'
      );
    }

    // Reset internal selected options tracking
    this.selectedOptionService.stopTimerEmitted = false;

    this.cdRef.detectChanges();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
    this.destroy$.next();
    this.destroy$.complete();
    this.subscriptions.unsubscribe();
    this.dotStatusCache.clear();
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
          this.dotStatusCache.clear();
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
            this.timerService.stopTimer?.(undefined, { force: true });
            this.timerService.resetTimer();
            this.timerService.resetTimerFlagsFor(index);
            this.timerService.startTimer(
              this.timerService.timePerQuestion,
              this.timerService.isCountdown,
              true
            );
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
      this.forceRegenerateExplanation(firstQuestion, initialIndex);
    } else {
      console.warn(`[No question found at index ${initialIndex}]`);
    }
  }

  private hydrateQuestionSet(questions: QuizQuestion[] | null | undefined):
    QuizQuestion[] {
    if (!Array.isArray(questions) || questions.length === 0) return [];

    return questions.map((question) => ({
      ...question,
      options: Array.isArray(question.options)
        ? question.options.map((option) => ({
          ...option,
          correct: (option.correct as any) === true || (option.correct as any) === 'true',
        }))
        : []
    }));
  }

  private applyQuestionsFromSession(questions: QuizQuestion[]): void {
    const hydratedQuestions = this.hydrateQuestionSet(questions);
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

    // Format each explanation with "Option X is correct" based on the SHUFFLED array index,
    // matching the UI.
    const formattedExplanations =
      hydratedQuestions.map((question, index) => {
        const rawExplanation = (question.explanation ?? '').trim();

        // Get correct option indices for this question
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(question, question.options, index);

        // Format the explanation with the prefix
        const formattedText = this.explanationTextService.formatExplanation(
          question,
          correctIndices,
          rawExplanation
        );

        return { questionIndex: index, explanation: formattedText };
      });

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

  private syncQuestionSnapshotFromSession(
    hydratedQuestions: QuizQuestion[]
  ): void {
    if (!Array.isArray(hydratedQuestions) || hydratedQuestions.length === 0) {
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

    const candidateIndices: Array<number | null> = [
      Number.isInteger(this.quizService?.currentQuestionIndex)
        ? this.quizService.currentQuestionIndex
        : null,
      Number.isInteger(this.currentQuestionIndex)
        ? this.currentQuestionIndex
        : null,
      Number.isInteger(this.previousIndex) ? this.previousIndex : null
    ];

    const resolvedIndex = candidateIndices.find(
      (value): value is number => typeof value === 'number'
    );

    const normalizedIndex = Math.min(
      Math.max(resolvedIndex ?? 0, 0),
      hydratedQuestions.length - 1
    );

    this.currentQuestionIndex = normalizedIndex;
    this.quizService.setCurrentQuestionIndex(normalizedIndex);

    const selectedQuestion = hydratedQuestions[normalizedIndex];
    if (!selectedQuestion) return;

    const normalizedOptions = this.quizService
      .assignOptionIds(
        selectedQuestion.options ?? [],
        this.currentQuestionIndex
      )
      .map((option) => ({
        ...option,
        correct: (option.correct as any) === true || (option.correct as any) === 'true',
        selected: option.selected ?? false,
        active: option.active ?? true,
        showIcon: option.showIcon ?? false
      }));

    const trimmedQuestionText = selectedQuestion.questionText?.trim()
      ?? 'No question available';

    this.question = selectedQuestion;
    this.currentQuestion = selectedQuestion;
    this.questionData = selectedQuestion;
    this.qaToDisplay = {
      question: selectedQuestion,
      options: normalizedOptions
    };

    this.questionToDisplay = trimmedQuestionText;
    this.questionToDisplaySource.next(trimmedQuestionText);

    this.optionsToDisplay = [...normalizedOptions];
    this.optionsToDisplay$.next([...normalizedOptions]);
    this.currentOptions = [...normalizedOptions];
    this.pendingOptions = null;
    this.hasOptionsLoaded = normalizedOptions.length > 0;
    this.shouldRenderOptions = this.hasOptionsLoaded;

    if (this.quizQuestionComponent) {
      this.quizQuestionComponent.optionsToDisplay = [...normalizedOptions];
    }

    const trimmedExplanation = (selectedQuestion.explanation ?? '').trim();
    this.explanationToDisplay = trimmedExplanation;

    this.explanationTextService.setExplanationTextForQuestionIndex(
      normalizedIndex,
      trimmedExplanation
    );

    if (normalizedOptions.length > 0) {
      const clonedOptions =
        normalizedOptions.map((option) => ({ ...option }));
      this.quizService.setOptions(clonedOptions);
      this.quizService.emitQuestionAndOptions(
        selectedQuestion,
        clonedOptions,
        normalizedIndex
      );
    }
  }

  private async prepareQuizSession(): Promise<void> {
    try {
      this.currentQuestionIndex = 0;
      this.quizId = this.activatedRoute.snapshot.paramMap.get('quizId') ?? '';

      // Fetch questions for the quiz and await the result.
      // Use QuizService.fetchQuizQuestions to ensure we get SHUFFLED questions if
      // shuffle is enabled. QuizDataService.getQuestionsForQuiz returns raw data,
      // bypassing shuffling.
      const questions: QuizQuestion[] =
        await this.quizService.fetchQuizQuestions(this.quizId);

      this.applyQuestionsFromSession(questions);

      // const question = this.questions[this.currentQuestionIndex];

      // Check for stored states after ensuring we have the questions
      const storedStates =
        this.quizStateService.getStoredState(this.quizId);

      if (storedStates) {
        // Logic to restore stored states to each question
        for (const [questionId, state] of storedStates.entries()) {
          this.quizStateService.setQuestionState(this.quizId, questionId, state);

          if (state.isAnswered && state.explanationDisplayed) {
            const restoredIndex = Number(questionId);
            const restoredQuestion = this.questions[restoredIndex];

            if (!restoredQuestion) {
              continue;
            }

            const rawExplanation = (restoredQuestion.explanation ?? '').trim();

            this.explanationTextService.storeFormattedExplanation(
              restoredIndex,
              rawExplanation,
              restoredQuestion,
              restoredQuestion.options,
              true
            );
          }
        }

        // Check and set explanation display for the first question if needed
        const firstQuestionState = storedStates.get(0);
        if (firstQuestionState && firstQuestionState.isAnswered) {
          this.explanationTextService.setResetComplete(true);
          this.explanationTextService.setShouldDisplayExplanation(true);
        }
      } else {
        // Apply default states to all questions as no stored state is found
        this.quizStateService.applyDefaultStates(this.quizId, questions);
      }
    } catch (error: any) {
      console.error('Error in prepareQuizSession:', error);
    }
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

      // Wait for feedback and Angular’s stabilization before unlocking
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
      if (!this.quiz) {
        console.error('[loadQuestionByRouteIndex] Quiz data is missing.');
        return;
      }

      if (!this.quiz?.questions) return;

      if (
        isNaN(routeIndex) ||
        routeIndex < 1 ||
        routeIndex > this.quiz.questions.length
      ) {
        console.warn('[loadQuestionByRouteIndex] Invalid route index:', routeIndex);
        void this.router.navigate(['/question/', this.quizId, 1]);
        return;
      }

      const questionIndex = routeIndex - 1;  // convert 1-based URL index to 0-based

      if (questionIndex < 0 || questionIndex >= this.quiz.questions.length) {
        console.error(
          '[loadQuestionByRouteIndex] Question index out of bounds:',
          questionIndex
        );
        return;
      }

      // Set the current index and badge (only now that it's confirmed valid)
      this.currentQuestionIndex = questionIndex;
      this.quizService.setCurrentQuestionIndex(questionIndex);

      this.timerService.resetTimer();
      this.timerService.startTimer(
        this.timerService.timePerQuestion,
        this.timerService.isCountdown,
        true
      );

      const totalCount = this.totalQuestions > 0 ?
        this.totalQuestions : (this.quiz?.questions?.length || 0);

      // Safety guard: Prevent "0 of 6" or "1 of 0" display glitches
      if (totalCount > 0 && questionIndex >= 0) {
        this.quizService.updateBadgeText(questionIndex + 1, totalCount);
        this.updateProgressValue();
      }

      this.resetFeedbackState();

      // Use quizService.getQuestionByIndex to respect shuffle
      // Direct access (this.quiz.questions[questionIndex]) uses the ORIGINAL order,
      // causing mismatches.
      const question =
        await firstValueFrom(this.quizService.getQuestionByIndex(questionIndex));

      if (!question) {
        console.error(`[loadQuestionByRouteIndex] Failed to load 
          Q${questionIndex}`);
        return;
      }

      this.currentQuestion = question;

      // Force-update the explanation text using the helper method
      this.forceRegenerateExplanation(question, questionIndex);

      // Update combined data immediately so children get the correct object
      this.combinedQuestionDataSubject.next({
        question: question,
        options: question.options ?? [],
        explanation: question.explanation ?? ''
      });

      this.questionToDisplay =
        question.questionText?.trim() ?? 'No question available';
      this.questionToDisplaySource.next(this.questionToDisplay);  // sync observable

      const optionsWithIds = this.quizService.assignOptionIds(
        question.options || [],
        this.currentQuestionIndex
      );

      this.optionsToDisplay = optionsWithIds.map((option, index) => ({
        ...option,
        feedback: 'Loading feedback...',
        showIcon: option.showIcon ?? false,
        active: option.active ?? true,
        selected: option.selected ?? false,
        correct: !!option.correct,
        optionId:
          typeof option.optionId === 'number' && !isNaN(option.optionId)
            ? option.optionId
            : index + 1
      }));

      const correctOptions = this.optionsToDisplay.filter((opt) => opt.correct);
      if (!correctOptions.length) {
        console.warn(
          '[loadQuestionByRouteIndex] No correct answers found for this question.'
        );
      }

      // Restore and apply feedback
      setTimeout(() => {
        this.restoreSelectedOptions();

        setTimeout(() => {
          if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
            console.warn(
              '[loadQuestionByRouteIndex] optionsToDisplay empty, relying on loader pipeline.'
            );
          }

          const previouslySelectedOption = this.optionsToDisplay.find(
            (opt) => opt.selected
          );

          if (previouslySelectedOption) {
            // Route feedback through the service instead
            this.selectedOptionService.reapplySelectionForQuestion(
              previouslySelectedOption,
              this.currentQuestionIndex
            );
          } else {
            console.log(
              '[loadQuestionByRouteIndex] No previously selected option. ' +
              'Skipping feedback replay.'
            );
          }
        }, 50);
      }, 50);

      try {
        const feedback =
          await (this.quizQuestionComponent?.generateFeedbackText(question) ?? '');

        this.feedbackText = feedback;

        console.log('[loadQuestionByRouteIndex] Feedback Text:', feedback);
      } catch (error: any) {
        console.error('[loadQuestionByRouteIndex] Feedback generation ' +
          'failed:', error);

        this.feedbackText = 'Could not generate feedback. Please try again.';
      }
    } catch (error: any) {
      console.error('[loadQuestionByRouteIndex] Unexpected error:', error);

      this.feedbackText = 'Error loading question details.';
      this.cdRef.markForCheck();
    }

    // Check if new question content requires scroll indicator
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

  /**
   * Helper to force-regenerate the FET for a specific question.
   * Ensures the explanation text matches the currently shuffled option order.
   */
  private forceRegenerateExplanation(question: QuizQuestion, index: number): void {
    if (question && question.options) {
      // DEBUG: Log the options to see their correct flags
      console.log(`[forceRegenerateExplanation] Q${index + 1} options:`,
        question.options.map((o, i) => ({
          idx: i + 1,
          text: o.text?.substring(0, 20),
          correct: o.correct,
          optionId: o.optionId
        }))
      );

      const correctIndices = this.explanationTextService.getCorrectOptionIndices(
        question,
        question.options,
        index
      );
      console.log(`[forceRegenerateExplanation] Q${index + 1} correctIndices:`, correctIndices);

      const formattedExplanation = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        question.explanation
      );
      console.log(`[forceRegenerateExplanation] Q${index + 1} formattedExplanation:`, formattedExplanation?.substring(0, 80));

      this.explanationTextService.storeFormattedExplanation(
        index,
        formattedExplanation,
        question,
        question.options,
        true // FORCE update to override any locked FET
      );
      console.log(`[forceRegenerateExplanation] Updated FET for Q${index + 1}`);
    } else {
      console.warn(`[forceRegenerateExplanation] Q${index + 1} has no options!`);
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

  // REMOVE!!
  private async fetchQuestionData(quizId: string, questionIndex: number): Promise<any> {
    try {
      const rawData: QuestionData | null = await firstValueFrom(
        of(this.quizService.getQuestionData(quizId, questionIndex)),
      );
      if (!rawData) return;

      // Get the explanation as an Observable
      const explanationObservable = this.explanationTextService
        .explanationsInitialized
        ? this.explanationTextService.getFormattedExplanationTextForQuestion(
          questionIndex,
        )
        : of('');

      // Convert the Observable to a Promise and await its value
      const explanation: string =
        (await firstValueFrom(explanationObservable)) ?? '';

      return {
        questionText: rawData.questionText ?? '',
        options: rawData.currentOptions ?? [],
        explanation: explanation ?? '',
        type: this.quizDataService.questionType as QuestionType,
      } as QuizQuestion;
    } catch (error) {
      console.error('Error fetching question data:', error);
      throw error;
    }
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
    const questionState = this.quizStateService.getQuestionState(this.quizId, questionIndex);

    if (!questionState) {
      console.warn('[Quiz] No question state found for index', questionIndex);
      return;
    }

    if (!questionState.selectedOptions) questionState.selectedOptions = [];

    const isAnswered = questionState.isAnswered;
    const explanationAlreadyDisplayed = questionState.explanationDisplayed;

    // Detect actual user interaction
    const hasUserSelected = (questionState.selectedOptions?.length ?? 0) > 0;

    // Critical Guard:
    // If the user has NOT interacted with this question, DO NOT touch the 
    // explanation streams at all. This prevents Q1 from inheriting stale text from QN.
    if (!hasUserSelected) {
      console.log('[NO USER SELECTION] Skipping explanation processing for Q', questionIndex);
      return;
    }

    // Only disable if it's a fresh unanswered question and explanation not yet shown
    const shouldDisableExplanation = !isAnswered && !explanationAlreadyDisplayed;

    if (isAnswered || explanationAlreadyDisplayed) {
      // Validate inputs and ensure explanation system is initialized
      if (
        Number.isFinite(questionIndex) &&
        this.explanationTextService.explanationsInitialized
      ) {
        const explanation$ =
          this.explanationTextService.getFormattedExplanationTextForQuestion(
            questionIndex
          );

        this.explanationToDisplay = (await firstValueFrom(explanation$)) ?? '';

        // Defensive fallback for empty explanation
        if (this.explanationToDisplay?.trim()) {
          this.explanationTextService.setExplanationText(this.explanationToDisplay, { index: this.currentQuestionIndex });
        } else {
          console.warn(`[Explanation is empty for Q${questionIndex}]`);
          this.explanationToDisplay = 'No explanation available';
          this.explanationTextService.setExplanationText(this.explanationToDisplay, { index: this.currentQuestionIndex });
        }
      } else {
        console.warn(
          `[Skipping explanation fetch — invalid index or explanations not ready] index: ${questionIndex}`
        );
        this.explanationToDisplay = 'No explanation available';
        this.explanationTextService.setExplanationText(
          this.explanationToDisplay,
          { index: this.currentQuestionIndex }
        );
      }

      // Always lock and enable explanation after setting the text
      this.explanationTextService.setResetComplete(true);
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.explanationTextService.lockExplanation();
      this.showExplanation = true;

      this.cdRef.detectChanges();
    } else if (shouldDisableExplanation) {
      this.explanationToDisplay = '';

      // Only allow disabling if explanation is not locked
      if (!this.explanationTextService.isExplanationLocked()) {
        this.explanationTextService.setResetComplete(false);
        this.explanationTextService.setExplanationText('', { index: this.currentQuestionIndex });
        this.explanationTextService.setShouldDisplayExplanation(false);
      } else {
        console.warn('[Explanation reset blocked due to active lock]');
      }

      this.showExplanation = false;
    }
  }

  // REMOVE!!
  handleRouteParams(
    params: ParamMap
  ): Observable<{ quizId: string; questionIndex: number; quizData: Quiz }> {
    const quizId = params.get('quizId');
    const questionIndex = Number(params.get('questionIndex'));

    // Validate parameters
    if (!quizId) {
      console.error('Quiz ID is missing.');
      return throwError(() => new Error('Quiz ID is required'));
    }

    if (isNaN(questionIndex)) {
      console.error('Invalid question index:',
        params.get('questionIndex'));
      return throwError(() => new Error('Invalid question index'));
    }

    // Fetch quiz data and validate
    return this.quizDataService.getQuizzes().pipe(
      map((quizzes: Quiz[]) => {
        const quizData =
          quizzes.find((quiz) => quiz.quizId === quizId);
        if (!quizData) {
          throw new Error(`Quiz with ID "${quizId}" not found.`);
        }
        return { quizId, questionIndex, quizData };
      }),
      catchError((error: Error) => {
        console.error('Error processing quiz data:', error);
        return throwError(() => new Error('Failed to process quiz data'));
      })
    );
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
                  this.timerService.stopTimer?.(undefined, { force: true });
                  this.timerService.resetTimer();
                  this.timerService.resetTimerFlagsFor(this.currentQuestionIndex);
                  this.timerService.startTimer(
                    this.timerService.timePerQuestion,
                    this.timerService.isCountdown,
                    true
                  );
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
    this.triggerAnimation();
    this.selectedOptionService.setAnswered(false);
    this.quizStateService.resetInteraction();  // clear interaction on nav


    // Wrap in NgZone.run to ensure Angular detects navigation changes
    // This fixes the bug where navigation only works when DevTools console is open
    await this.ngZone.run(async () => {
      let result = false;
      if (direction === 'next') {
        result = await this.quizNavigationService.advanceToNextQuestion();
      } else {
        // prev doesn't return boolean yet or not needed
        await this.quizNavigationService.advanceToPreviousQuestion();
        result = true;
      }

      // Force change detection after navigation completes
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

  // REMOVE!!
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

    // Navigate DIRECTLY to results - bypass navigation service
    const targetQuizId = this.quizId || this.quizService.quizId || this.quizService.getCurrentQuizId();
    console.log('[advanceToResults] Navigating to /quiz/results/' + targetQuizId);

    this.router.navigate(['/quiz', 'results', targetQuizId]).then((success: boolean) => {
      console.log('[advanceToResults] Navigation result:', success);
      this.navigatingToResults = false;
    }).catch((err: Error) => {
      console.error('[advanceToResults] Navigation error:', err);
      this.navigatingToResults = false;
    });
  }

  // REMOVE??
  private handleQuizCompletion(): void {
    this.quizService
      .submitQuizScore(this.answers.map((opt: Option) => opt.optionId ?? 0))
      .subscribe(() => {
        void this.router.navigate(['quiz', 'result']);
      });
  }

  private async fetchAndSetQuestionData(questionIndex: number): Promise<boolean> {
    // Reset loading state for options
    this.questionTextLoaded = false;
    this.hasOptionsLoaded = false;
    this.shouldRenderOptions = false;
    this.isLoading = true;
    if (this.quizQuestionComponent) {
      this.quizQuestionComponent.renderReady = true;
    }

    try {
      // Safety Checks
      if (
        isNaN(questionIndex) ||
        questionIndex < 0 ||
        questionIndex >= this.totalQuestions
      ) {
        console.warn(`[Invalid index: Q${questionIndex}]`);
        return false;
      }
      if (questionIndex === this.totalQuestions - 1) {
        console.log(`[Last Question] Q${questionIndex}`);
      }

      // Reset Local State
      this.currentQuestion = null;
      this.resetQuestionState();
      this.resetQuestionDisplayState();
      this.explanationTextService.resetExplanationState();
      this.resetComplete = false;

      // Restore persistency from storage if service is empty (e.g. reload)
      if (!this.selectedOptionService.isQuestionAnswered(questionIndex)) {
        const storedSel =
          sessionStorage.getItem(`quiz_selection_${questionIndex}`);
        if (storedSel) {
          try {
            const ids = JSON.parse(storedSel);
            if (Array.isArray(ids) && ids.length > 0) {
              console.log(`[fetchAndSetQuestionData] Restoring stored 
                selections for Q${questionIndex}`);
              ids.forEach(id =>
                this.selectedOptionService.addSelectedOptionIndex(questionIndex, id));
              // Force update the answered state in service
              this.selectedOptionService.updateAnsweredState(
                this.selectedOptionService.getSelectedOptionsForQuestion(
                  questionIndex
                ),
                questionIndex
              );
            }
          } catch (error: any) {
            console.error('Error restoring selections:', error);
          }
        }
      }

      // Parallel fetch for question and options
      const [fetchedQuestion, fetchedOptions] = await Promise.all([
        this.fetchQuestionDetails(questionIndex),
        firstValueFrom(
          this.quizService.getCurrentOptions(questionIndex).pipe(take(1))
        )
      ]);

      // Validate arrival of both question and options
      if (
        !fetchedQuestion ||
        !fetchedQuestion.questionText?.trim() ||
        !Array.isArray(fetchedOptions) ||
        fetchedOptions.length === 0
      ) {
        console.error(`[Q${questionIndex}] Missing question or options`);
        return false;
      }

      // Process question text
      this.explanationTextService.setResetComplete(false);
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.explanationTextService.explanationText$.next('');

      const trimmedText =
        (fetchedQuestion?.questionText ?? '').trim() || 'No question available';
      this.questionToDisplay = trimmedText;

      this.questionTextLoaded = true;

      // Hydrate and clone options
      const hydratedOptions =
        fetchedOptions.map((opt, idx) => ({
          ...opt,
          optionId: opt.optionId ?? idx,
          correct: opt.correct ?? false,
          feedback: opt.feedback ?? `The correct options are: ${opt.text}`
        }));

      const finalOptions = this.quizService.assignOptionActiveStates(
        hydratedOptions,
        false
      );

      const clonedOptions =
        structuredClone?.(finalOptions) ??
        JSON.parse(JSON.stringify(finalOptions));

      const quizIdForState = this.quizId ?? this.quizService.quizId ?? 'default-quiz';
      const questionState =
        this.quizStateService.getQuestionState(quizIdForState, questionIndex);
      const optionIdSet = new Set(
        clonedOptions
          .map((opt) => opt.optionId)
          .filter((id): id is number => typeof id === 'number')
      );
      const selectedOptions =
        this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex);
      const validSelections = (selectedOptions ?? []).filter((opt) =>
        optionIdSet.has(opt.optionId ?? -1)
      );

      let isAnswered = validSelections.length > 0;
      if (!isAnswered && questionState?.isAnswered) {
        this.quizStateService.setQuestionState(quizIdForState, questionIndex, {
          ...questionState,
          isAnswered: false,
          explanationDisplayed: false
        });
        this.selectedOptionService.clearSelectionsForQuestion(questionIndex);
        this.selectedOptionService.setAnswered(false, true);
      }

      if (isAnswered) {
        this.quizStateService.setAnswered(true);
        this.selectedOptionService.setAnswered(true, true);
      } else {
        this.quizStateService.setAnswered(false);
        this.selectedOptionService.setAnswered(false, true);
      }

      this.isAnswered = isAnswered;

      this.quizStateService.setDisplayState({
        mode: this.isAnswered ? 'explanation' : 'question',
        answered: this.isAnswered
      });

      // Defer header and options assignment so Angular renders them together
      Promise.resolve().then(() => {
        this.questionToDisplaySource.next(trimmedText);

        // Force fresh array reference to trigger ngOnChanges
        this.optionsToDisplay = clonedOptions;

        this.shouldRenderOptions = true;
        this.cdRef.markForCheck();
      });

      // Assign into Component State
      this.question = {
        questionText: fetchedQuestion.questionText,
        explanation: fetchedQuestion.explanation ?? '',
        options: clonedOptions,
        type: fetchedQuestion.type ?? QuestionType.SingleAnswer
      };
      this.currentQuestion = { ...this.question };
      this.optionsToDisplay = structuredClone(clonedOptions);

      // Emit Q+A before any rendering logic kicks in
      this.quizService.emitQuestionAndOptions(
        this.currentQuestion,
        clonedOptions,
        questionIndex
      );

      // Emit QA data with benchmark
      this.quizService.questionPayloadSubject.next({
        question: this.currentQuestion!,
        options: clonedOptions,
        explanation: this.currentQuestion?.explanation ?? ''
      });

      // Then set QA observable or render flags AFTER
      this.quizStateService.qaSubject.next({
        question: this.currentQuestion!,
        options: this.optionsToDisplay,
        explanation: this.currentQuestion?.explanation ?? '',
        quizId: this.quizService.quizId ?? 'default-id',
        index: this.currentQuestionIndex,
        heading: this.currentQuestion?.questionText ?? 'Untitled Question',
        selectionMessage: this.selectionMessageService.getCurrentMessage()
      });

      if (this.quizQuestionComponent) {
        this.quizQuestionComponent.updateOptionsSafely(clonedOptions);
      } else {
        requestAnimationFrame(() => {
          this.pendingOptions = clonedOptions;
          console.log('[Pending options queued until component ready]');
        });
      }

      // Flip “options loaded” flags together
      this.hasOptionsLoaded = true;
      this.shouldRenderOptions = true;

      // Explanation/Timer/Badge Logic
      let explanationText = '';
      this.timerService.stopTimer?.(undefined, { force: true });
      this.timerService.resetTimer();
      this.timerService.resetTimerFlagsFor(questionIndex);

      if (this.isAnswered) {
        // Already answered: restore explanation state and stop timer
        // CRITICAL FIX: Use properly formatted explanation with correct option indices
        // instead of raw explanation. This ensures FET option numbers match visual positions.
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(
          fetchedQuestion,
          finalOptions,  // Use the hydrated options which have correct flags
          questionIndex
        );
        const rawExplanation = fetchedQuestion.explanation?.trim() || 'No explanation available';
        explanationText = this.explanationTextService.formatExplanation(
          fetchedQuestion,
          correctIndices,
          rawExplanation
        );

        this.explanationTextService.storeFormattedExplanation(
          questionIndex,
          explanationText,
          fetchedQuestion,
          finalOptions,
          true  // Force update
        );
        this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
        this.timerService.isTimerRunning = false;
      } else {
        // Not answered yet: force baseline selection message exactly once
        this.selectionMessageService.forceBaseline(questionIndex);
        await this.selectionMessageService.setSelectionMessage(false);
        this.timerService.startTimer(
          this.timerService.timePerQuestion,
          this.timerService.isCountdown,
          true
        );
      }

      this.setQuestionDetails(trimmedText, finalOptions, explanationText);
      this.currentQuestionIndex = questionIndex;
      this.explanationToDisplay = explanationText;

      this.questionPayload = {
        question: this.currentQuestion!,
        options: clonedOptions,
        explanation: explanationText
      };
      this.shouldRenderQuestionComponent = true;

      this.quizService.setCurrentQuestion(this.currentQuestion);
      this.quizService.setCurrentQuestionIndex(questionIndex);
      this.quizStateService.updateCurrentQuestion(this.currentQuestion);

      //await this.quizService.checkIfAnsweredCorrectly(questionIndex);
      const liveSelections = this.getSelectionsForQuestion(questionIndex);
      const hasUserAnswersForQuestion =
        Array.isArray(this.quizService.userAnswers?.[questionIndex]) &&
        this.quizService.userAnswers[questionIndex].length > 0;
      const savedIndexRaw = localStorage.getItem('savedQuestionIndex');
      const isFreshStartAtQ1 =
        questionIndex === 0 &&
        this.quizService.questionCorrectness.size === 0 &&
        (savedIndexRaw == null || String(savedIndexRaw).trim() === '0');

      // Do not auto-score Q1 during a fresh start when no real selection exists.
      // This prevents stale same-tab state from rehydrating score as 1/6 on load.
      if (isFreshStartAtQ1 && liveSelections.length === 0 && !hasUserAnswersForQuestion) {
        const scoringKey = this.getScoringKey(questionIndex);
        this.quizService.questionCorrectness.delete(scoringKey);
        this.quizService.questionCorrectness.delete(questionIndex);
        this.quizService.sendCorrectCountToResults(0);
      } else {
        await this.quizService.checkIfAnsweredCorrectly(questionIndex, false);
      }

      // Mark question ready
      this.resetComplete = true;

      return true;
    } catch (error: any) {
      console.error(
        `[fetchAndSetQuestionData] Error at Q${questionIndex}:`, error
      );
      return false;
    }
  }

  private async fetchQuestionDetails(questionIndex: number): Promise<QuizQuestion | null> {
    try {
      const resolvedQuestion: QuizQuestion | null = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );

      if (!resolvedQuestion || !resolvedQuestion.questionText?.trim()) {
        console.error(`[Q${questionIndex}] Missing or invalid question payload`);
        return null;
      }

      const trimmedText = resolvedQuestion.questionText.trim();

      const options =
        Array.isArray(resolvedQuestion.options)
          ? resolvedQuestion.options.map((option, idx) => ({
            ...option,
            optionId: option.optionId ?? idx
          }))
          : [];

      if (!options.length) {
        console.error(`[Q${questionIndex}] No valid options`);
        return null;
      }

      // Fetch explanation text
      let explanation = 'No explanation available';
      if (this.explanationTextService.explanationsInitialized) {
        const fetchedExplanation = await firstValueFrom(
          this.explanationTextService.getFormattedExplanationTextForQuestion(
            questionIndex
          )
        );
        explanation = fetchedExplanation?.trim() || 'No explanation available';
      } else {
        console.warn(`[Q${questionIndex}] Explanations not initialized`);
      }

      if (
        (!explanation || explanation === 'No explanation available') &&
        resolvedQuestion.explanation?.trim()
      ) {
        explanation = resolvedQuestion.explanation.trim();
      }

      // Determine question type
      const correctCount = options.filter((opt: Option) => opt.correct).length;
      const type =
        correctCount > 1
          ? QuestionType.MultipleAnswer
          : QuestionType.SingleAnswer;

      const question: QuizQuestion = {
        questionText: trimmedText,
        options,
        explanation,
        type
      };

      // Sync type with service
      this.quizDataService.setQuestionType(question);
      return question;
    } catch (error: any) {
      console.error(`[fetchQuestionDetails] Error loading Q${questionIndex}:`, error);
      throw error;
    }
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

    // Use the authoritative service reset which clears maps, storage, and session
    this.quizService.resetAll();

    // Clear the dot status cache locally for fresh pagination
    this.dotStatusCache.clear();

    // Clear the shuffled questions in the service
    this.quizService.shuffledQuestions = [];

    // PRE-RESET: wipe all reactive quiz state and gates
    // (Prevents Q2/Q3 flickering and stale FET frames)

    // Reset explanation display flags
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });
    this.explanationTextService.setIsExplanationTextDisplayed(false);

    // Clear all cached explanation / gate subjects
    if (this.explanationTextService._byIndex) {
      this.explanationTextService._byIndex.clear();
    }
    if (this.explanationTextService._gatesByIndex) {
      this.explanationTextService._gatesByIndex.clear();
    }

    // Reset any internal locks / trackers
    this.explanationTextService._fetLocked = false;

    // Fully reset reactive participation state
    this.quizStateService.reset();

    // Reset question text BehaviorSubject (prevents “?” or old Q showing)
    try {
      this.quizQuestionLoaderService?.questionToDisplaySubject.next('');
    } catch {
      console.warn('[RESET] questionToDisplay$ not available');
    }

    // Force display back to question mode
    this.quizStateService.displayStateSubject?.next(
      { mode: 'question', answered: false }
    );
    this.quizStateService.setExplanationReady(false);

    console.log('[RESET] Reactive quiz state cleared.');

    // Clear selection/answer maps
    this.selectedOptionService.clearSelectedOption();
    this.selectedOptionService.clearSelection();
    this.selectedOptionService.deselectOption();
    this.selectedOptionService.resetSelectionState();
    this.selectedOptionService.selectedOptionsMap.clear();
    console.log('[SOS] restartQuiz() called - WIPING ALL SELECTIONS from map!');
    this.selectedOptionService.setAnswered(false);
    this.quizStateService.setAnswerSelected(false);

    // Reset explanation/FET state fully on restart so stale cached indices
    // (especially Q1 after URL restart) cannot be reused.
    this.explanationTextService.resetExplanationState();
    this.explanationTextService.unlockExplanation();
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.quizStateService.setDisplayState({ mode: 'question', answered: false });

    // Next starts disabled
    this.nextButtonStateService.setNextButtonState(false);

    // Clear child-local state
    this.quizQuestionComponent?.selectedIndices?.clear();

    // Reset sounds/timer

    this.timerService.stopTimer?.(undefined, { force: true });

    // Reset progress bar to 0%
    this.progress = 0;
    this.dotStatusCache.clear();
    this.updateProgressValue();


    // Navigate to Q1
    this.router.navigate(['/quiz/question', this.quizId, 1])
      .then(() => {
        // Sync current index
        this.currentQuestionIndex = 0;
        this.quizService.setCurrentQuestionIndex(0);
        this.quizService.updateBadgeText(1, this.totalQuestions);

        // Ensure child resets itself for Q1
        this.resetStateService.triggerResetFeedback();
        this.resetStateService.triggerResetState();
        this.quizService.setCurrentQuestionIndex(0);

        // Guarantee Next is off for Q1
        this.nextButtonStateService.setNextButtonState(false);
        this.quizStateService.setAnswerSelected(false);

        // Mark interactive so first click is processed immediately
        queueMicrotask(() => {
          this.quizStateService.setInteractionReady(true);

          // Start timer on next frame after paint
          requestAnimationFrame(() => {
            this.timerService.resetTimer();
            this.timerService.startTimer(
              this.timerService.timePerQuestion,
              this.timerService.isCountdown,
              true
            );
          });
        });

        // Regenerate option bindings
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
    // ALWAYS set _activeIndex and latestExplanationIndex so FET is tracked for ALL
    // questions (including Q1 where _activeIndex may already be 0)
    console.log(`[QuizComponent] Setting ETS active index to ${qIdx}`);
    this.explanationTextService._activeIndex = qIdx;
    this.explanationTextService.latestExplanationIndex = qIdx;
    // Grab the exact question raw text
    const question =
      this.questionsArray?.[qIdx] ??
      this.quiz?.questions?.[qIdx] ??
      (this.currentQuestionIndex === qIdx ? this.currentQuestion : null);

    if (!question) {
      console.warn(`No question found for index ${qIdx}`);
      this.explanationToDisplay = '<span class="muted">No explanation available</span>';
      this.explanationTextService.setExplanationText(this.explanationToDisplay, { index: qIdx });
      this.explanationTextService.setShouldDisplayExplanation(true);
      return;
    }

    const rawExpl = (question.explanation || 'No explanation available').trim();

    // Get the formatted explanation text string (unwrap the Observable)
    let formatted = this.explanationTextService.getFormattedSync(qIdx);
    if (!formatted) {
      const correctIndices = question.options
        .filter((o: Option) => o.correct)
        .map((o: Option) => o.optionId)
        .filter((id): id is number => id !== undefined);

      formatted = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        rawExpl
      );
      this.explanationTextService.setExplanationTextForQuestionIndex(qIdx, formatted);
    }

    this.explanationToDisplay = formatted;
    this.explanationOverride = { idx: qIdx, html: formatted };
    this.showExplanation = true;
    this.cdRef.detectChanges();

    // Push into the three streams synchronously so combinedText$ can see it
    this.explanationTextService.setExplanationText(formatted, { index: qIdx });
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
  }

  // Compute and emit the "# of correct answers" banner text for a given question index.
  private emitCorrectAnswersBanner(index: number): void {
    const fresh = this.quizService.questions?.[index];
    if (!fresh || !Array.isArray(fresh.options)) {
      console.warn('[emitCorrectAnswersBanner] No question/options yet at ' +
        'index', index);
      return;
    }

    console.log(
      '[emitCorrectAnswersBanner] 🧮 Raw options at index', index,
      fresh.options.map((o: Option) =>
        ({ text: o.text, correct: o.correct }))
    );

    const isMulti =
      fresh.type === QuestionType.MultipleAnswer ||
      fresh.options.filter((o: Option) => o.correct === true).length > 1;
    (fresh as any).isMulti = isMulti;  // stamp here
    console.log('[emitCorrectAnswersBanner] isMulti set to', isMulti);

    const numCorrect = fresh.options.filter((o: Option) =>
      o.correct).length;
    const totalOpts = fresh.options.length;
    const banner = isMulti
      ? this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
        numCorrect,
        totalOpts
      )
      : '';

    this.quizService.updateCorrectAnswersText(banner);
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

    if (this.isQuizFreshAtQuestionOne()) {
      for (let i = 0; i < total; i++) {
        this.dotStatusCache.set(i, 'pending');
      }
      this.progress = 0;
      this.cdRef.detectChanges();
      this.cdRef.markForCheck();
      return;
    }

    let answeredCount = 0;
    for (let i = 0; i < total; i++) {
      const status = this.getQuestionStatus(i, { forceRecompute: true });
      this.dotStatusCache.set(i, status);
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
    const answeredIndices = new Set<number>();
    const total = this.totalCount;
    if (total <= 0) return 0;

    // Source 1: Service Maps (The most immediate interactive source)
    const mapsByRef = [
      { name: 'SOS.Map', map: this.selectedOptionService?.selectedOptionsMap },
      { name: 'QS.Map', map: this.quizService?.selectedOptionsMap }
    ];
    for (const item of mapsByRef) {
      if (item.map) {
        for (const [key, value] of item.map.entries()) {
          const idx = Number(key);
          if (!isNaN(idx) && idx >= 0 && idx < total) {
            const hasData = Array.isArray(value) ? value.length > 0 : (value !== undefined);
            if (hasData) answeredIndices.add(idx);
          }
        }
      }
    }

    // Explicitly check questionCorrectness
    const qc = this.quizService.questionCorrectness;
    if (qc instanceof Map) {
      for (const [key, val] of qc.entries()) {
        const idx = Number(key);
        if (!isNaN(idx) && idx >= 0 && idx < total && val !== undefined) {
          answeredIndices.add(idx);
        }
      }
    }

    // Source 2: QuizStateService (Interaction Tracker)
    if (this.quizStateService) {
      this.quizStateService._answeredQuestionIndices?.forEach(idx => {
        if (idx >= 0 && idx < total) answeredIndices.add(idx);
      });
      this.quizStateService._hasUserInteracted?.forEach(idx => {
        if (idx >= 0 && idx < total) answeredIndices.add(idx);
      });
    }

    // Source 3: User Answers Persistence
    const userAnswers = this.quizService?.userAnswers;
    if (Array.isArray(userAnswers)) {
      userAnswers.forEach((ans, idx) => {
        if (idx < total && Array.isArray(ans) && ans.length > 0) {
          answeredIndices.add(idx);
        }
      });
    }

    const count = answeredIndices.size;
    const sortedIndices = Array.from(answeredIndices).sort((a, b) => a - b);
    console.log(`[PROGRESS] calculateAnsweredCount SUMMARY:
      TotalAnswered: ${count}/${total}
      AnsweredIndices: [${sortedIndices.map(i => i + 1).join(',')}]
      TotalCountSource: ${total} (totalQuestions=${this.totalQuestions}, quizQuestions=${this.quiz?.questions?.length})
    `);
    return count;
  }

  // Helper to determine dot class with caching
  private getScoringKey(index: number): number {
    const effectiveQuizId = this.quizId || this.quizService.quizId || localStorage.getItem('lastQuizId') || '';
    if (this.quizService.isShuffleEnabled() && effectiveQuizId) {
      const originalIndex = this.quizShuffleService.toOriginalIndex(effectiveQuizId, index);
      if (typeof originalIndex === 'number' && originalIndex >= 0) {
        return originalIndex;
      }
    }
    return index;
  }

  private getCandidateQuestionIndices(index: number): number[] {
    const scoringKey = this.getScoringKey(index);
    return Array.from(new Set([index, scoringKey]));
  }

  private getDotStatusStorageKey(): string {
    const keyQuizId = this.quizId || this.quizService.quizId || localStorage.getItem('lastQuizId') || 'default';
    return `quiz_dot_status_${keyQuizId}`;
  }

  private getProgressStorageKey(): string {
    const keyQuizId = this.quizId || this.quizService.quizId || localStorage.getItem('lastQuizId') || 'default';
    return `quiz_progress_${keyQuizId}`;
  }

  private getPersistedProgress(): number | null {
    try {
      const keys = [this.getProgressStorageKey(), 'quiz_progress_default'];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
      }
    } catch { }
    return null;
  }

  private setPersistedProgress(value: number): void {
    try {
      const keys = Array.from(new Set([this.getProgressStorageKey(), 'quiz_progress_default']));
      for (const key of keys) {
        localStorage.setItem(key, String(Math.max(0, Math.trunc(value))));
      }
    } catch { }
  }

  private getPersistedDotStatus(index: number): 'correct' | 'wrong' | null {
    try {
      const keys = [
        this.getDotStatusStorageKey(),
        'quiz_dot_status_default'
      ];

      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Record<string, 'correct' | 'wrong'>;
        const value = parsed[String(index)];
        if (value === 'correct' || value === 'wrong') {
          return value;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private setPersistedDotStatus(index: number, status: 'correct' | 'wrong'): void {
    try {
      const keys = Array.from(new Set([
        this.getDotStatusStorageKey(),
        'quiz_dot_status_default'
      ]));

      for (const key of keys) {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[String(index)] = status;
        localStorage.setItem(key, JSON.stringify(parsed));
      }
    } catch { }
  }

  private getSelectionsForQuestion(index: number): SelectedOption[] {
    // IMPORTANT: Use only live in-memory maps for dot/progress state.
    // Persisted fallbacks (userAnswers/sessionStorage) can contain stale values.
    const candidateIndices = this.getCandidateQuestionIndices(index);

    const question = this.questionsArray?.[index] ||
      this.quizService.questions?.[index] ||
      this.quizService.activeQuiz?.questions?.[index];

    const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
    const optionIdSet = new Set(
      (question?.options ?? [])
        .map((opt: Option, optIndex: number) => {
          const rawId = opt?.optionId;
          if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
            return String(rawId).trim();
          }
          return String(optIndex);
        })
    );
    const optionTextSet = new Set(
      (question?.options ?? [])
        .map((opt: Option) => normalize(opt?.text))
        .filter(Boolean)
    );
    const optionIndexSet = new Set((question?.options ?? []).map((_opt: Option, optIndex: number) => optIndex));

    const pickRelevantSelections = (selections: SelectedOption[]): SelectedOption[] => {
      if (!Array.isArray(selections) || selections.length === 0) {
        return [];
      }

      const exactQuestionSelections = selections.filter((selection: SelectedOption) =>
        selection?.questionIndex === index
      );
      if (exactQuestionSelections.length > 0) {
        return exactQuestionSelections;
      }

      const matchedSelections = selections.filter((selection: SelectedOption) => {
        const selectionId = String(selection?.optionId ?? '').trim();
        const selectionText = normalize(selection?.text);
        const selectionDisplayIndex = Number((selection as any)?.displayIndex ?? (selection as any)?.index ?? -1);

        return (
          (selectionId !== '' && optionIdSet.has(selectionId)) ||
          (selectionText !== '' && optionTextSet.has(selectionText)) ||
          optionIndexSet.has(selectionDisplayIndex)
        );
      });

      return matchedSelections.length > 0 ? matchedSelections : selections;
    };

    for (const candidateIndex of candidateIndices) {
      const serviceSelection = this.selectedOptionService?.selectedOptionsMap?.get(candidateIndex);
      if (Array.isArray(serviceSelection) && serviceSelection.length > 0) {
        // return serviceSelection;
        return pickRelevantSelections(serviceSelection);
      }

      const quizSelection = this.quizService?.selectedOptionsMap?.get(candidateIndex);
      if (Array.isArray(quizSelection) && quizSelection.length > 0) {
        // return quizSelection as SelectedOption[];
        return pickRelevantSelections(quizSelection as SelectedOption[]);
      }
    }

    const storedAnswerIds = Array.isArray(this.quizService?.userAnswers?.[index])
      ? (this.quizService.userAnswers[index] as number[])
      : [];
    if (storedAnswerIds.length > 0 && Array.isArray(question?.options) && question.options.length > 0) {
      const reconstructedSelections = storedAnswerIds
        .map((answerId: number) => {
          const directMatch = question.options.find((opt: Option) => String(opt?.optionId ?? '') === String(answerId));
          if (directMatch) {
            return {
              ...directMatch,
              optionId: directMatch.optionId ?? answerId,
              questionIndex: index,
              selected: true
            } as SelectedOption;
          }

          if (Number.isInteger(answerId) && answerId >= 0 && answerId < question.options.length) {
            return {
              ...question.options[answerId],
              optionId: question.options[answerId]?.optionId ?? answerId,
              questionIndex: index,
              displayIndex: answerId,
              selected: true
            } as SelectedOption;
          }

          return null;
        })
        .filter((selection): selection is SelectedOption => !!selection);

      if (reconstructedSelections.length > 0) {
        return reconstructedSelections;
      }
    }

    return [];
  }



  //private evaluateSelectionCorrectness(index: number, selections: SelectedOption[]): boolean | null {
  //const question = this.questionsArray?.[index] ||
  private getQuestionForIndex(index: number): QuizQuestion | null {
    return this.questionsArray?.[index] ||
      this.quizService.questions?.[index] ||
      this.quizService.activeQuiz?.questions?.[index] ||
      null;
  }

  private getResolvedCorrectOptions(question: QuizQuestion | null | undefined, fallbackOptions: Option[] = []): Option[] {
    const options = Array.isArray(question?.options) && question!.options.length > 0
      ? question!.options
      : fallbackOptions;

    if (!Array.isArray(options) || options.length === 0) {
      return [];
    }

    const correctIds = new Set<number>();
    const correctTexts = new Set<string>();

    if (Array.isArray((question as any)?.answer)) {
      for (const answer of (question as any).answer) {
        if (!answer) continue;

        const id = Number(answer.optionId);
        if (!Number.isNaN(id)) correctIds.add(id);

        const text = String(answer.text ?? '').trim().toLowerCase();
        if (text) correctTexts.add(text);
      }
    }

    const resolvedFromAnswers = options.filter((opt: Option) => {
      const id = Number(opt?.optionId);
      const text = String(opt?.text ?? '').trim().toLowerCase();

      return (!Number.isNaN(id) && correctIds.has(id)) || (!!text && correctTexts.has(text));
    });

    if (resolvedFromAnswers.length > 0) {
      return resolvedFromAnswers;
    }

    return options.filter(
      (opt: Option) => opt?.correct === true || String(opt?.correct) === 'true'
    );
  }


  private hasOptimisticCorrectSelection(index: number, selections: SelectedOption[]): boolean {
    const question = this.getQuestionForIndex(index);

    if (!question || !Array.isArray(question.options) || question.options.length === 0 || selections.length === 0) {
      return false;
    }

    const correctOptions = question.options.filter(
      (opt: Option) => opt.correct === true || String(opt.correct) === 'true'
    );

    if (correctOptions.length <= 1) {
      return false;
    }

    const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
    const matchesOption = (candidate: SelectedOption, option: Option): boolean => {
      const candidateId = String(candidate?.optionId ?? '').trim();
      const optionId = String(option?.optionId ?? '').trim();
      const candidateText = normalize(candidate?.text);
      const optionText = normalize(option?.text);

      return (candidateId !== '' && optionId !== '' && candidateId === optionId) ||
        (candidateText !== '' && optionText !== '' && candidateText === optionText);
    };

    const hasIncorrectSelection = selections.some((selection) =>
      !correctOptions.some((correctOption) => matchesOption(selection, correctOption))
    );

    if (hasIncorrectSelection) {
      return false;
    }

    // For multi-answer questions, the dot can turn green on the first correct
    // click, but it must return to red immediately if the current selection set
    // includes any incorrect option.
    return selections.some((selection) =>
      correctOptions.some((correctOption) => matchesOption(selection, correctOption))
    );
  }

  private evaluateSelectionCorrectness(index: number, selections: SelectedOption[]): boolean | null {
    const question = this.getQuestionForIndex(index);
    if (!question || !Array.isArray(question.options) || question.options.length === 0) {
      return null;
    }

    // const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();

    const correctOptions = question.options.filter(
      (opt: Option) => opt.correct === true || String(opt.correct) === 'true'
    );
    const isMultipleAnswerQuestion =
      question.type === QuestionType.MultipleAnswer || correctOptions.length > 1;

    // Treat questions with multiple correct options as multi-answer even when
    // explicit `question.type` metadata is missing.
    /* const isMultipleAnswerQuestion =
      question.type === QuestionType.MultipleAnswer || correctOptions.length > 1;

    // Selections are already retrieved for the target question key.
    // Avoid additional index scoping here because some flows (e.g. shuffle/remap)
    // can carry a different index marker while still belonging to this question.
    const effectiveSelectionsRaw = selections;

    const effectiveSelections = isMultipleAnswerQuestion
      ? effectiveSelectionsRaw
      : effectiveSelectionsRaw.slice(-1);

    if (effectiveSelections.length === 0) { */
    if (correctOptions.length === 0 || selections.length === 0) {
      return null;
    }

    /* const optionIdSet = new Set(
      question.options
        .map((opt: Option) => String(opt.optionId ?? '').trim())
        .filter(Boolean)
    );

    const optionTextSet = new Set(
      question.options
        .map((opt: Option) => normalize(opt.text))
        .filter(Boolean)
    ); */

    const resolution = this.selectedOptionService.getResolutionStatus(
      question,
      selections as Option[],
      true
    );

    if (resolution.correctSelected === 0 && resolution.incorrectSelected === 0) {
      return null;
    }

    /* const findMatchedOption = (selection: SelectedOption): Option | null => {
      const selectionId = String(selection?.optionId ?? '').trim();
      const selectionText = normalize(selection?.text ?? '');
      const selectionIndex = Number(
        (selection as any)?.displayIndex ?? (selection as any)?.index ?? -1
      );

      const byId = selectionId !== ''
        ? question.options.find((opt: Option) =>
          String(opt?.optionId ?? '').trim() === selectionId)
        : undefined;
      if (byId) {
        return byId;
      }

      const byText = selectionText !== ''
        ? question.options.find((opt: Option) =>
          normalize(opt?.text) === selectionText)
        : undefined;
      if (byText) {
        return byText;
      }

      if (
        Number.isInteger(selectionIndex) &&
        selectionIndex >= 0 &&
        selectionIndex < question.options.length
      ) {
        return question.options[selectionIndex] ?? null;
      }

      return null;
    };

    let consideredSelections = 0;
    let matchedCorrectCount = 0;
    let hasIncorrect = false;

    for (const selection of effectiveSelections) {
      //const id = String(selection?.optionId ?? '').trim();
      //const text = normalize(selection?.text ?? '');
      const explicitCorrect = selection?.correct === true || String(selection?.correct) === 'true';

      //const knownOption = (id !== '' && optionIdSet.has(id)) || (text !== '' && optionTextSet.has(text));
      const matchedOption = findMatchedOption(selection);
      const matchedOptionIsCorrect =
        matchedOption?.correct === true || String(matchedOption?.correct) === 'true';
      const knownOption = !!matchedOption;
      if (!knownOption && !explicitCorrect) continue;

      consideredSelections++;

      //const isCorrect = (id !== '' && correctIds.has(id)) || (text !== '' && correctTexts.has(text)) || explicitCorrect;
      const isCorrect = matchedOptionIsCorrect || explicitCorrect;
      if (isCorrect) {
        matchedCorrectCount++;
      } else {
        hasIncorrect = true;
      }
    } */
    if (isMultipleAnswerQuestion) {
      if (resolution.incorrectSelected > 0) {
        return false;
      }

      if (resolution.correctSelected > 0) {
        return true;
      }

      return null;
    }

    if (resolution.incorrectSelected > 0) {
      return false;
    }

    /* if (consideredSelections === 0) return null;
    if (hasIncorrect) return false; // Any wrong choice = Red
    if (matchedCorrectCount > 0) return true; // At least one right and zero wrong = Green
    return null; */
    return resolution.correctSelected > 0 ? true : null;
  }

  // Helper to determine dot class with caching
  getQuestionStatus(index: number, options?: { forceRecompute?: boolean }): 'correct' | 'wrong' | 'pending' {
    if (this.isQuizFreshAtQuestionOne()) {
      this.dotStatusCache.set(index, 'pending');
      return 'pending';
    }

    const previousCached = this.dotStatusCache.get(index);
    //if (this.dotStatusCache.has(index)) {
    const hasCachedStatus = this.dotStatusCache.has(index);

    const selections = this.getSelectionsForQuestion(index);
    const candidateIndices = this.getCandidateQuestionIndices(index);
    const questionHasLiveSessionState = this.hasLiveSessionStateForQuestion(index);

    if (hasCachedStatus) {
      const cached = this.dotStatusCache.get(index)!;
      const isCurrentQuestion = index === this.currentQuestionIndex;
      //if (!options?.forceRecompute && !isCurrentQuestion) {
      // Cached CORRECT is stable and can be reused safely.
      // Cached WRONG is not stable enough for multi-answer questions because the
      // user can fix an earlier incorrect selection by adding the remaining
      // correct answers, which should immediately flip the dot green.
      if (!options?.forceRecompute && !isCurrentQuestion && cached === 'correct') {
        return cached;
      }

      if (
        !options?.forceRecompute &&
        !isCurrentQuestion &&
        cached === 'pending' &&
        !questionHasLiveSessionState &&
        selections.length === 0
      ) {
        return cached;
      }
      if (!options?.forceRecompute && isCurrentQuestion && cached === 'pending') {
        return cached;
      }
    }

    /* const selections = this.getSelectionsForQuestion(index);
    const candidateIndices = this.getCandidateQuestionIndices(index);
    const questionHasLiveSessionState = this.hasLiveSessionStateForQuestion(index); */

    if (
      index === this.currentQuestionIndex &&
      !questionHasLiveSessionState &&
      selections.length === 0
    ) {
      if (previousCached === 'correct' || previousCached === 'wrong') {
        this.dotStatusCache.set(index, previousCached);
        return previousCached;
      }

      const localStatus = this.getPersistedDotStatus(index);
      if (localStatus === 'correct' || localStatus === 'wrong') {
        this.dotStatusCache.set(index, localStatus);
        return localStatus;
      }
      this.dotStatusCache.set(index, 'pending');
      return 'pending';
    }

    /* const hasScoredState = candidateIndices.some((key) => {
      const persisted = this.quizService.questionCorrectness.get(key);
      return persisted === true || persisted === false;
    }); */
    const persistedScoredValues = candidateIndices
      .map((key) => this.quizService.questionCorrectness.get(key))
      .filter((value): value is boolean => value === true || value === false);
    const hasScoredState = persistedScoredValues.length > 0;
    const hasAuthoritativeCorrectState = persistedScoredValues.includes(true);
    const evaluatedStatus = selections.length > 0
      ? this.evaluateSelectionCorrectness(index, selections)
      : null;
    const hasOptimisticCorrectSelection = selections.length > 0 &&
      this.hasOptimisticCorrectSelection(index, selections);
    /* const hasActiveSessionState =
      (this.selectedOptionService?.selectedOptionsMap?.size ?? 0) > 0 ||
      (this.quizService?.selectedOptionsMap?.size ?? 0) > 0 ||
      (this.quizService?.questionCorrectness?.size ?? 0) > 0 ||
      (Array.isArray(this.quizService?.userAnswers)
        ? this.quizService.userAnswers.some((answers: unknown) =>
          Array.isArray(answers) && answers.length > 0)
        : false); */

    // Multi-answer questions should flip green on the first correct click,
    // even before the stricter resolution/scoring paths fully settle.
    if (hasOptimisticCorrectSelection) {
      this.setPersistedDotStatus(index, 'correct');
      this.dotStatusCache.set(index, 'correct');
      return 'correct';
    }

    const localStatus = this.getPersistedDotStatus(index);

    // For the CURRENT question, the persisted dot status was written by
    // onOptionSelected based on the most-recently-clicked option.  Trust it
    // over the cumulative evaluateSelectionCorrectness result which may
    // disagree due to the full selection set or question type detection issues.
    if (index === this.currentQuestionIndex && (localStatus === 'correct' || localStatus === 'wrong') && questionHasLiveSessionState) {
      this.dotStatusCache.set(index, localStatus);
      return localStatus;
    }

    // If this click path has already persisted an optimistic CORRECT state for
    // the active question, trust it immediately so the current dot flips green
    // on the first correct click even while selection/scoring state is still
    // settling asynchronously.
    if (
      localStatus === 'correct' &&
      evaluatedStatus !== false &&
      (
        index !== this.currentQuestionIndex ||
        questionHasLiveSessionState ||
        selections.length > 0
      )
    ) {
      this.dotStatusCache.set(index, 'correct');
      return 'correct';
    }

    // Prefer the live selection evaluation whenever we still have in-memory
    // state for this question. This prevents a previously persisted "wrong"
    // dot from overriding the current multi-answer selection after the user
    // fixes the answer on the same question.
    /* if (
      (evaluatedStatus === true || evaluatedStatus === false) &&
      (questionHasLiveSessionState || index === this.currentQuestionIndex)
    ) { */

    // An authoritative scored-correct state must win over any live-selection
    // false negative. This is especially important for multiple-answer
    // questions where transient stale selections can still include an earlier
    // wrong click even after the service has already marked the question
    // correct.
    if (hasAuthoritativeCorrectState) {
      this.setPersistedDotStatus(index, 'correct');
      this.dotStatusCache.set(index, 'correct');
      return 'correct';
    }

    // Prefer the live selection evaluation whenever we can compute one from
    // the current selections. This ensures a stale persisted "wrong" dot is
    // immediately replaced once a multiple-answer question becomes correct
    // after the user fixes an earlier incorrect selection.
    if (evaluatedStatus === true || evaluatedStatus === false) {
      const status: 'correct' | 'wrong' = evaluatedStatus ? 'correct' : 'wrong';
      this.setPersistedDotStatus(index, status);
      this.dotStatusCache.set(index, status);
      return status;
    }

    // For non-current questions, prefer already persisted dot color first.
    // This prevents transient service-map false values from repainting an
    // already-correct dot red when user navigates forward.
    //if (index !== this.currentQuestionIndex && (localStatus === 'correct' || localStatus === 'wrong')) {
    // For non-current questions, a persisted CORRECT dot is safe to reuse.
    // Persisted WRONG is not authoritative enough to short-circuit here because
    // a transient false negative can be written before scoring fully settles,
    // which was leaving Q2 red after a correct answer.
    if (index !== this.currentQuestionIndex && localStatus === 'correct') {
      this.dotStatusCache.set(index, localStatus);
      return localStatus;
    }

    // If scoring service already has an explicit correctness value, prefer it over
    // local selection heuristics (which can be noisy with remapped/shuffled payloads)
    // for NON-current questions. For the active question, prioritize live evaluation.
    if (index !== this.currentQuestionIndex) {
      for (const key of candidateIndices) {
        const persisted = this.quizService.questionCorrectness.get(key);
        if (persisted === true || persisted === false) {
          const status: 'correct' | 'wrong' = persisted ? 'correct' : 'wrong';
          this.setPersistedDotStatus(index, status);
          this.dotStatusCache.set(index, status);
          return status;
        }
      }
    }

    // Active question: live evaluation should update immediately.
    /* if (index === this.currentQuestionIndex && (evaluatedStatus === true || evaluatedStatus === false)) {
      const status: 'correct' | 'wrong' = evaluatedStatus ? 'correct' : 'wrong';
      // const scoringKey = this.getScoringKey(index);
      // this.quizService.questionCorrectness.set(scoringKey, evaluatedStatus);
      // this.quizService.questionCorrectness.set(index, evaluatedStatus);
      // IMPORTANT: Keep this path visual-only.
      // Writing into questionCorrectness here can pre-mark a question as
      // already correct before incrementScore() runs, which suppresses the
      // first real score increment (wasCorrect=true, isNowCorrect=true).
      this.setPersistedDotStatus(index, status);
      this.dotStatusCache.set(index, status);
      return status;
    }

    // const localStatus = this.getPersistedDotStatus(index);
    const hasSessionState = this.hasLiveSessionStateForQuestion(index); */

    // Do not restore persisted dot color for untouched active questions.
    // But allow non-current questions to keep their previous run status when navigating.
    if (!hasScoredState && evaluatedStatus === null) {
      if (previousCached === 'correct') {
        return previousCached;
      }
      if (index !== this.currentQuestionIndex && localStatus === 'correct') {
        this.dotStatusCache.set(index, localStatus);
        return localStatus;
      }
      this.dotStatusCache.set(index, 'pending');
      return 'pending';
    }

    if (localStatus === 'correct' && index !== this.currentQuestionIndex) {
      this.dotStatusCache.set(index, localStatus);
      return localStatus;
    }
    /* for (const key of candidateIndices) {
      const persisted = this.quizService.questionCorrectness.get(key);
      if (persisted === true || persisted === false) {
        const status: 'correct' | 'wrong' = persisted ? 'correct' : 'wrong';
        this.setPersistedDotStatus(index, status);
        this.dotStatusCache.set(index, status);
        return status;
      }
    } */

    if (evaluatedStatus === true || evaluatedStatus === false) {
      const status: 'correct' | 'wrong' = evaluatedStatus ? 'correct' : 'wrong';
      this.setPersistedDotStatus(index, status);
      this.dotStatusCache.set(index, status);
      return status;
    }

    return 'pending';
  }

  private hasLiveSessionStateForQuestion(index: number): boolean {
    const candidateIndices = this.getCandidateQuestionIndices(index);

    const hasSelections = candidateIndices.some((candidateIndex) => {
      const selectedViaService = this.selectedOptionService?.selectedOptionsMap?.get(candidateIndex);
      if (Array.isArray(selectedViaService) && selectedViaService.length > 0) {
        return true;
      }

      const selectedViaQuiz = this.quizService?.selectedOptionsMap?.get(candidateIndex);
      return Array.isArray(selectedViaQuiz) && selectedViaQuiz.length > 0;
    });

    if (hasSelections) {
      return true;
    }

    const hasScoredState = candidateIndices.some((candidateIndex) => {
      const score = this.quizService?.questionCorrectness?.get(candidateIndex);
      return score === true || score === false;
    });

    if (hasScoredState) {
      return true;
    }

    const hasUserAnswers = candidateIndices.some((candidateIndex) => {
      const answers = this.quizService?.userAnswers?.[candidateIndex];
      return Array.isArray(answers) && answers.length > 0;
    });

    if (hasUserAnswers) {
      return true;
    }

    return false;
  }

  private isQuizFreshAtQuestionOne(): boolean {
    if (this.currentQuestionIndex !== 0) {
      return false;
    }

    const hasSelectionsInSelectedOptionService =
      (this.selectedOptionService?.selectedOptionsMap?.size ?? 0) > 0;
    const hasSelectionsInQuizService =
      (this.quizService?.selectedOptionsMap?.size ?? 0) > 0;
    const hasScoredQuestions =
      (this.quizService?.questionCorrectness?.size ?? 0) > 0;
    const hasStoredUserAnswers =
      Array.isArray(this.quizService?.userAnswers) &&
      this.quizService.userAnswers.some((answers: unknown) =>
        Array.isArray(answers) && answers.length > 0
      );
    const hasStateServiceActivity =
      (this.quizStateService?._answeredQuestionIndices?.size ?? 0) > 0 ||
      (this.quizStateService?._hasUserInteracted?.size ?? 0) > 0;

    return !hasSelectionsInSelectedOptionService &&
      !hasSelectionsInQuizService &&
      !hasScoredQuestions &&
      !hasStoredUserAnswers &&
      !hasStateServiceActivity;
  }

  // Call this when user selects an answer to update the cache
  updateDotStatus(index: number): void {
    console.log(`[DOT UPDATE] Re-evaluating Q${index + 1}`);
    // Use forceRecompute to bypass stale cache entries
    const status = this.getQuestionStatus(index, { forceRecompute: true });
    this.dotStatusCache.set(index, status);

    // Ensure CD runs to update UI colors immediately
    this.cdRef.detectChanges();
    this.cdRef.markForCheck();
  }

  getDotClass(index: number): string {
    const status = this.getQuestionStatus(index);
    if (index === this.currentQuestionIndex && status !== 'pending') {
      return `${status} current`;
    }
    return status;
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

  private persistContinueStatusIfNeeded(): void {
    if (!this.quizId) return;

    // Hard Block: never persist CONTINUE after completion
    if (this.quizService.quizCompleted === true) {
      console.log('[QuizComponent] Quiz completed. Skipping CONTINUE persist.');
      return;
    }

    // Only persist if the user actually answered something
    const hasAnsweredAny =
      this.currentQuestionIndex > 0 ||
      this.selectedOptionService.isQuestionAnswered(0) === true;

    if (!hasAnsweredAny) return;

    // Store the current question index for resume
    this.quizService.currentQuestionIndex = this.currentQuestionIndex;

    // Set CONTINUE status
    this.quizDataService.updateQuizStatus(this.quizId, QuizStatus.CONTINUE);
    this.quizService.setQuizStatus(QuizStatus.CONTINUE);
  }

  private finalizeAndGoToResults(): void {
    const analysis = this.buildScoreAnalysisSnapshot();

    const correct = analysis.filter(a => a.wasCorrect).length;
    const total = analysis.length;

    const finalResult: FinalResult = {
      quizId: this.quizId!,
      correct,
      total,
      percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
      analysis,
      completedAt: Date.now(),
    };

    this.quizService.quizCompleted = true;
    this.quizService.setQuizStatus(QuizStatus.COMPLETED);

    this.quizService.setFinalResult(finalResult);

    this.router.navigate(['/results', this.quizId]);
  }

  private buildScoreAnalysisSnapshot(): ScoreAnalysisItem[] {
    const questions = this.quizService.activeQuiz?.questions ?? this.quizService.questions ?? [];
    const analysis: ScoreAnalysisItem[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q) continue;

      const selected = this.selectedOptionService.getSelectedOptionsForQuestion(i) ?? [];
      const selectedIds = selected.map(o => String(o?.optionId ?? '')).filter(Boolean);

      const correctIds = (q.options ?? [])
        .filter((o: Option) => o.correct === true)
        .map((o: Option) => String(o.optionId))
        .filter(Boolean);

      // "wasCorrect" logic: selected set equals correct set
      const selectedSet: Set<string> = new Set<string>(selectedIds);
      const correctSet: Set<string> = new Set<string>(correctIds);

      const wasCorrect =
        correctSet.size > 0 &&
        correctSet.size === selectedSet.size &&
        Array.from(correctSet).every((id: string) => selectedSet.has(id));

      analysis.push({
        questionIndex: i,
        questionText: String(q.questionText ?? ''),
        wasCorrect,
        selectedOptionIds: selectedIds,
        correctOptionIds: correctIds
      });
    }

    return analysis;
  }
}
