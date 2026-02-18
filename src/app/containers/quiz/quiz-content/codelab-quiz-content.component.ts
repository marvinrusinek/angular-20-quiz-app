import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, OnInit, Output, Renderer2, SimpleChanges, ViewChild
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
    this.questionIndexSubject.next(idx);
    this.currentIndex = idx;

    // Reset FET lock when question changes
    this._fetLocked = false;
    this._lockedForIndex = -1;

    // Force clear view to prevent previous question's FET leaking (e.g. Q1 FET on Q2)
    // Force clear view removed to prevent race condition wiping out synchronous updates
    // if (this.qText?.nativeElement) {
    //   this.qText.nativeElement.innerHTML = '';
    // }

    this.overrideSubject.next({ idx, html: '' });
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

    // Verify against service state to prevent false positives from stale option objects
    const isRecordedAsAnswered = this.quizService.selectedOptionsMap?.has(idx);

    if (!hasSelectedOption || !isRecordedAsAnswered) {
      // No valid FET for this question = it wasn't answered, clear everything
      ets.resetForIndex(idx);
      ets.latestExplanation = '';
      ets.latestExplanationIndex = idx;
      ets.formattedExplanationSubject.next('');
      ets.explanationText$.next('');
      // Clear any cached FET for this index to prevent stale FET display.
      // Keeping stale index cache here can leak a previous Q1 explanation after
      // restart/rehydration races before fresh FET is regenerated.
      try {
        ets.fetByIndex?.delete(idx);
      } catch { }
      try {
        delete (ets.formattedExplanations as any)[idx];
      } catch { }

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
  private questionIndexSubject = new BehaviorSubject<number>(0);
  currentIndex$ = this.questionIndexSubject.asObservable();
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

  // Lock flag to prevent displayText$ from overwriting FET
  private _fetLocked = false;
  private _lockedForIndex = -1;

  // Use the service's indexed formattedExplanation$ so we can ignore stale payloads
  // that belong to previous questions (e.g., Q1 showing while on Q4).
  // Direct Access Reactive FET Logic
  // Combines Current Index with Service Cache Updates to guarantee latest data.
  // Re-emits automatically when cache populates (fixing Q1 Race Condition).
  formattedExplanation$: Observable<FETPayload> = combineLatest([
    this.currentIndex$,
    this.explanationTextService.explanationsUpdated
  ]).pipe(
    map(([idx, explanations]) => {
      const explanation = explanations[idx]?.explanation || '';
      return { idx, text: explanation, token: 0 } as FETPayload;
    }),
    distinctUntilChanged((a, b) => a.idx === b.idx && a.text === b.text),
    shareReplay(1)
  );

  public activeFetText$: Observable<string> = this.explanationTextService.fetPayload$.pipe(
    withLatestFrom(this.quizService.currentQuestionIndex$),
    map(([payload, idx]:
      [FETPayload, number]) => (payload?.idx === idx ? (payload.text ?? '') : '')),
    startWith(''),
    distinctUntilChanged()
  );

  // SIMPLE: One observable that switches between question text and FET
  // will be initialized in ngOnInit after inputs are set
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

  private navTime = 0;  // track when we landed on this question

  public shouldShowFet$!: Observable<boolean>;
  public fetToDisplay$!: Observable<string>;

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
    private renderer: Renderer2
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


    // Removed manual subscription to prevent race conditions.
    // The robust displayText$ pipeline (via subscribeToDisplayText) is now the SINGLE source of truth.
    // It correctly handles:
    // 1. Unshuffled/Shuffled text resolution
    // 2. Fallback to fetByIndex cache
    // 3. Strict mode checking (Question vs Explanation)
    // 4. Multi-answer banners

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

        // DISABLED: Pre-generation was using q.options which may not match the visual optionsToDisplay
        // This caused wrong option numbers (e.g., "Option 3" when it should be "Option 1")
        // FET is now generated on-demand in SharedOptionComponent.resolveExplanationText()
        // with the correct optionsToDisplay that matches what the user sees.
        //
        // const isShuffled = this.quizService.isShuffleEnabled();
        // const questionsToUse = isShuffled && this.quizService.shuffledQuestions && this.quizService.shuffledQuestions.length > 0
        //   ? this.quizService.shuffledQuestions
        //   : questions;
        // if (!Array.isArray(questionsToUse)) return;
        // questionsToUse.forEach((q, idx) => {
        //   if (q && q.explanation) {
        //     this.explanationTextService.storeFormattedExplanation(idx, q.explanation, q, q.options);
        //   }
        // });
      });

    this.timerService.expired$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const idx = this.quizService.getCurrentQuestionIndex?.() ?? this.currentQuestionIndexValue ?? 0;

        console.warn(`[CQCC] ⏰ Timer expired for Q${idx + 1} → allow FET display`);
        this.timedOutIdxSubject.next(idx);

        // Safety: ensure we have a formatted explanation for this idx
        const q =
          (this.quizService as any)?.questions?.[idx] ??
          ((this.quizService as any)?.currentQuestion?.value ?? null);

        if (q?.explanation) {
          // Pass q.options explicitly to ensure correct option indices
          this.explanationTextService.storeFormattedExplanation(idx, q.explanation, q, q.options);
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
    this.displayText$ = this.currentIndex$.pipe(
      filter(idx => idx >= 0),
      switchMap(safeIdx => {
        return combineLatest([
          // Ensure combineLatest can emit immediately on cold start,
          // even if getQuestionByIndex is async (qObj is safely handled as optional below).
          this.quizService.getQuestionByIndex(safeIdx).pipe(startWith(null)),

          // Use gated FET stream (only non-empty when correct answer(s) selected)
          // This prevents explanation from showing on first click / interaction.
          //
          // combineLatest will NOT emit until ALL sources emit at least once.
          // If fetToDisplay$ doesn't emit immediately on Q1 load, question text will never render.
          // startWith('') guarantees an initial emission so Q1 question text displays.
          this.fetToDisplay$.pipe(startWith('')),

          // Cold-start bulletproofing:
          // displayState$ must emit at least once or combineLatest will stall.
          // We provide a safe default so question text can render immediately on Q1.
          this.displayState$.pipe(startWith({ mode: 'question', answered: false }))
        ]).pipe(
          map(([qObj, fetTextGated, state]) => {
            const rawQText = qObj?.questionText || '';
            const serviceQText = (qObj?.questionText ?? '').trim();
            const effectiveQText = serviceQText || rawQText || '';

            // console.log(`[displayText$] Q${safeIdx + 1} Mode=${state?.mode}`);

            // Show FET ONLY when gated stream provides it (correct answer(s) selected).
            // Interaction alone should NOT force explanation display.
            // Default: Question Text with Multi-Answer Banner if needed
            const fetText = (fetTextGated ?? '').trim();
            if (fetText.length > 0) {
              console.log('[displayText$] Showing Explanation:', fetText.substring(0, 20) + '...');
              return fetText;
            }
            console.log('[displayText$] Showing Question Text (FET empty/gated)');

            let displayText = effectiveQText;

            const numCorrect = qObj?.options?.filter(o => o.correct)?.length || 0;
            if (numCorrect > 1 && qObj?.options) {
              const banner = this.quizQuestionManagerService.getNumberOfCorrectAnswersText(
                numCorrect,
                qObj.options.length
              );
              displayText = `${displayText} <span class="correct-count">${banner}</span>`;
            }

            return displayText;
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

          const el = this.qText?.nativeElement;
          if (el) {
            this.renderer.setProperty(el, 'innerHTML', text);
            console.log(`[subscribeToDisplayText] ✅ Updated innerHTML using Renderer2: "${text?.substring(0, 50)}..."`);
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
          /* if (fet && fet.text && fet.idx !== idx) {
            fet = { ...fet, idx: idx };
          } */

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
      map((results: any) => {
        const [baseText, displayState, explanationReady, formatted, idx] = results;
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
            const regenerated = this.regenerateFetForIndex(idx);
            if (regenerated) {
              return regenerated as string;
            }

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
        // ⚡ FIX: strictly respect mode === 'explanation' check
        // We only check for Hard Override if we are in explanation mode OR
        // if we are explicitly checking for an answered state that necessitates explanation.
        // The previous unconditional check forced FET display even in question mode.
        if (mode === 'explanation') {
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
    let storedFet = ets.fetByIndex?.get(idx)?.trim() || '';

    if (idx === active && hasUserInteracted && mode === 'explanation' && !storedFet) {
      console.log(`[resolveTextToDisplay] ♻️ Regenerating missing FET for Q${idx + 1}`);
      const regenerated = this.regenerateFetForIndex(idx);
      if (regenerated) {
        storedFet = regenerated;
      }
    }
    const hasValidFet = storedFet.length > 0;

    // Show FET if: we have content stored for this index, we're on the active question,
    // AND the user has actually interacted with this question (answered it) in explanation mode.
    // Without hasUserInteracted check, unanswered questions like Q3 would display cached FET
    // instead of the question text.

    // DETAILED DIAGNOSTIC LOGGING
    if (idx === active && mode === 'explanation') {
      console.log(`[resolveTextToDisplay] Q${idx + 1} evaluation:`, {
        idx,
        active,
        hasUserInteracted,
        mode,
        hasValidFet,
        storedFetLength: storedFet.length,
        storedFetPreview: storedFet.slice(0, 30)
      });
    }

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

  private regenerateFetForIndex(idx: number): string {
    try {
      const displayQuestions = this.quizService.getQuestionsInDisplayOrder?.() ?? [];
      const question = displayQuestions[idx] ?? this.quizService.questions?.[idx];
      if (!question || !Array.isArray(question.options) || question.options.length === 0) {
        return '';
      }

      const rawExplanation = (question.explanation ?? '').trim();
      if (!rawExplanation) return '';

      this.explanationTextService.storeFormattedExplanation(
        idx,
        rawExplanation,
        question,
        question.options,
        true
      );

      return this.explanationTextService.fetByIndex?.get(idx)?.trim() || '';
    } catch {
      return '';
    }
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

      /* await Promise.all(
        questions.map(async (question, index) => {
          const explanation =
            this.explanationTexts[index] ?? 'No explanation available';
          this.explanationTextService.storeFormattedExplanation(
            index,
            explanation,
            question
          );
        }),
      ); */
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
    this.shouldShowFet$ = this.currentIndex$.pipe(
      filter(idx => idx >= 0),
      distinctUntilChanged(),
      switchMap((idx) =>
        combineLatest([
          this.quizService.getQuestionByIndex(idx).pipe(startWith(null)),
          this.selectedOptionService.getSelectedOptionsForQuestion$(idx).pipe(
            startWith([])
          )
        ]).pipe(
          map(([question, selected]: [QuizQuestion | null, any[]]) => {
            // Removed hardcoded Q4 fix; now handled by robust type detection in QuizQuestionComponent

            const resolved = question
              ? this.selectedOptionService.isQuestionResolvedCorrectly(
                question,
                selected ?? []
              )
              : false;

            console.log(`[shouldShowFet] Idx: ${idx}, Resolved: ${resolved}, Selected: ${selected?.length}`);
            return resolved;
          })
        )
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  private setupFetToDisplay(): void {
    const showOnTimeout$ = combineLatest([
      this.currentIndex$.pipe(startWith(-1)),
      this.timedOutIdx$.pipe(startWith(-1))
    ]).pipe(
      map(([idx, timedOutIdx]) => idx >= 0 && idx === timedOutIdx),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.fetToDisplay$ = combineLatest([
      this.activeFetText$.pipe(startWith('')),
      this.shouldShowFet$.pipe(startWith(false)),
      showOnTimeout$.pipe(startWith(false)),
      this.currentQuestion.pipe(startWith(null))
    ]).pipe(
      map(([fet, resolved, timedOut, question]) => {
        const text = (fet ?? '').trim();
        console.log(`[fetToDisplay$] Resolved: ${resolved}, TimedOut: ${timedOut}, FET len: ${text.length}`);

        // Allow display if: Resolved OR TimedOut
        if (resolved || timedOut) {
          if (text.length > 0) {
            return text;
          }
          // Fallback if formatted text is missing (e.g. Q4 issue)
          if (question && question.explanation) {
            console.warn('[fetToDisplay$] Using fallback raw explanation');
            return question.explanation;
          }
        }
        return '';
      }),

      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
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