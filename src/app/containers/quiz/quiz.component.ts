import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
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
// import { Utils } from '../../shared/utils/utils';
import { QuizStatus } from '../../shared/models/quiz-status.enum';
import { QuestionType } from '../../shared/models/question-type.enum';
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
import { QuizService } from '../../shared/services/quiz.service';
import { QuizDataService } from '../../shared/services/quizdata.service';
import { QuizInitializationService } from '../../shared/services/quiz-initialization.service';
import { QuizNavigationService } from '../../shared/services/quiz-navigation.service';
import { QuizStateService } from '../../shared/services/quizstate.service';
import { QuizQuestionLoaderService } from '../../shared/services/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../shared/services/quizquestionmgr.service';
import { ExplanationTextService } from '../../shared/services/explanation-text.service';
import { NextButtonStateService } from '../../shared/services/next-button-state.service';
import { RenderStateService } from '../../shared/services/render-state.service';
import { SelectedOptionService } from '../../shared/services/selectedoption.service';
import { SelectionMessageService } from '../../shared/services/selection-message.service';
import { TimerService } from '../../shared/services/timer.service';
import { ResetStateService } from '../../shared/services/reset-state.service';
import { ResetBackgroundService } from '../../shared/services/reset-background.service';
import { SharedVisibilityService } from '../../shared/services/shared-visibility.service';
import { SoundService } from '../../shared/services/sound.service';
import { UserPreferenceService } from '../../shared/services/user-preference.service';
import { ChangeRouteAnimation } from '../../animations/animations';

type AnimationState = 'animationStarted' | 'none';

