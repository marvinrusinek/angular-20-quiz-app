import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, OnInit, Output, Renderer2, SimpleChanges, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import {
  BehaviorSubject, combineLatest, firstValueFrom,
  forkJoin, Observable, of, Subject, Subscription
} from 'rxjs';
import {
  catchError, debounceTime, distinctUntilChanged, filter, map,
  shareReplay, startWith, switchMap, take, takeUntil,
  tap, withLatestFrom
} from 'rxjs/operators';

import { CombinedQuestionDataType } from
  '../../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../../shared/models/Option.model';
import { QuestionType } from '../../../shared/models/question-type.enum';
import { QuestionPayload } from '../../../shared/models/QuestionPayload.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizService } from '../../../shared/services/data/quiz.service';
import { QuizDataService } from '../../../shared/services/data/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/flow/quiz-navigation.service';
import { QuizQuestionLoaderService } from
  '../../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/flow/quizquestionmgr.service';
import { QuizStateService } from '../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { ExplanationTextService, FETPayload } from
  '../../../shared/services/features/explanation-text.service';
import { QuizQuestionComponent } from
  '../../../components/question/quiz-question/quiz-question.component';
import { TimerService } from '../../../shared/services/features/timer.service';
import { QuizContentDisplayService } from '../../../shared/services/features/quiz-content-display.service';

