import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import {
  animationFrameScheduler,
  BehaviorSubject,
  combineLatest,
  firstValueFrom,
  forkJoin,
  merge,
  Observable,
  of,
  Subject,
  Subscription,
} from 'rxjs';
import {
  auditTime,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  observeOn,
  shareReplay,
  skip,
  skipUntil,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
  withLatestFrom,
} from 'rxjs/operators';

import { CombinedQuestionDataType } from '../../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../../shared/models/Option.model';
import { QuestionType } from '../../../shared/models/question-type.enum';
import { QuestionPayload } from '../../../shared/models/QuestionPayload.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/quiz-navigation.service';
import { QuizQuestionLoaderService } from '../../../shared/services/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/quizquestionmgr.service';
import { QuizStateService } from '../../../shared/services/quizstate.service';
import {
  ExplanationTextService,
  FETPayload,
} from '../../../shared/services/explanation-text.service';
import { QuizQuestionComponent } from '../../../components/question/quiz-question/quiz-question.component';

interface QuestionViewState {
  index: number;
  key: string;
  markup: string;
  fallbackExplanation: string;
  question: QuizQuestion | null;
}

@Component({
  selector: 'codelab-quiz-content',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './codelab-quiz-content.component.html',
  styleUrls: ['./codelab-quiz-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodelabQuizContentComponent
  implements OnInit, OnChanges, OnDestroy {
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
    mode: 'question' | 'explanation';
    answered: boolean;
  }>;
  @Input() displayVariables!: { question: string; explanation: string };
  @Input() localExplanationText = '';
  @Input() showLocalExplanation = false;

  @Input() set explanationOverride(o: { idx: number; html: string }) {
    this.overrideSubject.next(o);
  }

  @Input() set questionIndex(idx: number) {
    // Remember the index and clear any old override
    this.currentIndex = idx;
    this.overrideSubject.next({ idx, html: '' });
    this.clearCachedQuestionArtifacts(idx);

    // Hard-align the ExplanationTextService with the active index so the
    // formatted explanation text stream starts from a clean slate and does not
    // replay the previous question's FET (e.g., Q1 on Q4's first click).
    const ets = this.explanationTextService;
    ets._activeIndex = idx;
    // REMOVED AGGRESSIVE RESET LOGIC:
    // Calling ets.resetForIndex(idx), clearing subjects, and hiding explanation here
    // destroys persisting state when the user navigates back to this tab/route.
    // The service handles resetting internally via activeIndex$ subscription if needed.

    // Reset view flags
    this.resetExplanationView();
    if (this._showExplanation) this._showExplanation = false;

    // ⚡ FIX: Ensure display state matches the question status
    // IF the new question has NOT been answered yet, force 'question' mode.
    // This prevents "Persistence" from carrying over Q2's 'explanation' mode to Q3.
    const isAnswered = this.quizService.isAnswered(idx);
    if (!isAnswered) {
      this.quizStateService.setDisplayState({
        mode: 'question',
        answered: false,
      });
      // Also ensure ETS knows we shouldn't be showing explanation
      ets.setShouldDisplayExplanation(false, { force: true });
      ets.setIsExplanationTextDisplayed(false, { force: true });
    }
    // Else: If answered, let persistence (or service state) take over.

    this.cdRef.markForCheck();
  }

  @Input() set showExplanation(value: boolean) {
    this._showExplanation = value;
    this.cdRef.markForCheck();
  }

  private combinedTextSubject = new BehaviorSubject<string>('');
  combinedText$ = this.combinedTextSubject.asObservable();

  shouldDisplayCorrectAnswers = false;
  private shouldDisplayCorrectAnswersSubject: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);
  shouldDisplayCorrectAnswers$ =
    this.shouldDisplayCorrectAnswersSubject.asObservable();

  currentQuestionIndexValue = 0;
  currentQuestion$: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);
  currentOptions$: BehaviorSubject<Option[] | null> = new BehaviorSubject<
    Option[] | null
  >([]);
  currentQuestionIndex$!: Observable<number>;
  nextQuestion$: Observable<QuizQuestion | null>;
  previousQuestion$: Observable<QuizQuestion | null>;
  isNavigatingToPrevious = false;
  currentQuestionType: QuestionType | undefined = undefined;
  private _lastQuestionTextByIndex = new Map<number, string>();

  private overrideSubject = new BehaviorSubject<{ idx: number; html: string }>({
    idx: -1,
    html: '',
  });
  private currentIndex = -1;
  currentIndex$ = this.quizService.currentQuestionIndex$;
  private explanationCache = new Map<string, string>();
  private lastExplanationMarkupByKey = new Map<string, string>();
  private pendingExplanationRequests = new Map<string, Subscription>();
  private pendingExplanationKeys = new Set<string>();
  private latestViewState: QuestionViewState | null = null;
  latestDisplayMode: 'question' | 'explanation' = 'question';
  awaitingQuestionBaseline = false;
  private renderModeByKey = new Map<string, 'question' | 'explanation'>();
  private readonly questionLoadingText = 'Loading question…';
  private lastQuestionIndexForReset: number | null = null;
  private staleFallbackIndices = new Set<number>();

  explanationTextLocal = '';
  isExplanationDisplayed = false;
  explanationVisible = false;
  isExplanationTextDisplayed$: Observable<boolean>;
  private isExplanationDisplayed$ = new BehaviorSubject<boolean>(false);
  private _showExplanation = false;
  // Use the service's indexed formattedExplanation$ so we can ignore stale payloads
  // that belong to previous questions (e.g., Q1 showing while on Q4).
  formattedExplanation$: Observable<FETPayload> = this.explanationTextService
    .getFormattedExplanationByIndex()
    .pipe(
      startWith<FETPayload>({ idx: -1, text: '', token: 0 }),
      distinctUntilChanged(
        (a: FETPayload, b: FETPayload) => a.idx === b.idx && a.text === b.text,
      ),
    );

  public activeFetText$: Observable<string> = this.formattedExplanation$.pipe(
    withLatestFrom(this.quizService.currentQuestionIndex$),
    map(([payload, idx]) => (payload?.idx === idx ? (payload.text ?? '') : '')),
    startWith(''),
    distinctUntilChanged(),
  );
  // SIMPLE: One observable that switches between question text and FET
  // Will be initialized in ngOnInit after inputs are set
  displayText$!: Observable<string>;

  numberOfCorrectAnswers$: BehaviorSubject<string> =
    new BehaviorSubject<string>('0');

  correctAnswersTextSource: BehaviorSubject<string> =
    new BehaviorSubject<string>('');
  correctAnswersText$ = this.correctAnswersTextSource.asObservable();

  public displayCorrectAnswersText$!: Observable<string | null>;

  explanationText: string | null = null;
  explanationTexts: string[] = [];

  private correctAnswersDisplaySubject = new Subject<boolean>();

  questionRendered: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false,
  );

  isQuizQuestionComponentInitialized = new BehaviorSubject<boolean>(false);
  isContentAvailable$!: Observable<boolean>;

  private combinedSub?: Subscription;

  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizNavigationService: QuizNavigationService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private quizQuestionLoaderService: QuizQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private activatedRoute: ActivatedRoute,
    private cdRef: ChangeDetectorRef,
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;
    this.previousQuestion$ = this.quizService.previousQuestion$;

    this.quizNavigationService
      .getIsNavigatingToPrevious()
      .subscribe((isNavigating: boolean) => {
        this.isNavigatingToPrevious = isNavigating;
      });

    this.isExplanationTextDisplayed$ =
      this.explanationTextService.isExplanationTextDisplayed$;
  }

  async ngOnInit(): Promise<void> {
    this.isExplanationDisplayed = false;
    this.explanationTextService.setIsExplanationTextDisplayed(false);

    if (this.questionToDisplay$) {
      combineLatest([
        this.questionToDisplay$.pipe(startWith(''), distinctUntilChanged()),
        this.quizService.currentQuestionIndex$.pipe(
          startWith(this.quizService?.currentQuestionIndex ?? 0),
        ),
      ])
        .pipe(takeUntil(this.destroy$))
        .subscribe(([, index]) => {
          if (this.lastQuestionIndexForReset !== index) {
            this.explanationTextService.setShouldDisplayExplanation(false);
            this.lastQuestionIndexForReset = index;
          }
        });
    }

    this.displayState$ = this.quizStateService.displayState$;

    // Resolve the correct question object (respecting shuffle) for the current index
    const questionForIndex$ = this.quizService.currentQuestionIndex$.pipe(
      switchMap((idx) => this.quizService.getQuestionByIndex(idx)),
      startWith(null),
    );

    // Initialize displayText$ - handles both question text with banner and FET display
    this.displayText$ = combineLatest([
      this.displayState$ || of({ mode: 'question' as const, answered: false }),
      this.questionToDisplay$ || of(''),
      this.formattedExplanation$,
      this.currentIndex$,
      this.quizService.questions$.pipe(
        filter((q) => Array.isArray(q) && q.length > 0),
        startWith(this.quizService.questions || []),
      ),
      questionForIndex$,
    ]).pipe(
      debounceTime(50), // Allow time for questions to load
      map(([state, qText, fetPayload, idx, questions, questionObj]) => {
        // ⚡ FIX: Sync Safeguard
        // Use the component's local index if the pipe index is invalid/lagging.
        // Falling back to 0 causes Q3 to look like Q1 (which is answered + explanation mode).
        const safeIdx = Number.isFinite(idx)
          ? idx
          : Number.isFinite(this.currentIndex)
            ? this.currentIndex
            : 0;

        // ⚡ FIX: Race Condition Safeguard (Double Check)
        // Ensure strictly that we only show explanation mode if truly answered.
        const isAnswered = this.quizService.isAnswered(safeIdx);
        const mode = isAnswered ? state?.mode || 'question' : 'question';

        const trimmedQText = (qText ?? '').trim();

        // Debug logging to diagnose "FET instead of QText"
        if (safeIdx > 0 && mode === 'explanation') {
          console.log(`[displayText$] Showing FET for Q${safeIdx + 1}. isAnswered=${isAnswered}. FET Present: ${!!fetPayload?.text}`);
        }

        // Check if this is a multiple-answer question (use resolved object first, then fallback)
        const qObj =
          questionObj ||
          (Array.isArray(questions) ? questions[safeIdx] : undefined) ||
          (Array.isArray(this.quizService.questions)
            ? this.quizService.questions[safeIdx]
            : undefined);
        const numCorrect =
          qObj?.options?.filter((o: Option) => o.correct).length || 0;
        const isMulti = numCorrect > 1;
        console.log(
          `[displayText$] Q${safeIdx + 1}:`,
          JSON.stringify({
            hasQObj: !!qObj,
            qId: qObj?.questionId || 'N/A',
            qText: (qObj?.questionText || '').substring(0, 20),
            numCorrect,
            isMulti,
            questionsFromParam: questions?.length,
            questionsFromService: this.quizService.questions?.length,
            mode,
            qObjOptions: qObj?.options?.length,
            optionCorrectCounts: qObj?.options
              ?.map((o: Option) => (o.correct ? 1 : 0))
              .join(','),
          }),
        );

        // Generate banner text for multiple-answer questions
        let bannerText = '';
        if (isMulti && qObj) {
          const totalOpts = qObj.options?.length || 0;
          bannerText =
            this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
              numCorrect,
              totalOpts,
            );
          console.log(
            `[displayText$] Banner for Q${safeIdx + 1}: "${bannerText}"`,
          );
        }

        // Check if FET belongs to current question
        const belongsToIndex = fetPayload?.idx === safeIdx;
        const trimmedFet = belongsToIndex
          ? (fetPayload?.text ?? '').trim()
          : '';

        // Show FET in explanation mode if available
        const isValidFet =
          belongsToIndex &&
          trimmedFet !== 'No explanation available' &&
          trimmedFet !== 'No explanation available for this question.' &&
          trimmedFet.length > 10;

        if (mode === 'explanation') {
          if (isValidFet) {
            if (isMulti && bannerText) {
              return `${trimmedFet}`;
            }
            return trimmedFet;
          }
          // If in explanation mode but no FET, fall back to "No explanation available"
          // but DO NOT show question text unless intended.
          return 'No explanation available.';
        }

        // QUESTION MODE
        if (!trimmedQText) return '';

        if (isMulti && bannerText) {
          return `${trimmedQText} <span class="correct-count">${bannerText}</span>`;
        }

        return trimmedQText;
      }),
      distinctUntilChanged(),
    );

    this.resetExplanationView();

    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.explanationText$.next('');

    this.explanationTextService.resetForIndex(0);
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true,
    });

    // Build the stream only once globally
    this.combinedText$ = this.getCombinedDisplayTextStream();

    // Subscribe to displayText$ to update the DOM (works alongside template binding)
    // This ensures the question text and explanations are displayed
    // Wait for displayText$ to be initialized in ngOnInit
    setTimeout(() => {
      if (this.displayText$ && !this.combinedSub) {
        this.combinedSub = this.displayText$
          .pipe(distinctUntilChanged())
          .subscribe({
            next: (v) => {
              const el = this.qText?.nativeElement;
              if (!el) return;

              const currentIndex = this.quizService.getCurrentQuestionIndex();
              const incoming = v ?? '';

              console.log(
                `[CQCC Display] Q${currentIndex + 1}: "${incoming.slice(0, 100)}"`,
              );

              // Update the DOM with the text
              el.style.transition = 'opacity 0.12s linear';
              el.style.opacity = '0.4';
              el.innerHTML = incoming;

              requestAnimationFrame(() => {
                el.style.opacity = '1';
              });
            },
            error: (err) => console.error('[CQCC displayText$ error]', err),
          });
      }
    }, 50); // slightly longer delay to ensure displayText$ is initialized

    this.isContentAvailable$ = this.combineCurrentQuestionAndOptions().pipe(
      map(({ currentQuestion, currentOptions }) => {
        return !!currentQuestion && currentOptions.length > 0;
      }),
      distinctUntilChanged(),
      catchError((error) => {
        console.error('Error in isContentAvailable$:', error);
        return of(false); // fallback to `false` in case of errors
      }),
      startWith(false),
    );

    this.isContentAvailable$
      .pipe(distinctUntilChanged())
      .subscribe((isAvailable) => {
        if (isAvailable) {
          console.log('Content is available. Setting up state subscription.');
          this.setupDisplayStateSubscription();
        } else {
          console.log('Content is not yet available.');
        }
      });

    this.emitContentAvailableState(); // start emitting the content availability state

    // Load quiz data from the route first
    this.loadQuizDataFromRoute();

    // Initialize other component states and subscriptions
    await this.initializeComponent();
    this.configureDisplayLogic();
    this.setupCorrectAnswersTextDisplay();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['explanationOverride']) {
      this.overrideSubject.next(this.explanationOverride);
      this.cdRef.markForCheck();
    }

    // Run only when the new questionText arrives
    if (!!this.questionText && !this.questionRendered.getValue()) {
      this.questionRendered.next(true);
    }

    if (changes['questionIndex'] && !changes['questionIndex'].firstChange) {
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
    this.pendingExplanationRequests.forEach((subscription) =>
      subscription.unsubscribe(),
    );
    this.pendingExplanationRequests.clear();
    this.combinedTextSubject.complete();
    this.combinedSub?.unsubscribe();
  }

  private resetExplanationView(): void {
    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.setExplanationText('');
  }

  private clearCachedQuestionArtifacts(index: number): void {
    const normalizedIndex = Number.isFinite(index) ? Number(index) : -1;
    const keyPrefix = `${normalizedIndex}:`;

    const pruneMap = <T>(
      store: Map<string, T>,
      onRemove?: (value: T, key: string) => void,
    ) => {
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(keyPrefix)) {
          const value = store.get(key);
          if (onRemove && value !== undefined) {
            onRemove(value, key);
          }
          store.delete(key);
        }
      }
    };

    pruneMap(this.explanationCache);
    pruneMap(this.lastExplanationMarkupByKey);
    pruneMap(this.renderModeByKey);
    pruneMap(this.pendingExplanationRequests, (subscription) => {
      subscription?.unsubscribe();
    });

    for (const key of Array.from(this.pendingExplanationKeys)) {
      if (key.startsWith(keyPrefix)) this.pendingExplanationKeys.delete(key);
    }

    if (this.latestViewState?.index === index) this.latestViewState = null;

    this.latestDisplayMode = 'question';
    this.awaitingQuestionBaseline = false;
    this.staleFallbackIndices.delete(index);

    const placeholder = this.questionLoadingText;
    if (this.combinedTextSubject.getValue() !== placeholder) {
      this.combinedTextSubject.next(placeholder);
    }
  }

  public getCombinedDisplayTextStream(): Observable<string> {
    // Core reactive inputs
    const index$ = this.quizService.currentQuestionIndex$.pipe(
      startWith(this.currentQuestionIndexValue ?? 0),
      distinctUntilChanged(),
      tap((newIdx) => {
        const ets = this.explanationTextService;

        // Don't clear if FET is locked (user has clicked and explanation is showing)
        if (ets._fetLocked) {
          console.log(`[INDEX] Skipping reset - FET locked for Q${newIdx + 1}`);
          ets._activeIndex = newIdx;
          ets.latestExplanationIndex = newIdx;
          return;
        }

        // Reset FET only on index change (navigation), not on visibility
        ets._activeIndex = newIdx;
        ets.latestExplanation = '';
        // Don't set to null - set to newIdx so explanationIndexMatches works for Q1
        ets.latestExplanationIndex = newIdx;

        ets.formattedExplanationSubject?.next('');
        ets.explanationText$?.next('');

        ets.setShouldDisplayExplanation(false);
        ets.setIsExplanationTextDisplayed(false);
        ets.setGate?.(newIdx, false);

        if (ets._activeIndex !== null && ets._activeIndex !== newIdx) {
          ets.setGate?.(ets._activeIndex, false);
        }

        console.log(`[INDEX] 🔄 Reset FET streams for new index → ${newIdx}`);
      }),
      debounceTime(50),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const serviceQuestionText$ = (this.questionToDisplay$ || of('')).pipe(
      tap((q) =>
        console.log(
          `[questionText$] 🔵 Raw input (service): "${(q ?? '').slice(0, 80)}"`,
        ),
      ),
      map((q) => (q ?? '').trim()),
      filter((q) => q.length > 0),
    );

    const fallbackQuestionText$ = this.currentQuestion$.pipe(
      map((question) => (question?.questionText ?? '').trim()),
      filter((text) => text.length > 0),
      tap((text) =>
        console.log(
          `[questionText$] 🟣 Fallback from payload: "${text.slice(0, 80)}"`,
        ),
      ),
    );

    const questionText$ = merge(
      serviceQuestionText$,
      fallbackQuestionText$,
    ).pipe(
      tap((q) =>
        console.log(`[questionText$] 🟢 After merge: "${q.slice(0, 80)}"`),
      ),
      distinctUntilChanged(),
      tap((q) => console.log(`[questionText$] ✅ Final: "${q.slice(0, 80)}"`)),
    );

    const correctText$ = this.quizService.correctAnswersText$.pipe(
      map((v) => v?.trim() || ''),
      startWith(''),
      debounceTime(25),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const fetForIndex$ = combineLatest([
      (this.explanationTextService.formattedExplanation$ ?? of('')).pipe(
        startWith(''),
      ),
      (this.explanationTextService.shouldDisplayExplanation$ ?? of(false)).pipe(
        startWith(false),
      ),
      (this.explanationTextService.activeIndex$ ?? of(-1)).pipe(startWith(-1)),
    ]).pipe(
      auditTime(0),
      map(([text, gate, idx]) => ({
        idx,
        text: (text ?? '').trim(),
        gate: !!gate,
      })),
      distinctUntilChanged(
        (a, b) => a.idx === b.idx && a.gate === b.gate && a.text === b.text,
      ),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const shouldShow$ =
      this.explanationTextService.shouldDisplayExplanation$.pipe(
        map(Boolean),
        startWith(false),
        distinctUntilChanged(),
        auditTime(16),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    const navigating$ = this.quizStateService.isNavigatingSubject.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const qQuiet$ = this.quizQuestionLoaderService.quietZoneUntil$
      ? this.quizQuestionLoaderService.quietZoneUntil$.pipe(
        startWith(0),
        distinctUntilChanged(),
      )
      : of(0);

    const eQuiet$ = this.explanationTextService.quietZoneUntil$
      ? this.explanationTextService.quietZoneUntil$.pipe(
        startWith(0),
        distinctUntilChanged(),
      )
      : of(0);

    // Display mode and explanation readiness
    const displayState$ = this.quizStateService.displayState$;
    const explanationReady$ = this.quizStateService.explanationReady$;

    type CombinedTuple = [
      number, // index$
      string, // questionText$
      string, // correctText$
      { idx: number; text: string; gate: boolean }, // fetForIndex$
      boolean, // shouldShow$
      boolean, // navigating$
      number, // qQuiet$
      number, // eQuiet$
      QuizQuestion[], // questions$
    ];

    // Base stream: existing logic
    const base$ = combineLatest<CombinedTuple>([
      index$,
      questionText$,
      correctText$,
      fetForIndex$,
      shouldShow$,
      navigating$,
      qQuiet$,
      eQuiet$,
      this.quizService.questions$.pipe(
        startWith([]),
        map(() => this.quizService.questions || []),
      ),
    ]).pipe(
      startWith([
        0,
        '',
        '',
        { idx: -1, text: '', gate: false },
        false,
        false,
        0,
        0,
        [],
      ] as CombinedTuple),
      skip(1),
      auditTime(16),

      filter((tuple: CombinedTuple) => {
        const [
          ,
          ,
          ,
          ,
          ,
          // idx
          // question
          // banner
          // fet
          // shouldShow
          navigating,
          qQuiet,
          eQuiet,
        ] = tuple;
        const hold =
          navigating || performance.now() < Math.max(qQuiet || 0, eQuiet || 0);
        if (hold) {
          console.log('[VisualGate] ⏸ hold (navigating/quiet-zone)');
        }
        return !hold;
      }),

      distinctUntilChanged((prev: CombinedTuple, curr: CombinedTuple) => {
        const [pIdx, , , pFet, pShow] = prev;
        const [cIdx, , , cFet, cShow] = curr;
        return pIdx === cIdx && pFet?.text === cFet?.text && pShow === cShow;
      }),

      skipUntil(
        index$.pipe(
          filter((idx) => Number.isFinite(idx)),
          take(1),
        ),
      ),

      filter(([idx, , , fet]) => {
        const isMatch = fet?.idx === idx || !fet?.text?.trim();

        if (!isMatch) {
          console.log(
            `[DisplayGate] 🚫 Suppressing mismatched FET (fet.idx=${fet?.idx}, current=${idx})`,
          );
        }

        return isMatch;
      }),

      withLatestFrom(this.quizService.currentQuestionIndex$),

      filter(
        ([
          [idx, question, banner, fet, shouldShow, navigating, qQuiet, eQuiet],
          liveIdx,
        ]) => {
          const valid = idx === liveIdx;

          if (!valid) {
            console.warn('[INDEX GATE] Dropping stale emission', {
              streamIndex: idx,
              liveIndex: liveIdx,
              fetIdx: fet?.idx,
            });
          }

          return valid;
        },
      ),

      map(
        ([
          [
            idx,
            question,
            banner,
            fet,
            shouldShow,
            navigating,
            qQuiet,
            eQuiet,
            questions,
          ],
        ]) =>
          [
            idx,
            question,
            banner,
            fet,
            shouldShow,
            navigating,
            qQuiet,
            eQuiet,
            questions,
          ] as CombinedTuple,
      ),

      auditTime(32),
      filter(
        ([, question]) =>
          typeof question === 'string' && question.trim().length > 0,
      ),
      auditTime(32),
      filter(
        ([, question]) =>
          typeof question === 'string' && question.trim().length > 0,
      ),

      map(
        ([
          idx,
          question,
          banner,
          fet,
          shouldShow,
          navigating,
          qQuiet,
          eQuiet,
          questions,
        ]) => {
          console.log(
            `[getCombinedDisplayTextStream] Q${idx + 1} before resolveTextToDisplay:`,
            {
              questionsLength: questions?.length,
              serviceQuestionsLength: this.quizService.questions?.length,
              banner,
              idx,
            },
          );
          return this.resolveTextToDisplay(
            idx,
            question,
            banner,
            fet,
            shouldShow,
            questions,
          );
        },
      ),

      auditTime(16),
      distinctUntilChanged((a: string, b: string) => a.trim() === b.trim()),
    );

    // FINAL LAYER: explanation wins
    return combineLatest([
      base$,
      displayState$,
      explanationReady$,
      this.explanationTextService.formattedExplanation$.pipe(startWith('')),
      this.quizService.currentQuestionIndex$,
    ]).pipe(
      map(([baseText, displayState, explanationReady, formatted, idx]) => {
        const fet = String(
          formatted ?? this.explanationTextService.latestExplanation ?? '',
        ).trim();

        const mode = displayState?.mode ?? 'question';
        const base = String(baseText ?? '') as string;

        // Normal explanation-mode override
        if (mode === 'explanation') {
          // USE fetByIndex MAP: Check for this specific index first
          const indexFet = this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';
          const directFet = this.explanationTextService.latestExplanation?.trim() || '';
          const effectiveFet = indexFet || fet || directFet;

          if (effectiveFet) {
            return effectiveFet as string;
          }

          if (explanationReady) {
            return (effectiveFet || 'Explanation not available.') as string;
          }
        }

        // HARD OVERRIDE: once answered, FET wins if it exists
        try {
          const quizId = this.quizId ?? '';
          if (quizId) {
            const qState = this.quizStateService.getQuestionState(quizId, idx);
            const isAnswered =
              qState?.isAnswered || qState?.explanationDisplayed;

            if (isAnswered) {
              // USE fetByIndex MAP: Check for this specific index first
              const indexFet = this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';
              const directFet = this.explanationTextService.latestExplanation?.trim() || '';
              const effectiveFet = indexFet || fet || directFet;

              if (effectiveFet) {
                return effectiveFet as string;
              }
              // no FET? fall back to whatever base decided
              return base;
            }
          }
        } catch (err) {
          console.warn('[CQCC] ⚠️ Answered override check failed', err);
        }

        // Default: use base text (usually question)
        return base;
      }),
      distinctUntilChanged((a: string, b: string) => a.trim() === b.trim()),
      observeOn(animationFrameScheduler),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean,
    questions: QuizQuestion[] = [],
  ): string {
    const qText = (question ?? '').trim();
    const bannerText = (banner ?? '').trim();
    const fetText = (fet?.text ?? '').trim();
    const active = this.quizService.getCurrentQuestionIndex();

    // Use service questions as primary source (loaded synchronously)
    const qObj = this.quizService.questions?.[idx] || questions?.[idx];

    // Calculate isMulti early for use throughout the function
    const numCorrectForMultiCheck =
      qObj?.options?.filter((o: Option) => o.correct).length || 0;
    const isMulti = numCorrectForMultiCheck > 1;

    const ets = this.explanationTextService;
    const explanationIndex = (ets as any).latestExplanationIndex;
    const mode = this.quizStateService.displayStateSubject?.value?.mode;

    const hasUserInteracted =
      (this.quizStateService as any).hasUserInteracted?.(idx) ?? false;

    // Ensure we have index-scoped cache map
    if (!this._lastQuestionTextByIndex) {
      (this as any)._lastQuestionTextByIndex = new Map<number, string>();
    }

    // Always cache a “last known good” QUESTION text per index
    if (qText) {
      this._lastQuestionTextByIndex.set(idx, qText);
    }

    const explanationGate = ets.shouldDisplayExplanationSource?.value === true;

    // FET DISPLAY GATE — only allow in explanation mode
    // STRICT GUARD: Explanation index MUST match current index
    // NOTE: Use _activeIndex as fallback since latestExplanationIndex may be null initially
    const explanationIndexMatches =
      explanationIndex === idx ||
      (explanationIndex === null && ets._activeIndex === idx);

    // Use fetByIndex Map as primary source - bypasses stream timing issues
    const storedFet = ets.fetByIndex?.get(idx)?.trim() || '';
    const fallbackFet = ets.latestExplanation?.trim() || '';
    const effectiveFet = storedFet || fallbackFet;
    const hasValidFet = effectiveFet.length > 0;

    // Show FET if: we have content stored for this index and we're on the active question
    if (
      hasValidFet &&
      idx === active
    ) {
      const safe = effectiveFet;

      // Append correct answers banner to FET for multi-answer questions
      let finalFet = safe;
      if (isMulti) {
        const numCorrect =
          qObj?.options?.filter((o: Option) => o.correct).length || 0;
        const totalOpts = qObj?.options?.length || 0;

        if (numCorrect > 0) {
          const banner =
            this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
              numCorrect,
              totalOpts,
            );
          // Prepend the banner before the FET so it shows at the top
          finalFet = `<div class="correct-count-header">${banner}</div>${safe}`;
        }
      }

      this._lastQuestionTextByIndex.set(idx, finalFet);
      return finalFet;
    }

    // STRUCTURED FET PATH (kept, but secondary)
    const fetValid =
      !!fet &&
      fetText.length > 2 &&
      fet.idx === idx &&
      fet.idx === active &&
      fet.gate &&
      !ets._fetLocked &&
      shouldShow &&
      hasUserInteracted &&
      mode === 'explanation';

    if (fetValid) {
      console.log(`[resolveTextToDisplay] ✅ FET gate open for Q${idx + 1}`);
      this._lastQuestionTextByIndex.set(idx, fetText);
      return fetText;
    }

    // DEFAULT: QUESTION + BANNER
    const effectiveQObj = questions?.[idx] || this.quizService.questions?.[idx];

    // SAFETY: never reuse Q1's cache for other questions
    const cachedForThisIndex = this._lastQuestionTextByIndex.get(idx);

    const fallbackQuestion =
      qText ||
      cachedForThisIndex || // index scoped
      '[Recovery: question still loading…]';

    // Robust Banner Logic: Use stream banner OR calculate fallback
    let finalBanner = bannerText;

    if (isMulti && !finalBanner && effectiveQObj) {
      const numCorrect =
        effectiveQObj.options?.filter((o: Option) => o.correct).length || 0;
      const totalOpts = effectiveQObj.options?.length || 0;

      if (numCorrect > 0) {
        finalBanner =
          this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
            numCorrect,
            totalOpts,
          );
        console.log(
          `[resolveTextToDisplay] 🛠️ Calculated fallback banner for Q${idx + 1}: "${finalBanner}"`,
        );
      } else {
        console.warn(
          `[resolveTextToDisplay] ⚠️ Banner fallback failed: numCorrect=${numCorrect} for Q${idx + 1}`,
        );
      }
    }

    // FIXED: Show banner in question mode for multi-answer questions
    // Trust finalBanner if it exists (it implies multi-answer if it came from the service)
    const shouldShowBanner =
      (isMulti || !!finalBanner) && !!finalBanner && mode === 'question';

    // Only show banner when we have multi-answer question with banner text IN QUESTION MODE
    if (shouldShowBanner) {
      const merged = `${fallbackQuestion} <span class="correct-count">${finalBanner}</span>`;
      console.log(
        `[resolveTextToDisplay] 🎯 Question+banner for Q${idx + 1} (mode: ${mode})`,
      );
      this._lastQuestionTextByIndex.set(idx, merged);
      return merged;
    }

    if (qText) {
      this._lastQuestionTextByIndex.set(idx, qText);
    }

    return fallbackQuestion;
  }

  private emitContentAvailableState(): void {
    this.isContentAvailable$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (isAvailable: boolean) => {
        this.isContentAvailableChange.emit(isAvailable);
        this.quizDataService.updateContentAvailableState(isAvailable);
      },
      error: (error) => console.error('Error in isContentAvailable$:', error),
    });
  }

  private setupDisplayStateSubscription(): void {
    combineLatest([
      this.displayState$.pipe(distinctUntilChanged()), // ensure state changes trigger updates
      this.isQuizQuestionComponentInitialized.pipe(distinctUntilChanged()), // check initialization status
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([state, isInitialized]) => {
        if (isInitialized) {
          if (this.quizQuestionComponent) {
            if (state.mode === 'explanation' && state.answered) {
              console.log('Displaying explanation text.', {
                mode: state.mode,
                answered: state.answered,
              });
            } else {
              console.log('Displaying question text.', {
                mode: state.mode,
                answered: state.answered,
              });
            }
          } else {
            console.error(
              'QuizQuestionComponent is unexpectedly null during display update.',
            );
          }
        } else {
          console.info(
            'QuizQuestionComponent not ready. Skipping display update.',
            {
              state,
              isInitialized,
            },
          );
        }
      });
  }

  private fetchExplanationTextAfterRendering(
    question: QuizQuestion,
  ): Observable<string> {
    return new Observable<string>((observer) => {
      setTimeout(() => {
        this.fetchExplanationText(question).subscribe((explanation: string) => {
          observer.next(explanation);
          observer.complete();
        });
      }, 100); // delay to ensure rendering order
    });
  }

  configureDisplayLogic(): void {
    this.handleQuestionDisplayLogic().subscribe(({ isMultipleAnswer }) => {
      if (this.currentQuestionType === QuestionType.SingleAnswer) {
        this.shouldDisplayCorrectAnswers = false;
      } else {
        this.shouldDisplayCorrectAnswers = isMultipleAnswer;
      }
    });
  }

  private loadQuizDataFromRoute(): void {
    this.activatedRoute.paramMap.subscribe(async (params) => {
      const quizId = params.get('quizId');
      const questionIndex = Number(params?.get('questionIndex') ?? 1);
      const zeroBasedIndex = questionIndex - 1;

      if (quizId) {
        this.quizId = quizId;
        this.quizService.quizId = quizId;
        localStorage.setItem('quizId', quizId); // store quizId in localStorage
        this.currentQuestionIndexValue = zeroBasedIndex;
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
        }),
      )
      .subscribe();
  }

  private async loadQuestion(
    quizId: string,
    zeroBasedIndex: number,
  ): Promise<void> {
    if (zeroBasedIndex == null || isNaN(zeroBasedIndex)) {
      console.error('Question index is null or undefined');
      return;
    }

    try {
      const questions = await firstValueFrom(
        this.quizDataService.getQuestionsForQuiz(quizId),
      );
      if (
        questions &&
        questions.length > 0 &&
        zeroBasedIndex >= 0 &&
        zeroBasedIndex < questions.length
      ) {
        const question = questions[zeroBasedIndex];
        this.currentQuestion.next(question); // use 'next' to update BehaviorSubject
        this.isExplanationDisplayed = false; // reset explanation display state
        this.explanationToDisplay = '';

        // Reset explanation state
        this.explanationTextService.resetExplanationState();
        this.explanationTextService.resetExplanationText();

        this.quizService.setCurrentQuestion(question);

        setTimeout(() => {
          this.fetchExplanationTextAfterRendering(question);
        }, 300);
      } else {
        console.error('Invalid question index:', zeroBasedIndex);
      }
    } catch (error) {
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
        this.activatedRoute.paramMap.pipe(take(1)),
      );

      const data: [QuizQuestion[], string[]] = await firstValueFrom(
        this.fetchQuestionsAndExplanationTexts(params).pipe(
          takeUntil(this.destroy$),
        ),
      );

      const [questions, explanationTexts] = data;

      if (!questions || questions.length === 0) {
        console.warn('No questions found');
        return;
      }

      this.explanationTexts = explanationTexts;

      await Promise.all(
        questions.map(async (question, index) => {
          const explanation =
            this.explanationTexts[index] ?? 'No explanation available';
          this.explanationTextService.storeFormattedExplanation(
            index,
            explanation,
            question,
          );
        }),
      );

      // Set before test fetch
      this.explanationTextService.explanationsInitialized = true;

      this.initializeCurrentQuestionIndex();
    } catch (error) {
      console.error('Error in initializeQuestionData:', error);
    }
  }

  private fetchQuestionsAndExplanationTexts(
    params: ParamMap,
  ): Observable<[QuizQuestion[], string[]]> {
    this.quizId = params.get('quizId') ?? '';
    if (!this.quizId) {
      console.warn('No quizId provided in the parameters.');
      return of([[], []] as [QuizQuestion[], string[]]);
    }

    return forkJoin([
      this.quizDataService.getQuestionsForQuiz(this.quizId).pipe(
        catchError((error) => {
          console.error('Error fetching questions:', error);
          return of([] as QuizQuestion[]);
        }),
      ),
      this.quizDataService.getAllExplanationTextsForQuiz(this.quizId).pipe(
        catchError((error) => {
          console.error('Error fetching explanation texts:', error);
          return of([] as string[]);
        }),
      ),
    ]).pipe(
      map(([questions, explanationTexts]) => {
        return [questions, explanationTexts] as [QuizQuestion[], string[]];
      }),
    );
  }

  private initializeCurrentQuestionIndex(): void {
    this.quizService.currentQuestionIndex = 0;
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
        tap((isMultipleAnswer) => {
          const correctAnswers = question.options.filter(
            (option) => option.correct,
          ).length;
          const explanationDisplayed =
            this.explanationTextService.isExplanationTextDisplayedSource.getValue();
          const newCorrectAnswersText =
            isMultipleAnswer && !explanationDisplayed
              ? this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
                correctAnswers,
                question.options?.length ?? 0,
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
              shouldDisplayCorrectAnswers,
            );
          }
        }),
        map(() => void 0),
      );
  }

  private fetchExplanationText(question: QuizQuestion): Observable<string> {
    if (!question || !question.questionText) {
      console.error('Question is undefined or missing questionText');
      return of('No explanation available');
    }

    return this.quizDataService.getQuestionsForQuiz(this.quizId).pipe(
      switchMap((questions: QuizQuestion[] | null): Observable<string> => {
        // Defensive guard: ensure questions is non-null and not empty
        if (!questions || questions.length === 0) {
          console.error('No questions received from service.');
          return of('No explanation available');
        }

        // Find the index of the current question based on its text
        const questionIndex = questions.findIndex(
          (q) =>
            q.questionText.trim().toLowerCase() ===
            question.questionText.trim().toLowerCase(),
        );

        if (questionIndex < 0) {
          console.error('Current question not found in the questions array.');
          return of('No explanation available');
        }

        // Check if explanations are initialized
        if (!this.explanationTextService.explanationsInitialized) {
          console.warn(
            `[fetchExplanationText] ⏳ Explanations not initialized — returning fallback for Q${questionIndex}`,
          );
          return of('No explanation available');
        }

        // Safely return the formatted explanation text for the given question index
        return this.explanationTextService
          .getFormattedExplanationTextForQuestion(questionIndex)
          .pipe(map((text) => text ?? 'No explanation available'));
      }),
      catchError((error) => {
        // Catch any unexpected runtime errors
        console.error('Error fetching explanation text:', error);
        return of('No explanation available');
      }),
    );
  }

  private initializeCombinedQuestionData(): void {
    const questionIndex = this.quizService.getCurrentQuestionIndex();
    const currentQuizAndOptions$ = this.combineCurrentQuestionAndOptions();

    currentQuizAndOptions$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        console.log('Current Quiz and Options Data', data);
      },
      error: (err) =>
        console.error('Error combining current quiz and options:', err),
    });

    this.combinedQuestionData$ = combineLatest([
      currentQuizAndOptions$.pipe(
        startWith<{
          currentQuestion: QuizQuestion | null;
          currentOptions: Option[];
          explanation: string;
          currentIndex: number;
        } | null>(null),
      ),
      this.numberOfCorrectAnswers$.pipe(startWith(0)),
      this.isExplanationTextDisplayed$.pipe(startWith(false)),
      this.activeFetText$.pipe(startWith('')),
    ]).pipe(
      map(
        ([
          quiz,
          numberOfCorrectAnswers,
          isExplanationDisplayed,
          formattedExplanation,
        ]) => {
          const safeQuizData = quiz?.currentQuestion
            ? quiz
            : {
              currentQuestion: null,
              currentOptions: [],
              explanation: '',
              currentIndex: 0,
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
            selectionMessage,
          };

          return this.calculateCombinedQuestionData(
            currentQuizData,
            +(numberOfCorrectAnswers ?? 0),
            !!isExplanationDisplayed,
            formattedExplanation ?? '',
          );
        },
      ),
      filter((data): data is CombinedQuestionDataType => data !== null),
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
            maxSelections: 0,
          },
          currentOptions: [],
          options: [],
          questionText: 'Error loading question',
          explanation: '',
          correctAnswersText: '',
          isExplanationDisplayed: false,
          isNavigatingToPrevious: false,
          selectionMessage: '',
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
          value: [QuestionPayload | null, number],
        ): value is [QuestionPayload, number] => {
          const [payload] = value;
          return (
            !!payload &&
            !!payload.question &&
            Array.isArray(payload.options) &&
            payload.options.length > 0
          );
        },
      ),
      map(([payload, index]) => ({
        payload,
        index: Number.isFinite(index)
          ? index
          : this.currentIndex >= 0
            ? this.currentIndex
            : 0,
      })),
      filter(({ payload, index }) => {
        const expected =
          Array.isArray(this.questions) && index >= 0
            ? (this.questions[index] ?? null)
            : null;

        if (!expected) return true;

        const normalizedExpected = this.normalizeKeySource(
          expected.questionText,
        );
        const normalizedIncoming = this.normalizeKeySource(
          payload.question?.questionText,
        );

        if (
          normalizedExpected &&
          normalizedIncoming &&
          normalizedExpected !== normalizedIncoming
        ) {
          console.warn(
            '[combineCurrentQuestionAndOptions] Skipping stale payload for index',
            {
              index,
              normalizedExpected,
              normalizedIncoming,
            },
          );
          return false;
        }

        return true;
      }),
      map(({ payload, index }) => {
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
                : optionIndex,
          }))
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

        const normalizedQuestion: QuizQuestion = {
          ...payload.question,
          options: normalizedOptions,
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
          currentIndex: index,
        };
      }),
      distinctUntilChanged((prev, curr) => {
        const norm = (s?: string) =>
          (s ?? '')
            .replace(/<[^>]*>/g, ' ') // strip HTML
            .replace(/&nbsp;/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');

        const questionKey = (
          q: QuizQuestion | null | undefined,
          idx?: number,
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
          curr.currentOptions,
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error) => {
        console.error('Error in combineCurrentQuestionAndOptions:', error);
        return of({
          currentQuestion: null,
          currentOptions: [],
          explanation: '',
          currentIndex: -1,
        });
      }),
    );
  }

  private haveSameOptionOrder(
    left: Option[] = [],
    right: Option[] = [],
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
    formattedExplanation: string,
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
        selectionMessage: '',
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
          totalOptions,
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
      selectionMessage: '',
    };
    return combinedQuestionData;
  }

  handleQuestionDisplayLogic(): Observable<{
    combinedData: CombinedQuestionDataType;
    isMultipleAnswer: boolean;
  }> {
    // Ensure combinedQuestionData$ is always defined with a safe fallback
    const safeCombined$ =
      this.combinedQuestionData$ ??
      of<CombinedQuestionDataType>({
        currentQuestion: {
          questionText: 'No question available',
          options: [],
          explanation: '',
          selectedOptions: [],
          answer: [],
          selectedOptionIds: [],
          type: undefined,
          maxSelections: 0,
        },
        currentOptions: [],
        options: [],
        questionText: 'No question available',
        explanation: '',
        correctAnswersText: '',
        isExplanationDisplayed: false,
        isNavigatingToPrevious: false,
        selectionMessage: '',
      });

    // Main observable pipeline
    return safeCombined$.pipe(
      takeUntil(this.destroy$),
      switchMap((combinedData) => {
        // Ensure currentQuestion exists before proceeding
        if (combinedData && combinedData.currentQuestion) {
          this.currentQuestionType = combinedData.currentQuestion.type;

          // Use QuizQuestionManagerService to check question type
          return this.quizQuestionManagerService
            .isMultipleAnswerQuestion(combinedData.currentQuestion)
            .pipe(
              map((isMultipleAnswer) => ({
                combinedData,
                isMultipleAnswer,
              })),
            );
        } else {
          // Handle case where currentQuestion is missing
          this.currentQuestionType = undefined;
          return of({
            combinedData,
            isMultipleAnswer: false,
          });
        }
      }),
    );
  }

  private setupCorrectAnswersTextDisplay(): void {
    // Combining the logic to determine if the correct answers text should be displayed
    this.shouldDisplayCorrectAnswers$ = combineLatest([
      this.shouldDisplayCorrectAnswers$.pipe(
        startWith(false), // ensuring it has an initial value
        map((value) => value ?? false), // fallback to false if value is undefined
        distinctUntilChanged(),
      ),
      this.isExplanationDisplayed$.pipe(
        startWith(false), // ensuring it has an initial value
        map((value) => value ?? false), // fallback to false if value is undefined
        distinctUntilChanged(),
      ),
    ]).pipe(
      map(
        ([shouldDisplayCorrectAnswers, isExplanationDisplayed]) =>
          shouldDisplayCorrectAnswers && !isExplanationDisplayed,
      ),
      distinctUntilChanged(),
      catchError((error) => {
        console.error(
          'Error in shouldDisplayCorrectAnswers$ observable:',
          error,
        );
        return of(false); // default to not displaying correct answers in case of error
      }),
    );

    // Display correctAnswersText only if the above conditions are met
    this.displayCorrectAnswersText$ = this.shouldDisplayCorrectAnswers$.pipe(
      switchMap((shouldDisplay) => {
        return shouldDisplay ? this.correctAnswersText$ : of(null);
      }),
      distinctUntilChanged(),
      catchError((error) => {
        console.error('Error in displayCorrectAnswersText$ observable:', error);
        return of(null); // default to null in case of error
      }),
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