interface Override {
  idx: number;
  html: string;
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [UserPreferenceService]
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
  private isQuizLoaded = false; // tracks if the quiz data has been loaded
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
  private dotStatusCache =
    new Map<number, 'correct' | 'wrong'>();

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
    private resetBackgroundService: ResetBackgroundService,
    private sharedVisibilityService: SharedVisibilityService,
    private soundService: SoundService,
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
          console.log('[VISIBILITY] 💾 Saved display state on hide:',
            this._savedDisplayState);
        }
      } else {
        // Tab visible: Lock display state changes, then restore the saved state
        if (this._savedDisplayState) {
          console.log('[VISIBILITY] ♻️ Restoring saved display state:',
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
            console.log('[VISIBILITY] 🔄 Re-emitting question data to force ' +
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
        if (questions && questions.length > 0) {
          this.questions = questions;
          this.questionsArray = [...questions];
          this.totalQuestions = questions.length;
          this.cdRef.markForCheck();
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

    // Fix: Trigger CD on any selection change (e.g. Red -> Green transition)
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
      error: (err: Error) =>
        console.error('Error in currentQuestion subscription:', err),
      complete: () => console.log('currentQuestion subscription completed.'),
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
        if (!this.shouldShowNextButton) {
          event.preventDefault();
          await this.advanceToNextQuestion();
          return;
        }

        // Otherwise, “Show Results” visible? — go to results
        if (!this.shouldShowResultsButton) {
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
          console.warn('[⛔] Already at first question — cannot go back');
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

    this.resetQuizState();
    this.initializeQuestionIndex();
    this.fetchTotalQuestions();
    this.subscribeToQuestionIndex();

    await this.loadQuestions();

    // Common logic after loading (reusing existing continuation logic)
    const initialIndex = this.currentQuestionIndex || 0;
    this.quizService.setCurrentQuestionIndex(initialIndex);
    Promise.resolve().then(() => this.cdRef.detectChanges());

    this.initializeCorrectExpectedCounts();
    this.subscribeToNextButtonState();
    this.initializeServices();
  }

  private subscribeToQuestions(): void {
    this.questions$ = this.quizService.questions$;
    this.quizService.questions$.pipe(takeUntil(this.destroy$)).subscribe((q) => {
      this.questionsArray = q;
    });
  }

  private subscribeToRouteEvents(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        const raw = this.activatedRoute.snapshot.paramMap.get('questionIndex');
        const idx = Math.max(0, (Number(raw) || 1) - 1);
        this.quizService.setCurrentQuestionIndex(idx);
      });
  }

  private async initializeQuizId(): Promise<string | null> {
    let quizId = this.quizService.getCurrentQuizId();
    if (!quizId) {
      const routeQuizId = this.activatedRoute.snapshot.paramMap.get('quizId');
      if (routeQuizId) {
        quizId = routeQuizId;
        this.quizService.setQuizId(routeQuizId);
        console.warn('[⚠️ QuizComponent] quizId recovered from route params.');
      }
    }

    if (!quizId) {
      console.error('[❌ QuizComponent] Missing quizId.');
      await this.router.navigate(['/select']);
      return null;
    }
    return quizId;
  }

  private resetQuizState(): void {
    this.quizService.resetQuestionPayload();
    this.quizQuestionLoaderService.resetUI();
    localStorage.removeItem('savedQuestionIndex');
  }

  private initializeQuestionIndex(): void {
    const routeParamIndex = this.activatedRoute.snapshot.paramMap.get('questionIndex');
    const idx = Math.max(0, (Number(routeParamIndex) || 1) - 1);
    this.currentQuestionIndex = idx;
    this.quizService.setCurrentQuestionIndex(idx);
    localStorage.setItem('savedQuestionIndex', JSON.stringify(idx));
  }

  private fetchTotalQuestions(): void {
    this.quizService.getTotalQuestionsCount(this.quizId)
      .pipe(take(1))
      .subscribe((total: number) => {
        this.totalQuestions = total;
      });
  }

  private subscribeToQuestionIndex(): void {
    this.indexSubscription = this.quizService.currentQuestionIndex$
      .pipe(distinctUntilChanged())
      .subscribe((idx: number) => {
        const prevIdx = this.lastLoggedIndex;
        const ets = this.explanationTextService;

        // Only purge the previous question
        if (prevIdx !== null && prevIdx !== idx) {
          console.warn('[STATE CLEANUP] Purging Q', prevIdx + 1);

          this.quizStateService._hasUserInteracted?.delete(prevIdx);
          this.quizStateService._answeredQuestionIndices?.delete(prevIdx);

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
          console.log(`[QuizComponent] 🔄 Synced currentQuestion to Q${idx + 1} from URL/Index update`);

          // ⚡ FIX: Update Display Source so the UI receives the new text!
          this.questionToDisplaySource.next(question.questionText?.trim() ?? '');

          // ⚡ FIX: Update Combined Data for the template (options, etc.)
          this.combinedQuestionDataSubject.next({
            question: question,
            options: question.options,
            explanation: question.explanation
          });

          // Ensure QuizStateService is also aligned
          this.quizStateService.updateCurrentQuestion(this.currentQuestion);
          // Ensure QuizService is also aligned
          this.quizService.updateCurrentQuestion(this.currentQuestion); // Sync Service too
        }
        this.cdRef.markForCheck();

        // ONLY reset display mode when NAVIGATING to a NEW question
        if (prevIdx !== null && prevIdx !== idx) {
          console.warn(
            '[🔄 NAVIGATION RESET] Moving from Q',
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

          console.warn('[✅ NAVIGATION COMPLETE]', idx + 1);
        }
      });
  }

  private async loadQuestions(): Promise<void> {
    // Reuse existing loaded questions if they match the current quiz AND shuffle state
    const shouldShuffle = this.quizService.isShuffleEnabled();
    const hasShuffled =
      this.quizService.shuffledQuestions && this.quizService.shuffledQuestions.length > 0;

    // If shuffle is ON, we must have shuffledQuestions to reuse.
    // If shuffle is OFF, we can reuse standard questions.
    const canReuse = (shouldShuffle && hasShuffled) ||
      (!shouldShuffle && this.quizService.questions &&
        this.quizService.questions.length > 0);

    if (canReuse && this.quizService.quizId === this.quizId) {
      const source = shouldShuffle ?
        this.quizService.shuffledQuestions : this.quizService.questions;
      console.log(`[QuizComponent] ♻️ Reusing existing ${shouldShuffle ?
        'SHUFFLED' : 'standard'} questions (${source.length}) for quiz ${this.quizId}`);

      // Propagate existing questions to local array
      this.questionsArray = source;
      this.isQuizDataLoaded = true;

      // Ensure UI knows about them
      Promise.resolve().then(() => this.cdRef.detectChanges());
    } else {
      try {
        const questions = await this.quizService.fetchQuizQuestions(this.quizId);
        if (!questions?.length) {
          console.error('[❌ QuizComponent] No quiz questions returned.');
          return;
        }

        this.questionsArray = questions;
        console.log('[✅ QuizComponent] Questions fetched.');

        // Set quiz as loaded and sync index after questions are ready
        this.isQuizDataLoaded = true;
      } catch (err) {
        console.error('[❌ QuizComponent] Failed to fetch questions:', err);
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

  /* method removed */

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
      (enabled) => (this.isNextButtonEnabled = enabled),
      (answered) => (this.isCurrentQuestionAnswered = answered),
      (message) => (this.selectionMessage = message),
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
    this.explanationTextService.explanationText$.subscribe((text: string | null) => {
      this.explanationToDisplay = text || '';
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
              console.log(`[restoreSelectionState] ♻️ Restored selections from storage for Q${this.currentQuestionIndex}:`, ids);
            }
          } catch (err: any) {
            console.error('[restoreSelectionState] Error parsing stored selections', err);
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
      this.selectedOptionService.updateAnsweredState(questionOptions, this.currentQuestionIndex);
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
      error: (err: Error) => {
        console.error('Error fetching question:', err);
      },
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
      }),
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

  public async onOptionSelected(
    event: SelectedOption,
    isUserAction: boolean = true
  ): Promise<void> {
    this.updateProgressValue();

    // Guards and de-duplication
    if (!isUserAction || (!this.resetComplete && !this.hasOptionsLoaded)) return;

    // Use optionId or displayOrder for deduplication
    const optionIdentifier = event?.optionId ?? event?.displayOrder ?? -1;
    if (optionIdentifier === this.lastLoggedIndex) {
      console.warn('[🟡 Skipping duplicate event]', event);
      return;
    }
    this.lastLoggedIndex = optionIdentifier;

    // Show the explanation on first click
    const emittedQuestionIndex = event?.questionIndex;
    const normalizedQuestionIndex =
      Number.isInteger(emittedQuestionIndex) &&
        (emittedQuestionIndex as number) >= 0
        ? (emittedQuestionIndex as number)
        : this.currentQuestionIndex;

    if (!Number.isInteger(normalizedQuestionIndex) || normalizedQuestionIndex < 0) {
      console.warn('[⚠️ Invalid question index for explanation]', {
        emittedQuestionIndex,
        currentQuestionIndex: this.currentQuestionIndex
      });
      return;
    }

    this.showExplanationForQuestion(normalizedQuestionIndex);
    await firstValueFrom(this.quizService.getOptions(normalizedQuestionIndex));

    let isAnswered!: boolean;
    if (isAnswered) {
      // Mark as answered and enable Next
      this.selectedOptionService.setAnswered(true);
      this.nextButtonStateService.setNextButtonState(isAnswered);
    }
    this.cdRef.markForCheck();
    console.log('[PARENT] onOptionSelected → about to enable Next');

    // Persist per-question “seen” flag␊
    const prev =
      this.quizStateService.getQuestionState(this.quizId, normalizedQuestionIndex);
    if (!prev) {
      console.warn(
        `[setQuestionState] No previous state found for index ${normalizedQuestionIndex}`
      );
      return;
    }

    this.quizStateService.setQuestionState(this.quizId, normalizedQuestionIndex,
      {
        ...prev,
        isAnswered: true,
        explanationDisplayed: true,
        explanationText: this.explanationToDisplay,
        selectedOptions: prev.selectedOptions ?? []
      }
    );

    // ⚡ CRITICAL FIX: Trigger scoring logic
    // This was missing! Without this call, incrementScore is never triggered.
    void this.quizService.checkIfAnsweredCorrectly(normalizedQuestionIndex);

    // Selection message / next-button logic
    try {
      setTimeout(async () => {
        this.nextButtonStateService.evaluateNextButtonState(
          this.selectedOptionService.isAnsweredSubject.getValue(),
          this.quizStateService.isLoadingSubject.getValue(),
          this.quizStateService.isNavigatingSubject.getValue()
        );
      }, 50);
    } catch (err: any) {
      console.error('[❌ setSelectionMessage failed]', err);
    }

    // Persist state in sessionStorage
    sessionStorage.setItem('isAnswered', 'true');

    // Save selection indices for persistence
    const currentIndices =
      this.selectedOptionService.getSelectedOptionIndices(normalizedQuestionIndex);
    sessionStorage.setItem(`quiz_selection_${normalizedQuestionIndex}`,
      JSON.stringify(currentIndices));
    sessionStorage.setItem(`displayMode_${normalizedQuestionIndex}`, 'explanation');
    sessionStorage.setItem('displayExplanation', 'true');
  }

  private resetQuestionState(): void {
    // Remove stale question so template can’t render old text
    this.currentQuestion = null;
    this.question = null; // also clear this for consistency
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
      console.log('[resetQuestionState] 🛡️ Skipping explanation reset — lock is active.');
    }

    // Reset internal selected options tracking
    this.selectedOptionService.stopTimerEmitted = false;

    this.cdRef.detectChanges();
  }

  ngOnDestroy(): void {
    // Set CONTINUE status if quiz is in progress (not completed, but started)
    if (this.quizId && !this.quizService.quizCompleted) {
      const hasAnsweredAny = this.currentQuestionIndex > 0 ||
        this.selectedOptionService.isQuestionAnswered(0);

      if (hasAnsweredAny) {
        // Store the current question index for resume
        this.quizService.currentQuestionIndex = this.currentQuestionIndex;

        // Set CONTINUE status
        this.quizDataService.updateQuizStatus(this.quizId, QuizStatus.CONTINUE);
        this.quizService.setQuizStatus(QuizStatus.CONTINUE);
        console.log(`[QuizComponent] Set CONTINUE status for quiz 
          ${this.quizId} at Q${this.currentQuestionIndex}`);
      }
    }


    this.destroy$.next();
    this.destroy$.complete();
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
    this.subscriptions.unsubscribe();
    this.routeSubscription?.unsubscribe();
    this.routerSubscription?.unsubscribe();
    this.indexSubscription?.unsubscribe();
    this.questionAndOptionsSubscription?.unsubscribe();
    this.optionSelectedSubscription?.unsubscribe();
    this.timerService.stopTimer(undefined, { force: true });

    this.nextButtonStateService.cleanupNextButtonStateStream();

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
        '[QuizComponent] 🔄 currentQuestion changed:',
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
    return this.currentQuestionIndex < this.totalQuestions - 1;
  }

  public get shouldShowResultsButton(): boolean {
    return this.currentQuestionIndex === this.totalQuestions - 1;
  }

  /**
   * Creates the unified config object for QuizQuestionComponent.
   * This getter encapsulates all the individual input bindings.
   */
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

  /**
   * Unified event handler for QuizQuestionComponent events.
   * Dispatches to existing individual handlers based on event type.
   */
  public handleQuizQuestionEvent(event: QuizQuestionEvent): void {
    switch (event.type) {
      case 'answer':
        this.selectedAnswer(event.payload);
        break;
      case 'optionSelected':
        void this.onOptionSelected(event.payload);
        break;
      case 'selectionMessageChange':
        this.onSelectionMessageChange(event.payload);
        break;
      case 'explanationToDisplayChange':
        this.onExplanationChanged(event.payload);
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

    this.quizService.correctAnswersText$
      .pipe(takeUntil(this.destroy$))
      .subscribe((text: string) => {
        this.correctAnswersText = text;
        this.correctAnswersTextSource.next(text);
      });

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

  /******* Initialize route parameters functions *********/
  private subscribeToRouteParams(): void {
    this.activatedRoute.paramMap
      .pipe(
        tap((p) =>
          console.log('[ROUTE 📦] paramMap emitted →',
            p.get('questionIndex')),
        ),
        distinctUntilChanged(
          (prev, curr) =>
            prev.get('questionIndex') === curr.get('questionIndex') &&
            prev.get('quizId') === curr.get('quizId'),
        ),
      )
      .subscribe(async (params: ParamMap) => {
        const quizId = params.get('quizId') ?? '';
        const indexParam = params.get('questionIndex');
        const index = Number(indexParam) - 1;

        if (!quizId || isNaN(index) || index < 0) {
          console.error('[❌ Invalid route params]', { quizId, indexParam });
          return;
        }

        this.cdRef.markForCheck();

        // Update indices (local and services) before async calls
        this.quizId = quizId;
        this.currentQuestionIndex = index;
        this.quizService.quizId = quizId;
        this.quizService.setCurrentQuestionIndex(index);

        try {
          // Fetch current quiz meta (unchanged)
          const currentQuiz: Quiz = await firstValueFrom(
            this.quizDataService.getQuiz(quizId).pipe(
              filter((q): q is Quiz => !!q && Array.isArray(q.questions)),
              take(1),
            ),
          );
          if (!currentQuiz) {
            console.error('[❌ Failed to fetch quiz with quizId]', quizId);
            return;
          }
          // Cache it in the service
          this.quizService.setCurrentQuiz(currentQuiz);

          // Set loader context
          this.quizQuestionLoaderService.activeQuizId = quizId;
          this.quizQuestionLoaderService.totalQuestions = currentQuiz.questions?.length ?? 0;

          // Now let the loader fetch question + options and emit payload
          const success =
            await this.quizQuestionLoaderService.loadQuestionAndOptions(index);
          if (success) {
            this.soundService.clearPlayedOptionsForQuestion(index);
          } else {
            console.warn(`[❌ Failed to load Q${index}]`);
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
            console.error('[❌ No question at index]', { index });
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

          this.updateProgressValue();
          localStorage.setItem('savedQuestionIndex', index.toString());
        } catch (err) {
          console.error('[❌ Error in paramMap subscribe]', err);
        }
      });
  }

  /**** Initialize route parameters and subscribe to updates ****/
  resolveQuizData(): void {
    this.activatedRoute.data
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe((data: any) => {
        const quizData = data['quizData'];

        if (quizData && Array.isArray(quizData.questions) &&
          quizData.questions.length > 0) {
          this.selectedQuiz = quizData;

          this.quizService.setSelectedQuiz(quizData);
          this.explanationTextService.initializeExplanationTexts(
            quizData.questions.map((q: QuizQuestion) => q.explanation)
          );

          void this.initializeQuiz();
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
      console.warn('[🛑 initializeQuiz] Already initialized. Skipping...');
      return;
    }

    console.log('[✅ initializeQuiz] Starting quiz init...');
    this.quizAlreadyInitialized = true;

    // Initialize quiz session, dependencies, and routing
    void this.prepareQuizSession();
    this.initializeQuizDependencies();
    this.initializeQuizBasedOnRouteParams();

    // Set index to the first question
    const initialIndex = 0;
    this.quizService.setCurrentQuestionIndex(initialIndex);

    // Load the first question
    const firstQuestion: QuizQuestion | null = await firstValueFrom(
      this.quizService.getQuestionByIndex(initialIndex)
    );
    if (firstQuestion) {
      this.quizService.setCurrentQuestion(firstQuestion);
    } else {
      console.warn(`[⚠️ No question found at index ${initialIndex}]`);
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
          correct: option.correct ?? false
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
    console.log('[QuizComponent] 🧹 Cleared FET cache (fetByIndex) before ' +
      'regenerating.');

    // Format each explanation with "Option X is correct because..." prefix
    const formattedExplanations =
      hydratedQuestions.map((question, index) => {
        const rawExplanation = (question.explanation ?? '').trim();

        // Get correct option indices for this question
        const correctIndices = this.explanationTextService.getCorrectOptionIndices(question);

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
      this.explanationTextService.setExplanationText('');
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
        correct: option.correct ?? false,
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

      const question = this.questions[this.currentQuestionIndex];

      // Check for stored states after ensuring we have the questions
      const storedStates =
        this.quizStateService.getStoredState(this.quizId);

      if (storedStates) {
        // Logic to restore stored states to each question
        for (const [questionId, state] of storedStates.entries()) {
          this.quizStateService.setQuestionState(this.quizId, questionId, state);

          if (state.isAnswered && state.explanationDisplayed) {
            const explanationTextObservable =
              this.explanationTextService.getFormattedExplanation(+questionId);
            const explanationText: string = await firstValueFrom(
              explanationTextObservable
            );

            this.explanationTextService.storeFormattedExplanation(
              +questionId,
              explanationText,
              question
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
      },
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
      console.error(`❌ Invalid question index: ${this.questionIndex}`);
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
          },
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
        error: (err: Error) => {
          console.error('Subscription error:', err);
        },
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
      console.log(`[updateContentBasedOnIndex] 🔒 Locked + purged FET for 
        Q${adjustedIndex + 1}`);
    } catch (err: any) {
      console.warn(`[updateContentBasedOnIndex] ⚠️ purgeAndDefer failed`, err);
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
        `[updateContentBasedOnIndex] 🔄 Cleared option states for 
          Q${adjustedIndex + 1}`
      );
    } catch (err: any) {
      console.warn('[updateContentBasedOnIndex] ⚠️ State reset failed', err);
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
                  `[updateContentBasedOnIndex] 🚫 stale unlock skipped for 
                   Q${adjustedIndex + 1}`
                );
                return;
              }

              ets._fetLocked = false;
              console.log(
                `[updateContentBasedOnIndex] 🔓 FET gate unlocked cleanly for Q${adjustedIndex + 1}`
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
    } catch (err: any) {
      console.error('[updateContentBasedOnIndex] ❌ Failed to load question',
        err);
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
    this.explanationTextService.setExplanationText('', { force: true });
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
        console.error('[loadQuestionByRouteIndex] ❌ Quiz data is missing.');
        return;
      }

      if (!this.quiz?.questions) return;

      if (
        isNaN(routeIndex) ||
        routeIndex < 1 ||
        routeIndex > this.quiz.questions.length
      ) {
        console.warn('[loadQuestionByRouteIndex] ⚠️ Invalid route index:', routeIndex);
        void this.router.navigate(['/question/', this.quizId, 1]);
        return;
      }

      const questionIndex = routeIndex - 1;  // convert 1-based URL index to 0-based

      if (questionIndex < 0 || questionIndex >= this.quiz.questions.length) {
        console.error(
          '[loadQuestionByRouteIndex] ❌ Question index out of bounds:',
          questionIndex
        );
        return;
      }

      // Set the current index and badge (only now that it's confirmed valid)
      this.currentQuestionIndex = questionIndex;
      this.quizService.setCurrentQuestionIndex(questionIndex);

      this.timerService.resetTimer();
      this.timerService.startTimer();

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
        console.error(`[loadQuestionByRouteIndex] ❌ Failed to load 
          Q${questionIndex}`);
        return;
      }

      // Update component state with the correct shuffled question
      this.currentQuestion = question;

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
          '[loadQuestionByRouteIndex] ⚠️ No correct answers found for this question.',
        );
      }

      // Restore and apply feedback
      setTimeout(() => {
        this.restoreSelectedOptions();

        setTimeout(() => {
          if (!this.optionsToDisplay || this.optionsToDisplay.length === 0) {
            console.warn(
              '[loadQuestionByRouteIndex] ⚠️ optionsToDisplay empty, relying on loader pipeline.',
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
              '[loadQuestionByRouteIndex] ℹ️ No previously selected option. ' +
              'Skipping feedback replay.'
            );
          }
        }, 50);
      }, 150);

      try {
        const feedback =
          await (this.quizQuestionComponent?.generateFeedbackText(question) ?? '');

        this.feedbackText = feedback;

        console.log('[loadQuestionByRouteIndex] 🧠 Feedback Text:', feedback);
      } catch (error: any) {
        console.error('[loadQuestionByRouteIndex] ❌ Feedback generation ' +
          'failed:', error);

        this.feedbackText = 'Could not generate feedback. Please try again.';
      }
    } catch (error: any) {
      console.error('[loadQuestionByRouteIndex] ❌ Unexpected error:', error);

      this.feedbackText = 'Error loading question details.';
      this.cdRef.markForCheck();
    }

    // Check if new question content requires scroll indicator
    setTimeout(() => this.checkScrollIndicator(), 300);
  }

  // TODO: Keep this fallback type resolver for now.
  // Remove ONLY after:
  //   1) All quiz JSON has reliable `type` values,
  //   2) Multi-answer detection is handled upstream,
  //   3) No remaining logic depends on inferred question types.
  //   Currently still required by navigation, correct-answers hints,
  //   and explanation-text formatting.
  /* private resolveQuestionType(question: QuizQuestion): QuestionType {
  if (question?.type) return question.type;

  const correctCount = (question?.options ?? []).reduce(
    (count, option) => (option?.correct ? count + 1 : count),
    0
  );

  return correctCount > 1
    ? QuestionType.MultipleAnswer
    : QuestionType.SingleAnswer;
} */

  // keep, called in syncCorrectAnswersHint()
  /* private persistCurrentQuestionType(type: QuestionType): void {
  try {
    localStorage.setItem('currentQuestionType', type);
  } catch (error) {
    console.warn(
      '[QuizComponent] ⚠️ Unable to persist currentQuestionType to storage:',
      error
    );
  }
} */

  // keep, called in syncCorrectAnswersHint()
  /* private readStoredQuestionType(): QuestionType | null {
  try {
    const stored = localStorage.getItem('currentQuestionType');
    if (!stored) return null;

    if (stored === QuestionType.MultipleAnswer) {
      return QuestionType.MultipleAnswer;
    }

    if (stored === QuestionType.SingleAnswer) {
      return QuestionType.SingleAnswer;
    }

    if (stored === QuestionType.TrueFalse) {
      return QuestionType.TrueFalse;
    }

    return null;
  } catch (error) {
    console.warn(
      '[QuizComponent] ⚠️ Unable to read currentQuestionType from storage:',
      error
    );
    return null;
  }
} */

  private restoreSelectedOptions(): void {
    const selectedOptionsData = sessionStorage.getItem(`selectedOptions`);
    if (!selectedOptionsData) return;

    try {
      const selectedOptions = JSON.parse(selectedOptionsData);
      if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
        console.warn('[restoreSelectedOptions] ❌ No valid selected options to restore.');
        return;
      }

      for (const option of selectedOptions) {
        const restoredOption = this.optionsToDisplay.find(
          opt => opt.optionId === option.optionId
        );

        if (restoredOption) {
          restoredOption.selected = true;  // set option as selected
          console.log(
            '[restoreSelectedOptions] ✅ Restored option as selected:',
            restoredOption
          );
        } else {
          console.warn(
            '[restoreSelectedOptions] ❌ Option not found in optionsToDisplay:',
            option
          );
        }
      }
    } catch (error: any) {
      console.error('[restoreSelectedOptions] ❌ Error parsing selected options:', error);
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
  /* End of functions responsible for handling navigation to a particular question
  using the URL. */

  refreshQuestionOnReset(): void {
    const firstQuestion = this.quizService.getQuestionByIndex(0);
    if (!firstQuestion) {
      console.error('[refreshQuestionOnReset] ❌ No question found at index 0.');
      return;
    }

    // Update the current question
    firstValueFrom(firstQuestion)
      .then((question: QuizQuestion | null) => {
        if (question) {
          this.quizService.setCurrentQuestion(question);
          this.loadCurrentQuestion();
        } else {
          console.error('[refreshQuestionOnReset] ❌ Failed to fetch question at ' +
            'index 0.');
        }
      })
      .catch((error: Error) => {
        console.error('[refreshQuestionOnReset] ❌ Error fetching first ' +
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
        error: (err: Error) => {
          console.error('Error subscribing to currentOptions$:', err);
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
            console.error('[Route Init] ❌ No quizId found in URL.');
            return EMPTY;
          }
          this.quizId = quizId;

          return this.handleRouteParams(params).pipe(
            switchMap(({ quizData }: any) => {
              if (!quizData || !Array.isArray(quizData.questions)) {
                console.error('[Route Init] ❌ Invalid quiz data or missing ' +
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
              console.error('[Route Init] ❌ Error during quiz initialization:', error);
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe({
        next: async (question) => {
          if (!question) {
            console.error('[Route Init] ❌ No question returned.');
            return;
          }

          this.currentQuiz = this.quizService.getActiveQuiz();

          await this.resetAndLoadQuestion(this.currentQuestionIndex);
        },
        complete: () => {
          console.log('[Route Init] 🟢 Initialization complete.');
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
          } catch (err) {
            console.warn('[INIT] ⚠️ FET clear failed', err);
          }

          // Skip ensureExplanationsLoaded - applyQuestionsFromSession already
          // generates FET Calling both causes overwrites with different option
          // orders for single-answer Qs
          console.log(
            '[INIT] ⚡ Skipping ensureExplanationsLoaded ' +
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
              console.log('[QUIZ INIT] 🪄 Seeded initial question text for Q1');

              // Unlock gate only AFTER first text is stable
              setTimeout(() => {
                this.explanationTextService._fetLocked = false;
                console.log('[INIT] 🔓 FET gate opened after first-question ' +
                  'seed');
              }, 80);
            }
          }

          // Delay reopening FET gates slightly so preload emissions don't leak
          this.explanationTextService.setShouldDisplayExplanation(false);
          this.explanationTextService.setIsExplanationTextDisplayed(false);
        } catch (err: any) {
          console.warn('[QUIZ INIT] ⚠️ Could not seed initial question text', err);
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
                  .pipe(take(1)),
              );

              if (question) {
                console.log('Current question:', question);
              } else {
                console.warn(
                  'No question found at index',
                  this.currentQuestionIndex,
                );
              }
            } catch (err: any) {
              console.error('Error fetching question:', err);
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
            } catch (err: any) {
              console.error('Error fetching options:', err);
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
          console.error('[❌ Error in createQuestionData]', error);
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
        `Quiz data is invalid or not loaded for Quiz ID ${this.quizId}`,
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
        console.log('[🧪 selectedQuiz.questions]', this.selectedQuiz.questions);

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
            `Current question is undefined: Quiz ID ${this.quizId}, Question Index ${this.currentQuestionIndex}`,
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

    /**
     * 🛑 CRITICAL GUARD:
     * If the user has NOT interacted with this question, DO NOT touch the 
     * explanation streams at all. This prevents Q1 from inheriting stale text from QN.
     */
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
          this.explanationTextService.setExplanationText(this.explanationToDisplay);
        } else {
          console.warn(`[⚠️ Explanation is empty for Q${questionIndex}]`);
          this.explanationToDisplay = 'No explanation available';
          this.explanationTextService.setExplanationText(this.explanationToDisplay);
        }
      } else {
        console.warn(
          `[⚠️ Skipping explanation fetch — invalid index or explanations not ready] index: ${questionIndex}`
        );
        this.explanationToDisplay = 'No explanation available';
        this.explanationTextService.setExplanationText(
          this.explanationToDisplay
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
        this.explanationTextService.setExplanationText('');
        this.explanationTextService.setShouldDisplayExplanation(false);
      } else {
        console.warn('[🛡️ Explanation reset blocked due to active lock]');
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
      }),
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
    void this.quizService.checkIfAnsweredCorrectly(this.currentQuestionIndex);

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
    if (this.navigatingToResults) {
      console.warn('Navigation to results already in progress.');
      return;
    }

    this.navigatingToResults = true;  // prevent multiple clicks

    // Reset quiz state
    this.quizService.resetAll();

    // Stop the timer and record elapsed time
    if (this.timerService.isTimerRunning) {
      this.timerService.stopTimer(
        (elapsedTime: number) => {
          this.elapsedTimeDisplay = elapsedTime;
          console.log('Elapsed time recorded for results:', elapsedTime);
        },
        { force: true }
      );
    } else {
      console.log('Timer was not running, skipping stopTimer.');
    }

    // Check if all answers were completed before navigating
    if (!this.quizService.quizCompleted) {
      this.quizService.checkIfAnsweredCorrectly(this.currentQuestionIndex)
        .then(() => {
          console.log('All answers checked, navigating to results...');
          this.handleQuizCompletion();
          this.quizNavigationService.navigateToResults();
        })
        .catch((error: Error) => {
          console.error('Error during checkIfAnsweredCorrectly:', error);
        })
        .finally(() => {
          this.navigatingToResults = false;  // allow navigation again after the process
        });
    } else {
      console.warn('Quiz already marked as completed.');
      this.navigatingToResults = false;
    }
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
        console.warn(`[❌ Invalid index: Q${questionIndex}]`);
        return false;
      }
      if (questionIndex === this.totalQuestions - 1) {
        console.log(`[🔚 Last Question] Q${questionIndex}`);
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
              console.log(`[fetchAndSetQuestionData] ♻️ Restoring stored 
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
          } catch (err: any) {
            console.error('Error restoring selections:', err);
          }
        }
      }

      // Parallel Fetch
      const isAnswered = this.selectedOptionService.isQuestionAnswered(questionIndex);

      // Only set false if it's actually unanswered
      if (isAnswered) {
        this.quizStateService.setAnswered(true);
        this.selectedOptionService.setAnswered(true, true);
      }

      this.quizStateService.setDisplayState({
        mode: isAnswered ? 'explanation' : 'question',
        answered: isAnswered
      });

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
        console.error(`[❌ Q${questionIndex}] Missing question or options`);
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
          console.log('[⏳ Pending options queued until component ready]');
        });
      }

      // Flip “options loaded” flags together
      this.hasOptionsLoaded = true;
      this.shouldRenderOptions = true;

      // Explanation/Timer/Badge Logic
      let explanationText = '';

      if (isAnswered) {
        // Already answered: restore explanation state and stop timer
        explanationText =
          fetchedQuestion.explanation?.trim() || 'No explanation available';
        this.explanationTextService.setExplanationTextForQuestionIndex(
          questionIndex,
          explanationText
        );
        this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
        this.timerService.isTimerRunning = false;
      } else {
        // Not answered yet: force baseline selection message exactly once
        this.selectionMessageService.forceBaseline(questionIndex);
        await this.selectionMessageService.setSelectionMessage(false);
        this.timerService.startTimer(this.timerService.timePerQuestion);
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

      await this.quizService.checkIfAnsweredCorrectly(questionIndex);

      // Mark question ready
      this.resetComplete = true;

      return true;
    } catch (error: any) {
      console.error(`[❌ fetchAndSetQuestionData] Error at Q${questionIndex}:`,
        error);
      return false;
    }
  }

  private async fetchQuestionDetails(questionIndex: number): Promise<QuizQuestion | null> {
    try {
      const resolvedQuestion: QuizQuestion | null = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );

      if (!resolvedQuestion || !resolvedQuestion.questionText?.trim()) {
        console.error(`[❌ Q${questionIndex}] Missing or invalid question payload`);
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
        console.error(`[❌ Q${questionIndex}] No valid options`);
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
        console.warn(`[⚠️ Q${questionIndex}] Explanations not initialized`);
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
      console.error(`[❌ fetchQuestionDetails] Error loading Q${questionIndex}:`, error);
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
      console.warn('[setQuestionDetails] ⚠️ Explanation fallback triggered');
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
      console.error(`[❌ Q${index}] Incomplete data`, {
        fetched,
        question: this.question
      });
      return false;
    }
    return true;
  }

  private isValidIndex(index: number): boolean {
    const valid = index >= 0 && index < this.totalQuestions;
    if (!valid) console.warn(`[❌ Invalid index]: ${index}`);
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
      console.warn('[⚠️ Badge update skipped] Invalid index or totalQuestions');
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

    console.log('[🔄 Reinjection] Dynamic container was empty – reinjecting');
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
    // Reset score immediately before clearing state to prevent decrements
    this.quizService.resetScore();

    // Clear stale localStorage data on restart to prevent question/option mismatches
    try {
      localStorage.removeItem('shuffledQuestions');
      localStorage.removeItem('selectedOptions');
      localStorage.removeItem('correctAnswersCount');
      console.log('[RESTART] Cleared stale localStorage data.');
    } catch (error: any) {
      console.warn('[RESTART] Failed to clear localStorage:', error);
    }

    // Clear the dot status cache for fresh pagination
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

    // EXISTING RESET LOGIC (unchanged below)
    // Clear selection/answer maps
    this.selectedOptionService.clearSelectedOption();
    this.selectedOptionService.clearSelection();
    this.selectedOptionService.deselectOption();
    this.selectedOptionService.resetSelectionState();
    this.selectedOptionService.selectedOptionsMap.clear();

    this.selectedOptionService.setAnswered(false);
    this.quizStateService.setAnswerSelected(false);

    // Reset explanation to hidden + question mode
    this.explanationTextService.resetExplanationText();
    this.explanationTextService.unlockExplanation();
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.quizStateService.setDisplayState({ mode: 'question', answered: false });

    // Next starts disabled
    this.nextButtonStateService.setNextButtonState(false);

    // Clear child-local state
    this.quizQuestionComponent?.selectedIndices?.clear();

    // Reset sounds/timer
    this.soundService.reset();
    this.timerService.stopTimer?.(undefined, { force: true });

    // Reset progress bar to 0%
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
            this.timerService.startTimer(this.timerService.timePerQuestion);
          });
        });

        // Regenerate option bindings
        queueMicrotask(() => {
          this.sharedOptionComponent?.generateOptionBindings();
          this.cdRef.detectChanges();
        });
      })
      .catch((error: Error) =>
        console.error('❌ Navigation error on restart:', error)
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
      console.warn(`[⚠️] No question found for index ${qIdx}`);
      this.explanationToDisplay = '<span class="muted">No explanation available</span>';
      this.explanationTextService.setExplanationText(this.explanationToDisplay);
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
    this.explanationTextService.setExplanationText(formatted);
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
  }

  // Compute and emit the "# of correct answers" banner text for a given question index.
  private emitCorrectAnswersBanner(index: number): void {
    const fresh = this.quizService.questions?.[index];
    if (!fresh || !Array.isArray(fresh.options)) {
      console.warn('[emitCorrectAnswersBanner] ❌ No question/options yet at ' +
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
    console.log('[emitCorrectAnswersBanner] ✅ isMulti set to', isMulti);

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

  onExplanationChanged(explanation: string): void {
    console.log('[QC] onExplanationChanged called with:', explanation);
    this.explanationToDisplay = explanation;
    this.explanationTextService.setExplanationText(explanation);
    this.explanationTextService.setShouldDisplayExplanation(true);
  }

  onShowExplanationChanged(shouldShow: boolean): void {
    if (shouldShow) {
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    }
  }

  updateProgressValue(): void {
    const answeredCount = this.calculateAnsweredCount();
    const total =
      this.totalQuestions > 0 ?
        this.totalQuestions : (this.quiz?.questions?.length || 0);
    this.progress = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  }

  // Calculate percentage based on ANSWERED questions
  calculateAnsweredCount(): number {
    let count = 0;
    const total = this.totalQuestions || 0;
    for (let i = 0; i < total; i++) {
      const status = this.getQuestionStatus(i);
      // Count as answered if it's correct OR wrong (anything but pending)
      if (status === 'correct' || status === 'wrong') {
        count++;
      }
    }
    return count;
  }

  // Helper to determine dot class with caching
  getQuestionStatus(index: number): string {
    // Check Cache First - if already determined the status, use it
    if (this.dotStatusCache.has(index)) {
      const cached = this.dotStatusCache.get(index)!;
      console.log(`[DOT] Q${index} → ${cached.toUpperCase()} (from cache)`);
      return cached;
    }

    // Try to compute from current selections
    const selected = this.selectedOptionService.selectedOptionsMap.get(index);

    if (!selected || selected.length === 0) {
      console.log(`[DOT] Q${index} → PENDING (no selections, no cache)`);
      return 'pending';
    }

    const displayQuestion = this.questionsArray[index] ||
      this.quizService.questions[index];

    // Fallback Context Logic
    const normalize =
      (str: string) =>
        (str || '').replace(/\s/g, '').toLowerCase();
    let questionContext = displayQuestion;

    if (!questionContext || !questionContext.options || !questionContext.options.some(o => o.correct)) {
      const allQuestions =
        (this.quizService.quizData || []).flatMap(q => q.questions || []);
      const found =
        allQuestions.find(
          q => normalize(
            q.questionText) === normalize(displayQuestion?.questionText)
        );
      if (found) questionContext = found;
    }

    // Evaluate Correctness
    if (questionContext && questionContext.options) {
      const correctOptions = questionContext.options.filter((o: Option) =>
        o.correct);
      const correctIds = new Set(correctOptions.map((o: Option) => o.optionId));
      const correctTexts = new Set(correctOptions.map((o: Option) =>
        normalize(o.text)));
      const isMultiAnswer = correctOptions.length > 1;

      // Check if any wrong answer was selected
      const hasWrongSelection = selected.some((sel: any) => {
        const isCorrect = correctIds.has(sel.optionId) ||
          correctTexts.has(normalize(sel.text)) ||
          sel.correct === true;
        return !isCorrect;
      });

      if (hasWrongSelection) {
        this.dotStatusCache.set(index, 'wrong');
        console.log(`[DOT] Q${index} → WRONG (wrong answer selected)`);
        return 'wrong';
      }

      // For multi-answer: check if ALL correct answers are selected
      if (isMultiAnswer) {
        const selectedIds = new Set(selected.map((s: any) => s.optionId));
        const selectedTexts = new Set(selected.map((s: any) => normalize(s.text)));

        const allCorrectSelected = correctOptions.every((opt: Option) =>
          selectedIds.has(opt.optionId) || selectedTexts.has(normalize(opt.text))
        );

        if (allCorrectSelected) {
          this.dotStatusCache.set(index, 'correct');
          console.log(`[DOT] Q${index} → CORRECT (all ${correctOptions.length} 
            correct answers selected)`);
          return 'correct';
        } else {
          // Multi-answer but not all selected yet - don't cache, return pending
          console.log(`[DOT] Q${index} → PENDING (multi-answer: 
            ${selected.length}/${correctOptions.length} selected)`);
          return 'pending';
        }
      }

      // Single answer question - just check the last selection
      const last = selected[selected.length - 1];
      const isLastCorrect = correctIds.has(last.optionId) ||
        correctTexts.has(normalize(last.text)) || last.correct === true;
      const result = isLastCorrect ? 'correct' : 'wrong';
      this.dotStatusCache.set(index, result);
      return result;
    }

    // Default fallback
    const last = selected[selected.length - 1];
    const result: 'correct' | 'wrong' = last.correct ? 'correct' : 'wrong';
    this.dotStatusCache.set(index, result);
    return result;
  }

  // Call this when user selects an answer to update the cache
  updateDotStatus(index: number): void {
    // Force re-evaluation by temporarily removing from cache
    this.dotStatusCache.delete(index);
    // Now call getQuestionStatus which will re-compute and cache
    this.getQuestionStatus(index);
    this.cdRef.detectChanges();
  }

  getDotClass(index: number): string {
    const status = this.getQuestionStatus(index);
    return (index === this.currentQuestionIndex) ? `${status} current` : status;
  }

  navigateToDot(index: number): void {
    // Only allow navigation to questions that have been answered (or current question)
    if (!this.isDotClickable(index)) {
      console.log(`[DOT NAV] ⛔ Blocked navigation to Q${index + 1} - question not yet answered`);
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
}