@Component({
  selector: 'codelab-quiz-content',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './codelab-quiz-content.component.html',
  styleUrls: ['./codelab-quiz-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CodelabQuizContentComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild(QuizQuestionComponent, { static: false })
  quizQuestionComponent!: QuizQuestionComponent;
  @ViewChild('qText', { static: true })
  qText!: ElementRef<HTMLHeadingElement>;

  @Output() isContentAvailableChange = new EventEmitter<boolean>();

  @Input() combinedQuestionData$: Observable<CombinedQuestionDataType> | null =
    null;
  @Input() currentQuestion = new BehaviorSubject<QuizQuestion | null>(null);
  @Input() questionToDisplay = '';
  @Input() questionToDisplay$!: Observable<string | null>;
  @Input() explanationToDisplay: string | null = null;
  @Input() question!: QuizQuestion;
  @Input() question$!: Observable<QuizQuestion | null>;
  @Input() questions!: QuizQuestion[];
  @Input() options!: Option[];
  @Input() quizId = '';
  @Input() correctAnswersText = '';
  @Input() questionText = '';
  @Input() quizData: CombinedQuestionDataType | null = null;
  @Input() displayState$!: Observable<{
    mode: 'question' | 'explanation',
    answered: boolean
  }>;
  @Input() displayVariables!: { question: string; explanation: string };
  @Input() localExplanationText = '';
  @Input() showLocalExplanation = false;

  @Input() set explanationOverride(o: { idx: number; html: string }) {
    this.overrideSubject.next(o);
  }

  @Input() set questionIndex(idx: number) {
    this.currentIndex = idx;

    // Reset FET lock when question changes
    this._fetLocked = false;
    this._lockedForIndex = -1;

    // Reset timed-out state so stale expiry from a previous session
    // doesn't cause FET to display on a fresh visit to this question
    this.timedOutIdxSubject.next(-1);

    // Force clear view BEFORE pushing new index to the subject.
    // The subject push triggers the displayText$ pipeline synchronously (of() and
    // startWith() emit synchronously). If we clear AFTER the push, we wipe the
    // question text that the pipeline just rendered — causing blank Q2+ text.
    if (this.qText?.nativeElement) {
      this.renderer.setProperty(this.qText.nativeElement, 'innerHTML', '');
    }

    this.overrideSubject.next({ idx, html: '' });

    // Push new index AFTER clearing — pipeline emits synchronously and sets innerHTML
    this.questionIndexSubject.next(idx);
    this.clearCachedQuestionArtifacts(idx);

    // Hard-align the ExplanationTextService with the active index so the
    // formatted explanation text stream starts from a clean slate and does not
    // replay the previous question's FET (e.g., Q1 on Q4's first click).
    const ets = this.explanationTextService;
    ets._activeIndex = idx;

    // Check if ANY option in this question has been selected
    // This is the most reliable check - options are the source of truth
    const isShuffled = this.quizService.isShuffleEnabled() && Array.isArray(this.quizService.shuffledQuestions) && this.quizService.shuffledQuestions.length > 0;
    const currentQuestion = isShuffled
      ? this.quizService.shuffledQuestions[idx]
      : this.quizService.questions[idx];

    const hasSelectedOption =
      currentQuestion?.options?.some((o: Option) => o.selected) ?? false;

    // Verify against both selection stores because QuizService.selectedOptionsMap
    // can briefly lag behind SelectedOptionService during navigation.
    // If we require both stores to agree, valid answered states (often Q3+) can be
    // misclassified as unanswered and their FET cache gets wiped.
    const quizServiceHasSelections =
      this.quizService.selectedOptionsMap?.has(idx) ?? false;
    const selectedOptionServiceHasSelections =
      (this.selectedOptionService.selectedOptionsMap?.get(idx)?.length ?? 0) > 0;
    const hasTrackedInteraction = this.quizStateService.hasUserInteracted(idx);
    const hasAnswerEvidence =
      hasSelectedOption ||
      quizServiceHasSelections ||
      selectedOptionServiceHasSelections ||
      hasTrackedInteraction;

    // AUTHORITATIVE MODE RESET: Determine if the question is truly resolved (all correct, none wrong).
    // This prevents explanation mode from leaking from a previous question (like Q3) to the current one (Q4).
    const selectedForIdx = (this.selectedOptionService.selectedOptionsMap?.get(idx) ?? []) as Option[];
    const isActuallyResolved = currentQuestion && this.selectedOptionService.isQuestionResolvedCorrectly(currentQuestion, selectedForIdx);

    if (isActuallyResolved && !this.isNavigatingToPrevious) {
      console.log(`[CQCC] Q${idx + 1} is already perfectly resolved. Showing explanation mode.`);
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    } else {
      console.log(`[CQCC] Q${idx + 1} is ${this.isNavigatingToPrevious ? 'navigating back' : 'not resolved'}. Forcing question mode.`);
      this.quizStateService.setDisplayState({ mode: 'question', answered: false });

      if (!hasAnswerEvidence) {
        // No valid FET for this question = it wasn't answered, clear everything
        ets.resetForIndex(idx);
        ets.latestExplanation = '';
        ets.latestExplanationIndex = idx;
        ets.formattedExplanationSubject.next('');
        ets.explanationText$.next('');
        
        // Clear _fetSubject replay buffer
        try {
          (ets as any)._fetSubject?.next({ idx: -1, text: '', token: 0 });
        } catch { }

        // Clear any cached FET for this index
        try {
          ets.fetByIndex?.delete(idx);
        } catch { }
        try {
          delete (ets.formattedExplanations as any)[idx];
        } catch { }

        this._lastQuestionTextByIndex?.delete(idx);
        this.quizService.selectedOptionsMap?.delete(idx);
        this.selectedOptionService.selectedOptionsMap?.delete(idx); // Clear both stores
        this._fetDisplayedThisSession?.delete(idx);
        ets.setShouldDisplayExplanation(false, { force: true });
        ets.setIsExplanationTextDisplayed(false, { force: true });
      }
    }

    // Reset local view flags (component-level)
    this.resetExplanationView();
    if (this._showExplanation) this._showExplanation = false;

    this.cdRef.markForCheck();
  }

  @Input() set showExplanation(value: boolean) {
    this._showExplanation = value;
    this.cdRef.markForCheck();
  }

  private combinedTextSubject = new BehaviorSubject<string>('');
  combinedText$ = this.combinedTextSubject.asObservable();

  private shouldDisplayCorrectAnswersSubject: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);
  shouldDisplayCorrectAnswers$ =
    this.shouldDisplayCorrectAnswersSubject.asObservable();

  currentQuestionIndexValue = 0;
  currentQuestion$: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);
  currentOptions$: BehaviorSubject<Option[] | null> =
    new BehaviorSubject<Option[] | null>([]);
  currentQuestionIndex$!: Observable<number>;
  nextQuestion$: Observable<QuizQuestion | null>;
  previousQuestion$: Observable<QuizQuestion | null>;
  isNavigatingToPrevious = false;

  private get _lastQuestionTextByIndex(): Map<number, string> {
    return this.displayService._lastQuestionTextByIndex;
  }

  private get _fetDisplayedThisSession(): Set<number> {
    return this.displayService._fetDisplayedThisSession;
  }

  private overrideSubject =
    new BehaviorSubject<{ idx: number; html: string }>({ idx: -1, html: '' });
  private currentIndex = -1;
  private questionIndexSubject = new BehaviorSubject<number>(0);
  currentIndex$ = this.questionIndexSubject.asObservable();
  private readonly questionLoadingText = 'Loading question…';
  private lastQuestionIndexForReset: number | null = null;

  explanationTextLocal = '';
  isExplanationDisplayed = false;
  explanationVisible = false;
  isExplanationTextDisplayed$: Observable<boolean>;
  private isExplanationDisplayed$ = new BehaviorSubject<boolean>(false);
  private _showExplanation = false;

  private get _fetLocked(): boolean { return this.displayService._fetLocked; }
  private set _fetLocked(v: boolean) { this.displayService._fetLocked = v; }
  private get _lockedForIndex(): number { return this.displayService._lockedForIndex; }
  private set _lockedForIndex(v: number) { this.displayService._lockedForIndex = v; }

  formattedExplanation$!: Observable<FETPayload>;
  public activeFetText$!: Observable<string>;
  get displayText$(): Observable<string> { return this.displayService.displayText$; }
  set displayText$(v: Observable<string>) { this.displayService.displayText$ = v; }

  numberOfCorrectAnswers$: BehaviorSubject<string> =
    new BehaviorSubject<string>('0');

  correctAnswersTextSource: BehaviorSubject<string> =
    new BehaviorSubject<string>('');
  correctAnswersText$ = this.correctAnswersTextSource.asObservable();

  public displayCorrectAnswersText$!: Observable<string | null>;

  explanationText: string | null = null;
  explanationTexts: string[] = [];

  private correctAnswersDisplaySubject = new Subject<boolean>();

  questionRendered: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);

  isContentAvailable$!: Observable<boolean>;

  private combinedSub?: Subscription;

  private navTime = 0;  // track when we landed on this question

  get shouldShowFet$(): Observable<boolean> { return this.displayService.shouldShowFet$; }
  set shouldShowFet$(v: Observable<boolean>) { this.displayService.shouldShowFet$ = v; }
  get fetToDisplay$(): Observable<string> { return this.displayService.fetToDisplay$; }
  set fetToDisplay$(v: Observable<string>) { this.displayService.fetToDisplay$ = v; }

  private timedOutForIdx = new Set<number>();
  private timedOutIdxSubject = new BehaviorSubject<number>(-1);
  public timedOutIdx$ = this.timedOutIdxSubject.asObservable();

  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizNavigationService: QuizNavigationService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private activatedRoute: ActivatedRoute,
    private cdRef: ChangeDetectorRef,
    private renderer: Renderer2,
    private displayService: QuizContentDisplayService
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;
    this.previousQuestion$ = this.quizService.previousQuestion$;
    this.displayState$ = this.quizStateService.displayState$;

    this.formattedExplanation$ = this.displayService.createFormattedExplanation$(this.currentIndex$);
    this.activeFetText$ = this.displayService.createActiveFetText$(this.currentIndex$);

    this.quizNavigationService
      .getIsNavigatingToPrevious()
      .subscribe((isNavigating: boolean) => {
        this.isNavigatingToPrevious = isNavigating;
      });

    this.isExplanationTextDisplayed$ =
      this.explanationTextService.isExplanationTextDisplayed$;
  }

  async ngOnInit(): Promise<void> {
    this.resetInitialState();

    // Clear user interaction state to ensure question text shows first
    this.quizStateService._hasUserInteracted?.clear();
    this.quizStateService.resetInteraction();  // clear stream too

    this.setupQuestionResetSubscription();
    this.resetExplanationService();

    this.setupShouldShowFet();
    this.setupFetToDisplay();

    this.initDisplayTextPipeline();
    this.subscribeToDisplayText();
    this.setupContentAvailability();

    this.emitContentAvailableState();
    this.loadQuizDataFromRoute();
    await this.initializeComponent();
    this.setupCorrectAnswersTextDisplay();


    // Subscribe to questions$ to REGENERATE FETs when questions/shuffling changes
    // This ensures that "Option 1 is correct" matches the ACTUAL visual order of options
    // if they have been shuffled.
    this.quizService.questions$
      .pipe(
        takeUntil(this.destroy$),
        filter(qs => Array.isArray(qs) && qs.length > 0)
      )
      .subscribe((questions) => {
        console.log('[CQCC] ♻️ Questions updated - FET will be generated on-demand when user clicks');

      });

    this.timerService.expired$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Use local currentIndex for stability, as QuizService may briefly reset to 0 during nav
        const idx = this.currentIndex >= 0 ? this.currentIndex : (this.quizService.getCurrentQuestionIndex?.() ?? this.currentQuestionIndexValue ?? 0);

        console.warn(`[CQCC] ⏰ Timer expired for Q${idx + 1} → allow FET display`);
        this.timedOutIdxSubject.next(idx);

        // Safety: ensure we have a formatted explanation for this idx
        const isShuffled = this.quizService.isShuffleEnabled?.() && Array.isArray((this.quizService as any).shuffledQuestions) && (this.quizService as any).shuffledQuestions.length > 0;
        let q = isShuffled
          ? (this.quizService as any).shuffledQuestions[idx]
          : (this.quizService as any).questions?.[idx];
        
        q = q ?? ((this.quizService as any)?.currentQuestion?.value ?? null);

        if (q?.explanation) {
          // Pass the actual component visual options to ensure correct option index generation
          const visualOpts = this.quizQuestionComponent?.optionsToDisplay ?? q.options;
          this.explanationTextService.storeFormattedExplanation(idx, q.explanation, q, visualOpts);
        }

        // OnPush safety
        this.cdRef.markForCheck();
      });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['explanationOverride']) {
      this.overrideSubject.next(this.explanationOverride);
      this.cdRef.markForCheck();
    }

    // NOTE: Removed explanationToDisplay handler as it was unreliable
    // The parent component doesn't reset this value when navigating, causing stale FET display
    // FET should only be updated through the formattedExplanation$ stream which has index validation

    // Run only when the new questionText arrives
    if (!!this.questionText && !this.questionRendered.getValue()) {
      this.questionRendered.next(true);
    }

    if (changes['questionIndex'] && !changes['questionIndex'].firstChange) {
      this.navTime = Date.now();  // capture navigation time baseline
      // Reset FET lock when question changes to allow question text to display
      this._fetLocked = false;
      this._lockedForIndex = -1;

      // Clear out old explanation
      this.currentIndex = this.questionIndex;
      this.overrideSubject.next({ idx: this.currentIndex, html: '' });
      this.resetExplanationView();
      this.explanationText = '';
      this.explanationTextLocal = '';
      this.explanationVisible = false;
      this.cdRef.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.correctAnswersTextSource.complete();
    this.correctAnswersDisplaySubject.complete();
    this.combinedTextSubject.complete();
    this.combinedSub?.unsubscribe();
  }

  private resetInitialState(): void {
    this.isExplanationDisplayed = false;
    this.explanationTextService.setIsExplanationTextDisplayed(false);
  }

  private setupQuestionResetSubscription(): void {
    if (this.questionToDisplay$) {
      combineLatest([
        this.questionToDisplay$.pipe(startWith(''), distinctUntilChanged()),
        this.quizService.currentQuestionIndex$.pipe(
          startWith(this.quizService?.currentQuestionIndex ?? 0)
        )
      ])
        .pipe(takeUntil(this.destroy$))
        .subscribe(([_, index]: [string | null, number]) => {
          if (this.lastQuestionIndexForReset !== index) {
            this.explanationTextService.setShouldDisplayExplanation(false);
            this.lastQuestionIndexForReset = index;

            this.quizService.isAnswered(index).pipe(take(1))
              .subscribe((isAnswered: boolean) => {
                if (!isAnswered) {
                  this.quizStateService.setDisplayState(
                    { mode: 'question', answered: false }
                  );
                  this.explanationTextService.setIsExplanationTextDisplayed(
                    false, { force: true }
                  );
                }
              });
          }
        });
    }
  }

  private initDisplayTextPipeline(): void {
    this.displayService.initDisplayTextPipeline(
      this.currentIndex$,
      this.timedOutIdx$,
      this.displayState$
    );
  }

  private resetExplanationService(): void {
    this.resetExplanationView();

    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.explanationText$.next('');

    this.explanationTextService.resetForIndex(0);
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });
  }

  private subscribeToDisplayText(): void {
    this.combinedText$ = this.displayText$;

    if (this.combinedSub) {
      this.combinedSub.unsubscribe();
    }

    console.log('[subscribeToDisplayText] 🔄 Setting up subscription...');

    this.combinedSub = this.combinedText$
      .pipe(
        tap((text: string) => console.log(`[subscribeToDisplayText] 🔔 RAW emission (${text?.length || 0} chars): "${text?.substring(0, 50)}..."`)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (text: string) => {
          console.log(`[subscribeToDisplayText] 📝 Processing text (${text?.length || 0} chars)`);

          // Ensure explanation text always has "Option X is correct because" prefix.
          // The displayText$ pipeline may emit raw explanation text if reactive
          // streams lose the formatted FET due to timing/reset issues.
          // GUARD: Only intercept if text is NOT the question text itself.
          let finalText = text;
          const lowerText = (text ?? '').toLowerCase();
          const currentQ = this.quizService.getQuestionsInDisplayOrder()?.[this.currentIndex];
          const qTextRaw = (currentQ?.questionText ?? '').trim();
          const isQuestionText = qTextRaw.length > 0 && (text ?? '').trim().startsWith(qTextRaw);
          const isExplanation = lowerText.length > 0
            && !isQuestionText
            && !lowerText.includes('correct because')
            && this.explanationTextService.latestExplanationIndex === this.currentIndex
            && this.explanationTextService.latestExplanationIndex >= 0;
          if (isExplanation) {
            const idx = this.currentIndex;
            // Check caches first
            const cached = (this.explanationTextService.formattedExplanations[idx]?.explanation ?? '').trim()
              || ((this.explanationTextService as any).fetByIndex?.get(idx) ?? '').trim();
            if (cached && cached.toLowerCase().includes('correct because')) {
              finalText = cached;
              console.log(`[subscribeToDisplayText] 🔧 Replaced raw with CACHED FET for Q${idx + 1}`);
            } else {
              // Try on-the-fly formatting
              try {
                const questions = this.quizService.getQuestionsInDisplayOrder();
                const q = questions?.[idx];
                if (q?.options?.length > 0 && q.explanation) {
                  const correctIndices = this.explanationTextService.getCorrectOptionIndices(q, q.options, idx);
                  if (correctIndices.length > 0) {
                    finalText = this.explanationTextService.formatExplanation(q, correctIndices, q.explanation);
                    console.log(`[subscribeToDisplayText] 🔧 On-the-fly FET for Q${idx + 1}: "${finalText.slice(0, 50)}"`);
                  }
                }
              } catch (e) {
                console.warn('[subscribeToDisplayText] On-the-fly FET failed', e);
              }
            }
          }

          const el = this.qText?.nativeElement;
          if (el) {
            this.renderer.setProperty(el, 'innerHTML', finalText);
            console.log(`[subscribeToDisplayText] ✅ Updated innerHTML using Renderer2: "${finalText?.substring(0, 50)}..."`);
          } else {
            console.warn(`[subscribeToDisplayText] ⚠️ qText.nativeElement not available!`);
          }
        },
        error: (err: Error) => console.error('[subscribeToDisplayText] ❌ Error:', err),
        complete: () => console.log('[subscribeToDisplayText] 🏁 Subscription completed')
      });

    console.log('[subscribeToDisplayText] ✅ Subscription active');
  }

  private setupContentAvailability(): void {
    this.isContentAvailable$ = this.combineCurrentQuestionAndOptions().pipe(
      map(({ currentQuestion, currentOptions }:
        { currentQuestion: QuizQuestion | null; currentOptions: Option[] }) => {
        return !!currentQuestion && currentOptions.length > 0;
      }),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in isContentAvailable$:', error);
        return of(false);
      }),
      startWith(false)
    );

    this.isContentAvailable$
      .pipe(distinctUntilChanged())
      .subscribe((isAvailable: boolean) => {
        if (isAvailable) {
          console.log('Content is available. Setting up state subscription.');
        } else {
          console.log('Content is not yet available.');
        }
      });
  }

  private resetExplanationView(): void {
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setExplanationText('');
  }

  private clearCachedQuestionArtifacts(index: number): void {
    const placeholder = this.questionLoadingText;
    if (this.combinedTextSubject.getValue() !== placeholder) {
      this.combinedTextSubject.next(placeholder);
    }
  }

  private regenerateFetForIndex(idx: number): string {
    return this.displayService.regenerateFetForIndex(idx);
  }

  private emitContentAvailableState(): void {
    this.isContentAvailable$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (isAvailable: boolean) => {
        this.isContentAvailableChange.emit(isAvailable);
        this.quizDataService.updateContentAvailableState(isAvailable);
      },
      error: (error: Error) => console.error('Error in isContentAvailable$:', error)
    });
  }

  private loadQuizDataFromRoute(): void {
    this.activatedRoute.paramMap.subscribe(async (params: ParamMap) => {
      const quizId = params.get('quizId');
      const questionIndex = Number(params?.get('questionIndex') ?? 1);
      const zeroBasedIndex = questionIndex - 1;

      if (quizId) {
        this.quizId = quizId;
        this.quizService.quizId = quizId;
        this.quizService.setQuizId(quizId);
        localStorage.setItem('quizId', quizId);  // store quizId in localStorage
        this.currentQuestionIndexValue = zeroBasedIndex;

        // ⚡ FIX: Sync internal index state with Route immediately
        // This ensures displayText$ pipeline gets the correct index even if Input binding lags
        this.questionIndexSubject.next(zeroBasedIndex);
        this.currentIndex = zeroBasedIndex;

        await this.loadQuestion(quizId, zeroBasedIndex);
      } else {
        console.error('Quiz ID is missing from route parameters');
      }
    });

    this.currentQuestion
      .pipe(
        debounceTime(200),
        tap((question: QuizQuestion | null) => {
          if (question) this.updateCorrectAnswersDisplay(question).subscribe();
        })
      )
      .subscribe();
  }

  private async loadQuestion(
    quizId: string,
    zeroBasedIndex: number
  ): Promise<void> {
    if (zeroBasedIndex == null || isNaN(zeroBasedIndex)) {
      console.error('Question index is null or undefined');
      return;
    }

    try {
      const questions = (await firstValueFrom(
        this.quizDataService.getQuestionsForQuiz(quizId)
      )) as QuizQuestion[];
      if (
        questions &&
        questions.length > 0 &&
        zeroBasedIndex >= 0 &&
        zeroBasedIndex < questions.length
      ) {
        // ⚡ FIX: Use Suffled Question if enabled to ensure Options-Text Match
        // This overrides the raw data fetch with the authoritative shuffled state
        let question = questions[zeroBasedIndex];
        if (this.quizService.isShuffleEnabled() &&
          this.quizService.shuffledQuestions?.length > zeroBasedIndex) {
          question = this.quizService.shuffledQuestions[zeroBasedIndex];
          console.log(`[loadQuestion] 🔀 Using Shuffled Question for Q${zeroBasedIndex + 1}`);
        }

        this.currentQuestion.next(question);  // use 'next' to update BehaviorSubject
        this.isExplanationDisplayed = false;  // reset explanation display state
        this.explanationToDisplay = '';

        // Reset explanation state
        this.explanationTextService.resetExplanationState();
        this.explanationTextService.resetExplanationText();

        this.quizService.setCurrentQuestion(question);
      } else {
        console.error('Invalid question index:', zeroBasedIndex);
      }
    } catch (error: any) {
      console.error('Error fetching questions for quiz:', error);
    }
  }

  private async initializeComponent(): Promise<void> {
    await this.initializeQuestionData();
    this.initializeCombinedQuestionData();
  }

  private async initializeQuestionData(): Promise<void> {
    try {
      const params: ParamMap = await firstValueFrom(
        this.activatedRoute.paramMap.pipe(take(1))
      );

      const data: [QuizQuestion[], string[]] = await firstValueFrom(
        this.fetchQuestionsAndExplanationTexts(params).pipe(
          takeUntil(this.destroy$)
        )
      );

      const [questions, explanationTexts] = data;

      if (!questions || questions.length === 0) {
        console.warn('No questions found');
        return;
      }

      this.explanationTexts = explanationTexts;

      // ⚡ FIX: Populate Service State explicitly.
      // The displayText$ pipeline relies on quizService.questions$ / quizService.questions.
      // If we don't set this here, the pipeline sees empty array -> qObj null -> Banner missing.
      this.quizService.questions = questions;
      if (this.quizService.questions$ instanceof BehaviorSubject || this.quizService.questions$ instanceof Subject) {
        (this.quizService.questions$ as unknown as Subject<QuizQuestion[]>).next(questions);
      }

      // Do NOT pre-generate/store formatted explanations during boot.
      // In shuffle mode this runs before the final visual option order is stable,
      // which can lock in wrong "Option #" prefixes (most visible on Q1).
      // FET is generated on-demand from the rendered options snapshot.
      questions.forEach((_, index) => {
        const explanation =
          this.explanationTexts[index] ?? 'No explanation available';
        this.explanationTextService.setExplanationTextForQuestionIndex(
          index,
          explanation
        );
      });

      // Set before test fetch
      this.explanationTextService.explanationsInitialized = true;

      this.initializeCurrentQuestionIndex();
    } catch (error: any) {
      console.error('Error in initializeQuestionData:', error);
    }
  }

  private fetchQuestionsAndExplanationTexts(
    params: ParamMap
  ): Observable<[QuizQuestion[], string[]]> {
    this.quizId = params.get('quizId') ?? '';
    if (!this.quizId) {
      console.warn('No quizId provided in the parameters.');
      return of([[], []] as [QuizQuestion[], string[]]);
    }

    return forkJoin([
      this.quizDataService.getQuestionsForQuiz(this.quizId).pipe(
        catchError((error: Error) => {
          console.error('Error fetching questions:', error);
          return of([] as QuizQuestion[]);
        })
      ),
      this.quizDataService.getAllExplanationTextsForQuiz(this.quizId).pipe(
        catchError((error: Error) => {
          console.error('Error fetching explanation texts:', error);
          return of([] as string[]);
        })
      ),
    ]).pipe(
      map((results: any) => {
        const [questions, explanationTexts] = results;
        return [questions as QuizQuestion[], explanationTexts as string[]];
      })
    );
  }

  private initializeCurrentQuestionIndex(): void {
    const idx = this.currentQuestionIndexValue ?? 0;
    this.quizService.currentQuestionIndex = idx;
    this.questionIndexSubject.next(idx);
    this.currentIndex = idx;
    this.currentQuestionIndex$ =
      this.quizService.getCurrentQuestionIndexObservable();
  }

  private updateCorrectAnswersDisplay(
    question: QuizQuestion | null,
  ): Observable<void> {
    if (!question) {
      return of(void 0);
    }

    return this.quizQuestionManagerService
      .isMultipleAnswerQuestion(question)
      .pipe(
        tap((isMultipleAnswer: boolean) => {
          const correctAnswers = question.options.filter(
            (option) => option.correct
          ).length;
          const explanationDisplayed =
            this.explanationTextService.isExplanationTextDisplayedSource.getValue();
          const newCorrectAnswersText =
            isMultipleAnswer && !explanationDisplayed
              ? this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
                correctAnswers,
                question.options?.length ?? 0
              )
              : '';

          if (
            this.correctAnswersTextSource.getValue() !== newCorrectAnswersText
          ) {
            this.correctAnswersTextSource.next(newCorrectAnswersText);
          }

          const shouldDisplayCorrectAnswers =
            isMultipleAnswer && !explanationDisplayed;
          if (
            this.shouldDisplayCorrectAnswersSubject.getValue() !==
            shouldDisplayCorrectAnswers
          ) {
            this.shouldDisplayCorrectAnswersSubject.next(
              shouldDisplayCorrectAnswers
            );
          }
        }),
        map(() => void 0)
      );
  }

  private initializeCombinedQuestionData(): void {
    const currentQuizAndOptions$ = this.combineCurrentQuestionAndOptions();

    currentQuizAndOptions$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (data: any) => {
        console.log('Current Quiz and Options Data', data);
      },
      error: (err: any) =>
        console.error('Error combining current quiz and options:', err)
    });

    this.combinedQuestionData$ = combineLatest([
      currentQuizAndOptions$.pipe(
        startWith<{
          currentQuestion: QuizQuestion | null;
          currentOptions: Option[];
          explanation: string;
          currentIndex: number;
        } | null>(null)
      ),
      this.numberOfCorrectAnswers$.pipe(startWith(0)),
      this.isExplanationTextDisplayed$.pipe(startWith(false)),
      this.activeFetText$.pipe(startWith(''))
    ]).pipe(
      map(
        ([
          quiz,
          numberOfCorrectAnswers,
          isExplanationDisplayed,
          formattedExplanation
        ]: [
            {
              currentQuestion: QuizQuestion | null;
              currentOptions: Option[];
              explanation: string;
              currentIndex: number;
            } | null,
            number | string,
            boolean,
            string
          ]): CombinedQuestionDataType => {
          const safeQuizData = quiz?.currentQuestion
            ? quiz
            : {
              currentQuestion: null,
              currentOptions: [],
              explanation: '',
              currentIndex: 0
            };

          const selectionMessage =
            'selectionMessage' in safeQuizData
              ? (safeQuizData as any).selectionMessage || ''
              : '';

          const currentQuizData: CombinedQuestionDataType = {
            currentQuestion: safeQuizData.currentQuestion,
            currentOptions: safeQuizData.currentOptions ?? [],
            options: safeQuizData.currentOptions ?? [],
            questionText:
              safeQuizData.currentQuestion?.questionText ||
              'No question available',
            explanation: safeQuizData.explanation ?? '',
            correctAnswersText: '',
            isExplanationDisplayed: !!isExplanationDisplayed,
            isNavigatingToPrevious: false,
            selectionMessage
          };

          return this.calculateCombinedQuestionData(
            currentQuizData,
            +(numberOfCorrectAnswers ?? 0),
            !!isExplanationDisplayed,
            formattedExplanation ?? ''
          );
        }
      ),
      filter((data: CombinedQuestionDataType | null):
        data is CombinedQuestionDataType => data !== null),
      catchError((error: Error) => {
        console.error('Error combining quiz data:', error);
        const fallback: CombinedQuestionDataType = {
          currentQuestion: {
            questionText: 'Error loading question',
            options: [],
            explanation: '',
            selectedOptions: [],
            answer: [],
            selectedOptionIds: [],
            type: undefined,
            maxSelections: 0
          },
          currentOptions: [],
          options: [],
          questionText: 'Error loading question',
          explanation: '',
          correctAnswersText: '',
          isExplanationDisplayed: false,
          isNavigatingToPrevious: false,
          selectionMessage: ''
        };

        // Explicit generic keeps the observable type consistent
        return of<CombinedQuestionDataType>(fallback);
      }),
    );
  }

  private combineCurrentQuestionAndOptions(): Observable<{
    currentQuestion: QuizQuestion | null;
    currentOptions: Option[];
    explanation: string;
    currentIndex: number;
  }> {
    return this.quizService.questionPayload$.pipe(
      withLatestFrom(this.quizService.currentQuestionIndex$),
      filter(
        (
          value: [QuestionPayload | null, number]
        ): value is [QuestionPayload, number] => {
          const [payload] = value;
          return (
            !!payload &&
            !!payload.question &&
            Array.isArray(payload.options) &&
            payload.options.length > 0
          );
        }
      ),
      map(([payload, index]: [QuestionPayload, number]) => ({
        payload,
        index: Number.isFinite(index)
          ? index
          : this.currentIndex >= 0
            ? this.currentIndex
            : 0
      })),
      filter(({ payload, index }: { payload: QuestionPayload; index: number }) => {
        const expected =
          Array.isArray(this.questions) && index >= 0
            ? (this.questions[index] ?? null)
            : null;

        if (!expected) return true;

        const normalizedExpected = this.normalizeKeySource(expected.questionText);
        const normalizedIncoming = this.normalizeKeySource(
          payload.question?.questionText
        );

        // ⚡ FIX: Removed aggressive filtering!
        // We trust the payload from the service. Filtering against local 'expected' state
        // (which might be stale/unshuffled) causes valid shuffled updates to be dropped.
        if (
          normalizedExpected &&
          normalizedIncoming &&
          normalizedExpected !== normalizedIncoming
        ) {
          console.warn('[combineCurrentQuestionAndOptions] ⚠️ Mismatch detected but ALLOWING update to fix Shuffled Stuck Text.', {
            index,
            normalizedExpected,
            normalizedIncoming
          });
          // return true; // Just allow it
        }

        return true;
      }),
      map(({ payload, index }: { payload: QuestionPayload; index: number }) => {
        const normalizedOptions = payload.options
          .map((option, optionIndex) => ({
            ...option,
            optionId:
              typeof option.optionId === 'number'
                ? option.optionId
                : optionIndex + 1,
            displayOrder:
              typeof option.displayOrder === 'number'
                ? option.displayOrder
                : optionIndex
          }))
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

        const normalizedQuestion: QuizQuestion = {
          ...payload.question,
          options: normalizedOptions
        };

        this.currentQuestion$.next(normalizedQuestion);
        this.currentOptions$.next(normalizedOptions);

        return {
          currentQuestion: normalizedQuestion,
          currentOptions: normalizedOptions,
          explanation:
            payload.explanation?.trim() ||
            payload.question.explanation?.trim() ||
            '',
          currentIndex: index
        };
      }),
      distinctUntilChanged(
        (prev: {
          currentQuestion: QuizQuestion; currentOptions: Option[]; explanation: string;
          currentIndex: number
        },
          curr: {
            currentQuestion: QuizQuestion; currentOptions: Option[]; explanation: string;
            currentIndex: number
          }) => {
          const norm = (s?: string) =>
            (s ?? '')
              .replace(/<[^>]*>/g, ' ') // strip HTML
              .replace(/&nbsp;/g, ' ')
              .trim()
              .toLowerCase()
              .replace(/\s+/g, ' ');

          const questionKey = (
            q: QuizQuestion | null | undefined,
            idx?: number
          ) => {
            // Prefer a stable id if it exists in the model; fallback to normalized text and index
            const textKey = norm(q?.questionText);
            return `${textKey}#${Number.isFinite(idx) ? idx : -1}`;
          };

          const sameQuestion =
            questionKey(prev.currentQuestion, prev.currentIndex) ===
            questionKey(curr.currentQuestion, curr.currentIndex);
          if (!sameQuestion) return false;

          if (prev.explanation !== curr.explanation) return false;

          return this.haveSameOptionOrder(
            prev.currentOptions,
            curr.currentOptions
          );
        }),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error: Error) => {
        console.error('Error in combineCurrentQuestionAndOptions:', error);
        return of({
          currentQuestion: null,
          currentOptions: [],
          explanation: '',
          currentIndex: -1
        });
      })
    );
  }

  private haveSameOptionOrder(
    left: Option[] = [],
    right: Option[] = []
  ): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) return false;

    return left.every((option, index) => {
      const other = right[index];
      if (!other) return false;

      const optionText = (option.text ?? option.text ?? '').toString();
      const otherText = (other.text ?? other.text ?? '').toString();

      return (
        option.optionId === other.optionId &&
        option.displayOrder === other.displayOrder &&
        optionText === otherText
      );
    });
  }

  private calculateCombinedQuestionData(
    currentQuizData: CombinedQuestionDataType,
    numberOfCorrectAnswers: number,
    isExplanationDisplayed: boolean,
    formattedExplanation: string
  ): CombinedQuestionDataType {
    const { currentQuestion, currentOptions } = currentQuizData;

    if (!currentQuestion) {
      console.error('No current question found in data:', currentQuizData);
      return {
        currentQuestion: null,
        currentOptions: [],
        options: [],
        questionText: 'No question available',
        explanation: '',
        correctAnswersText: '',
        isExplanationDisplayed: false,
        isNavigatingToPrevious: false,
        selectionMessage: ''
      };
    }

    const normalizedCorrectCount = Number.isFinite(numberOfCorrectAnswers)
      ? numberOfCorrectAnswers
      : 0;

    const totalOptions = Array.isArray(currentOptions)
      ? currentOptions.length
      : Array.isArray(currentQuestion?.options)
        ? currentQuestion.options.length
        : 0;

    const isMultipleAnswerQuestion =
      currentQuestion.type === QuestionType.MultipleAnswer ||
      (Array.isArray(currentQuestion.options)
        ? currentQuestion.options.filter((option) => option.correct).length > 1
        : false);

    const correctAnswersText =
      isMultipleAnswerQuestion && normalizedCorrectCount > 0
        ? this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
          normalizedCorrectCount,
          totalOptions
        )
        : '';

    const explanationText = isExplanationDisplayed
      ? formattedExplanation?.trim() ||
      currentQuizData.explanation ||
      currentQuestion.explanation ||
      ''
      : '';

    const combinedQuestionData: CombinedQuestionDataType = {
      currentQuestion: currentQuestion,
      currentOptions: currentOptions,
      options: currentOptions ?? [],
      questionText: currentQuestion.questionText,
      explanation: explanationText,
      correctAnswersText,
      isExplanationDisplayed: isExplanationDisplayed,
      isNavigatingToPrevious: false,
      selectionMessage: ''
    };
    return combinedQuestionData;
  }

  private setupCorrectAnswersTextDisplay(): void {
    // Combining the logic to determine if the correct answers text should be displayed
    this.shouldDisplayCorrectAnswers$ = combineLatest([
      this.shouldDisplayCorrectAnswers$.pipe(
        startWith(false),  // ensuring it has an initial value
        map((value: boolean) => value ?? false),  // fallback to false if value is undefined
        distinctUntilChanged()
      ),
      this.isExplanationDisplayed$.pipe(
        startWith(false),  // ensuring it has an initial value
        map((value: boolean) => value ?? false),  // fallback to false if value is undefined
        distinctUntilChanged()
      ),
    ]).pipe(
      map(
        ([shouldDisplayCorrectAnswers, isExplanationDisplayed]: [boolean, boolean]) =>
          shouldDisplayCorrectAnswers && !isExplanationDisplayed
      ),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in shouldDisplayCorrectAnswers$ observable:', error);
        return of(false);  // default to not displaying correct answers in case of error
      }),
    );

    // Display correctAnswersText only if the above conditions are met
    this.displayCorrectAnswersText$ = this.shouldDisplayCorrectAnswers$.pipe(
      switchMap((shouldDisplay: boolean) => {
        return shouldDisplay ? this.correctAnswersText$ : of(null);
      }),
      distinctUntilChanged(),
      catchError((error: Error) => {
        console.error('Error in displayCorrectAnswersText$ observable:', error);
        return of(null);  // default to null in case of error
      })
    );
  }

  private setupShouldShowFet(): void {
    this.displayService.setupShouldShowFet(this.currentIndex$);
  }

  private setupFetToDisplay(): void {
    this.displayService.setupFetToDisplay(
      this.currentIndex$,
      this.timedOutIdx$,
      this.activeFetText$,
      this.currentQuestion
    );
  }

  private normalizeKeySource(value: string | null | undefined): string {
    return (value ?? '')
      .toString()
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}