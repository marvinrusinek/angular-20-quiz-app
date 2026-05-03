
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, effect, ElementRef,
  OnChanges, OnDestroy, OnInit, Renderer2, SimpleChanges, untracked, ViewChild,
  input, output, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

import { CombinedQuestionDataType } from
  '../../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../../shared/models/Option.model';
import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizService } from '../../../shared/services/data/quiz.service';
import { QuizDataService } from '../../../shared/services/data/quizdata.service';
import { QuizNavigationService } from '../../../shared/services/flow/quiz-navigation.service';
import { QqcQuestionLoaderService } from
  '../../../shared/services/features/qqc/qqc-question-loader.service';
import { QuizQuestionManagerService } from '../../../shared/services/flow/quizquestionmgr.service';
import { QuizStateService } from '../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { ExplanationTextService, FETPayload } from
      '../../../shared/services/features/explanation/explanation-text.service';
import { QuizQuestionComponent } from
  '../../../components/question/quiz-question/quiz-question.component';
import { TimerService } from '../../../shared/services/features/timer/timer.service';
import { QuizContentDisplayService } from '../../../shared/services/features/quiz-content/quiz-content-display.service';
import { CqcOrchestratorService } from '../../../shared/services/features/quiz-content/cqc-orchestrator.service';

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

  readonly isContentAvailableChange = output<boolean>();

  private _combinedQuestionDataSig = signal<Observable<CombinedQuestionDataType> | null>(null);
  readonly combinedQuestionData$ = this._combinedQuestionDataSig.asReadonly();
  setCombinedQuestionData$(v: Observable<CombinedQuestionDataType> | null): void { this._combinedQuestionDataSig.set(v); }
  currentQuestion = new BehaviorSubject<QuizQuestion | null>(null);
  readonly questionToDisplay = input<string>('');
  readonly questionToDisplay$ = input<Observable<string | null> | null>(null);
  readonly explanationToDisplay = input<string | null>(null);
  readonly question = input<QuizQuestion | null>(null);
  readonly question$ = input<Observable<QuizQuestion | null> | null>(null);
  readonly questions = input<QuizQuestion[]>([]);
  readonly options = input<Option[]>([]);
  private _quizIdSig = signal<string>('');
  readonly quizId = this._quizIdSig.asReadonly();
  setQuizId(v: string): void { this._quizIdSig.set(v); }
  readonly correctAnswersText = input<string>('');
  readonly questionText = input<string>('');
  readonly quizData = input<CombinedQuestionDataType | null>(null);
  readonly displayState$ = input<Observable<{ mode: 'question' | 'explanation', answered: boolean }> | null>(null);
  readonly displayVariables = input<{ question: string; explanation: string } | null>(null);
  readonly localExplanationText = input<string>('');
  readonly showLocalExplanation = input<boolean>(false);

  readonly questionIndex = input<number>(0);

  private combinedTextSubject = new BehaviorSubject<string>('');

  currentQuestionIndexValue = 0;
  currentQuestion$: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);
  currentOptions$: BehaviorSubject<Option[] | null> =
    new BehaviorSubject<Option[] | null>([]);
  currentQuestionIndex$!: Observable<number>;
  nextQuestion$: Observable<QuizQuestion | null>;
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

  explanationTextLocal = '';
  isExplanationDisplayed = false;
  explanationVisible = false;
  isExplanationTextDisplayed$: Observable<boolean>;

  private get _fetLocked(): boolean { return this.displayService._fetLockedSig(); }
  private set _fetLocked(v: boolean) { this.displayService._fetLockedSig.set(v); }
  private get _lockedForIndex(): number { return this.displayService._lockedForIndexSig(); }
  private set _lockedForIndex(v: number) { this.displayService._lockedForIndexSig.set(v); }

  formattedExplanation$!: Observable<FETPayload>;
  public activeFetText$!: Observable<string>;
  get displayText$(): Observable<string> { return this.displayService.displayText$; }
  set displayText$(v: Observable<string>) { this.displayService.displayText$ = v; }

  numberOfCorrectAnswers$: BehaviorSubject<string> =
    new BehaviorSubject<string>('0');

  correctAnswersTextSource: BehaviorSubject<string> =
    new BehaviorSubject<string>('');
  correctAnswersText$ = this.correctAnswersTextSource.asObservable();

  explanationText: string | null = null;

  questionRendered: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  isContentAvailable$!: Observable<boolean>;

  private navTime = 0;  // track when we landed on this question

  // Signal-backed source of truth for the qText heading's innerHTML.
  // Binding the template to this signal makes Angular's change detection
  // keep the heading stable across tab visibility flips and async restores —
  // no more fighting the DOM imperatively.
  readonly qTextHtmlSig = signal<string>('');

  get shouldShowFet$(): Observable<boolean> { return this.displayService.shouldShowFet$; }
  set shouldShowFet$(v: Observable<boolean>) { this.displayService.shouldShowFet$ = v; }
  get fetToDisplay$(): Observable<string> { return this.displayService.fetToDisplay$; }
  set fetToDisplay$(v: Observable<string>) { this.displayService.fetToDisplay$ = v; }

  private timedOutIdxSubject = new BehaviorSubject<number>(-1);
  public timedOutIdx$ = this.timedOutIdxSubject.asObservable();

  private destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private quizNavigationService: QuizNavigationService,
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private quizQuestionLoaderService: QqcQuestionLoaderService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private activatedRoute: ActivatedRoute,
    private cdRef: ChangeDetectorRef,
    private renderer: Renderer2,
    private displayService: QuizContentDisplayService,
    private orchestrator: CqcOrchestratorService
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;

    this.formattedExplanation$ = this.displayService.createFormattedExplanation$(this.currentIndex$);
    this.activeFetText$ = this.displayService.createActiveFetText$(this.currentIndex$);

    this.quizNavigationService
      .getIsNavigatingToPrevious()
      .subscribe((isNavigating: boolean) => {
        this.isNavigatingToPrevious = isNavigating;
      });

    this.isExplanationTextDisplayed$ =
      this.explanationTextService.isExplanationTextDisplayed$;

    let effectFiredOnce = false;
    effect(() => {
      const idx = this.questionIndex();
      untracked(() => {
        if (!effectFiredOnce) {
          // Skip the effect's own first run — ngOnInit primes synchronously.
          effectFiredOnce = true;
          return;
        }
        this.navTime = Date.now();
        this._fetLocked = false;
        this._lockedForIndex = -1;
        this.orchestrator.runQuestionIndexSet(this, idx);
        this.currentIndex = idx;
        this.overrideSubject.next({ idx, html: '' });
        this.resetExplanationView();
        this.explanationText = '';
        this.explanationTextLocal = '';
        this.explanationVisible = false;
        this.cdRef.markForCheck();
      });
    });
  }

  async ngOnInit(): Promise<void> {
    // Prime synchronously with the initial input value so runOnInit's
    // downstream setup sees the correct currentIndex / FET state.
    const initialIdx = this.questionIndex();
    this.orchestrator.runQuestionIndexSet(this, initialIdx);
    const result = this.orchestrator.runOnInit(this);

    // ══════════════════════════════════════════════════════════════════
    // DOM-LEVEL FET WATCHDOG. MutationObserver on the <h3 #qText>
    // element. Whenever its content changes to something that looks
    // like FET for the CURRENT multi-answer question, we consult
    // pristine quizInitialState + live selections and revert the DOM
    // to plain question text if not every correct option is selected.
    // This is the ultimate safety net that bypasses every RxJS/Angular
    // state path, running after the DOM has been written.
    // ══════════════════════════════════════════════════════════════════
    try {
      const el = this.qText?.nativeElement;
      if (el && typeof MutationObserver !== 'undefined') {
        const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
        const revert = (reason: string) => {
          try {
            const qs: any = this.quizService;
            const idx: number = Number.isFinite(qs?.currentQuestionIndex)
              ? qs.currentQuestionIndex
              : (qs?.getCurrentQuestionIndex?.() ?? 0);
            const isShuffled = qs?.isShuffleEnabled?.()
              && Array.isArray(qs?.shuffledQuestions)
              && qs.shuffledQuestions.length > 0;
            const liveQ: any = isShuffled
              ? qs?.shuffledQuestions?.[idx]
              : qs?.questions?.[idx];
            const rawQ = (liveQ?.questionText ?? '').trim();
            if (rawQ) {
              (el as HTMLElement).innerHTML = rawQ;
              // DOM reverted for question
            }
          } catch { /* ignore */ }
        };
        const isResolvedRightNow = (): boolean | null => {
          try {
            const qs: any = this.quizService;
            const idx: number = Number.isFinite(qs?.currentQuestionIndex)
              ? qs.currentQuestionIndex
              : (qs?.getCurrentQuestionIndex?.() ?? 0);
            // Timer expired → always allow FET
            const timedOutVal = this.timedOutIdxSubject?.getValue?.() ?? -1;
            if (timedOutVal >= 0 && timedOutVal === idx) return true;
            const isShuffled = qs?.isShuffleEnabled?.()
              && Array.isArray(qs?.shuffledQuestions)
              && qs.shuffledQuestions.length > 0;
            const liveQ: any = isShuffled
              ? qs?.shuffledQuestions?.[idx]
              : qs?.questions?.[idx];
            const qText = nrm(liveQ?.questionText ?? '');

            let pristineCorrectTexts: string[] = [];
            const bundle: any[] = qs?.quizInitialState ?? [];
            for (const quiz of bundle) {
              for (const pq of quiz?.questions ?? []) {
                if (nrm(pq?.questionText) !== qText) continue;
                pristineCorrectTexts = (pq?.options ?? [])
                  .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                  .map((o: any) => nrm(o?.text))
                  .filter((t: string) => !!t);
                break;
              }
              if (pristineCorrectTexts.length > 0) break;
            }
            if (pristineCorrectTexts.length < 2) return null;  // not multi

            const selectedNow = new Set<string>();
            const liveOpts: any[] = Array.isArray(liveQ?.options)
              ? liveQ.options
              : [];
            for (const o of liveOpts) {
              const isSel = o?.selected === true
                || o?.highlight === true
                || o?.showIcon === true;
              if (!isSel) continue;
              const t = nrm(o?.text);
              if (t) selectedNow.add(t);
            }
            const rawMap: any = (this.selectedOptionService as any)?.selectedOptionsMap;
            if (rawMap && typeof rawMap.get === 'function') {
              const mapSel: any[] = rawMap.get(idx) ?? [];
              for (const o of mapSel) {
                if (o?.selected === false) continue;
                const t = nrm(o?.text);
                if (t) selectedNow.add(t);
              }
            }
            const all = pristineCorrectTexts.every(t => selectedNow.has(t));
            return all;
          } catch {
            return null;
          }
        };
        const looksLikeFetFn = (html: string): boolean => {
          const n = nrm(html);
          if (!n) return false;
          if (n.includes('are correct because')) return true;
          if (n.includes('is correct because')) return true;
          try {
            const qs: any = this.quizService;
            const idx: number = Number.isFinite(qs?.currentQuestionIndex)
              ? qs.currentQuestionIndex
              : (qs?.getCurrentQuestionIndex?.() ?? 0);
            const isShuffled = qs?.isShuffleEnabled?.()
              && Array.isArray(qs?.shuffledQuestions)
              && qs.shuffledQuestions.length > 0;
            const liveQ: any = isShuffled
              ? qs?.shuffledQuestions?.[idx]
              : qs?.questions?.[idx];
            const qText = nrm(liveQ?.questionText ?? '');
            const qExp = nrm(liveQ?.explanation ?? '');
            if (qExp && n.includes(qExp)) return true;
            const bundle: any[] = qs?.quizInitialState ?? [];
            for (const quiz of bundle) {
              for (const pq of quiz?.questions ?? []) {
                if (nrm(pq?.questionText) !== qText) continue;
                const pExp = nrm(pq?.explanation ?? '');
                if (pExp && n.includes(pExp)) return true;
              }
            }
          } catch { /* ignore */ }
          return false;
        };
        const enforce = () => {
          try {
            const html = (el as HTMLElement).innerHTML ?? '';
            if (!looksLikeFetFn(html)) return;
            const resolved = isResolvedRightNow();
            if (resolved === false) {
              revert(`DOM contained FET but pristine says not resolved: "${html.substring(0, 60)}"`);
            }
          } catch { /* ignore */ }
        };
        const mo = new MutationObserver(() => enforce());
        mo.observe(el, { childList: true, characterData: true, subtree: true });
        (this as any)._fetWatchdog = mo;
        // Also enforce on every click (covers cases where the DOM
        // hasn't mutated recently but the selection changed).
        const clickHandler = () => setTimeout(enforce, 0);
        document.addEventListener('click', clickHandler, true);
        (this as any)._fetWatchdogClick = clickHandler;
      }
    } catch (e) {
      // watchdog install failed
    }

    return result;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!!this.questionText() && !this.questionRendered.getValue()) {
      this.questionRendered.next(true);
    }
  }

  ngOnDestroy(): void {
    try {
      (this as any)._fetWatchdog?.disconnect?.();
      if ((this as any)._fetWatchdogClick) {
        document.removeEventListener('click', (this as any)._fetWatchdogClick, true);
      }
    } catch { /* ignore */ }
    this.orchestrator.runOnDestroy(this);
  }

  private resetInitialState(): void {
    this.isExplanationDisplayed = false;
    this.explanationTextService.setIsExplanationTextDisplayed(false);
  }

  private setupQuestionResetSubscription(): void {
    this.orchestrator.runSetupQuestionResetSubscription(this);
  }

  private initDisplayTextPipeline(): void {
    this.displayService.initDisplayTextPipeline(
      this.currentIndex$,
      this.timedOutIdx$,
      this.displayState$() ?? this.quizStateService.displayState$
    );
  }

  private resetExplanationService(): void {
    this.resetExplanationView();

    this.explanationTextService.setShouldDisplayExplanation(false);
    this.explanationTextService.explanationTextSig.set('');

    this.explanationTextService.resetForIndex(0);
    this.explanationTextService.setShouldDisplayExplanation(false, {
      force: true
    });
  }

  private subscribeToDisplayText(): void {
    this.orchestrator.runSubscribeToDisplayText(this);
  }

  private setupContentAvailability(): void {
    this.orchestrator.runSetupContentAvailability(this);
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
    this.orchestrator.runEmitContentAvailableState(this);
  }

  private loadQuizDataFromRoute(): void {
    this.orchestrator.runLoadQuizDataFromRoute(this);
  }

  private async loadQuestion(quizId: string, zeroBasedIndex: number): Promise<void> {
    return this.orchestrator.runLoadQuestion(this, quizId, zeroBasedIndex);
  }

  private async initializeComponent(): Promise<void> {
    await this.initializeQuestionData();
    this.initializeCombinedQuestionData();
  }

  private async initializeQuestionData(): Promise<void> {
    return this.orchestrator.runInitializeQuestionData(this);
  }

  private fetchQuestionsAndExplanationTexts(params: ParamMap): Observable<[QuizQuestion[], string[]]> {
    return this.orchestrator.runFetchQuestionsAndExplanationTexts(this, params);
  }

  private initializeCurrentQuestionIndex(): void {
    const idx = this.currentQuestionIndexValue ?? 0;
    this.quizService.currentQuestionIndex = idx;
    this.questionIndexSubject.next(idx);
    this.currentIndex = idx;
    this.currentQuestionIndex$ =
      this.quizService.getCurrentQuestionIndexObservable();
  }

  private updateCorrectAnswersDisplay(question: QuizQuestion | null): Observable<void> {
    return this.orchestrator.runUpdateCorrectAnswersDisplay(this, question);
  }

  private initializeCombinedQuestionData(): void {
    this.orchestrator.runInitializeCombinedQuestionData(this);
  }

  private combineCurrentQuestionAndOptions(): Observable<{
    currentQuestion: QuizQuestion | null;
    currentOptions: Option[];
    explanation: string;
    currentIndex: number;
  }> {
    return this.orchestrator.runCombineCurrentQuestionAndOptions(this);
  }

  private haveSameOptionOrder(left: Option[] = [], right: Option[] = []): boolean {
    return this.orchestrator.runHaveSameOptionOrder(this, left, right);
  }

  private calculateCombinedQuestionData(
    currentQuizData: CombinedQuestionDataType,
    numberOfCorrectAnswers: number,
    isExplanationDisplayed: boolean,
    formattedExplanation: string
  ): CombinedQuestionDataType {
    return this.orchestrator.runCalculateCombinedQuestionData(this, currentQuizData, numberOfCorrectAnswers, isExplanationDisplayed, formattedExplanation);
  }

  private setupCorrectAnswersTextDisplay(): void {
    this.orchestrator.runSetupCorrectAnswersTextDisplay(this);
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