import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { animationFrameScheduler, BehaviorSubject, combineLatest, defer, firstValueFrom, forkJoin, Observable, of, Subject, Subscription } from 'rxjs';
import { auditTime, catchError, debounceTime, distinctUntilChanged, filter, map, observeOn, shareReplay, skip, skipUntil, startWith, switchMap, take, takeUntil, tap, withLatestFrom } from 'rxjs/operators';

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
import { ExplanationTextService } from '../../../shared/services/explanation-text.service';
import { QuizQuestionComponent } from '../../../components/question/quiz-question/quiz-question.component';

interface QuestionViewState {
  index: number,
  key: string,
  markup: string,
  fallbackExplanation: string,
  question: QuizQuestion | null
}

@Component({
  selector: 'codelab-quiz-content',
  standalone: true,
  templateUrl: './codelab-quiz-content.component.html',
  styleUrls: ['./codelab-quiz-content.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CodelabQuizContentComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild(QuizQuestionComponent, { static: false })
  quizQuestionComponent!: QuizQuestionComponent;
  
  /* set quizQuestionComponent(component: unknown) {
    this._quizQuestionComponent = component as QuizQuestionComponent | undefined;
  }

  get quizQuestionComponent(): QuizQuestionComponent | undefined {
    return this._quizQuestionComponent;
  } */
  
  @ViewChild('qText', { static: true })
  qText!: ElementRef<HTMLHeadingElement>;
  @Output() isContentAvailableChange = new EventEmitter<boolean>();
  @Input() combinedQuestionData$: Observable<CombinedQuestionDataType> | null = null;
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
  @Input() displayVariables!: { question: string, explanation: string };
  @Input() localExplanationText = '';
  @Input() showLocalExplanation = false;

  @Input() set explanationOverride(o: { idx: number, html: string }) {
    this.overrideSubject.next(o);
  }

  @Input() set questionIndex(idx: number) {
    // Remember the index and clear any old override
    this.currentIndex = idx;
    this.overrideSubject.next({ idx, html: '' });
    this.clearCachedQuestionArtifacts(idx);
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

  shouldDisplayCorrectAnswers = false;
  private shouldDisplayCorrectAnswersSubject: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  shouldDisplayCorrectAnswers$ = this.shouldDisplayCorrectAnswersSubject.asObservable();
  currentQuestionIndexValue = 0;
  currentQuestion$: BehaviorSubject<QuizQuestion | null> = new BehaviorSubject<QuizQuestion | null>(null);
  currentOptions$: BehaviorSubject<Option[] | null> = new BehaviorSubject<Option[] | null>([]);
  currentQuestionIndex$!: Observable<number>;
  nextQuestion$: Observable<QuizQuestion | null>;
  previousQuestion$: Observable<QuizQuestion | null>;
  isNavigatingToPrevious = false;
  currentQuestionType: QuestionType | undefined = undefined;
  _lastQuestionText = '';

  private overrideSubject = new BehaviorSubject<{ idx: number; html: string }>({ idx: -1, html: '' });
  private currentIndex = -1;
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
  formattedExplanation$ = this.explanationTextService.formattedExplanation$;

  numberOfCorrectAnswers$: BehaviorSubject<string> = new BehaviorSubject<string>('0');

  correctAnswersTextSource: BehaviorSubject<string> = new BehaviorSubject<string>('');
  correctAnswersText$ = this.correctAnswersTextSource.asObservable();

  public displayCorrectAnswersText$!: Observable<string | null>;

  explanationText: string | null = null;
  explanationTexts: string[] = [];

  private correctAnswersDisplaySubject = new Subject<boolean>();

  questionRendered: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

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
    private ngZone: NgZone
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;
    this.previousQuestion$ = this.quizService.previousQuestion$;

    this.quizNavigationService
      .getIsNavigatingToPrevious()
      .subscribe((isNavigating: boolean) => {
        this.isNavigatingToPrevious = isNavigating;
      });

    this.isExplanationTextDisplayed$ = this.explanationTextService.isExplanationTextDisplayed$;
  }

  async ngOnInit(): Promise<void> {
    this.isExplanationDisplayed = false;
    this.explanationTextService.setIsExplanationTextDisplayed(false);

    if (this.questionToDisplay$) {
      combineLatest([
        this.questionToDisplay$.pipe(startWith(''), distinctUntilChanged()),
        this.quizService.currentQuestionIndex$.pipe(
          startWith(this.quizService?.currentQuestionIndex ?? 0)
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

    this.resetExplanationView();

    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.explanationText$.next('');

    this.explanationTextService.resetForIndex(0);
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });

    // Build the stream only once globally
    this.combinedText$ = this.getCombinedDisplayTextStream();

    // Always subscribe after the stream is created
    // Use a small delay so as not to subscribe to an undefined observable
    setTimeout(() => {
      if (this.combinedText$ && !this.combinedSub) {
        this.combinedSub = this.combinedText$
          .pipe(distinctUntilChanged())
          .subscribe({
            next: (v) => {
              const el = this.qText?.nativeElement;
              if (!el) return;

              // Run inside Angular's zone so FET + banner are reactive
              this.ngZone.run(() => {
                requestAnimationFrame(() => {
                  const incoming = v ?? '';
                  const plainText = incoming
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/&nbsp;/gi, ' ')
                    .trim();

                  // Skip transient placeholder frames (e.g. a lone question mark)
                  if (plainText === '?') {
                    return;
                  }

                  // Fade-out
                  el.style.transition = 'opacity 0.12s linear';
                  el.style.opacity = '0.4';

                  // Update content atomically
                  el.innerHTML = incoming || '';

                  // Fade-in again
                  requestAnimationFrame(() => {
                    el.style.opacity = '1';
                  });

                  // Force Angular to refresh bindings that depend on FET state
                  this.cdRef.detectChanges();
                });
              });
            },
            error: (err) => console.error('[CQCC combinedText$ error]', err),
          });
      }
    }, 20);


    this.combinedQuestionData$ = this.combineCurrentQuestionAndOptions().pipe(
      map(({ currentQuestion, currentOptions }) => {
        const questionText = currentQuestion?.questionText?.trim() ?? 'No question available';
        const options = currentOptions ?? [];
        const explanationText = currentQuestion?.explanation?.toString().trim() ?? 'No explanation available';

        return {
          questionText,
          options,
          explanation: explanationText,
          currentQuestion,
          isNavigatingToPrevious: false,
          isExplanationDisplayed: false,
          selectionMessage: '',
        } satisfies CombinedQuestionDataType;
      }),
      catchError((err) => {
        console.error('[❌ combinedQuestionData$ error]:', err);
        return of({
          questionText: 'Error loading question',
          options: [],
          explanation: '',
          currentQuestion: null,
          isNavigatingToPrevious: false,
          isExplanationDisplayed: false,
          selectionMessage: 'Unable to load question.'
        } satisfies CombinedQuestionDataType);
      })
    );

    this.isContentAvailable$ = this.combineCurrentQuestionAndOptions().pipe(
      map(({ currentQuestion, currentOptions }) => {
        return !!currentQuestion && currentOptions.length > 0;
      }),
      distinctUntilChanged(),
      catchError((error) => {
        console.error('Error in isContentAvailable$:', error);
        return of(false);  // fallback to `false` in case of errors
      }),
      startWith(false)
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

    this.emitContentAvailableState();  // start emitting the content availability state

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
      this.initializeExplanationTextObservable();
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
        // Completely clear explanation state *before* CombineLatest runs again
        ets._activeIndex = newIdx;
        ets.latestExplanation = '';
        ets.formattedExplanationSubject?.next('');
        ets.setShouldDisplayExplanation(false);
        ets.setIsExplanationTextDisplayed(false);
        ets.setGate?.(newIdx, false);
        console.log(`[INDEX] 🔄 Reset FET streams for new index → ${newIdx}`);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );    

    const questionText$ = defer(() => this.questionToDisplay$).pipe(
      map(q => (q ?? '').trim()),                     // normalize to trimmed strings
      filter(q => q.length > 0),                      // skip empty startup emissions
      debounceTime(0),                                // merge microtasks in one tick
      observeOn(animationFrameScheduler),             // wait for paint frame
      distinctUntilChanged(),                         // avoid same-string repaint
      shareReplay({ bufferSize: 1, refCount: true })  // cache latest stable text
    );
  
    /* const questionText$ = this.questionToDisplay$.pipe(
      map(q => (q ?? '').trim()),
      filter(q => q.length > 0 && q !== '?'),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    ); */
  
    const correctText$ = this.quizService.correctAnswersText$.pipe(
      map(v => v?.trim() || ''),
      startWith(''),
      debounceTime(25),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  
    // FET source with explicit idx
    // Seed FET inputs so fetForIndex$ emits once at startup
    // FET stream — resets cleanly after each purge
    const fetForIndex$ = combineLatest([
      (this.explanationTextService.formattedExplanation$ ?? of('')).pipe(startWith('')),
      (this.explanationTextService.shouldDisplayExplanation$ ?? of(false)).pipe(startWith(false)),
      (this.explanationTextService.activeIndex$ ?? of(-1)).pipe(startWith(-1))
    ]).pipe(
      auditTime(0),
      map(([text, gate, idx]) => ({ idx, text: (text ?? '').trim(), gate: !!gate })),
      distinctUntilChanged((a,b)=>a.idx===b.idx && a.gate===b.gate && a.text===b.text),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  
    const shouldShow$ = this.explanationTextService.shouldDisplayExplanation$.pipe(
      map(Boolean),
      startWith(false),        // seed initial value so combineLatest emits immediately
      distinctUntilChanged(),
      auditTime(16),           // stabilizes quick flips
      shareReplay({ bufferSize: 1, refCount: true })
    );
  
    // Navigating gate
    const navigating$ = this.quizStateService.isNavigatingSubject.pipe(
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Quiet zone observables (mirrors service-level _quietZoneUntil)
    // Used to temporarily gate rendering after navigation
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
  
    // ────────────────────────────────────────────────
    // Combine everything with strong gating
    // ────────────────────────────────────────────────
    type CombinedTuple = [
      number, // index$
      string, // questionText$
      string, // correctText$
      { idx: number; text: string; gate: boolean },  // fetForIndex$
      boolean, // shouldShow$
      boolean, // navigating$
      number,  // qQuiet$
      number   // eQuiet$
    ];

    return combineLatest<CombinedTuple>([
      index$,
      questionText$,
      correctText$,
      fetForIndex$,
      shouldShow$,
      navigating$,
      qQuiet$,
      eQuiet$
    ]).pipe(
      startWith([
        0, // index$
        'Loading question...',  // questionText$
        '',  // correctText$
        { idx: -1, text: '', gate: false },  // fetForIndex$
        false, // shouldShow$
        false, // navigating$
        0,     // qQuiet$
        0      // eQuiet$
      ] as CombinedTuple),
      skip(1),
      auditTime(16),
      // If navigating or in quiet zone, hold the last stable string (don’t pass new frames).
      filter(
        ([
          , // idx
          , // question
          , // banner
          , // fet
          , // shouldShow
          navigating,
          qQuiet,
          eQuiet
        ]: [
          number,
          string,
          string,
          { idx: number; text: string; gate: boolean },
          boolean,
          boolean,
          number | null | undefined,
          number | null | undefined
        ]) => {
        const hold = navigating || performance.now() < Math.max(qQuiet || 0, eQuiet || 0);
        if (hold) {
          console.log('[VisualGate] ⏸ hold (navigating/quiet-zone)');
        }
        return !hold;
      }),
  
      // drop back-to-back duplicate “question → FET → question” bursts
      distinctUntilChanged((prev, curr) => {
        const [pIdx, , , pFet, pShow] = prev;
        const [cIdx, , , cFet, cShow] = curr;
        return (
          pIdx === cIdx &&
          pFet?.text === cFet?.text &&
          pShow === cShow
        );
      }),

      // Gate only while index is still undefined (not 0)
      skipUntil(
        index$.pipe(
          filter(idx => Number.isFinite(idx)),  // open as soon as a real index exists
          take(1)
        )
      ),

      // Ignore mismatched FETs — prevents Q1 text replaying for Q2
      filter(([idx, , , fet]) => {
        const isMatch = fet?.idx === idx || !fet?.text?.trim();
      
        if (!isMatch) {
          console.log(
            `[DisplayGate] 🚫 Suppressing mismatched FET (fet.idx=${fet?.idx}, current=${idx})`
          );
        }
      
        return isMatch;
      }),

      // Coalesce multi-stream bursts (question, banner, FET clears)
      // Prevents flash of empty strings between renders
      // ────────────────────────────────
      auditTime(32),  // waits ~1 frame before passing combined emission
      filter(([ , question]) => typeof question === 'string' && question.trim().length > 0),
  
      map(([idx, question, banner, fet, shouldShow, ..._rest]) =>
        this.resolveTextToDisplay(idx, question, banner, fet, shouldShow)
      ),

      // Coalesce bursts to a single animation frame once gate opens
      auditTime(16),
      distinctUntilChanged((a, b) => a.trim() === b.trim()),  // don’t re-render identical HTML strings
      observeOn(animationFrameScheduler),
      shareReplay({ bufferSize: 1, refCount: true })
    ) as Observable<string>;
  }
  
  /* private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean
  ): string { */
    /* const active = this.quizService.getCurrentQuestionIndex();
    const fetTxt = fet?.text?.trim() ?? '';
    const qTxt = question?.trim() ?? '';
  
    // Skip stale or mismatched explanations outright
    if (fet && fet.idx !== active) return qTxt;
  
    // If locked, always show question (prevents rapid flicker)
    if (this.explanationTextService._fetLocked) return qTxt;
  
    // Gate FET — only show once the gate is open and explanation is ready
    const fetAllowed =
      fet?.gate && fetTxt.length > 2 && shouldShow;
  
    if (fetAllowed) {
      this._lastQuestionText = fetTxt;
      return fetTxt;
    }
  
    // Merge banner only in question mode
    const qObj = this.quizService.questions?.[idx];
    const isMulti =
      !!qObj &&
      (qObj.type === QuestionType.MultipleAnswer ||
        (Array.isArray(qObj.options) && qObj.options.some(o => o.correct)));
  
    let merged = qTxt;
    if (isMulti && banner?.trim() && this.quizStateService.displayStateSubject?.value?.mode === 'question') {
      merged = `${qTxt} <span class="correct-count">${banner.trim()}</span>`;
    }
  
    this._lastQuestionText = merged;
    return merged; */
    /* const qText = question.trim();
    const bannerText = banner.trim();
    const fetText = (fet?.text ?? '').trim();

    // ✅ Always get the latest active index directly from QuizService
    const active = this.quizService.getCurrentQuestionIndex();

    // Guard: if FET text is present but belongs to a different question, skip it
    if (fet && fet.idx !== idx) {
      console.log(
        `[CombinedStream] 🚫 FET belongs to Q${fet.idx + 1}, current is Q${idx + 1} → show question`
      );
      return question.trim(); // always show question text instead
    }

    // Guard: if FET is empty or gate is false, show question text
    if (!fet?.text || !fet.gate) {
      return question.trim();
    }

    // If this emission belongs to a different question, skip it
    if (fet && fet.idx !== active) {
      console.log(
        `[CombinedStream] 🚫 Dropping stale FET from Q${fet.idx + 1}, current=${active + 1}`
      );
      return this._lastQuestionText || qText;
    }

    // Only allow FET if its gate is open, and it belongs to current question
    const mode = this.quizStateService.displayStateSubject?.value?.mode ?? 'question';
    // const fetAllowed =
      fetText.length > 0 &&
      fet?.gate &&
      fet.idx === active &&
      (shouldShow || mode === 'explanation');
    const fetAllowed =
      fet &&
      fetText.length > 2 &&
      fet.idx === active &&
      fet.idx === idx &&
      fet.gate &&
      (shouldShow || mode === 'explanation');

    console.log(`[CombinedStream] active=${active}, idx=${idx}, fet.idx=${fet?.idx}`);

    if (fetAllowed) {
      console.log(`[CombinedStream] ✅ Showing FET for Q${active + 1}`);
      this._lastQuestionText = fetText;
      return fetText;
    }

    // ✅ Otherwise show the question text
    const qObj = this.quizService.questions?.[idx];
    const isMulti =
      !!qObj &&
      (qObj.type === QuestionType.MultipleAnswer ||
        (Array.isArray(qObj.options) && qObj.options.some(o => o.correct)));

    let merged = qText;
    if (isMulti && bannerText && mode === 'question') {
      merged = `${qText} <span class="correct-count">${bannerText}</span>`;
    } else {
      merged = qText;  // prevent bleed-over of Q1 banner
    }

    this._lastQuestionText = merged;
    return merged;
  } */
  /* private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean
  ): string {
    const qText = (question ?? '').trim();
    const bannerText = (banner ?? '').trim();
    const fetText = (fet?.text ?? '').trim();
    const active = this.quizService.getCurrentQuestionIndex();
    const mode = this.quizStateService.displayStateSubject?.value?.mode ?? 'question';
  
    // ────────────────────────────────────────────────
    // 🚧 1️⃣ Hard guard: reject null, empty, or mismatched FET indices
    // ────────────────────────────────────────────────
    if (!fet || !fetText || fet.idx < 0 || fet.idx !== idx || fet.idx !== active) {
      console.log(
        `[CombinedStream] 🚫 Rejecting mismatched/empty FET (fet.idx=${fet?.idx}, idx=${idx}, active=${active})`
      );
      this._lastQuestionText = qText;
      return qText;
    }
  
    // ────────────────────────────────────────────────
    // 🔒 2️⃣ Lock + gate checks
    // ────────────────────────────────────────────────
    if (
      this.explanationTextService._fetLocked ||
      !fet.gate ||
      fetText.length < 2
    ) {
      console.log(`[CombinedStream] ⏸ Locked or gate closed → show question for Q${idx + 1}`);
      this._lastQuestionText = qText;
      return qText;
    }
  
    // ────────────────────────────────────────────────
    // ✅ 3️⃣ Show FET only for active question and open gate
    // ────────────────────────────────────────────────
    if (fet.idx === active && fet.gate && shouldShow) {
      console.log(`[CombinedStream] ✅ Displaying FET for Q${active + 1}`);
      this._lastQuestionText = fetText;
      return fetText;
    }
  
    // ────────────────────────────────────────────────
    // 🧩 4️⃣ Otherwise fall back to question text (+banner)
    // ────────────────────────────────────────────────
    const qObj = this.quizService.questions?.[idx];
    const isMulti =
      !!qObj &&
      (qObj.type === QuestionType.MultipleAnswer ||
        (Array.isArray(qObj.options) && qObj.options.some(o => o.correct)));
  
    let merged = qText;
    if (isMulti && bannerText && mode === 'question') {
      merged = `${qText} <span class="correct-count">${bannerText}</span>`;
    } else {
      merged = qText; // prevent banner/FET bleed
    }
  
    this._lastQuestionText = merged;
    return merged;
  } */
  /* private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean
  ): string {
    const qText = (question ?? '').trim();
    const bannerText = (banner ?? '').trim();
    const fetText = (fet?.text ?? '').trim();
    const active = this.quizService.getCurrentQuestionIndex();
    const mode =
      this.quizStateService.displayStateSubject?.value?.mode ?? 'question';
  
    // 1️⃣ No explanation → show normal question
    if (!fetText) {
      this._lastQuestionText = qText;
      return qText;
    }
  
    // 2️⃣ Reject only if explanation belongs to another question
    if (fet?.idx !== idx || active !== idx) {
      console.warn(
        `[FET BLOCK] idx mismatch → fet.idx=${fet?.idx}, idx=${idx}, active=${active}`
      );
      this._lastQuestionText = qText;
      return qText;
    }
  
    // 3️⃣ Allow FET when:
    //    - gate is open
    //    - OR UI is explicitly in explanation mode
    const allowFET =
      fet.gate === true ||
      shouldShow === true ||
      mode === 'explanation';
  
    if (allowFET) {
      console.log(`[✅ FET DISPLAY] Showing explanation for Q${idx + 1}`);
      this._lastQuestionText = fetText;
      return fetText;
    }
  
    // 4️⃣ Otherwise show question + banner
    const qObj = this.quizService.questions?.[idx];
    const isMulti =
      !!qObj &&
      (qObj.type === QuestionType.MultipleAnswer ||
        (Array.isArray(qObj.options) && qObj.options.some((o: Option) => o.correct)));
  
    let merged = qText;
  
    if (isMulti && bannerText && mode === 'question') {
      merged = `${qText} <span class="correct-count">${bannerText}</span>`;
    }
  
    this._lastQuestionText = merged;
    return merged;
  } */
  private resolveTextToDisplay(
    idx: number,
    question: string,
    banner: string,
    fet: { idx: number; text: string; gate: boolean } | null,
    shouldShow: boolean
  ): string {
    console.log('[FET TRACE]', {
      idx,
      active: this.quizService.getCurrentQuestionIndex(),
      fetIdx: fet?.idx,
      fetLen: fet?.text?.length,
      fetGate: fet?.gate,
      shouldShow,
      mode: this.quizStateService.displayStateSubject?.value?.mode,
      locked: this.explanationTextService._fetLocked
    });
    
  
    const qText = (question ?? '').trim();
    const bannerText = (banner ?? '').trim();
    const fetText = (fet?.text ?? '').trim();
    const active = this.quizService.getCurrentQuestionIndex();
    const mode = this.quizStateService.displayStateSubject?.value?.mode ?? 'question';
  
    // 1. Always keep a last valid question text cached
    if (qText) {
      this._lastQuestionText = qText;
    }
  
    // 🔴 TEMP TEST: force explanation rendering
    if (fet?.text?.trim()) {
      console.log('[FET FORCE] Showing text:', fet.text.slice(0, 60));
      return fet.text;
    }
  
    // ✅ Safe snapshot (no .value on observable nonsense)
    const shouldDisplaySnapshot =
      this.explanationTextService.shouldDisplayExplanationSource?.getValue?.() === true;
  
    // 🧠 Step 1: corrected FET gate
    const fetValid =
      !!fet &&
      fetText.length > 2 &&
      fet.idx === idx &&
      fet.idx === active &&
      fet.gate === true &&
      !this.explanationTextService._fetLocked &&
      (
        shouldShow === true ||
        mode === 'explanation' ||
        shouldDisplaySnapshot
      );
  
    if (fetValid) {
      console.log(`[resolveTextToDisplay] ✅ Showing FET for Q${idx + 1}`);
      this._lastQuestionText = fetText;
      return fetText;
    }
  
    // 3. Otherwise, return safe question text (never empty)
    const fallback = this._lastQuestionText || qText || '...';
  
    const qObj = this.quizService.questions?.[idx];
    const isMulti =
      !!qObj &&
      (qObj.type === QuestionType.MultipleAnswer ||
        (Array.isArray(qObj.options) && qObj.options.filter((o: Option) => o.correct).length > 1));
  
    if (isMulti && bannerText && mode === 'question') {
      return `${fallback} <span class="correct-count">${bannerText}</span>`;
    }
  
    console.log(`[resolveTextToDisplay] fallback →`, fallback);
    return fallback;
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
      this.displayState$.pipe(distinctUntilChanged()),  // ensure state changes trigger updates
      this.isQuizQuestionComponentInitialized.pipe(distinctUntilChanged()),  // check initialization status
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([state, isInitialized]) => {
        if (isInitialized) {
          if (this.quizQuestionComponent) {
            if (state.mode === 'explanation' && state.answered) {
              console.log('Displaying explanation text.', {
                mode: state.mode,
                answered: state.answered
              });
            } else {
              console.log('Displaying question text.', {
                mode: state.mode,
                answered: state.answered
              });
            }
          } else {
            console.error(
              'QuizQuestionComponent is unexpectedly null during display update.'
            );
          }
        } else {
          console.info(
            'QuizQuestionComponent not ready. Skipping display update.',
            {
              state,
              isInitialized
            }
          );
        }
      });
  }

  private initializeExplanationTextObservable(): void {
    combineLatest([
      this.quizStateService.currentQuestion$.pipe(
        map((value) => value ?? null),  // default to `null` if value is `undefined`
        distinctUntilChanged()
      ),
      this.explanationTextService.isExplanationTextDisplayed$.pipe(
        map((value) => value ?? false),  // default to `false` if value is `undefined`
        distinctUntilChanged()
      ),
    ])
      .pipe(
        takeUntil(this.destroy$),
        withLatestFrom(
          this.questionRendered.pipe(
            map((value) => value ?? false),  // default to `false` if value is `undefined`
            distinctUntilChanged()
          )
        ),
        switchMap(([[question, isDisplayed], rendered]) => {
          if (question && isDisplayed && rendered) {
            return this.fetchExplanationTextAfterRendering(question);
          } else {
            return of('');
          }
        }),
        catchError((error) => {
          console.error('Error fetching explanation text:', error);
          return of('');  // emit an empty string in case of an error
        })
      )
      .subscribe((explanation: string) => {
        this.explanationToDisplay = explanation;
        this.isExplanationDisplayed = !!explanation;
      });
  }

  private fetchExplanationTextAfterRendering(
    question: QuizQuestion
  ): Observable<string> {
    return new Observable<string>((observer) => {
      setTimeout(() => {
        this.fetchExplanationText(question).subscribe((explanation: string) => {
          observer.next(explanation);
          observer.complete();
        });
      }, 100);  // delay to ensure rendering order
    });
  }

  configureDisplayLogic(): void {
    this.handleQuestionDisplayLogic().subscribe(
      ({ isMultipleAnswer }) => {
        if (this.currentQuestionType === QuestionType.SingleAnswer) {
          this.shouldDisplayCorrectAnswers = false;
        } else {
          this.shouldDisplayCorrectAnswers = isMultipleAnswer;
        }
      }
    );
  }

  private loadQuizDataFromRoute(): void {
    this.activatedRoute.paramMap.subscribe(async (params) => {
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
          const explanation = this.explanationTexts[index] ?? 'No explanation available';
          this.explanationTextService.storeFormattedExplanation(
            index,
            explanation,
            question
          );
        })
      );

      // Set before test fetch
      this.explanationTextService.explanationsInitialized = true;

      this.initializeCurrentQuestionIndex();
    } catch (error) {
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
        catchError((error) => {
          console.error('Error fetching questions:', error);
          return of([] as QuizQuestion[]);
        })
      ),
      this.quizDataService.getAllExplanationTextsForQuiz(this.quizId).pipe(
        catchError((error) => {
          console.error('Error fetching explanation texts:', error);
          return of([] as string[]);
        })
      ),
    ]).pipe(
      map(([questions, explanationTexts]) => {
        return [questions, explanationTexts] as [QuizQuestion[], string[]];
      })
    );
  }

  private initializeCurrentQuestionIndex(): void {
    this.quizService.currentQuestionIndex = 0;
    this.currentQuestionIndex$ =
      this.quizService.getCurrentQuestionIndexObservable();
  }

  private updateCorrectAnswersDisplay(
    question: QuizQuestion | null
  ): Observable<void> {
    if (!question) {
      return of(void 0);
    }

    return this.quizQuestionManagerService
      .isMultipleAnswerQuestion(question)
      .pipe(
        tap((isMultipleAnswer) => {
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

          const shouldDisplayCorrectAnswers = isMultipleAnswer && !explanationDisplayed;
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
            question.questionText.trim().toLowerCase()
        );
  
        if (questionIndex < 0) {
          console.error('Current question not found in the questions array.');
          return of('No explanation available');
        }
  
        // Check if explanations are initialized
        if (!this.explanationTextService.explanationsInitialized) {
          console.warn(
            `[fetchExplanationText] ⏳ Explanations not initialized — returning fallback for Q${questionIndex}`
          );
          return of('No explanation available');
        }
  
        // Safely return the formatted explanation text for the given question index
        return this.explanationTextService
          .getFormattedExplanationTextForQuestion(questionIndex)
          .pipe(
            map((text) => text ?? 'No explanation available')
          );
      }),
      catchError((error) => {
        // Catch any unexpected runtime errors
        console.error('Error fetching explanation text:', error);
        return of('No explanation available');
      })
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

    this.explanationTextService
      .getFormattedExplanation(questionIndex)
      .pipe(
        takeUntil(this.destroy$),
        map((explanation) => explanation || 'No explanation available'),
        catchError((error) => {
          console.error(`Error fetching explanation for question ${questionIndex}:`, error);
          return of('Error fetching explanation');
        })
      )
      .subscribe((explanation: string) => {
        this.explanationTextService.formattedExplanationSubject.next(
          explanation
        );
      });

    this.combinedQuestionData$ = combineLatest([
      currentQuizAndOptions$.pipe(
        map((value) => (value ? value : ({} as CombinedQuestionDataType))),
        distinctUntilChanged()
      ),
      this.numberOfCorrectAnswers$.pipe(
        map((value) => value ?? 0),
        distinctUntilChanged()
      ),
      this.isExplanationTextDisplayed$.pipe(
        map((value) => value ?? false),
        distinctUntilChanged()
      ),
      this.formattedExplanation$.pipe(
        map((value) => value ?? ''),
        withLatestFrom(this.quizService.currentQuestionIndex$),
        map(([text, index]) => ({ text, index })),
        distinctUntilChanged(
          (prev, curr) => prev.text === curr.text && prev.index === curr.index
        ),
        map(({ text }) => text)
      ),
    ]).pipe(
      switchMap(
        ([
          currentQuizData,
          numberOfCorrectAnswers,
          isExplanationDisplayed,
          formattedExplanation,
        ]) => {
          // Check if currentQuestion is null and handle it
          if (!currentQuizData.currentQuestion) {
            console.warn('No current question found in data:', currentQuizData);
            return of<CombinedQuestionDataType>({
              currentQuestion: {
                questionText: 'No question available',
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
              questionText: 'No question available',
              explanation: '',
              correctAnswersText: '',
              isExplanationDisplayed: false,
              isNavigatingToPrevious: false,
              selectionMessage: ''
            });
          }

          let selectionMessage = '';
          if ('selectionMessage' in currentQuizData) {
            selectionMessage = currentQuizData.selectionMessage || '';
          }

          // Ensure currentQuizData is an object with all necessary properties
          if (
            !currentQuizData.currentQuestion ||
            !Array.isArray(currentQuizData.currentOptions) ||
            currentQuizData.currentOptions.length === 0
          ) {
            console.warn('[🛑 Skipping incomplete initial data in switchMap]', {
              currentQuestion: currentQuizData.currentQuestion,
              currentOptions: currentQuizData.currentOptions
            });
            return of(null);
          }

          const completeQuizData: CombinedQuestionDataType = {
            ...currentQuizData,
            questionText:
              currentQuizData.currentQuestion.questionText ||
              'No question text available',
            options: currentQuizData.currentOptions || [],
            explanation: formattedExplanation,
            isNavigatingToPrevious: false,
            isExplanationDisplayed,
            selectionMessage,
          };

          return this.calculateCombinedQuestionData(
            completeQuizData,  // pass the complete object
            +numberOfCorrectAnswers,
            isExplanationDisplayed,
            formattedExplanation
          );
        }
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
      })
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
            ? this.questions[index] ?? null
            : null;

        if (!expected) {
          return true;
        }

        const normalizedExpected = this.normalizeKeySource(
          expected.questionText
        );
        const normalizedIncoming = this.normalizeKeySource(
          payload.question?.questionText
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
            }
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

        if (prev.explanation !== curr.explanation) {
          return false;
        }

        return this.haveSameOptionOrder(
          prev.currentOptions,
          curr.currentOptions
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
      if (!other) {
        return false;
      }

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
  ): Observable<CombinedQuestionDataType> {
    const { currentQuestion, currentOptions } = currentQuizData;

    if (!currentQuestion) {
      console.error('No current question found in data:', currentQuizData);
      return of({
        currentQuestion: null,
        currentOptions: [],
        options: [],
        questionText: 'No question available',
        explanation: '',
        correctAnswersText: '',
        isExplanationDisplayed: false,
        isNavigatingToPrevious: false,
        selectionMessage: '',
      });
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
    return of(combinedQuestionData);
  }

  handleQuestionDisplayLogic(): Observable<{
    combinedData: CombinedQuestionDataType;
    isMultipleAnswer: boolean;
  }> {
    // ✅ Ensure combinedQuestionData$ is always defined with a safe fallback
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
          maxSelections: 0
        },
        currentOptions: [],
        options: [],
        questionText: 'No question available',
        explanation: '',
        correctAnswersText: '',
        isExplanationDisplayed: false,
        isNavigatingToPrevious: false,
        selectionMessage: ''
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
                isMultipleAnswer
              }))
            );
        } else {
          // Handle case where currentQuestion is missing
          this.currentQuestionType = undefined;
          return of({
            combinedData,
            isMultipleAnswer: false
          });
        }
      })
    );
  }

  private setupCorrectAnswersTextDisplay(): void {
    // Combining the logic to determine if the correct answers text should be displayed
    this.shouldDisplayCorrectAnswers$ = combineLatest([
      this.shouldDisplayCorrectAnswers$.pipe(
        startWith(false),  // ensuring it has an initial value
        map((value) => value ?? false),  // fallback to false if value is undefined
        distinctUntilChanged()
      ),
      this.isExplanationDisplayed$.pipe(
        startWith(false),  // ensuring it has an initial value
        map((value) => value ?? false),  // fallback to false if value is undefined
        distinctUntilChanged()
      ),
    ]).pipe(
      map(
        ([shouldDisplayCorrectAnswers, isExplanationDisplayed]) =>
          shouldDisplayCorrectAnswers && !isExplanationDisplayed
      ),
      distinctUntilChanged(),
      catchError((error) => {
        console.error('Error in shouldDisplayCorrectAnswers$ observable:', error);
        return of(false);  // default to not displaying correct answers in case of error
      })
    );

    // Display correctAnswersText only if the above conditions are met
    this.displayCorrectAnswersText$ = this.shouldDisplayCorrectAnswers$.pipe(
      switchMap((shouldDisplay) => {
        return shouldDisplay ? this.correctAnswersText$ : of(null);
      }),
      distinctUntilChanged(),
      catchError((error) => {
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