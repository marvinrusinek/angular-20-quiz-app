import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import {
  animationFrameScheduler, BehaviorSubject, combineLatest, firstValueFrom,
  forkJoin, merge, Observable, of, Subject, Subscription
} from 'rxjs';
import {
  auditTime, catchError, debounceTime, distinctUntilChanged, filter, map,
  observeOn, shareReplay, skip, skipUntil, startWith, switchMap, take, takeUntil,
  tap, withLatestFrom
} from 'rxjs/operators';

import { CombinedQuestionDataType } from
  '../../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../../shared/models/Option.model';
import { QuestionType } from '../../../shared/models/question-type.enum';
import { QuestionPayload } from '../../../shared/models/QuestionPayload.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/quiz-navigation.service';
import { QuizQuestionLoaderService } from
  '../../../shared/services/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../shared/services/quizquestionmgr.service';
import { QuizStateService } from '../../../shared/services/quizstate.service';
import { ExplanationTextService, FETPayload } from
  '../../../shared/services/explanation-text.service';
import { QuizQuestionComponent } from
  '../../../components/question/quiz-question/quiz-question.component';

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
    // Remember the index and clear any old override
    this.currentIndex = idx;
    this.overrideSubject.next({ idx, html: '' });
    this.clearCachedQuestionArtifacts(idx);

    // Hard-align the ExplanationTextService with the active index so the
    // formatted explanation text stream starts from a clean slate and does not
    // replay the previous question's FET (e.g., Q1 on Q4's first click).
    const ets = this.explanationTextService;
    ets._activeIndex = idx;

    // Check if ANY option in this question has been selected
    // This is the most reliable check - options are the source of truth
    const currentQuestion = this.quizService.questions[idx];
    const hasSelectedOption =
      currentQuestion?.options?.some((o: Option) => o.selected) ?? false;

    if (!hasSelectedOption) {
      // No valid FET for this question = it wasn't answered, clear everything
      ets.resetForIndex(idx);
      ets.latestExplanation = '';
      ets.latestExplanationIndex = idx;
      ets.formattedExplanationSubject.next('');
      ets.explanationText$.next('');
      // Clear any cached FET for this index to prevent stale FET display
      ets.fetByIndex.delete(idx);
      // Also clear the local question text cache which may have stale FET
      this._lastQuestionTextByIndex?.delete(idx);
      // Clear stale selectedOptionsMap entry so isAnswered() returns false
      this.quizService.selectedOptionsMap?.delete(idx);
      // Clear session tracking so stale FET won't persist
      this._fetDisplayedThisSession?.delete(idx);
      ets.setShouldDisplayExplanation(false, { force: true });
      ets.setIsExplanationTextDisplayed(false, { force: true });
      this.quizStateService.setDisplayState({ mode: 'question', answered: false });
    } else {
      // Has valid FET: preserve state for persistence
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

  private _lastQuestionTextByIndex = new Map<number, string>();

  // Session-based tracking: which questions have had FET displayed this session
  private _fetDisplayedThisSession = new Set<number>();

  private overrideSubject =
    new BehaviorSubject<{ idx: number; html: string }>({ idx: -1, html: '' });
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
        (a: FETPayload, b: FETPayload) => a.idx === b.idx && a.text === b.text
      )
    );

  public activeFetText$: Observable<string> = this.formattedExplanation$.pipe(
    withLatestFrom(this.quizService.currentQuestionIndex$),
    map(([payload, idx]:
      [FETPayload, number]) => (payload?.idx === idx ? (payload.text ?? '') : '')),
    startWith(''),
    distinctUntilChanged()
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

  questionRendered: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);

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
    private cdRef: ChangeDetectorRef
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;
    this.previousQuestion$ = this.quizService.previousQuestion$;
    this.displayState$ = this.quizStateService.displayState$;

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

    // ⚡ FIX: Clear user interaction state to ensure question text shows first
    this.quizStateService._hasUserInteracted?.clear();

    this.setupQuestionResetSubscription();
    this.initDisplayTextPipeline();
    this.resetExplanationService();
    this.subscribeToDisplayText();
    this.setupContentAvailability();
    this.emitContentAvailableState();
    this.loadQuizDataFromRoute();
    await this.initializeComponent();
    this.setupCorrectAnswersTextDisplay();

    // ⚡ FIX: Reset latestExplanationIndex on init to prevent stale FET on reload
    this.explanationTextService.latestExplanationIndex = null;


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
      subscription.unsubscribe()
    );
    this.pendingExplanationRequests.clear();
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
    // Resolve the correct question object (respecting shuffle) for the current index
    const questionForIndex$ = this.quizService.currentQuestionIndex$.pipe(
      switchMap((idx: number) => this.quizService.getQuestionByIndex(idx))
    );

    this.displayText$ = combineLatest([
      this.displayState$ || of({ mode: 'question' as const, answered: false }),
      this.questionToDisplay$ || of(''),
      this.formattedExplanation$,
      this.currentIndex$,
      this.quizService.questions$.pipe(
        filter((q: QuizQuestion[]) => Array.isArray(q) && q.length > 0),
        startWith(this.quizService.questions || [])
      ),
      questionForIndex$,
    ]).pipe(
      debounceTime(50),
      switchMap(([state, qText, fetPayload, idx, questions, questionObj]: [
        { mode: 'question' | 'explanation'; answered: boolean },
        string | null,
        FETPayload,
        number,
        QuizQuestion[],
        QuizQuestion | null
      ]) => {
        const safeIdx = Number.isFinite(idx)
          ? idx
          : Number.isFinite(this.currentIndex)
            ? this.currentIndex
            : 0;

        const rawQText = (qText as string)?.trim();

        // ⚡ FIX: ALWAYS prioritize questionObj (from getQuestionByIndex via questionForIndex$)
        // This is the ONLY source that correctly respects shuffle state and matches the options.
        // The questions array from questions$ can be stale and cause text/options mismatch.
        const qObj =
          questionObj ||
          (Array.isArray(questions) ? questions[safeIdx] : undefined) ||
          (Array.isArray(this.quizService.questions)
            ? this.quizService.questions[safeIdx]
            : undefined);

        return this.quizService.isAnswered(safeIdx).pipe(
          map((isAnswered: boolean) => {
            const mode = isAnswered ? (state?.mode || 'question') : 'question';
            const dummyQText = (qText ?? '').trim();
            const trimmedQText = dummyQText;

            const numCorrect =
              qObj?.options?.filter((o: Option) => o.correct).length || 0;
            const isMulti = numCorrect > 1;

            let bannerText = '';
            if (isMulti && qObj) {
              const totalOpts = qObj.options?.length || 0;
              bannerText =
                this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
                  numCorrect,
                  totalOpts
                );
            }

            const hasFetStored = this.explanationTextService.fetByIndex?.has(safeIdx) &&
              (this.explanationTextService.fetByIndex?.get(safeIdx)?.trim()?.length ?? 0) > 10;
            const actuallyAnswered = isAnswered && hasFetStored;

            if (!actuallyAnswered) {
              const serviceQText = (questionObj?.questionText ?? '').trim();

              // ⚡ FIX: ALWAYS prefer question text from questionObj (via getQuestionByIndex)
              // The questionToDisplay$ input is often stale and lags behind navigation.
              // questionObj comes from getQuestionByIndex which respects shuffle and
              // is the same source as options, ensuring text and options are synchronized.
              const effectiveQText = serviceQText || rawQText || '';

              if (!effectiveQText) {
                console.warn(`[displayText$] ⚠️ Q${safeIdx + 1} No safe text available yet.`);
                return '';
              }

              // Show banner for multi-answer questions when we have valid text
              if (isMulti && bannerText && effectiveQText) {
                return `${effectiveQText} <span class="correct-count">${bannerText}</span>`;
              }
              return effectiveQText;
            }

            const belongsToIndex = fetPayload?.idx === safeIdx;
            const trimmedFet = belongsToIndex
              ? (fetPayload?.text ?? '').trim()
              : '';

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
              return 'No explanation available.';
            }

            if (!trimmedQText) return '';

            if (isMulti && bannerText) {
              return `${trimmedQText} <span class="correct-count">${bannerText}</span>`;
            }

            return trimmedQText;
          })
        );
      }),
      distinctUntilChanged()
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
    this.combinedText$ = this.getCombinedDisplayTextStream();

    // ⚡ FIX: Create a PERSISTENT subscription that updates question text on EVERY index change
    // This is the authoritative mechanism that ensures question text matches options.
    // getQuestionByIndex is the same source used for options, guaranteeing synchronization.
    this.quizService.currentQuestionIndex$.pipe(
      switchMap((idx: number) => {
        console.log(`[CQCC] 📍 Index changed to ${idx}, fetching question text...`);
        return this.quizService.getQuestionByIndex(idx);
      }),
      filter((question: QuizQuestion | null): question is QuizQuestion =>
        question !== null && !!question.questionText?.trim()
      )
    ).subscribe({
      next: (question: QuizQuestion) => {
        const el = this.qText?.nativeElement;
        const idx = this.quizService.getCurrentQuestionIndex();



        if (el) {
          let text = question.questionText.trim();

          // Calculate if this is a multi-answer question and add the banner
          const numCorrect = question.options?.filter((o: Option) => o.correct).length ?? 0;
          const isMulti = numCorrect > 1;

          if (isMulti) {
            const totalOpts = question.options?.length ?? 0;
            const banner = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
              numCorrect,
              totalOpts
            );
            if (banner) {
              text = `${text} <span class="correct-count">${banner}</span>`;
              console.log(`[CQCC] ⚡ Multi-answer Q: Adding banner "${banner}"`);
            }
          }

          console.log(`[CQCC] ⚡ Setting text for Q: "${text.slice(0, 50)}..."`);
          el.innerHTML = text;
        }
      },
      error: (err: Error) => console.error('[CQCC] Error in index subscription:', err)
    });

    // Still set up combinedText$ for FET (explanation text) handling
    setTimeout(() => {
      if (this.combinedText$ && !this.combinedSub) {
        console.log(`[CQCC TIMEOUT] Setting up subscription to combinedText$...`);
        this.combinedSub = this.combinedText$
          .pipe(distinctUntilChanged())
          .subscribe({
            next: (v: string) => {
              const el = this.qText?.nativeElement;

              if (el && v) {
                // Hard Override: Force verified FET display if it exists for this question
                // This solves issues where combinedText$ might revert to question text due to logic complexity
                const fet = this.explanationTextService.formattedExplanationSubject.value;
                const fetIdx = this.explanationTextService.latestExplanationIndex;
                const currentIdx = this.quizService.getCurrentQuestionIndex();

                if (fet?.trim() && fetIdx === currentIdx && fet !== v) {
                  el.innerHTML = fet;
                  this.cdRef.markForCheck();
                } else {
                  el.innerHTML = v;
                }
              }
            },
            error: (err: Error) => console.error('[CQCC displayText$ error]', err)
          });
      }
    }, 50);
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
    const normalizedIndex = Number.isFinite(index) ? Number(index) : -1;
    const keyPrefix = `${normalizedIndex}:`;

    const pruneMap = <T>(
      store: Map<string, T>,
      onRemove?: (value: T, key: string) => void
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
    pruneMap(this.pendingExplanationRequests, (subscription: Subscription) => {
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
      tap((newIdx: number) => {
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
        ets.setGate(newIdx, false);

        if (ets._activeIndex !== null && ets._activeIndex !== newIdx) {
          ets.setGate(ets._activeIndex, false);
        }
      }),
      debounceTime(50),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ⚡ FIX: Create an AUTHORITATIVE observable that gets question text directly from
    // getQuestionByIndex every time the index changes. This is the SAME source as options,
    // guaranteeing absolute synchronization between question text and answer options.
    // 
    // IMPORTANT: The ONLY source of truth for question text must be getQuestionByIndex.
    // However, we also need to handle Q1's initial load when questions might not be ready.

    // Primary source: getQuestionByIndex (authoritative, same as options)
    const authoritativeText$ = index$.pipe(
      switchMap((idx: number) => {
        console.log(`[questionText$] 🔄 Index changed to ${idx}, fetching from getQuestionByIndex...`);
        return this.quizService.getQuestionByIndex(idx);
      }),
      filter((question: QuizQuestion | null): question is QuizQuestion => question !== null && !!question.questionText),
      map((question: QuizQuestion) => (question.questionText ?? '').trim()),
      filter((text: string) => text.length > 0),
      tap((text: string) =>
        console.log(
          `[questionText$] 🔑 AUTHORITATIVE: "${text.slice(0, 80)}"`
        )
      )
    );

    // Fallback for Q1 initial load: try to get text from quizService.questions directly
    const initialFallback$ = this.quizService.questions$.pipe(
      filter((questions: QuizQuestion[]) => Array.isArray(questions) && questions.length > 0),
      take(1),
      switchMap((questions: QuizQuestion[]) => {
        const idx = this.currentQuestionIndexValue ?? 0;
        const question = questions[idx];
        if (question && question.questionText?.trim()) {
          console.log(`[questionText$] 🔶 FALLBACK Q${idx + 1}: "${question.questionText.slice(0, 80)}"`);
          return of(question.questionText.trim());
        }
        return of('');
      }),
      filter((text: string) => text.length > 0)
    );

    // Merge: Authoritative source wins after initial, fallback provides Q1 initial display
    const questionText$ = merge(
      initialFallback$,      // Emits once for Q1 initial load
      authoritativeText$     // Takes over for all subsequent changes
    ).pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const correctText$ = this.quizService.correctAnswersText$.pipe(
      map((v: string | null) => v?.trim() || ''),
      startWith(''),
      debounceTime(25),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const fetForIndex$ = combineLatest([
      (this.explanationTextService.formattedExplanation$ ?? of('')).pipe(
        startWith('')
      ),
      (this.explanationTextService.shouldDisplayExplanation$ ?? of(false)).pipe(
        startWith(false)
      ),
      (this.explanationTextService.activeIndex$ ?? of(-1)).pipe(startWith(-1))
    ]).pipe(
      auditTime(0),
      map(([payload, gate, idx]: [FETPayload | string, boolean, number]) => ({
        idx,
        text: (typeof payload === 'string' ? payload : payload?.text ?? '').trim(),
        gate: !!gate
      })),
      distinctUntilChanged(
        (a: { idx: number; text: string; gate: boolean },
          b: { idx: number; text: string; gate: boolean }) =>
          a.idx === b.idx && a.gate === b.gate && a.text === b.text
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const shouldShow$ =
      this.explanationTextService.shouldDisplayExplanation$.pipe(
        map(Boolean),
        startWith(false),
        distinctUntilChanged(),
        auditTime(16),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    const navigating$ = this.quizStateService.isNavigatingSubject.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const qQuiet$ = this.quizQuestionLoaderService.quietZoneUntil$
      ? this.quizQuestionLoaderService.quietZoneUntil$.pipe(
        startWith(0),
        distinctUntilChanged()
      )
      : of(0);

    const eQuiet$ = this.explanationTextService.quietZoneUntil$
      ? this.explanationTextService.quietZoneUntil$.pipe(
        startWith(0),
        distinctUntilChanged()
      )
      : of(0);

    // Display mode and explanation readiness
    const displayState$ = this.quizStateService.displayState$;
    const explanationReady$ = this.quizStateService.explanationReady$;

    type CombinedTuple = [
      number,  // index$
      string,  // questionText$
      string,  // correctText$
      { idx: number; text: string; gate: boolean },  // fetForIndex$
      boolean,  // shouldShow$
      boolean,  // navigating$
      number,  // qQuiet$
      number,  // eQuiet$
      QuizQuestion[]  // questions$
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
        map(() => this.quizService.questions || [])
      )
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
        []
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
          eQuiet
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
          filter((idx: number) => Number.isFinite(idx)),
          take(1)
        )
      ),

      filter(([idx, , , fet]: CombinedTuple) => {
        // ⚡ RELAXED GUARD: Trust the FET if it exists. 
        // validText ensures we don't block display if index logic drifts.
        const validText = !!fet?.text?.trim();
        const indexMatch = fet?.idx === idx;
        const isMatch = indexMatch || validText;

        if (!isMatch && !validText) {
          console.log(
            `[DisplayGate] 🚫 Suppressing empty/mismatched FET (fet.idx=${fet?.idx}, current=${idx})`
          );
        }

        return isMatch;
      }),

      withLatestFrom(this.quizService.currentQuestionIndex$),

      filter(
        ([
          [idx, question, banner, fet, shouldShow, navigating, qQuiet, eQuiet],
          liveIdx
        ]: [CombinedTuple, number]) => {
          const valid = idx === liveIdx;

          if (!valid) {
            console.warn('[INDEX GATE] Dropping stale emission', {
              streamIndex: idx,
              liveIndex: liveIdx,
              fetIdx: fet?.idx
            });
          }

          return valid;
        }
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
            questions
          ]
        ]: [CombinedTuple, number]) =>
          [
            idx,
            question,
            banner,
            fet,
            shouldShow,
            navigating,
            qQuiet,
            eQuiet,
            questions
          ] as CombinedTuple
      ),

      auditTime(32),
      filter(
        ([, question]: CombinedTuple) =>
          typeof question === 'string' && question.trim().length > 0
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
          questions
        ]: CombinedTuple) => {
          console.log(
            `[getCombinedDisplayTextStream] Q${idx + 1} before resolveTextToDisplay:`,
            {
              questionsLength: questions?.length,
              serviceQuestionsLength: this.quizService.questions?.length,
              banner,
              idx
            }
          );
          // ⚡ ADAPTER: If we have valid FET text, assume it belongs to this question (idx)
          // to bypass strict index checks in resolveTextToDisplay.
          if (fet && fet.text && fet.idx !== idx) {
            fet = { ...fet, idx: idx };
          }

          return this.resolveTextToDisplay(
            idx,
            question,
            banner,
            fet,
            shouldShow,
            questions
          );
        }
      ),

      auditTime(16),
      distinctUntilChanged((a: string, b: string) => a.trim() === b.trim())
    );

    // FINAL LAYER: explanation wins
    return combineLatest([
      base$,
      displayState$,
      explanationReady$,
      this.explanationTextService.formattedExplanation$.pipe(startWith('')),
      this.quizService.currentQuestionIndex$,
    ]).pipe(
      map(([baseText, displayState, explanationReady, formatted, idx]:
        [unknown, any, boolean, any, number]) => {
        const mode = displayState?.mode ?? 'question';
        const base = String(baseText ?? '') as string;

        // Normal explanation-mode override
        // Important: Must also verify that THIS question (idx) was actually answered.
        // Otherwise, if mode stays 'explanation' after navigating from an answered question,
        // Q3 (unanswered) would show stale FET instead of its question text.
        if (mode === 'explanation') {
          const quizId = this.quizId ?? '';
          const qState = quizId ?
            this.quizStateService.getQuestionState(quizId, idx) : null;
          const isThisQuestionAnswered =
            qState?.isAnswered || qState?.explanationDisplayed;

          // Only show FET if THIS question was actually answered
          if (isThisQuestionAnswered) {
            // ONLY use index-specific FET, not global fet/latestExplanation
            // Global values could be stale from a different question (e.g., Q2's FET showing on Q3)
            const indexFet = this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';

            if (indexFet) {
              return indexFet as string;
            }

            if (explanationReady) {
              return 'Explanation not available.' as string;
            }
          }
          // If question not answered but mode is 'explanation', fall through to default (question text)
        }

        // Hard Override: once answered, FET wins if it exists
        // ⚡ FIX: Check fetByIndex directly without relying on quizId matching
        // (quizId may differ between QuizQuestionComponent and this component)
        try {
          const indexFet = this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';

          if (indexFet) {
            console.log(`[CQCC Final] Direct FET check for idx=${idx}: "${indexFet.substring(0, 30)}..."`);
            return indexFet as string;
          }

          // Also check quizStateService for isAnswered (with fallback quizId)
          const quizId = this.quizId || this.quizService?.quizId || 'default';
          const qState = this.quizStateService.getQuestionState(quizId, idx);
          const isAnswered = qState?.isAnswered || qState?.explanationDisplayed;

          if (isAnswered) {
            console.log(`[CQCC Final] isAnswered=true but no FET for idx=${idx}, using base`);
          }
        } catch (err: any) {
          console.warn('[CQCC] ⚠️ Hard Override check failed', err);
        }

        // Default: use base text (usually question)
        return base;
      }),
      distinctUntilChanged((a: string, b: string) => a.trim() === b.trim()),
      observeOn(animationFrameScheduler),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean,
    questions: QuizQuestion[] = []
  ): string {
    const qText = (question ?? '').trim();
    const bannerText = (banner ?? '').trim();
    const fetText = (fet?.text ?? '').trim();
    const active = this.quizService.getCurrentQuestionIndex();

    // Use service questions as primary source (loaded synchronously)
    let qObj = this.quizService.questions[idx] || questions[idx];

    // ⚡ FIX: Mismatch Guard
    // If the provided qText doesn't match the object at this index (e.g. Shuffle Mismatch),
    // try to find the actual question object by matching the text.
    // This ensures we get the correct "isMulti" / banner logic for the QUESTION THAT IS ACTUALLY DISPLAYED.
    if (qText && qObj && qObj.questionText !== qText) {
      console.warn(`[resolveTextToDisplay] ⚠️ Index Mismatch! Displaying="${qText.substring(0, 15)}..." but Q[${idx}]="${qObj.questionText.substring(0, 15)}..."`);
      const matchedQ = questions.find((q: QuizQuestion) => q.questionText === qText) ||
        this.quizService.questions.find((q: QuizQuestion) => q.questionText === qText);

      if (matchedQ) {
        console.log(`[resolveTextToDisplay] 🛡️ Recovered question object by text lookup.`);
        qObj = matchedQ;
      }
    }

    // Calculate isMulti early for use throughout the function
    const numCorrectForMultiCheck =
      qObj?.options?.filter((o: Option) => o.correct).length || 0;
    const isMulti = numCorrectForMultiCheck > 1;

    const ets = this.explanationTextService;
    const mode = this.quizStateService.displayStateSubject?.value?.mode;

    const hasUserInteracted =
      this.quizStateService.hasUserInteracted(idx) ?? false;

    // Ensure we have index-scoped cache map
    if (!this._lastQuestionTextByIndex) {
      (this as any)._lastQuestionTextByIndex = new Map<number, string>();
    }

    // Always cache a “last known good” QUESTION text per index
    if (qText) {
      this._lastQuestionTextByIndex.set(idx, qText);
    }

    // Use fetByIndex Map as primary source - bypasses stream timing issues
    // Only use index-specific FET, NOT latestExplanation (could be stale from different question)
    const storedFet = ets.fetByIndex?.get(idx)?.trim() || '';
    const hasValidFet = storedFet.length > 0;

    // Show FET if: we have content stored for this index, we're on the active question,
    // AND the user has actually interacted with this question (answered it) in explanation mode.
    // Without hasUserInteracted check, unanswered questions like Q3 would display cached FET
    // instead of the question text.
    if (
      hasValidFet &&
      idx === active &&
      hasUserInteracted &&
      mode === 'explanation'
    ) {
      const safe = storedFet;

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
              totalOpts
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
    const effectiveQObj = questions[idx] || this.quizService.questions[idx];

    // SAFETY: never reuse Q1's cache for other questions
    const cachedForThisIndex = this._lastQuestionTextByIndex.get(idx);

    const fallbackQuestion =
      qText ||
      cachedForThisIndex ||  // index scoped
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
            totalOpts
          );
        console.log(
          `[resolveTextToDisplay] 🛠️ Calculated fallback banner for Q${idx + 1}: "${finalBanner}"`
        );
      } else {
        console.warn(
          `[resolveTextToDisplay] ⚠️ Banner fallback failed: numCorrect=${numCorrect} for Q${idx + 1}`
        );
      }
    }

    // Show banner in question mode for multi-answer questions
    // Trust finalBanner if it exists (it implies multi-answer if it came from the service)
    const shouldShowBanner =
      (isMulti || !!finalBanner) && !!finalBanner && mode === 'question';

    // Only show banner when we have multi-answer question with banner text IN QUESTION MODE
    if (shouldShowBanner) {
      const merged =
        `${fallbackQuestion} <span class="correct-count">${finalBanner}</span>`;
      console.log(
        `[resolveTextToDisplay] 🎯 Question+banner for Q${idx + 1} (mode: ${mode})`
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
        localStorage.setItem('quizId', quizId);  // store quizId in localStorage
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
      const questions = await firstValueFrom(
        this.quizDataService.getQuestionsForQuiz(quizId)
      );
      if (
        questions &&
        questions.length > 0 &&
        zeroBasedIndex >= 0 &&
        zeroBasedIndex < questions.length
      ) {
        const question = questions[zeroBasedIndex];
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

      await Promise.all(
        questions.map(async (question, index) => {
          const explanation =
            this.explanationTexts[index] ?? 'No explanation available';
          this.explanationTextService.storeFormattedExplanation(
            index,
            explanation,
            question
          );
        }),
      );

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
      map(([questions, explanationTexts]: [QuizQuestion[], string[]]) => {
        return [questions, explanationTexts];
      })
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