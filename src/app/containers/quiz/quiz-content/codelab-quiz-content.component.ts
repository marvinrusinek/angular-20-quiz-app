import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  Input, OnChanges, OnDestroy, OnInit, Output, Renderer2, SimpleChanges, ViewChild,
  input, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';

import { CombinedQuestionDataType } from
  '../../../shared/models/CombinedQuestionDataType.model';
import { Option } from '../../../shared/models/Option.model';
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

  @Input() combinedQuestionData$: Observable<CombinedQuestionDataType> | null =
    null;
  @Input() currentQuestion = new BehaviorSubject<QuizQuestion | null>(null);
  readonly questionToDisplay = input<string>('');
  readonly questionToDisplay$ = input<Observable<string | null> | null>(null);
  @Input() explanationToDisplay: string | null = null;
  readonly question = input<QuizQuestion | null>(null);
  readonly question$ = input<Observable<QuizQuestion | null> | null>(null);
  readonly questions = input<QuizQuestion[]>([]);
  readonly options = input<Option[]>([]);
  @Input() quizId = '';
  readonly correctAnswersText = input<string>('');
  readonly questionText = input<string>('');
  readonly quizData = input<CombinedQuestionDataType | null>(null);
  readonly displayState$ = input<Observable<{ mode: 'question' | 'explanation', answered: boolean }> | null>(null);
  readonly displayVariables = input<{ question: string; explanation: string } | null>(null);
  readonly localExplanationText = input<string>('');
  readonly showLocalExplanation = input<boolean>(false);

  @Input() set explanationOverride(o: { idx: number; html: string }) {
    this.overrideSubject.next(o);
  }

  @Input() set questionIndex(idx: number) {
    this.orchestrator.runQuestionIndexSet(this, idx);
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
    private displayService: QuizContentDisplayService,
    private orchestrator: CqcOrchestratorService
  ) {
    this.nextQuestion$ = this.quizService.nextQuestion$;
    this.previousQuestion$ = this.quizService.previousQuestion$;

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
    return this.orchestrator.runOnInit(this);
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
    if (!!this.questionText() && !this.questionRendered.getValue()) {
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
    this.explanationTextService.explanationText$.next('');

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