import {
  AfterViewInit, ApplicationRef, ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
  Output, QueryList, SimpleChanges, ViewChildren
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioModule, MatRadioChange } from '@angular/material/radio';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { animationFrameScheduler, BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { distinctUntilChanged, observeOn, take, takeUntil } from 'rxjs/operators';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { Option } from '../../../../shared/models/Option.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
import { QuestionType } from '../../../../shared/models/question-type.enum';
import { SelectedOption } from '../../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../../shared/models/SharedOptionConfig.model';
import { FeedbackComponent } from '../feedback/feedback.component';
import { ExplanationTextService } from '../../../../shared/services/explanation-text.service';
import { FeedbackService } from '../../../../shared/services/feedback.service';
import { QuizService } from '../../../../shared/services/quiz.service';
import { QuizStateService } from '../../../../shared/services/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/selectedoption.service';
import { SelectionMessageService } from '../../../../shared/services/selection-message.service';
import { NextButtonStateService } from '../../../../shared/services/next-button-state.service';
import { TimerService } from '../../../../shared/services/timer.service';
import { SoundService } from '../../../../shared/services/sound.service';
import { HighlightOptionDirective } from '../../../../directives/highlight-option.directive';
import { SharedOptionConfigDirective } from '../../../../directives/shared-option-config.directive';
import { correctAnswerAnim } from '../../../../animations/animations';
import { isValidOption } from '../../../../shared/utils/option-utils';

@Component({
  selector: 'app-shared-option',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule,
    MatIconModule,
    FeedbackComponent,
    HighlightOptionDirective,
    SharedOptionConfigDirective
  ],
  templateUrl: './shared-option.component.html',
  styleUrls: ['../../quiz-question/quiz-question.component.scss'],
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedOptionComponent
  implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  @ViewChildren(HighlightOptionDirective)
  highlightDirectives!: QueryList<HighlightOptionDirective>;

  @Output() optionClicked =
    new EventEmitter<OptionClickedPayload>();
  @Output() reselectionDetected = new EventEmitter<boolean>();
  @Output() explanationUpdate = new EventEmitter<number>();
  @Output() renderReadyChange = new EventEmitter<boolean>();
  @Input() currentQuestion: QuizQuestion | null = null;
  @Input() currentQuestionIndex!: number;
  @Input() questionIndex: number | null = null;
  @Input() optionsToDisplay!: Option[];
  @Input() quizId!: string;
  @Input() type: 'single' | 'multiple' = 'single';
  @Input() config!: SharedOptionConfig;
  @Input() selectedOption: Option | null = null;
  @Input() showFeedbackForOption!: { [optionId: number]: boolean };
  @Input() correctMessage = '';
  @Input() showFeedback = false;
  @Input() shouldResetBackground = false;
  @Input() highlightCorrectAfterIncorrect = false;
  @Input() quizQuestionComponentOnOptionClicked!: (
    option: SelectedOption, index: number) => void;
  @Input() optionBindings: OptionBindings[] = [];
  @Input() selectedOptionId: number | null = null;
  @Input() selectedOptionIndex: number | null = null;
  @Input() isNavigatingBackwards = false;
  @Input() renderReady = false;
  @Input() finalRenderReady$: Observable<boolean> | null = null;
  @Input() questionVersion = 0;  // increments every time questionIndex changes
  @Input() sharedOptionConfig!: SharedOptionConfig;
  public finalRenderReady = false;
  private finalRenderReadySub?: Subscription;
  private selectionSub!: Subscription;
  public isSelected = false;

  private optionBindingsInitialized = false;
  feedbackBindings: FeedbackProps[] = [];
  currentFeedbackConfig!: FeedbackProps;
  feedbackConfigs: { [key: string]: FeedbackProps } = {};
  selectedOptions: Set<number> = new Set();
  clickedOptionIds: Set<number> = new Set();
  private readonly perQuestionHistory = new Set<number>();
  // Track CORRECT option clicks per question for timer stop logic
  private correctClicksPerQuestion: Map<number, Set<number>> = new Map();
  // 🔒 Track DISABLED option IDs per question - persists across binding recreations
  private disabledOptionsPerQuestion: Map<number, Set<number>> = new Map();
  iconVisibility: boolean[] = []; // array to store visibility state of icons
  showIconForOption: { [optionId: number]: boolean } = {};
  lastSelectedOptionIndex = -1;
  private lastFeedbackQuestionIndex = -1;
  lastFeedbackOptionId = -1;
  lastSelectedOptionId = -1;
  highlightedOptionIds: Set<number> = new Set();

  // Counter to force OnPush re-render when disabled state changes
  disableRenderTrigger = 0;

  // ⚡ FIX: Internal tracker for last processed question index
  // This is separate from the @Input currentQuestionIndex to handle timing issues
  private lastProcessedQuestionIndex: number = -1;

  private readonly optionsToDisplay$ = new BehaviorSubject<Option[]>([]);
  isOptionSelected = false;
  private optionsRestored = false;  // tracks if options are restored
  viewInitialized = false;
  viewReady = false;
  optionsReady = false;
  displayReady = false;
  showOptions = false;
  showNoOptionsFallback = false;
  lastClickedOptionId: number | null = null;
  lastClickTimestamp: number | null = null;
  hasUserClicked = false;
  freezeOptionBindings = false;
  selectedOptionHistory: number[] = [];
  private selectedOptionMap: Map<number, boolean> = new Map();
  lastFeedbackOptionMap: { [questionIndex: number]: number } = {};
  form!: FormGroup;

  private renderReadySubject =
    new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();

  private click$ = new Subject<{ b: OptionBindings; i: number }>();

  // Include disableRenderTrigger to force re-render when disabled state changes
  trackByOptionId = (b: OptionBindings, idx: number) =>
    `${b.option.optionId ?? idx}_${this.disableRenderTrigger}`;

  private flashDisabledSet = new Set<number>();
  private lockedIncorrectOptionIds = new Set<number>();
  private shouldLockIncorrectOptions = false;
  public hasCorrectSelectionForLock = false;
  public allCorrectSelectedForLock = false;
  private resolvedTypeForLock: QuestionType = QuestionType.SingleAnswer;
  private forceDisableAll = false;
  private timerExpiredForQuestion = false;  // track timer expiration
  private timeoutCorrectOptionKeys = new Set<string>();
  private pendingExplanationIndex = -1;
  private resolvedQuestionIndex: number | null = null;

  destroy$ = new Subject<void>();

  constructor(
    private explanationTextService: ExplanationTextService,
    private feedbackService: FeedbackService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService,
    private soundService: SoundService,
    private nextButtonStateService: NextButtonStateService,
    private timerService: TimerService,
    private cdRef: ChangeDetectorRef,
    private fb: FormBuilder,
    private ngZone: NgZone,
    private appRef: ApplicationRef
  ) {
    this.form = this.fb.group({
      selectedOptionId: [null, Validators.required]
    });

    // React to form-control changes, capturing id into updateSelections which highlights any option that has been chosen
    this.form.get('selectedOptionId')!
      .valueChanges.pipe(distinctUntilChanged())
      .subscribe((id: number | string) => this.updateSelections(id));
  }

  // Robust Multi-Mode Detection (Infers from Data if Type is missing)
  get isMultiMode(): boolean {
    // Explicit check
    if (this.type === 'multiple' || this.config?.type === 'multiple') {
      console.log(`[isMultiMode] Returning TRUE due to explicit type='multiple'`);
      return true;
    }

    // ⚡ FIX: Use getActiveQuestionIndex for most reliable index
    // Then use getQuestionAtDisplayIndex for shuffle-aware question lookup
    const idx = this.getActiveQuestionIndex();
    const currentQ = this.getQuestionAtDisplayIndex(idx) ?? this.currentQuestion;

    // Data inference (fixes multiple-answer questions)
    if (currentQ?.options) {
      const count = currentQ.options.filter((o: Option) => o.correct).length;
      console.log(`[isMultiMode] Q${idx + 1} from question: correctCount=${count}, returning ${count > 1}`);
      if (count > 1) return true;
    }

    // ⚡ Fallback: Check optionsToDisplay (most reliable for shuffled mode)
    // This is what's actually being shown to the user
    if (this.optionsToDisplay?.length > 0) {
      const displayCount = this.optionsToDisplay.filter((o: Option) => o.correct === true).length;
      console.log(`[isMultiMode] Q${idx + 1} from optionsToDisplay: correctCount=${displayCount}, returning ${displayCount > 1}`);
      if (displayCount > 1) return true;
    }

    console.log(`[isMultiMode] Q${idx + 1}: No multi-answer detected, returning false`);
    return false;
  }

  ngOnInit(): void {
    this.initializeQuestionIndex();
    this.resetStateForNewQuestion();
    this.subscribeToTimerExpiration();
    this.setupFallbackRendering();
    this.initializeConfiguration();
    this.initializeOptionDisplayWithFeedback();
    this.setupSubscriptions();
    this.subscribeToSelectionChanges();
    this.subscribeToFormChanges();
  }

  private initializeQuestionIndex(): void {
    const qIndex = this.questionIndex ??
      this.currentQuestionIndex ??
      this.config?.idx ??
      this.quizService?.currentQuestionIndex ?? 0;

    // ⚡ FIX: Also initialize lastProcessedQuestionIndex to prevent -1 value
    // during first render before the subscription fires
    this.lastProcessedQuestionIndex = qIndex;

    this.updateResolvedQuestionIndex(qIndex);
  }

  private resetStateForNewQuestion(): void {
    this.disabledOptionsPerQuestion.clear();
    this.lockedIncorrectOptionIds.clear();
    this.flashDisabledSet.clear();
    this.timerExpiredForQuestion = false;
    this.timeoutCorrectOptionKeys.clear();
    this.forceDisableAll = false;  // ⚡ FIX: Reset forceDisableAll for new question
  }

  private subscribeToTimerExpiration(): void {
    this.timerService.expired$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      console.log('[SOC] ⏰ Timer expired - setting timerExpiredForQuestion = true');
      this.timerExpiredForQuestion = true;
      const question = this.currentQuestion
        || this.config?.currentQuestion
        || this.getQuestionAtDisplayIndex(this.currentQuestionIndex)
        || this.getQuestionAtDisplayIndex(this.quizService.getCurrentQuestionIndex());
      const displayOptions = this.optionsToDisplay?.length
        ? this.optionsToDisplay
        : question?.options ?? [];
      const correctFromDisplay = displayOptions.filter((option) => option?.correct);
      const correctOptions = question
        ? this.quizService.getCorrectOptionsForCurrentQuestion(question)
        : [];
      const keys = new Set<string>();

      if (correctFromDisplay.length > 0) {
        displayOptions.forEach((option, index) => {
          if (option?.correct) {
            keys.add(this.keyOf(option, index));
          }
        });
      } else if (correctOptions.length > 0) {
        correctOptions.forEach((correctOption, fallbackIndex) => {
          const displayIndex = displayOptions.findIndex((option) =>
            option?.optionId != null && option.optionId === correctOption.optionId
          );
          if (displayIndex >= 0) {
            keys.add(this.keyOf(displayOptions[displayIndex], displayIndex));
            return;
          }

          const textMatchIndex = displayOptions.findIndex((option) =>
            option?.text && correctOption.text && option.text === correctOption.text
          );
          if (textMatchIndex >= 0) {
            keys.add(this.keyOf(displayOptions[textMatchIndex], textMatchIndex));
            return;
          }

          keys.add(this.keyOf(correctOption, fallbackIndex));
        });
      }

      this.timeoutCorrectOptionKeys = keys;
      this.cdRef.markForCheck();
    });
  }

  private setupFallbackRendering(): void {
    // ⚡ FIX: Stackblitz can be slower, so we retry at multiple intervals
    // before showing the fallback message
    const checkAndRetry = (attempt: number) => {
      const maxAttempts = 5;  // Increased for Stackblitz
      const delays = [100, 200, 400, 800, 1500]; // Progressive delays for retries

      setTimeout(() => {
        // If options are now ready, try to initialize them
        if (this.optionsToDisplay?.length && !this.optionBindings?.length) {
          console.log(`[SOC] 🔄 Fallback retry ${attempt}: Options arrived, generating bindings`);
          this.generateOptionBindings();
          this.cdRef.detectChanges();  // Force immediate update for OnPush
          return;
        }

        // If we have options and bindings but display flags aren't set, fix them
        if (this.optionsToDisplay?.length && this.optionBindings?.length) {
          if (!this.showOptions || !this.renderReady) {
            console.log(`[SOC] 🔧 Fallback retry ${attempt}: Fixing display flags`);
            this.showOptions = true;
            this.renderReady = true;
            this.optionsReady = true;
            this.showNoOptionsFallback = false;
            this.cdRef.detectChanges();  // Force immediate update for OnPush
          }
          return;
        }

        // If we've exhausted retries, show fallback
        if (attempt >= maxAttempts) {
          if (!this.renderReady || !this.optionsToDisplay?.length) {
            console.warn('[SOC] ⚠️ Options still not ready after retries, showing fallback');
            this.showNoOptionsFallback = true;
            this.cdRef.detectChanges();  // Force immediate update for OnPush
          }
          return;
        }

        // Try again
        checkAndRetry(attempt + 1);
      }, delays[attempt - 1] || 1500);
    };

    checkAndRetry(1);
  }

  private initializeConfiguration(): void {
    this.initializeFromConfig();

    if (this.config && this.config.optionsToDisplay?.length > 0) {
      this.optionsToDisplay = this.config.optionsToDisplay;
    } else if (this.optionsToDisplay?.length > 0) {
      console.log('Options received directly:', this.optionsToDisplay);
    } else {
      console.warn('No options received in SharedOptionComponent');
    }

    this.renderReady = this.optionsToDisplay?.length > 0;
  }

  private initializeOptionDisplayWithFeedback(): void {
    this.initializeOptionBindings();
    this.synchronizeOptionBindings();
    this.initializeDisplay();

    // Initial feedback generation for Q1
    if (this.currentQuestionIndex >= 0 && this.optionsToDisplay?.length > 0) {
      this.regenerateFeedback(this.currentQuestionIndex);
    }

    // ⚡ FIX: Immediately set display flags if options are available
    if (this.optionsToDisplay?.length > 0) {
      this.renderReady = true;
      this.showOptions = true;
      this.optionsReady = true;
      this.cdRef.detectChanges();
    }

    // Fallback: retry after short delay for Stackblitz timing issues
    setTimeout(() => {
      if (this.optionsToDisplay?.length > 0 && !this.showOptions) {
        this.renderReady = true;
        this.showOptions = true;
        this.optionsReady = true;
        this.cdRef.detectChanges();
      }
    }, 50);
  }

  private setupSubscriptions(): void {
    if (this.finalRenderReady$) {
      this.finalRenderReadySub = this.finalRenderReady$.subscribe((ready: boolean) => {
        this.finalRenderReady = ready;
      });
    }
  
    // Regenerate feedback when quizService index changes
    // ✅ FIX: combine index + latest @Input options to avoid race conditions
    combineLatest([
      this.quizService.currentQuestionIndex$.pipe(distinctUntilChanged()),
      this.optionsToDisplay$
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([idx, opts]: [number, Option[]]) => {
        // ✅ Use opts (synced latest options) for logging/logic
        console.log(
          `[SOC 🔄] currentQuestionIndex$ fired: idx=${idx}, optionsToDisplay.length=${opts?.length}`
        );
  
        // ⚡ FIX: Reset all state when question index changes
        // This fixes highlighting/disabled state persisting from previous questions
        // Use lastProcessedQuestionIndex (internal tracker) instead of @Input currentQuestionIndex
        // because the @Input might not have been updated yet when this subscription fires
        if (this.lastProcessedQuestionIndex !== idx) {
          console.log(`[SOC 🔄] Question changed from ${this.lastProcessedQuestionIndex} to ${idx} - RESETTING STATE`);
          this.resetStateForNewQuestion();
  
          // Clear highlighting state
          this.highlightedOptionIds.clear();
          this.showFeedback = false;
          this.showFeedbackForOption = {};
  
          // Reset option bindings to clear visual state
          for (const b of this.optionBindings ?? []) {
            b.isSelected = false;
            b.showFeedback = false;
            b.highlightCorrect = false;
            b.highlightIncorrect = false;
            b.highlightCorrectAfterIncorrect = false;
            b.disabled = false;
            if (b.option) {
              b.option.selected = false;
              b.option.showIcon = false;
            }
          }
  
          // Update the internal tracker
          this.lastProcessedQuestionIndex = idx;
          // Also update currentQuestionIndex if it's stale
          if (this.currentQuestionIndex !== idx) {
            this.currentQuestionIndex = idx;
          }
  
          this.cdRef.markForCheck();
        }
  
        // ✅ IMPORTANT: Use opts (synced) instead of this.optionsToDisplay (may be stale)
        if (idx >= 0 && Array.isArray(opts) && opts.length > 0) {
          // ⚡ FIX: Use helper method that respects shuffle state
          const question = this.getQuestionAtDisplayIndex(idx);
  
          if (question?.options) {
            const correctOptions = opts.filter(
              (o: Option) => o.correct === true
            );
            console.log(
              `[SOC 🔄] Q${idx + 1} correctOptions from optionsToDisplay:`,
              correctOptions?.map((o) => o.optionId)
            );
  
            const serviceDisplayOrders = question.options
              ?.map((o: Option) => o.displayOrder)
              .join(',');
            const inputDisplayOrders = opts
              ?.map((o) => o.displayOrder)
              .join(',');
            console.log(
              `[SOC 🔄] Service DisplayOrders: [${serviceDisplayOrders}] | 
                 Input DisplayOrders: [${inputDisplayOrders}]`
            );
  
            const freshFeedback =
              this.feedbackService.generateFeedbackForOptions(
                correctOptions,
                opts
              );
  
            this.feedbackConfigs = {};
  
            for (const b of this.optionBindings ?? []) {
              if (!b.option) continue;
  
              b.option.feedback = freshFeedback;
              b.feedback = freshFeedback;
  
              const optId = b.option.optionId ?? -1;
              if (optId < 0) continue;
  
              this.feedbackConfigs[optId] = {
                feedback: freshFeedback,
                showFeedback: b.showFeedback ?? false,
                options: opts,
                question: question,
                selectedOption: b.option,
                correctMessage: freshFeedback,
                idx: b.index
              };
            }
          }
        }
  
        this.cdRef.markForCheck();
      });
  }

  private subscribeToFormChanges(): void {
    this.click$.pipe(takeUntil(this.destroy$)).subscribe(({ b, i }) => {
      this.form
        .get('selectedOptionId')
        ?.setValue(b.option.optionId, { emitEvent: false });
      this.updateOptionAndUI(b, i, {
        value: b.option.optionId
      } as MatRadioChange);
    });
  }

  private subscribeToSelectionChanges(): void {
    this.selectionSub = this.selectedOptionService.selectedOption$
      .pipe(
        distinctUntilChanged(
          (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)
        ),
        observeOn(animationFrameScheduler)
      )
      .subscribe((incoming) => {
        const selList: SelectedOption[] = Array.isArray(incoming)
          ? incoming
          : incoming
            ? [incoming]
            : [];

        this.applySelectionsUI(selList);

        const selectedIds =
          selList.map((s) => s.optionId);

        if (this.selectedOptionId != null) {
          this.isSelected = selectedIds.includes(this.selectedOptionId);
        } else {
          this.isSelected = false;
        }

        this.cdRef.markForCheck();
      });
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    // Always resolve a valid index
    const fallbackIndex =
      changes['questionIndex']?.currentValue ??
      changes['currentQuestionIndex']?.currentValue ??
      this.currentQuestionIndex ??
      this.questionIndex ??
      -1;

    this.resolvedQuestionIndex = fallbackIndex;
    this.currentQuestionIndex = fallbackIndex;

    // Force re-render when question changes to reset disabled state
    if (
      changes['questionIndex'] ||
      changes['currentQuestionIndex'] ||
      changes['optionsToDisplay']
    ) {
      // Clear all disabled options - new question starts fresh
      this.disabledOptionsPerQuestion.clear();
      console.log(
        '[ngOnChanges] 🔄 Cleared disabledOptionsPerQuestion for new question'
      );

      this.disableRenderTrigger++;
      console.log(
        '[ngOnChanges] 🔄 Question changed, disableRenderTrigger incremented to:',
        this.disableRenderTrigger
      );
    }

    console.log(
      `[HYDRATE-INDEX FIX] Resolved questionIndex=${this.currentQuestionIndex}`
    );

    // Hard Reset: Deep clone & purge any reference identity leaks immediately
    // when options change
    if (changes['optionsToDisplay'] && Array.isArray(this.optionsToDisplay)) {
      try {
        // Hard clone & purge any reference identity leaks
        this.optionsToDisplay = JSON.parse(
          JSON.stringify(this.optionsToDisplay)
        );

        // Publish the latest options snapshot for SOC reactive logic
        this.optionsToDisplay$.next(
          Array.isArray(this.optionsToDisplay) ? [...this.optionsToDisplay] : []
        );

        this.optionBindings = [];
        for (const d of this.highlightDirectives ?? []) {
          // Gracefully handle if the directive doesn’t have updateHighlight
          if ('updateHighlight' in d) {
            d.updateHighlight();  // force visual reset
          }
        }
        this.highlightedOptionIds.clear();
        this.selectedOption = null;
        console.log(
          '[💧 HARD RESET] optionsToDisplay deep-cloned and state cleared'
        );
      } catch (err: any) {
        console.warn('[💧 HARD RESET] deep clone failed', err);
      }
    }

    // Hard clone barrier: break all option object references between questions
    if (Array.isArray(this.optionsToDisplay)) {
      try {
        this.optionsToDisplay =
          typeof structuredClone === 'function'
            ? structuredClone(this.optionsToDisplay)
            : JSON.parse(JSON.stringify(this.optionsToDisplay));
        console.log(
          '[HARD CLONE BARRIER] optionsToDisplay deep-cloned for new question'
        );
      } catch (err: any) {
        console.warn('[HARD CLONE BARRIER] clone failed', err);
      }
    }

    if (changes['questionIndex']) {
      this.resolvedQuestionIndex = null;
      this.updateResolvedQuestionIndex(changes['questionIndex'].currentValue);
    }

    if (changes['currentQuestionIndex']) {
      this.resolvedQuestionIndex = null;
      this.updateResolvedQuestionIndex(
        changes['currentQuestionIndex'].currentValue
      );
    }

    if (changes['config']?.currentValue?.idx !== undefined) {
      this.updateResolvedQuestionIndex(changes['config'].currentValue.idx);
    }

    // Simplified check: regenerate if any relevant input changes
    const shouldRegenerate =
      (changes['optionsToDisplay'] && Array.isArray(this.optionsToDisplay) &&
        this.optionsToDisplay.length > 0) ||
      (changes['config'] && this.config != null) ||
      (changes['currentQuestionIndex'] &&
        typeof changes['currentQuestionIndex'].currentValue === 'number') ||
      (changes['questionIndex'] &&
        typeof changes['questionIndex'].currentValue === 'number');

    if (changes['currentQuestionIndex']) {
      console.log(
        '[🔍 currentQuestionIndex changed]',
        changes['currentQuestionIndex']
      );

      // ⚡ FIX: Update lastProcessedQuestionIndex when input changes
      // This is critical for the verified selection state logic
      const newIndex = changes['currentQuestionIndex'].currentValue;
      if (typeof newIndex === 'number') {
        console.log(`[ngOnChanges] Updating lastProcessedQuestionIndex from ${this.lastProcessedQuestionIndex} to ${newIndex}`);
        this.lastProcessedQuestionIndex = newIndex;

        // Reset state for new question
        this.resetStateForNewQuestion();
        this.highlightedOptionIds.clear();
        this.showFeedback = false;
        this.showFeedbackForOption = {};
      }

      if (!changes['currentQuestionIndex'].firstChange) {
        this.flashDisabledSet.clear();
        this.cdRef.markForCheck();
      }
    }

    if (shouldRegenerate) {
      this.hydrateOptionsFromSelectionState();
      this.generateOptionBindings();
    } else if (
      changes['optionBindings'] &&
      Array.isArray(changes['optionBindings'].currentValue) &&
      changes['optionBindings'].currentValue.length
    ) {
      this.hydrateOptionsFromSelectionState();
      this.generateOptionBindings();
    } else {
      console.warn(
        '[⏳ generateOptionBindings skipped] No triggering inputs changed'
      );
    }

    // Handle changes to optionsToDisplay / questionIndex (if any)
    const questionChanged =
      (changes['questionIndex'] && !changes['questionIndex'].firstChange) ||
      (changes['currentQuestionIndex'] &&
        !changes['currentQuestionIndex'].firstChange);
    const optionsChanged =
      changes['optionsToDisplay'] &&
      changes['optionsToDisplay'].previousValue !==
      changes['optionsToDisplay'].currentValue;

    // Only reset display mode when question changes, not when options change
    if (questionChanged) {
      console.log(`[🔄 RESET] Question changed - resetting to question mode`);

      // Reset cached index so we don't use the old one
      this.resolvedQuestionIndex = null;

      this.quizStateService.setDisplayState({ mode: 'question', answered: false });

      // Clear the explanation text service to prevent old FET from showing
      this.explanationTextService.unlockExplanation();
      this.explanationTextService.setExplanationText('', { force: true });
      this.explanationTextService.setShouldDisplayExplanation(false, {
        force: true
      });
      this.explanationTextService.setIsExplanationTextDisplayed(false, {
        force: true
      });

      console.log(
        `[🔄 RESET] Cleared explanation text service for new question`
      );
    }

    // Handle TYPE changes explicitly
    if (changes['type']) {
      this.type = changes['type'].currentValue;
      console.log(`[SOC] 🔄 Type changed to: ${this.type}`);
    }

    // UI cleanup can happen on both question and options changes
    if ((questionChanged || optionsChanged) && this.optionsToDisplay?.length) {
      this.questionVersion++;

      // If the previous question forced every option disabled (e.g. after
      // showing feedback on completion), make sure that guard is cleared before
      // the restart/new question renders so Q1 is interactive again.
      this.clearForceDisableAllOptions();

      this.fullyResetRows();

      this.selectedOptionHistory = [];
      this.lastFeedbackOptionId = -1;
      this.showFeedbackForOption = {};
      this.feedbackConfigs = {};

      this.form.get('selectedOptionId')?.setValue(null,
        { emitEvent: false });

      this.processOptionBindings();

      this.cdRef.detectChanges();
      for (const d of this.highlightDirectives ?? []) {
        d.updateHighlight();
      }

      this.updateHighlighting();
      this.cdRef.detectChanges();
    }

    // Full local visual reset to prevent ghost highlighting
    if (questionChanged || optionsChanged) {
      console.log(
        `[SOC] 🔄 Resetting local visual state for 
        Q${this.resolvedQuestionIndex}`
      );
      this.highlightedOptionIds.clear();
      this.flashDisabledSet.clear();
      this.correctClicksPerQuestion.clear();
      this.showFeedbackForOption = {};
      this.feedbackConfigs = {};
      this.selectedOptionHistory = [];
      this.lastFeedbackOptionId = -1;

      // Force every option to lose highlight/showIcon state
      if (Array.isArray(this.optionsToDisplay)) {
        this.optionsToDisplay = this.optionsToDisplay.map((opt) => ({
          ...opt,
          selected: false,
          highlight: false,
          showIcon: false
        }));
      }

      // Reset any lingering form control
      this.form.get('selectedOptionId')?.setValue(null,
        { emitEvent: false });

      this.cdRef.detectChanges();
    }
  }

  ngAfterViewInit(): void {
    // Force hydration from persistence
    setTimeout(() => {
      const qIndex = this.resolveCurrentQuestionIndex();
      const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) || [];
      if (saved.length > 0) {
        const savedIds = new Set(saved.map(s => s.optionId));

        // Update bindings
        if (this.optionBindings) {
          for (const b of this.optionBindings) {
            if (savedIds.has(b.option.optionId!)) {
              b.isSelected = true;
              b.option.selected = true;
            }
          }
        }

        if (this.optionsToDisplay) {
          for (const o of this.optionsToDisplay) {
            if (savedIds.has(o.optionId!)) {
              o.selected = true;
            }
          }
        }

        this.updateHighlighting();
        this.cdRef.detectChanges();
      }
    }, 100);

    if (this.form) {
      console.log('form value:', this.form.value);
    } else {
      console.warn('[SOC] form is undefined in ngAfterViewInit');
    }

    if (!this.optionBindings?.length && this.optionsToDisplay?.length) {
      console.warn(
        '[⚠️ SOC] ngOnChanges not triggered, forcing optionBindings generation'
      );
      // ⚡ FIX: Actually call generateOptionBindings() instead of just logging
      // This ensures showOptions gets set to true and options render correctly
      this.generateOptionBindings();
    }

    this.viewInitialized = true;
    this.viewReady = true;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.selectionSub?.unsubscribe();
    this.finalRenderReadySub?.unsubscribe();
  }

  // Handle visibility changes to restore state
  @HostListener('window:visibilitychange', [])
  onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') {
      return;
    }

    try {
      // Make sure optionsToDisplay is populated
      this.ensureOptionsToDisplay();

      // Restore highlight / selection styling
      this.preserveOptionHighlighting();

      this.cdRef.markForCheck();
    } catch (error) {
      console.error(
        '[SharedOptionComponent] Error during visibility change handling:',
        error
      );
    }
  }

  // Push the newly‐clicked option into history, then synchronize every binding’s
  // visual state (selected, highlight, icon, feedback) in one synchronous pass.
  private updateSelections(rawSelectedId: number | string): void {
    const parsedId =
      typeof rawSelectedId === 'string'
        ? Number.parseInt(rawSelectedId, 10)
        : rawSelectedId;

    if (!Number.isFinite(parsedId)) {
      console.warn(
        '[SharedOptionComponent] Ignoring non-numeric selection id',
        { rawSelectedId }
      );
      return;
    }

    // Ignore the synthetic “-1 repaint” that runs right after question load
    if (parsedId === -1) return;

    const selectedId = parsedId;

    // Remember every id that has ever been clicked in this question
    if (!this.selectedOptionHistory.includes(selectedId)) {
      this.selectedOptionHistory.push(selectedId);
    }

    for (const b of this.optionBindings) {
      const id = b.option.optionId;
      if (id === undefined) {
        continue;
      }

      const everClicked = this.selectedOptionHistory.includes(id);
      const isCurrent = id === selectedId;

      // Color stays ON for anything ever clicked
      b.option.highlight = everClicked;

      // Icon only on the row that was just clicked
      b.option.showIcon = isCurrent;

      // Native control state
      b.isSelected = isCurrent;
      b.option.selected = isCurrent;

      // Feedback – only current row is true
      if (!b.showFeedbackForOption) {
        b.showFeedbackForOption = {};
      }
      b.showFeedbackForOption[id] = isCurrent;

      // Repaint row
      b.directiveInstance?.updateHighlight();
    }

    this.cdRef.detectChanges();
  }

  private ensureOptionsToDisplay(): void {
    const fallbackOptions = this.currentQuestion?.options;

    if (
      Array.isArray(this.optionsToDisplay) &&
      this.optionsToDisplay.length > 0
    ) {
      return;  // already populated, no need to proceed
    }

    if (Array.isArray(fallbackOptions) && fallbackOptions.length > 0) {
      this.optionsToDisplay = fallbackOptions.map((option) => ({
        ...option,
        active: option.active ?? true,
        feedback: option.feedback ?? undefined,
        showIcon: option.showIcon ?? false
      }));
      console.info(
        '[SharedOptionComponent] Restored optionsToDisplay from currentQuestion.options',
      );
    } else {
      console.warn(
        '[SharedOptionComponent] No valid options available to restore.',
      );
      this.optionsToDisplay = [];
    }
  }

  private synchronizeOptionBindings(): void {
    // Hard Guard: optionsToDisplay not ready
    if (
      !Array.isArray(this.optionsToDisplay) ||
      this.optionsToDisplay.length === 0
    ) {
      console.warn(
        '[SOC] ❌ synchronizeOptionBindings() aborted — optionsToDisplay EMPTY'
      );

      // If no user selection exists, clear; otherwise keep old bindings
      const hasSelection =
        this.optionBindings?.some((opt) => opt.isSelected);

      if (!hasSelection && !this.freezeOptionBindings) {
        this.optionBindings = [];
      }

      return;
    }

    // REVERTED: This optimization was preventing updates when moving between questions
    // that have the same number of options (e.g. Q2 -> Q3).
    // The content is different even if the length is the same.
    /*
    if (this.optionBindings.length === this.optionsToDisplay.length) {
      console.warn(
        '[SOC] ⚠️ synchronizeOptionBindings() skipped — counts match'
      );
      return;
    }
    */

    // Guard: user clicked recently → freeze updates
    if (this.freezeOptionBindings) {
      console.warn(
        '[SOC] 🔒 freezeOptionBindings active — ABORTING reassignment'
      );
      return;
    }

    // Build new optionBindings
    const bindings = this.optionsToDisplay.map((option, idx) => {
      const isSelected = option.selected ?? false;
      const isCorrect = option.correct ?? false;

      return {
        option,
        index: idx,
        isSelected,
        isCorrect,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: { [idx]: false },
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: isSelected && !isCorrect,
        highlightCorrect: isSelected && isCorrect,
        styleClass: isSelected ? 'highlighted' : '',
        disabled: false,
        type: this.type ?? 'single',
        appHighlightOption: isSelected,
        appHighlightInputType: (this.type === 'multiple'
          ? 'checkbox'
          : 'radio') as 'checkbox' | 'radio',
        allOptions: [...this.optionsToDisplay],
        appHighlightReset: false,
        ariaLabel: `Option ${idx + 1}`,
        appResetBackground: false,
        optionsToDisplay: [...this.optionsToDisplay],
        checked: isSelected,
        change: () => { },
        active: true
      };
    });

    // Defer assignment to next microtask
    queueMicrotask(() => {
      this.optionBindings = bindings;
      this.showOptions = true;  // Ensure showOptions is set
      this.renderReady = true;  // Ensure renderReady is set
      this.cdRef.detectChanges();  // Force immediate update for OnPush
      console.warn('[SOC] ✅ optionBindings REASSIGNED', bindings);
    });

    // Restore highlights after binding reassignment
    this.updateHighlighting();
  }

  buildSharedOptionConfig(b: OptionBindings, i: number): SharedOptionConfig {
    // ⚡ FIX: Verify selection state from service, not from potentially stale binding
    // ⚡ FIX: Use lastProcessedQuestionIndex which is synchronized with Input in ngOnChanges.
    // Preferring quizService.currentQuestionIndex caused a race condition where we fetched 
    // selections for the PREVIOUS question because the service hadn't updated yet.
    const qIndex = this.lastProcessedQuestionIndex ?? this.resolveCurrentQuestionIndex();
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const isActuallySelected = currentSelections.some(s => s.optionId === b.option.optionId);

    // Also check if we're on the correct question (prevent Q2 state showing on Q3)
    const isOnCorrectQuestion = this.lastProcessedQuestionIndex === qIndex;

    // ⚡ FIX: STRICTLY trust the service.
    // 'b.isSelected' comes from inputs that may contain stale option objects from the previous question.
    // By ignoring b.isSelected and relying only on isActuallySelected (which checks the service for the specific qIndex),
    // we ensure we never show stale selections.
    const showAsSelected = isActuallySelected;
    const optionKey = this.keyOf(b.option, i);
    const showCorrectOnTimeout = this.timerExpiredForQuestion
      && (this.timeoutCorrectOptionKeys.has(optionKey) || !!b.option.correct);

    // ⚡ FIX: Create a copy of the option with verified selected state
    // This prevents the directive from reading stale option.selected values
    const verifiedOption = {
      ...b.option,
      selected: showAsSelected,  // override with verified state
      highlight: showAsSelected || showCorrectOnTimeout,  // also update highlight flag
      showIcon: showAsSelected || showCorrectOnTimeout   // ensure the copy has the icon state
    };

    // ⚡ FIX: Vital to update the ORIGINAL option's showIcon property
    // because the template reads 'b.option.showIcon' to display the mat-icon.
    // Since this method is called during change detection before the icon check,
    // this effectively syncs the visual state.
    b.option.showIcon = showAsSelected || showCorrectOnTimeout;

    return {
      option: verifiedOption,  // Use verified option, not original
      idx: i,
      type: this.type,
      isOptionSelected: showAsSelected, // ⚡ Use verified selection state
      isAnswerCorrect: b.isCorrect,
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      // ⚡ FIX: Only force reset when:
      // 1. The component's shouldResetBackground is true (explicit reset), OR
      // 2. We're on a different question AND there are no current selections (fresh navigation)
      shouldResetBackground: this.shouldResetBackground || (!isOnCorrectQuestion && currentSelections.length === 0),
      feedback: b.feedback ?? '',
      showFeedbackForOption: this.showFeedbackForOption,
      optionsToDisplay: this.optionsToDisplay,
      selectedOption: this.selectedOption,
      currentQuestion: this.currentQuestion,
      showFeedback: this.showFeedback,
      correctMessage: this.correctMessage,
      showCorrectMessage: !!this.correctMessage,
      explanationText: '',
      showExplanation: false,
      selectedOptionIndex: this.selectedOptionIndex,
      highlight: showAsSelected || showCorrectOnTimeout  // explicitly set top-level highlight on config
    };
  }

  public getSharedOptionConfig(
    b: OptionBindings,
    i: number
  ): SharedOptionConfig {
    return this.buildSharedOptionConfig(b, i);
  }

  private handleClick(binding: OptionBindings, index: number): void {
    // Robust index resolution - fallback to Service if local is default/0
    let activeQuestionIndex = this.getActiveQuestionIndex();
    if (activeQuestionIndex === null || activeQuestionIndex === undefined ||
      (activeQuestionIndex === 0 && this.quizService.currentQuestionIndex > 0)) {
      activeQuestionIndex = this.quizService.currentQuestionIndex;
    }
    activeQuestionIndex = activeQuestionIndex ?? 0;

    // ⚡ FIX: Mark that user has interacted with this question this session
    // This is required for the displayText$ pipeline's shouldShowFet logic
    this.quizStateService.markUserInteracted(activeQuestionIndex);
    console.log(`[SOC] 🖱️ Marked user interaction for Q${activeQuestionIndex + 1}`);

    // ⚡ FIX: Set display mode to 'explanation' - THIS IS CRITICAL FOR FET DISPLAY!
    // The displayText$ pipeline checks: shouldShowFet = hasInteractedThisSession && currentMode === 'explanation'
    // Without this call, currentMode stays 'question' and FET never displays.
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    console.log(`[SOC] 📝 Set display mode to 'explanation' for Q${activeQuestionIndex + 1}`);

    const enrichedOption: SelectedOption = {
      ...binding.option,
      selected: binding.option.selected === true,
      questionIndex: activeQuestionIndex
    };

    const payload: OptionClickedPayload = {
      option: enrichedOption,
      index,
      checked: enrichedOption.selected === true
    };

    this.optionClicked.emit(payload);

    // Run score check AFTER parent updates service (next tick)
    setTimeout(() => {
      // Construct complete answers list for Multiple Choice
      let currentAnswers: any[] = [];
      if (this.type === 'multiple') {
        const stored =
          this.selectedOptionService.getSelectedOptionsForQuestion(
            activeQuestionIndex
          );
        currentAnswers = stored ? [...stored] : [];

        // If stored is empty (race condition), fallback to current enriched
        if (currentAnswers.length === 0) currentAnswers = [enrichedOption];
      } else {
        currentAnswers = [enrichedOption];
      }

      this.quizService.answers = currentAnswers;
      this.quizService.updateAnswersForOption(enrichedOption);

      console.log(`[SOC] 📊 Updated Answers for Q${activeQuestionIndex}. 
        Type=${this.type}, Answers=${currentAnswers.length}`);

      // Removed explicit score check to avoid double-call with QQC.processAnswer
    }, 0);

  }

  preserveOptionHighlighting(): void {
    for (const option of this.optionsToDisplay) {
      if (option.selected) {
        option.highlight = true;  // highlight selected options
      }
    }
  }

  initializeFromConfig(): void {
    if (this.freezeOptionBindings) {
      console.warn(
        '[🛡️ initializeFromConfig] Skipping initialization - option bindings ' +
        'frozen.'
      );
      return;
    }

    // Full reset
    this.optionBindings = [];
    this.selectedOption = null;
    this.selectedOptionIndex = -1;
    this.showFeedbackForOption = {};
    this.correctMessage = '';
    this.showFeedback = false;
    this.shouldResetBackground = false;
    this.optionsRestored = false;
    this.currentQuestion = null;
    this.optionsToDisplay = [];

    console.info('[🔄 State Reset Completed]');

    // Guard: Config or options missing
    if (!this.config || !this.config.optionsToDisplay?.length) {
      console.warn('[🧩 initializeFromConfig] Config missing or empty.');
      return;
    }

    // Assign current question
    this.currentQuestion = this.config.currentQuestion;

    // Validate currentQuestion before proceeding
    if (!this.currentQuestion || !Array.isArray(this.currentQuestion.options)) {
      console.error(
        '[🚨 initializeFromConfig] Invalid or missing currentQuestion options.'
      );
      return;
    }

    // Populate optionsToDisplay with structured data
    this.optionsToDisplay = this.currentQuestion.options.map((opt, idx) => {
      return {
        ...opt,
        optionId: opt.optionId ?? idx,
        correct: opt.correct ?? false,
        feedback: typeof opt.feedback === 'string' ? opt.feedback.trim() : '',
        selected: opt.selected ?? false,
        active: true,
        showIcon: false
      };
    });

    if (!this.optionsToDisplay.length) {
      console.warn(
        '[🚨 initializeFromConfig] optionsToDisplay is empty after processing.'
      );
      return;
    }

    // Rehydrate selection state from Service (persistence)
    // This ensures that when navigating back, the options show as selected
    // (Green/Red).
    // ⚡ FIX: Use quizService.currentQuestionIndex (authoritative) instead of 
    // resolveCurrentQuestionIndex() which may return stale @Input value
    const qIndex = this.quizService.currentQuestionIndex ?? this.resolveCurrentQuestionIndex();
    const inputIndex = this.resolveCurrentQuestionIndex();

    // ⚡ MISMATCH GUARD: If service index differs from input, use service index
    // This prevents Q2 selections from being applied to Q3
    if (qIndex !== inputIndex) {
      console.warn(`[initializeFromConfig] ⚠️ INDEX MISMATCH: Service says ${qIndex}, Input says ${inputIndex}. Using ${qIndex}.`);
    }

    console.log(`[initializeFromConfig] 🔍 Rehydrating for Q${qIndex + 1} (service: ${this.quizService.currentQuestionIndex}, input: ${inputIndex})`);

    const saved =
      this.selectedOptionService.getSelectedOptionsForQuestion(qIndex);
    if (saved?.length > 0) {
      const savedIds = new Set(saved.map(s => s.optionId));

      for (const opt of this.optionsToDisplay) {

        if (opt.optionId !== undefined && savedIds.has(opt.optionId)) {
          opt.selected = true;
          opt.showIcon = true;
        }
      }
    } else {
      console.log(`[initializeFromConfig] No saved selections for Q${qIndex + 1} - starting clean`);
    }

    // Determine question type based on options, but Respect explicit input first!
    if (this.type !== 'multiple') {
      this.type = this.determineQuestionType(this.currentQuestion);
    } else {
      console.log('[SOC] 🛡️ Preserving type="multiple" from Input');
    }

    // Initialize bindings and feedback maps
    this.setOptionBindingsIfChanged(this.optionsToDisplay);
    this.initializeFeedbackBindings();

    this.finalizeOptionPopulation();
  }

  private setOptionBindingsIfChanged(newOptions: Option[]): void {
    if (!newOptions?.length) return;

    const incomingIds = newOptions.map((o) => o.optionId).join(',');
    const existingIds = this.optionBindings
      ?.map((b) => b.option.optionId)
      .join(',');

    if (incomingIds !== existingIds || !this.optionBindings?.length) {
      this.optionBindings = newOptions.map((option, idx) => ({
        option,
        index: idx,
        isSelected: !!option.selected,
        isCorrect: option.correct ?? false,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: false,
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        styleClass: '',
        disabled: false,
        type: this.type ?? 'single',
        appHighlightOption: false,
        appHighlightInputType: '',
        allOptions: this.optionsToDisplay ?? []
      })) as unknown as OptionBindings[];
    } else {
      let idx = 0;

      for (const binding of this.optionBindings ?? []) {
        const updated = newOptions[idx];
        binding.option = updated;
        binding.isSelected = !!updated.selected;
        binding.isCorrect = updated.correct ?? false;
        idx++;
      }
    }

    // Immediate update instead of deferring
    this.optionsReady = true;
    this.showOptions = true;
  }

  getOptionDisplayText(option: Option, idx: number): string {
    return `${idx + 1}. ${option?.text ?? ''}`;
  }

  public getOptionIcon(option: Option, i: number): string {
    // ⚡ FIX: Allow icon if globally enabled OR local option requests it (e.g. immediate feedback)
    if (!this.showFeedback && !(option as any).showIcon) return '';

    // Return 'close' if feedback explicitly marks it incorrect
    if ((option as any).feedback === 'x') return 'close';

    // Primary: if reveal-for-all placed feedback in the child map, use that
    const cfg = this.feedbackConfigs[this.keyOf(option, i)];
    if (cfg?.showFeedback) {
      // Keep icon set: 'check' for correct, 'close' for incorrect
      const isCorrect = (cfg as any)?.isCorrect ?? !!option.correct;
      return isCorrect ? 'check' : 'close';
    }

    // Fallback: derive from the option itself
    return option.correct ? 'check' : 'close';
  }

  public getOptionClasses(binding: OptionBindings): { [key: string]: boolean } {
    const option = binding.option;
    // ⚡ FIX: Use quizService.currentQuestionIndex (authoritative) instead of 
    // resolveCurrentQuestionIndex() which may return stale @Input value
    const qIndex = this.quizService.currentQuestionIndex ?? this.resolveCurrentQuestionIndex();

    // Check if options should be locked (show not-allowed cursor)
    let isLocked = false;
    try {
      const isQuestionAnswered =
        this.selectedOptionService.getSelectedOptionsForQuestion(qIndex)?.length > 0;
      const isExplanationShowing =
        this.explanationTextService.shouldDisplayExplanationSource.getValue();
      const isQuestionLockedByService =
        this.selectedOptionService.isQuestionLocked(qIndex);

      isLocked =
        isQuestionAnswered || isExplanationShowing || isQuestionLockedByService;
    } catch { }

    // ⚡ FIX: Only highlight if this option is ACTUALLY selected for the CURRENT question
    // This prevents Q2's selected options from highlighting on Q3
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const isActuallySelected = currentSelections.some(s => s.optionId === option.optionId);

    // Use verified selection state, not the potentially stale option.selected flag
    const showAsSelected = isActuallySelected || (binding.isSelected && this.lastProcessedQuestionIndex === qIndex);

    const optionKey = this.keyOf(option, binding.index);
    const showCorrectOnTimeout = this.timerExpiredForQuestion
      && (this.timeoutCorrectOptionKeys.has(optionKey) || !!option.correct);

    return {
      'disabled-option': this.shouldDisableOption(binding),
      'locked-option': isLocked && !this.shouldDisableOption(binding),
      'correct-option': (showAsSelected && !!option.correct) || showCorrectOnTimeout,
      'incorrect-option': showAsSelected && !option.correct,
      'flash-red': this.flashDisabledSet.has(option.optionId ?? -1)
    };
  }

  /** Returns cursor style for option - 'not-allowed' for disabled/incorrect
   * options or when timer expired */
  public getOptionCursor(binding: OptionBindings, index: number): string {
    const option = binding?.option;
    const isCorrect = option?.correct === true;

    // If ALL options are force-disabled (timer expired), show not-allowed on ALL
    // including correct
    if (this.forceDisableAll || this.timerExpiredForQuestion) {
      return 'not-allowed';
    }

    // Check if this specific option is disabled
    if (this.isDisabled(binding, index)) {
      return 'not-allowed';
    }

    // Correct options keep pointer cursor (when user answered correctly)
    if (isCorrect) {
      return 'pointer';
    }

    return 'pointer';
  }

  // Decide if an option should be disabled, only checks disabledOptionsPerQuestion
  // Map. All actual disabling decisions are made in onOptionContentClick
  public shouldDisableOption(binding: OptionBindings): boolean {
    if (!binding || !binding.option) return false;

    const option = binding.option;
    const optionId = option.optionId;
    // ⚡ FIX: Use quizService.currentQuestionIndex (authoritative) instead of 
    // resolveCurrentQuestionIndex() which may return stale @Input value
    const qIndex = this.quizService.currentQuestionIndex ?? this.resolveCurrentQuestionIndex();

    // Force unlock for Multi-Select (fix "green to red" lock)
    if (this.isMultiMode) {
      if (this.forceDisableAll) return true;
      return false;
    }

    // Prevent reselection: disable correct options that are already selected in
    // multiple-answer questions
    const isMultipleAnswer = this.isMultiMode;  // use robust getter
    if (isMultipleAnswer && binding.isSelected && option.correct) {
      console.log(`[SOC] 🔒 Option ${optionId} is a selected correct answer - 
        disabling to prevent reselection`);
      return true;
    }

    // Check persistent disabled state - this is the only source of truth
    const disabledSet = this.disabledOptionsPerQuestion.get(qIndex);
    if (disabledSet && typeof optionId === 'number' && disabledSet.has(optionId)) {
      console.log(`[SOC] 🚫 Option ${optionId} DISABLED by persistent set for Q${qIndex + 1}`);
      return true;
    }

    // Check other global disable conditions
    if (this.forceDisableAll) return true;

    try {
      if (this.selectedOptionService.isQuestionLocked(qIndex)) {
        return true;
      }
    } catch { }

    if (binding.disabled) return true;

    try {
      if (
        optionId != null &&
        this.selectedOptionService.isOptionLocked(qIndex, optionId)
      ) {
        return true;
      }
    } catch { }

    if (optionId != null && this.lockedIncorrectOptionIds.has(optionId))
      return true;

    return optionId != null && this.flashDisabledSet.has(optionId);
  }

  private resolveQuestionType(): QuestionType {
    if (this.currentQuestion?.type) {
      return this.currentQuestion.type;
    }

    const candidateIndex = this.getActiveQuestionIndex();

    // ⚡ FIX: Use helper method that respects shuffle state
    const question = this.getQuestionAtDisplayIndex(candidateIndex);
    if (question?.type) {
      return question.type;
    }

    return this.type === 'multiple'
      ? QuestionType.MultipleAnswer
      : QuestionType.SingleAnswer;
  }

  private updateLockedIncorrectOptions(): void {
    const bindings = this.optionBindings ?? [];

    if (!bindings.length) {
      this.lockedIncorrectOptionIds.clear();
      this.shouldLockIncorrectOptions = false;
      return;
    }

    if (this.forceDisableAll) {
      for (const binding of bindings) {
        binding.disabled = true;

        if (binding.option) {
          binding.option.active = false;
        }
      }

      this.cdRef.markForCheck();
      return;
    }

    const resolvedType = this.resolveQuestionType();
    const hasCorrectSelection = bindings.some(
      (b) => b.isSelected && !!b.option?.correct
    );
    const correctBindings =
      bindings.filter((b) => !!b.option?.correct);
    const allCorrectSelectedLocally =
      correctBindings.length > 0 && correctBindings.every((b) =>
        b.isSelected);

    this.resolvedTypeForLock = resolvedType;
    this.hasCorrectSelectionForLock = hasCorrectSelection;
    this.allCorrectSelectedForLock = allCorrectSelectedLocally;

    const shouldLockIncorrect = this.computeShouldLockIncorrectOptions(
      resolvedType,
      hasCorrectSelection,
      allCorrectSelectedLocally
    );

    this.shouldLockIncorrectOptions = shouldLockIncorrect;

    if (!shouldLockIncorrect) {
      this.lockedIncorrectOptionIds.clear();
      for (const binding of bindings) {
        binding.disabled = false;

        if (binding.option) {
          binding.option.active = true;
        }
      }
      this.shouldLockIncorrectOptions = false;
      this.cdRef.markForCheck();
      return;
    }

    for (const binding of bindings) {
      const optionId = binding.option?.optionId;
      const shouldDisable = !binding.option?.correct;

      binding.disabled = shouldDisable;

      if (binding.option) {
        binding.option.active = !shouldDisable;
      }

      if (optionId != null) {
        if (shouldDisable) {
          this.lockedIncorrectOptionIds.add(optionId);
        } else {
          this.lockedIncorrectOptionIds.delete(optionId);
        }
      }
    }

    this.cdRef.markForCheck();
  }

  private computeShouldLockIncorrectOptions(
    resolvedType: QuestionType,
    hasCorrectSelection: boolean,
    allCorrectSelectedLocally: boolean
  ): boolean {
    if (
      resolvedType === QuestionType.SingleAnswer ||
      resolvedType === QuestionType.TrueFalse
    ) {
      // Single / TF: lock incorrect options once a correct one is selected
      return hasCorrectSelection;
    }

    if (resolvedType === QuestionType.MultipleAnswer) {
      // Multiple: lock incorrect options only when all correct answers are selected
      return allCorrectSelectedLocally;
    }

    return false;
  }

  onOptionChanged(b: OptionBindings, i: number, event: MatRadioChange | MatCheckboxChange) {
    console.log(`[🎯 onOptionChanged] optionId=${b?.option?.optionId}, index=${i}, Q${(this.currentQuestionIndex ?? 0) + 1}`);

    // NOTE: Scoring is handled in onOptionContentClick - NOT here
    // This prevents double-scoring and incorrect scoring issues

    this.updateOptionAndUI(b, i, event);
  }

  public onOptionInteraction(binding: OptionBindings, index: number, event: MouseEvent): void {
    // Guard: Skip if this option is disabled (check persistent Map)
    if (this.isDisabled(binding, index)) {
      console.log('[SOC] 🛑 onOptionInteraction: Option is disabled, blocking click:', binding.option?.optionId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target as HTMLElement;
    // If we clicked the native input, let it do its thing.
    if (target.tagName === 'INPUT') {
      return;
    }

    // If we clicked the padding/background (host), trigger manual selection.
    // We reuse onOptionContentClick logic since it does exactly what we want
    // (Manual Logic + Form Sync).
    this.onOptionContentClick(binding, index, event);
  }

  public onOptionContentClick(
    binding: OptionBindings,
    index: number,
    event: MouseEvent
  ): void {
    // 🔍 DEBUG: Log at the very start
    const qIdx = this.resolveCurrentQuestionIndex();
    console.log(`[SOC] 🔍 ENTRY onOptionContentClick Q${qIdx}, optionIndex=${index}, optionId=${binding.option?.optionId}`);
    
    // ⚡ FIX: Mark interaction IMMEDIATELY
    this.quizStateService.markUserInteracted(qIdx);
    console.log(`[SOC] 🖱️ Marked user interaction for Q${qIdx + 1}`);

    // Prevent the click from bubbling up to the mat-radio-button/mat-checkbox
    event.stopPropagation();

    // Guard: Skip if this option is disabled (check persistent Map)
    if (this.isDisabled(binding, index)) {
      console.log('[SOC] 🛑 onOptionContentClick: Option is disabled, blocking click:', binding.option?.optionId);
      return;
    }

    // ⚡ FIX: Immediately disable this option after click to prevent re-clicking
    const optionIdToDisable = binding.option?.optionId;
    if (typeof optionIdToDisable === 'number') {
      if (!this.disabledOptionsPerQuestion.has(qIdx)) {
        this.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
      }
      this.disabledOptionsPerQuestion.get(qIdx)!.add(optionIdToDisable);
      console.log(`[SOC] 🔒 Disabled option ${optionIdToDisable} for Q${qIdx + 1} to prevent re-click`);
    }

    // Force update answers and trigger score logic here (multi-answer support)
    const bindingsForScore = this.optionBindings ?? [];
    const correctCountForScore =
      bindingsForScore.filter(b => b.option?.correct).length;
    const isMultipleForScore = correctCountForScore > 1;
    const qIndexForScore = this.resolveCurrentQuestionIndex();

    // Guard: prevent deselection of correct answers in multiple-answer questions
    if (isMultipleForScore && binding.isSelected && binding.option?.correct) {
      console.log('[SOC] 🛑 Blocking deselection of correct answer:',
        binding.option?.optionId);
      event.preventDefault();
      return;
    }

    // Calculate Current Selected Set (prior to this click)
    let currentSelectedOptions = bindingsForScore
      .filter(b => b.isSelected)
      .map(b => b.option);

    // Determine Action
    const willBeSelected = isMultipleForScore ? !binding.isSelected : true;

    // Update Set
    if (isMultipleForScore) {
      if (willBeSelected) {
        // Add if not present
        if (!currentSelectedOptions.find(
          o => o.optionId === binding.option.optionId)
        ) {
          currentSelectedOptions.push(binding.option);
        }
      } else {
        // Remove
        currentSelectedOptions = currentSelectedOptions.filter(o => o.optionId !== binding.option.optionId);
      }
    } else {
      // Single: just this option
      currentSelectedOptions = [binding.option];
    }

    // Use SelectedOptionService as source of truth
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIndexForScore) || [];
    let simulatedSelection = [...storedSelection];

    // Check current option status in stored selection
    const existingIdx = simulatedSelection.findIndex(o => o.optionId === binding.option.optionId);

    // Enforce "history mode" (accumulation) for ALL types per user request
    // This keeps incorrect answers highlighted even after selecting the correct one.
    if (existingIdx > -1) {
      simulatedSelection.splice(existingIdx, 1);
    } else {
      simulatedSelection.push({
        ...binding.option,
        selected: true,
        questionIndex: qIndexForScore
      } as SelectedOption
      );
    }

    // Update service and check score
    // If options lack IDs (unshuffled raw mode), generate the expected numeric ID
    // ⚡ FIX: Use the FULL options list (this.optionBindings) to find the correct index for generation
    // Relying on simulatedSelection index was incorrect because it only contains SELECTED options.
    const allBindings = this.optionBindings ?? [];

    const validIds = simulatedSelection.map((o) => {
      if (typeof o.optionId === 'number') return o.optionId;

      // Fallback: Find True Index in the full list
      const trueIndex = allBindings.findIndex(b => b.option === o || (b.option?.text === o.text));

      // If found, generate ID. If not found, use 0 (which will likely fail but is safer than random)
      const idxToUse = trueIndex >= 0 ? trueIndex : 0;

      return Number(`${qIndexForScore + 1}${(idxToUse + 1).toString().padStart(2, '0')}`);
    }).filter((id): id is number => Number.isFinite(id));

    this.quizService.updateUserAnswer(qIndexForScore, validIds);

    // Must sync to SelectedOptionService for dots to update
    this.selectedOptionService.syncSelectionState(
      qIndexForScore,
      simulatedSelection
    );

    // ⚡ FIX: For UNSHUFFLED mode, call checkIfAnsweredCorrectly for score verification
    // For SHUFFLED mode, skip this call - rely on scoreDirectly calls which are more reliable
    // The duplicate async calls were causing race conditions in SHUFFLED mode
    const isShuffledForScoring = this.quizService?.isShuffleEnabled?.();
    if (!isShuffledForScoring) {
      this.quizService.checkIfAnsweredCorrectly(qIndexForScore).then((isCorrect) => {
        console.log(`[SOC] Score Verified for Q${qIndexForScore + 1}: ${isCorrect}`);
      });
    } else {
      console.log(`[SOC] 🔀 SHUFFLED mode: Skipping duplicate checkIfAnsweredCorrectly (scoreDirectly will handle scoring)`);
    }

    // TIMER STOP LOGIC (FIXED - THE ONLY LOCATION!)
    // Single-answer: stop when correct option is clicked
    // Multi-answer: stop when ALL correct options are selected
    // Use same index method as isDisabled for consistency
    const questionIndex = this.resolveCurrentQuestionIndex();
    // ⚡ FIX: Use helper method that respects shuffle state
    const question = this.getQuestionAtDisplayIndex(questionIndex);

    // ⚡ FIX: Cross-check correct flag against source question options
    // The binding.option.correct may be stale or not properly propagated
    let clickedIsCorrect = binding.option.correct === true;

    // Fallback 1: Check question.options from quizService
    if (!clickedIsCorrect && question?.options) {
      // Try to find the matching option by optionId or text
      const matchingOpt = question.options.find((o: Option) =>
        o.optionId === binding.option.optionId ||
        (o.text && o.text.trim().toLowerCase() === (binding.option.text ?? '').trim().toLowerCase())
      );
      if (matchingOpt?.correct === true) {
        clickedIsCorrect = true;
        console.log(`[SOC] ⚡ Corrected clickedIsCorrect via question.options lookup for optionId=${binding.option.optionId}`);
      }
    }

    // Fallback 2: Check optionBindings (the displayed options) - for shuffled mode
    if (!clickedIsCorrect && this.optionBindings?.length) {
      const matchingBinding = this.optionBindings.find((b: OptionBindings) =>
        b.option?.optionId === binding.option.optionId ||
        (b.option?.text && b.option.text.trim().toLowerCase() === (binding.option.text ?? '').trim().toLowerCase())
      );
      if (matchingBinding?.option?.correct === true) {
        clickedIsCorrect = true;
        console.log(`[SOC] ⚡ Corrected clickedIsCorrect via optionBindings lookup for optionId=${binding.option.optionId}`);
      }
    }

    // Fallback 3: Check optionsToDisplay - another source of truth
    if (!clickedIsCorrect && this.optionsToDisplay?.length) {
      const matchingOption = this.optionsToDisplay.find((o: Option) =>
        o.optionId === binding.option.optionId ||
        (o.text && o.text.trim().toLowerCase() === (binding.option.text ?? '').trim().toLowerCase())
      );
      if (matchingOption?.correct === true) {
        clickedIsCorrect = true;
        console.log(`[SOC] ⚡ Corrected clickedIsCorrect via optionsToDisplay lookup for optionId=${binding.option.optionId}`);
      }
    }

    // ⚡ Fallback 4: Use binding index directly (most reliable for shuffled mode)
    // The `index` passed to this method corresponds to the position in optionsToDisplay/optionBindings
    // This bypasses any optionId/text matching issues
    if (!clickedIsCorrect && typeof index === 'number' && this.optionsToDisplay?.[index]) {
      const optionAtIndex = this.optionsToDisplay[index];
      if (optionAtIndex?.correct === true) {
        clickedIsCorrect = true;
        console.log(`[SOC] ⚡ Corrected clickedIsCorrect via index-based lookup: index=${index}, optionId=${optionAtIndex.optionId}`);
      }
    }

    // ⚡ Fallback 5: Check optionBindings by index (ultimate fallback)
    if (!clickedIsCorrect && typeof index === 'number' && this.optionBindings?.[index]) {
      const bindingAtIndex = this.optionBindings[index];
      if (bindingAtIndex?.option?.correct === true) {
        clickedIsCorrect = true;
        console.log(`[SOC] ⚡ Corrected clickedIsCorrect via optionBindings index: index=${index}`);
      }
    }

    // Count correct options FROM BINDINGS (they're local and available)
    // quizService.questions was returning undefined, so use optionBindings instead
    const bindings = this.optionBindings ?? [];

    // Use centralized getter, but also double-check with optionsToDisplay
    // This ensures multi-answer detection works even for edge cases like Q4 SHUFFLED
    let isMultipleAnswer = this.isMultiMode;

    // ⚡ FIX: Direct fallback check on optionsToDisplay (most reliable for current question)
    // This catches cases where isMultiMode fails to detect multi-answer due to question lookup issues
    if (!isMultipleAnswer && this.optionsToDisplay?.length > 0) {
      const correctCountInDisplay = this.optionsToDisplay.filter((o: Option) => o.correct === true).length;
      if (correctCountInDisplay > 1) {
        isMultipleAnswer = true;
        console.log(`[SOC] ⚡ OVERRIDE: Detected multi-answer from optionsToDisplay (${correctCountInDisplay} correct options)`);
      }
    }

    const isSingle = !isMultipleAnswer;

    // 🔍 DEBUG: Comprehensive logging for scoring issues
    console.log(`[SOC] 🔍 DEBUG Q${questionIndex + 1} (idx=${questionIndex}): clickedIsCorrect=${clickedIsCorrect}, isSingle=${isSingle}, isMulti=${isMultipleAnswer}`);
    console.log(`[SOC] 🔍 DEBUG binding.option:`, {
      optionId: binding.option.optionId,
      correct: binding.option.correct,
      text: binding.option.text?.substring(0, 30),
      clickIndex: index
    });
    console.log(`[SOC] 🔍 DEBUG question?.options:`, question?.options?.map((o: Option) => ({
      optionId: o.optionId,
      correct: o.correct
    })));
    console.log(`[SOC] 🔍 DEBUG optionsToDisplay:`, this.optionsToDisplay?.map((o: Option, i: number) => ({
      idx: i,
      optionId: o.optionId,
      correct: o.correct
    })));
    console.log(`[SOC] 🔍 DEBUG shuffle state:`, {
      isShuffleEnabled: this.quizService?.isShuffleEnabled?.(),
      shuffledQuestionsLength: this.quizService?.shuffledQuestions?.length,
      questionsLength: this.quizService?.questions?.length
    });

    // NOTE: REMOVED "UNIVERSAL SCORING FALLBACK" - scoring is handled by DIRECT SCORING below for single-answer
    // and by PERFECTION ACHIEVED for multi-answer. The fallback was causing double-scoring.

    if (isSingle) {
      // Single-answer: track correct click and stop timer when correct option is
      // clicked
      if (clickedIsCorrect) {
        // TRACK CORRECT CLICK FOR SINGLE-ANSWER (needed for disable logic)
        if (!this.correctClicksPerQuestion.has(questionIndex)) {
          this.correctClicksPerQuestion.set(questionIndex, new Set<number>());
        }
        const clickedCorrectSet = this.correctClicksPerQuestion.get(questionIndex)!;
        const currentOptionId = binding.option.optionId;
        if (typeof currentOptionId === 'number') {
          clickedCorrectSet.add(currentOptionId);
        }

        console.log(`[SOC] 🎯 SINGLE-ANSWER: Correct option clicked → STOPPING TIMER`);
        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });

        // ⚡ DIRECT SCORING: Always call scoreDirectly for single-answer questions
        // The duplicate checkIfAnsweredCorrectly call is now skipped for SHUFFLED mode to prevent race conditions
        this.quizService.scoreDirectly(questionIndex, true, false);

        // DIRECTLY DISABLE ALL INCORRECT OPTIONS
        console.log('[SOC] 🔒 About to disable incorrect options. optionBindings count:', this.optionBindings?.length);

        // PERSISTENT DISABLE: Add incorrect options to disabledOptionsPerQuestion Map
        if (!this.disabledOptionsPerQuestion.has(questionIndex)) {
          this.disabledOptionsPerQuestion.set(questionIndex, new Set<number>());
        }
        const disabledSet = this.disabledOptionsPerQuestion.get(questionIndex)!;

        // Modify this.optionBindings directly (not the local bindings const)
        for (const b of this.optionBindings ?? []) {
          if (!b.option?.correct) {
            b.disabled = true;
            const optId = b.option?.optionId;
            if (typeof optId === 'number') {
              disabledSet.add(optId);
            }
            console.log(`[SOC] 🔒 DISABLED incorrect option:`, optId);
          }
        }

        // Force Angular to see the change by creating NEW binding objects (not just spread)
        // This is key for OnPush - we need object identity to change, not just array reference
        this.optionBindings = this.optionBindings.map(b => ({
          ...b,
          disabled: !b.option?.correct  // set disabled on new object
        }));

        // Force global change detection
        this.disableRenderTrigger++;

        // First mark for check
        this.cdRef.markForCheck();

        // Then run NgZone to ensure Angular picks up changes
        this.ngZone.run(() => {
          // Force global app change detection tick
          this.appRef.tick();
          this.cdRef.detectChanges();
          console.log('[SOC] 🔒 Angular appRef.tick() and detectChanges() called');
        });
      } else {
        // User clicked an incorrect option for single-answer
        console.log('[SOC] ❌ Single-answer: INCORRECT option clicked, not disabling others');
      }
    } else {
      // MULTI-ANSWER: Check if ALL correct options have been CLICKED (not just isSelected)
      // Using correctClicksPerQuestion Map as source of truth for actual user clicks

      // Get correct option IDs from question.options (source of truth)
      // NOT from bindings, which may not have correct property propagated
      const correctIdsFromQuestion = (question?.options ?? [])
        .filter((o: Option) => o.correct === true)
        .map((o: Option, idx: number) =>
          // Option ID might not be set, use index-based fallback matching binding
          // assignment
          o.optionId ?? (questionIndex * 100 + (idx + 1))
        );

      // Also get IDs from bindings to map which binding corresponds to which
      // correct option
      const bindingCorrectIds = (this.optionBindings ?? [])
        .filter((b: OptionBindings) => b.option?.correct === true)
        .map((b: OptionBindings) => b.option?.optionId)
        .filter((id: number | undefined): id is number => typeof id === 'number');

      // ⚡ FIX: Also check optionsToDisplay for correct IDs (more reliable for shuffled mode)
      const optionsToDisplayCorrectIds = (this.optionsToDisplay ?? [])
        .filter((o: Option) => o.correct === true)
        .map((o: Option) => o.optionId)
        .filter((id: number | undefined): id is number => typeof id === 'number');

      // Use the best available source: bindings > optionsToDisplay > question
      const correctIds = bindingCorrectIds.length > 0
        ? bindingCorrectIds
        : (optionsToDisplayCorrectIds.length > 0
          ? optionsToDisplayCorrectIds
          : correctIdsFromQuestion);


      // Initialize clicks set for this question if needed
      if (!this.correctClicksPerQuestion.has(questionIndex)) {
        this.correctClicksPerQuestion.set(questionIndex, new Set<number>());
      }
      const clickedCorrectSet =
        this.correctClicksPerQuestion.get(questionIndex)!;

      // If current click is on a correct option, add it to the clicked set
      const currentOptionId = binding.option.optionId;
      if (clickedIsCorrect && typeof currentOptionId === 'number') {
        clickedCorrectSet.add(currentOptionId);
        // Trigger change detection to update disabled state for incorrect options
        this.cdRef.detectChanges();
      }

      // Strict validation: For multi-answer, we MUST have at least 2 correct options
      if (correctIds.length < 2) {
        console.error(`[SOC] 🚨 MULTI-ANSWER ERROR: correctIds.length=${correctIds.length}, expected >= 2! Data issue detected.`);
        console.error(`[SOC] 🔍 Debug data:`, {
          questionOptions: question?.options?.length,
          correctFromQuestion: correctIdsFromQuestion,
          correctFromBindings: bindingCorrectIds,
          bindingsCount: (this.optionBindings ?? []).length,
          bindingsData: (this.optionBindings ?? []).map((b: OptionBindings) => ({
            optionId: b.option?.optionId,
            correct: b.option?.correct,
            text: b.option?.text?.slice(0, 20)
          }))
        });
        // DON'T stop timer - this is a data error
        return;
      }

      // Check if ALL correct options have been clicked
      const allCorrectClicked =
        correctIds.every((id: number) => clickedCorrectSet.has(id));

      // ⚡ FIX: Check if ALL correct options are now in the selection
      // Don't rely on a.correct flag which may not be set on simulatedSelection
      const currentAnswersForLock = simulatedSelection || [];
      const selectedOptionIds = currentAnswersForLock.map(a => a.optionId).filter((id): id is number => typeof id === 'number');

      // Perfect state: Every correct option ID is in the selected set
      const allCorrectSelected = correctIds.every((id: number) => selectedOptionIds.includes(id));
      const isPerfectState = allCorrectSelected && selectedOptionIds.length >= correctIds.length;

      console.log(`[SOC] 🔍 MULTI-ANSWER DEBUG: correctIds=${JSON.stringify(correctIds)}, selectedIds=${JSON.stringify(selectedOptionIds)}, allCorrectSelected=${allCorrectSelected}, isPerfectState=${isPerfectState}`);

      if (isPerfectState) {
        console.log(`[SOC] 🎯 MULTI-ANSWER: PERFECTION ACHIEVED → STOPPING TIMER`);

        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });

        // ⚡ DIRECT SCORING: Always call scoreDirectly for multi-answer when all correct answers are selected
        // The duplicate checkIfAnsweredCorrectly call is now skipped for SHUFFLED mode to prevent race conditions
        this.quizService.scoreDirectly(questionIndex, true, true);


        // DISABLE ALL INCORRECT OPTIONS FOR MULTI-ANSWER
        if (!this.disabledOptionsPerQuestion.has(questionIndex)) {
          this.disabledOptionsPerQuestion.set(questionIndex, new Set<number>());
        }
        const disabledSet = this.disabledOptionsPerQuestion.get(questionIndex)!;

        for (const b of this.optionBindings ?? []) {
          if (!b.option?.correct) {
            const optId = b.option?.optionId;
            if (typeof optId === 'number') {
              disabledSet.add(optId);
              console.log(`[SOC] 🔒 MULTI-ANSWER: DISABLED incorrect option:`, optId);
            }
          }
        }

        // Force re-render
        this.disableRenderTrigger++;
        this.cdRef.markForCheck();
        this.ngZone.run(() => {
          this.appRef.tick();
          this.cdRef.detectChanges();
        });
      } else {
        console.log(`[SOC] ⏳ MULTI-ANSWER: Not all correct options clicked yet (${clickedCorrectSet.size}/${correctIds.length}), timer continues`);
      }
    }

    // For radio: always select. For checkbox: toggle.
    const newState = isSingle ? true : !binding.isSelected;

    // Construct a mock event to match what onOptionChanged expects
    const mockEvent = isSingle
      ? { source: null, value: binding.option.optionId }
      : { source: null, checked: newState };

    // 1. Run logic (generate feedback, set local flags)
    // We do this first so that updateOptionAndUI sees the "old" state and runs the
    // feedback generator.
    this.updateOptionAndUI(binding, index, mockEvent as any);

    // 2. Sync Form (Update Visuals)
    // We do this SECOND so the mat-radio-group UI updates to show the circle selected.
    // emitEvent: false ensures we don't trigger the valueChanges subscriber again.
    if (isSingle) {
      this.form.get('selectedOptionId')
        ?.setValue(binding.option.optionId, { emitEvent: false });
    }

    this.cdRef.detectChanges();

    // SELECTION MESSAGE UPDATE (using centralized computeFinalMessage)
    try {
      // Build options array with correct selection state for computeFinalMessage
      const clickedCorrectSet =
        this.correctClicksPerQuestion.get(questionIndex) ?? new Set<number>();
      const opts = bindings.map((b: OptionBindings) => ({
        ...b.option,
        selected: isSingle
          ? (b.option?.optionId === binding.option?.optionId)  // single: only clicked option is selected
          : clickedCorrectSet.has(b.option?.optionId as number)  // multi: all clicked correct options
      }));

      const message = this.selectionMessageService.computeFinalMessage({
        index: questionIndex,
        total: this.quizService?.totalQuestions,
        qType: isSingle ? QuestionType.SingleAnswer : QuestionType.MultipleAnswer,
        opts: opts as Option[]
      });

      // Push the message to the service
      if (this.selectionMessageService) {
        this.selectionMessageService.selectionMessageSubject.next(message);
      }
    } catch (err) {
      console.error('[SOC] ❌ Failed to update selection message:', err);
    }

    // Direct sound playback
    try {
      const enrichedOption: SelectedOption = {
        ...binding.option,
        questionIndex: questionIndex,
        optionId: binding.option.optionId,
        correct: binding.option.correct
      };
      this.soundService.playOnceForOption(enrichedOption);
    } catch (err: any) {
      console.error('[SOC] ❌ Failed to play sound:', err);
    }
    // NOTE: REMOVED "GUARANTEED FINAL SCORING CHECK" 
    // The scoring is now handled by:
    // 1. Single-answer: inline scoring when correct option is clicked (see "DIRECT SCORING" comment above)
    // 2. Multi-answer: scoring when isPerfectState is achieved (see "MULTI-ANSWER: PERFECTION ACHIEVED" above)
    // The final check was causing premature scoring for multi-answer questions.
  }

  public updateOptionAndUI(
    optionBinding: OptionBindings,
    index: number,
    event: MatCheckboxChange | MatRadioChange
  ): void {
    console.log(`[updateOptionAndUI] CALLED for optionId=${optionBinding?.option?.optionId}, index=${index}`);
    const currentIndex = this.getActiveQuestionIndex() ?? 0;

    if (this.lastFeedbackQuestionIndex !== currentIndex) {
      this.feedbackConfigs = {};
      this.showFeedbackForOption = {};
      this.lastFeedbackOptionId = -1;
      this.lastFeedbackQuestionIndex = currentIndex;
    }

    const optionId = optionBinding.option.optionId;
    const now = Date.now();
    const checked =
      'checked' in event ? (event as MatCheckboxChange).checked : true;

    const alreadySelected = optionBinding.option.selected && checked;

    // Always set the selection state first
    optionBinding.option.selected = checked;
    console.log(
      '[🧪 updateOptionAndUI] option.selected:',
      optionBinding.option.selected
    );

    // KEEP CANONICAL SELECTED FLAGS IN SYNC
    // This ensures multiple-answer selection sets are correct for QQC/timer.
    for (const b of this.optionBindings) {
      b.isSelected = b.option.selected ?? false;
    }

    if (alreadySelected) {
      if (
        this.lastFeedbackOptionId !== -1 &&
        this.lastFeedbackOptionId !== optionId
      ) {
        for (const k of Object.keys(this.showFeedbackForOption)) {
          this.showFeedbackForOption[+k] = false;
        }

        this.showFeedbackForOption[this.lastFeedbackOptionId] = true;

        const cfg = this.feedbackConfigs[this.lastFeedbackOptionId];
        if (cfg) cfg.showFeedback = true;

        this.cdRef.detectChanges();
      }

      // ⚡ FIX: STILL emit explanation even for already-selected options
      const activeIndex = this.getActiveQuestionIndex() ?? 0;
      this.emitExplanation(activeIndex);

      return;
    }

    // Block rapid duplicate unselect toggle
    if (
      this.lastClickedOptionId === optionId &&
      this.lastClickTimestamp &&
      now - this.lastClickTimestamp < 150 &&
      !checked
    ) {
      console.warn('[⛔ Duplicate false event]', optionId);
      return;
    }

    this.lastClickedOptionId = optionId ?? null;
    this.lastClickTimestamp = now;
    this.freezeOptionBindings ??= true;
    this.hasUserClicked = true;

    // Apply selection state
    optionBinding.option.selected = checked;
    this.perQuestionHistory.add(optionId ?? -1);

    // FORCE UPDATE SERVICE STATE DIRECTLY
    // This bypasses flaky form listeners and ensures "Next" button enables immediately.
    if (checked && optionId !== undefined && optionId !== null) {
      console.log('[SharedOptionComponent] 🚀 Forcing service update for option:', optionId);
      // We don't await this to keep UI snappy, but it triggers the subject emissions
      this.selectedOptionService.selectOption(
        optionId,
        currentIndex,
        optionBinding.option.text,
        this.type === 'multiple',
        this.optionsToDisplay
      ).then(() => { });

      // Guaranteed failsafe: directly set answered state to enable Next button
      // This ensures the button enables even if selectOption has internal issues
      this.selectedOptionService.setAnswered(true, true);

      // Double failsafe: directly set the button state via NextButtonStateService
      // This bypasses ALL stream logic and directly enables the button
      this.nextButtonStateService.setNextButtonState(true);
      console.log('[SharedOptionComponent] ✅ FORCED setNextButtonState(true) - Button should now enable');
    }

    if (this.type === 'single') {
      this.selectedOptionMap.clear();
      for (const b of this.optionBindings) {
        const id = b.option.optionId;
        if (id === undefined) {
          continue;
        }

        const shouldPaint = this.perQuestionHistory.has(id);

        b.isSelected = shouldPaint;
        b.option.selected = shouldPaint;
        b.option.highlight = shouldPaint;
        b.option.showIcon = shouldPaint;

        if (b.showFeedbackForOption && b.option.optionId !== undefined) {
          b.showFeedbackForOption[b.option.optionId] = false;
        }

        this.showFeedbackForOption[id] = id === optionId;

        b.directiveInstance?.updateHighlight();
      }
    }

    optionBinding.isSelected = true;
    optionBinding.option.highlight = true;
    optionBinding.option.showIcon = true;

    if (optionId !== undefined) {
      this.selectedOptionMap.set(optionId, true);
    }

    this.showFeedback = true;

    // Track selection history
    let isAlreadyVisited = false;
    if (optionId !== undefined) {
      const isAlreadyVisited = this.selectedOptionHistory.includes(optionId);

      if (!isAlreadyVisited) {
        this.selectedOptionHistory.push(optionId);
      }
    }

    if (alreadySelected || isAlreadyVisited) {
      console.log(
        '[↩️ Reselected existing option — preserving feedback anchor on ' +
        'previous option]'
      );

      for (const key of Object.keys(this.showFeedbackForOption)) {
        this.showFeedbackForOption[+key] = false;
      }

      if (this.lastFeedbackOptionId !== -1) {
        this.showFeedbackForOption[this.lastFeedbackOptionId] = true;

        const cfg = this.feedbackConfigs[this.lastFeedbackOptionId];
        if (cfg) cfg.showFeedback = true;
      }

      // ⚡ FIX: STILL emit explanation even for reselected options
      // This ensures FET displays when user clicks an already-selected option
      const activeIndex = this.getActiveQuestionIndex() ?? 0;
      this.emitExplanation(activeIndex);

      this.cdRef.detectChanges();
      return;
    }

    this.showFeedbackForOption = { [optionId ?? -1]: true };
    this.lastFeedbackOptionId = optionId ?? -1;

    this.toggleSelectedOption(optionBinding.option);
    this.forceHighlightRefresh(optionId ?? -1);

    for (const binding of this.optionBindings) {
      const id = binding.option.optionId ?? -1;
      const isSelected = this.selectedOptionMap.get(id) === true;

      binding.isSelected = isSelected;
      binding.option.selected = isSelected;

      if (id !== optionId) continue;

      // Use fresh data from quizService, not stale optionsToDisplay
      const currentIdx =
        this.currentQuestionIndex ??
        this.resolvedQuestionIndex ??
        this.quizService.getCurrentQuestionIndex();

      // ⚡ FIX: Use helper method that respects shuffle state
      const currentQuestion = this.getQuestionAtDisplayIndex(currentIdx);
      const freshOptions =
        this.optionsToDisplay?.length > 0
          ? this.optionsToDisplay
          : currentQuestion?.options ?? [];
      const correctOptions = freshOptions.filter((opt: Option) => opt.correct);

      const dynamicFeedback = this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        freshOptions
      );

      // ALWAYS update feedbackConfigs
      this.feedbackConfigs[optionId] = {
        feedback: dynamicFeedback,
        showFeedback: true,
        options: freshOptions,
        question: currentQuestion ?? this.currentQuestion,
        selectedOption: optionBinding.option,
        correctMessage: dynamicFeedback,
        idx: index
      };

      this.showFeedbackForOption[optionId] = true;
      this.lastFeedbackOptionId = optionId;
    }

    this.applyHighlighting(optionBinding);
    this.applyFeedback(optionBinding);

    this.updateLockedIncorrectOptions();

    if (this.type === 'single') {
      this.enforceSingleSelection(optionBinding);
    }

    for (const id of this.selectedOptionHistory) {
      const b = this.optionBindings.find(x => x.option.optionId === id);
      if (b?.option) {
        b.option.selected = true;
      }
    }
    this.syncSelectedFlags();
    for (const d of this.highlightDirectives ?? []) {
      d.updateHighlight();
    }

    // Force UI refresh: ensure feedback icons and class changes are rendered
    // immediately.
    this.cdRef.detectChanges();

    const activeIndex = this.getActiveQuestionIndex() ?? 0;
    console.log(
      `[🔧 FIX] Using activeIndex: ${activeIndex} instead of 
      quizService.currentQuestionIndex: ${this.quizService.currentQuestionIndex}`
    );
    this.emitExplanation(activeIndex);

    // Force Update Selection Message: Ensure the selection message service knows
    // about this change. This fixes the issue where messages would stay stuck on
    // "Please start..."
    this.selectionMessageService.notifySelectionMutated(this.optionsToDisplay);
    this.selectionMessageService.setSelectionMessage(false);

    this.cdRef.detectChanges();
  }

  private applyHighlighting(optionBinding: OptionBindings): void {
    const optionId = optionBinding.option.optionId;
    const isSelected = optionBinding.isSelected;
    const isCorrect = optionBinding.isCorrect;

    // Set highlight flags (can be used by directive or other logic)
    optionBinding.highlightCorrect = isSelected && isCorrect;
    optionBinding.highlightIncorrect = isSelected && !isCorrect;

    // Apply style class used in [ngClass] binding
    if (isSelected) {
      optionBinding.styleClass = isCorrect
        ? 'highlight-correct' : 'highlight-incorrect';
    } else {
      optionBinding.styleClass = '';
    }

    // Direct DOM fallback (for defensive rendering, optional)
    const optionElement = document.querySelector(
      `[data-option-id="${optionId}"]`
    );
    if (optionElement) {
      optionElement.classList.remove(
        'highlight-correct',
        'highlight-incorrect'
      );
      if (isSelected) {
        optionElement.classList.add(
          isCorrect ? 'highlight-correct' : 'highlight-incorrect'
        );
      }
      console.log(`[✅ DOM class applied for Option ${optionId}]`);
    } else {
      console.warn(`[⚠️ DOM element not found for Option ${optionId}]`);
    }
  }

  private applyFeedback(optionBinding: OptionBindings): void {
    // Prefer component input (ground truth) > config > resolved index > service
    // index. The `currentQuestion` input or `config.currentQuestion` is passed
    // directly from parent and is the most reliable source.
    // ⚡ FIX: Use getQuestionAtDisplayIndex for shuffle-aware question lookup
    const question = this.currentQuestion
      || this.config?.currentQuestion
      || this.getQuestionAtDisplayIndex(this.currentQuestionIndex)
      || this.getQuestionAtDisplayIndex(this.resolvedQuestionIndex ?? 0)
      || this.getQuestionAtDisplayIndex(this.quizService.getCurrentQuestionIndex());

    if (!question) {
      console.warn('[applyFeedback] ❌ No question found. Feedback generation skipped.');
      return;
    }

    let freshFeedback = optionBinding.option.feedback ?? 'No feedback available';

    if (question.options) {
      const correctOptions = this.quizService.getCorrectOptionsForCurrentQuestion(question);
      // ⚡ FIX: Use optionsToDisplay (shuffled visual order) instead of question.options (original order)
      // This ensures feedback option numbers match what the user sees on screen
      const visualOptions = this.optionsToDisplay?.length > 0 ? this.optionsToDisplay : question.options;
      freshFeedback = this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        visualOptions
      );
    }

    const feedbackProps: FeedbackProps = {
      feedback: freshFeedback,
      showFeedback: true,
      options: question.options ?? this.optionsToDisplay,
      question: question,
      selectedOption: optionBinding.option,
      correctMessage: freshFeedback,
      idx: optionBinding.index
    };

    const optId = optionBinding.option.optionId ?? -1;
    this.feedbackConfigs[optId] = feedbackProps;
  }

  private enforceSingleSelection(selectedBinding: OptionBindings): void {
    for (const binding of this.optionBindings) {
      const isTarget = binding === selectedBinding;

      if (!isTarget && binding.isSelected) {
        binding.isSelected = false;
        binding.option.selected = false;

        // Preserve feedback state for previously selected option
        const id = binding.option.optionId ?? -1;

        if (id !== -1) {
          this.showFeedbackForOption[id] = true;
          this.updateFeedbackState(id);
        } else {
          console.warn('[⚠️ Missing optionId for binding]', binding);
        }
      }
    }
  }

  private updateFeedbackState(optionId: number): void {
    if (!this.showFeedbackForOption) {
      this.showFeedbackForOption = {};  // ensure initialization
    }

    this.showFeedback = true;
    this.showFeedbackForOption[optionId] = true;
  }

  updateHighlighting(): void {
    if (!this.highlightDirectives?.length) {
      console.warn('[❌ updateHighlighting] No highlightDirectives available.');
      return;
    }

    let index = 0;

    for (const directive of this.highlightDirectives) {
      const binding = this.optionBindings[index];

      if (!binding) {
        console.warn(
          `[❌ updateHighlighting] No binding found for index ${index}`
        );
        index++;
        continue;
      }

      const option = binding.option;

      // Sync state flags to directive
      directive.option = option;
      directive.isSelected = binding.isSelected || !!option.selected;
      directive.isCorrect = !!option.correct;

      const feedbackMap: Record<string | number, boolean> =
        this.showFeedbackForOption ?? {};
      const optionKey = option?.optionId ?? index;

      directive.showFeedback = Boolean(
        feedbackMap[optionKey] ??
        feedbackMap[String(optionKey)] ??
        feedbackMap[index] ??
        feedbackMap[String(index)]
      );

      directive.highlightCorrectAfterIncorrect =
        this.highlightCorrectAfterIncorrect;

      // Apply highlight and icon state
      option.highlight = binding.isSelected || option.selected;
      option.showIcon = directive.isSelected && this.showFeedback;

      // Trigger directive update
      directive.updateHighlight();

      index++;
    }
  }

  private emitExplanation(questionIndex: number): void {
    console.log(`[SOC] 📣 emitExplanation called for Q${questionIndex + 1}`);
    const explanationText = this.resolveExplanationText(questionIndex);
    console.log(`[SOC] 📝 Resolved explanation for Q${questionIndex + 1}: "${explanationText?.substring(0, 50)}..."`);
    this.pendingExplanationIndex = questionIndex;
    this.applyExplanationText(explanationText, questionIndex);
    this.scheduleExplanationVerification(questionIndex, explanationText);
  }

  private applyExplanationText(
    explanationText: string,
    questionIndex: number
  ): void {
    // ⚡ FIX: Mark interaction FIRST so that when emitFormatted triggers the subscriber,
    // the 'hasUserInteracted' check passes immediately.
    this.quizStateService.markUserInteracted(questionIndex);

    const contextKey = this.buildExplanationContext(questionIndex);

    // Set active index and emit FET before locking
    this.explanationTextService._activeIndex = questionIndex;
    this.explanationTextService.latestExplanation = explanationText;
    this.explanationTextService.latestExplanationIndex = questionIndex;

    // Emit the formatted explanation to the _fetSubject stream
    this.explanationTextService.emitFormatted(questionIndex, explanationText);

    // Now set the explanation text in the service
    this.explanationTextService.setExplanationText(explanationText, {
      force: true,
      context: contextKey
    });

    const displayOptions = { context: contextKey, force: true } as const;
    this.explanationTextService.setShouldDisplayExplanation(
      true,
      displayOptions
    );
    this.explanationTextService.setIsExplanationTextDisplayed(
      true,
      displayOptions
    );
    this.explanationTextService.setResetComplete(true);

    // Lock after emitting to prevent race conditions
    this.explanationTextService.lockExplanation();

    // Switch to explanation mode so FET displays
    this.quizStateService.setDisplayState({
      mode: 'explanation',
      answered: true
    });
  }

  private buildExplanationContext(questionIndex: number): string {
    const normalized = Number.isFinite(questionIndex)
      ? Math.max(0, Math.floor(questionIndex))
      : 0;

    return `question:${normalized}`;
  }

  private scheduleExplanationVerification(
    questionIndex: number,
    explanationText: string
  ): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        let latest: string | null = null;

        // Try to synchronously grab the last emission if available
        const subj = this.explanationTextService
          .formattedExplanationSubject as any;

        try {
          // For BehaviorSubject → safe synchronous read
          if (typeof subj.getValue === 'function') {
            latest = subj.getValue();
          } else {
            // For ReplaySubject → use a one-time subscription to peek
            subj.pipe(take(1)).subscribe((val: string) => {
              latest = val;
            });
          }
        } catch {
          latest = null;
        }

        if (this.pendingExplanationIndex !== questionIndex) {
          return;
        }

        if (latest?.trim() === explanationText.trim()) {
          this.clearPendingExplanation();
          return;
        }

        this.ngZone.run(() => {
          console.warn('[🔁 Re-applying explanation text after mismatch]', {
            expected: explanationText,
            latest,
            questionIndex
          });

          this.explanationTextService.unlockExplanation();
          this.applyExplanationText(explanationText, questionIndex);
          this.cdRef.markForCheck();
          this.clearPendingExplanation();
        });
      });
    });
  }

  private clearPendingExplanation(): void {
    this.pendingExplanationIndex = -1;
  }

  private deferHighlightUpdate(callback: () => void): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.ngZone.run(() => {
          callback();
        });
      });
    });
  }

  private resolveExplanationText(questionIndex: number): string {
    console.log(`[resolveExplanationText] Q${questionIndex + 1} | optionsToDisplay.len=${this.optionsToDisplay?.length || 0} | currentQuestionIndex=${this.currentQuestionIndex} | resolvedQuestionIndex=${this.resolvedQuestionIndex}`);

    // If we have local options and this is the active question, ignore the service
    // cache validation because the service cache might hold unshuffled "default" text.
    /* const useLocalOptions =
      Array.isArray(this.optionsToDisplay) &&
      this.optionsToDisplay.length > 0 &&
      (questionIndex === this.currentQuestionIndex ||
        questionIndex === this.resolvedQuestionIndex); */
    const activeIndex = this.getActiveQuestionIndex();
    const displayIndex =
      activeIndex ??
      this.currentQuestionIndex ??
      this.resolvedQuestionIndex ??
      questionIndex;
    const useLocalOptions =
      Array.isArray(this.optionsToDisplay) &&
      this.optionsToDisplay.length > 0 &&
      questionIndex === displayIndex;

    // ⚡ FIX: Use helper method that respects shuffle state
    const question = this.getQuestionAtDisplayIndex(questionIndex);

    const shuffleActive = this.quizService?.isShuffleEnabled?.();

    if (useLocalOptions && question) {
      console.log(
        `[⚡ Using LOCAL OPTIONS for Q${questionIndex + 1} to ensure visual 
        match]`
      );

      // Sync with FeedbackService: use display order as-is to match "Option N" labels.
      const validOptions = this.optionsToDisplay;

      const correctIndices =
        this.explanationTextService.getCorrectOptionIndices(
          question,
          validOptions
        );
      const raw = (question.explanation || '').trim();
      const formatted = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        raw
      );
      this.explanationTextService.storeFormattedExplanation(
        questionIndex,
        formatted,
        question,
        validOptions
      );
      return formatted;
    }

    // Try to get pre-formatted explanation first
    const formatted =
      this.explanationTextService.formattedExplanations?.[questionIndex]?.explanation?.trim() || '';
    if (formatted && !(shuffleActive && this.optionsToDisplay?.length)) {
      console.log(
        `[✅ Using pre-formatted FET for Q${questionIndex + 1}]:`,
        formatted.slice(0, 80)
      );
      return formatted;
    }

    // Fallback: Generate on the fly if missing
    console.warn(
      `[⚠️ FET missing for Q${questionIndex + 1}] - Generating on the fly...`
    );

    if (question) {
      // Sync indices with visual options
      const rawOpts =
        this.optionsToDisplay?.length &&
          questionIndex === this.currentQuestionIndex
          ? this.optionsToDisplay
          : (question.options || []);
      const opts = rawOpts.filter(Boolean);

      const correctIndices =
        this.explanationTextService.getCorrectOptionIndices(question, opts);
      const raw = (question.explanation || '').trim();
      const formatted = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        raw
      );
      this.explanationTextService.storeFormattedExplanation(
        questionIndex,
        formatted,
        question,
        opts
      );
      return formatted;
    }

    // Get the raw explanation text
    const matchesCurrentInput = this.currentQuestionIndex === displayIndex;

    let rawExplanation = '';

    // Try current question first
    if (matchesCurrentInput && this.currentQuestion?.explanation?.trim()) {
      rawExplanation = this.currentQuestion.explanation.trim();
    }

    // Try service question
    if (!rawExplanation) {
      const serviceQuestion =
        this.quizService.currentQuestion?.getValue();
      if (serviceQuestion?.explanation && displayIndex === questionIndex) {
        rawExplanation = serviceQuestion.explanation.trim();
        console.log(
          `[📝 From quizService.currentQuestion]:`,
          rawExplanation.slice(0, 100),
        );
      }
    }

    // Try questions array using direct index lookup as fallback
    if (!rawExplanation) {
      const allQuestions =
        (Array.isArray(this.quizService.questions) && this.quizService.questions) ||
        (Array.isArray(this.quizService.questionsList) && this.quizService.questionsList) ||
        [];

      const q = allQuestions[questionIndex];
      if (q?.explanation) {
        rawExplanation = q.explanation.trim();
      }
    }

    if (!rawExplanation) {
      console.warn(`[⚠️ No explanation found for Q${questionIndex + 1}]`);
      return 'No explanation available';
    }

    // Format the Explanation with "Option X is correct because..."
    try {
      // ⚡ FIX: Use getQuestionAtDisplayIndex for shuffle-aware question lookup
      const question =
        this.currentQuestion || this.getQuestionAtDisplayIndex(questionIndex);

      if (question) {
        console.log(`[🔍 Question object for formatting]:`, {
          questionText: question.questionText?.slice(0, 80),
          explanation: question.explanation?.slice(0, 80),
          options: question.options?.map((o: Option) => ({
            text: o.text,
            correct: o.correct
          }))
        });

        // Sync indices with visual options
        const rawOpts =
          this.optionsToDisplay?.length &&
            questionIndex === this.currentQuestionIndex
            ? this.optionsToDisplay
            : (question.options || []);
        const opts = rawOpts.filter(Boolean);

        const correctIndices =
          this.explanationTextService.getCorrectOptionIndices(question, opts);
        const formattedExplanation =
          this.explanationTextService.formatExplanation(
            question,
            correctIndices,
            rawExplanation.trim()
          );
this.explanationTextService.storeFormattedExplanation(
          questionIndex,
          formattedExplanation,
          question,
          opts
        );
        console.log(
          `[✅ Formatted FET for Q${questionIndex + 1}]:`,
          formattedExplanation.slice(0, 100)
        );
        return formattedExplanation;
      }
    } catch (err: any) {
      console.warn('[⚠️ Failed to format explanation, using raw]:', err);
    }

    return rawExplanation;
  }

  private forceHighlightRefresh(optionId: number): void {
    if (!this.highlightDirectives?.length) {
      console.warn('[⚠️ No highlightDirectives available]');
      return;
    }

    let found = false;

    for (const directive of this.highlightDirectives) {
      if (directive.optionBinding?.option?.optionId === optionId) {
        const binding = this.optionBindings.find(
          (b) => b.option.optionId === optionId
        );
        if (!binding) {
          console.warn(
            '[⚠️ No binding found to sync with directive for]',
            optionId
          );
          continue;
        }

        // Sync critical directive inputs from the current binding
        directive.option = binding.option;
        directive.isSelected = binding.isSelected;
        directive.isCorrect = binding.option.correct ?? false;
        directive.showFeedback = this.showFeedbackForOption[optionId] ?? false;

        // Ensure highlight flag is enabled for this refresh
        directive.option.highlight = true;

        // Defer update to after current rendering phase
        this.deferHighlightUpdate(() => {
          directive.updateHighlight();
        });

        found = true;
        break;  // stop after first match
      }
    }

    if (!found) {
      console.warn('[⚠️ No matching directive found for optionId]', optionId);
    }
  }

  async handleOptionClick(
    option: SelectedOption | undefined,
    index: number
  ): Promise<void> {
    // Validate the option object immediately
    if (!option || typeof option !== 'object') {
      console.error(
        `Invalid or undefined option at index ${index}. Option:`,
        option
      );
      return;
    }

    // Clone the option to prevent mutations
    const clonedOption = { ...option };

    // Set last selected index for feedback targeting
    this.lastSelectedOptionIndex = index;

    // Emit the explanation update event
    this.explanationUpdate.emit(index);

    // Safely access optionId, or fallback to index
    const optionId = this.quizService.getSafeOptionId(clonedOption, index);
    if (optionId === undefined) {
      console.error(
        `Failed to access optionId. Option data: 
        ${JSON.stringify(clonedOption, null, 2)}`
      );
      return;
    }

    // Check if the click should be ignored
    if (this.shouldIgnoreClick(optionId)) {
      console.warn(`Ignoring click for optionId: ${optionId}`);
      return;
    }

    // Handle navigation reversal scenario
    if (this.isNavigatingBackwards) {
      this.handleBackwardNavigationOptionClick(clonedOption, index);
      return;
    }

    // Update option state, handle selection, and display feedback
    this.updateOptionState(index, optionId);
    this.handleSelection(clonedOption, index, optionId);
    this.displayFeedbackForOption(clonedOption, index, optionId);

    // Generate feedbackConfig per option using hydrated data
    const hydratedOption = this.optionsToDisplay[index];
    if (!hydratedOption) {
      console.warn(`[⚠️ Feedback] No hydrated option found at index ${index}`);
    } else {
      const activeQuestionIndex = this.getActiveQuestionIndex() ?? 0;
      const selectedHydratedOption: SelectedOption = {
        ...hydratedOption,
        selected: true,
        questionIndex: activeQuestionIndex
      };

      // Ensure feedbackConfigs exists and assign the new config
      this.feedbackConfigs = this.feedbackConfigs ?? [];
      this.feedbackConfigs[index] = this.generateFeedbackConfig(
        selectedHydratedOption,
        index
      );

      // Build final payload
      const payload: OptionClickedPayload = {
        option: clonedOption,  // never mutate on the way out
        index,  // option index
        checked: clonedOption.selected === true
      };

      this.optionClicked.emit(payload);
    }
  }

  private shouldIgnoreClick(optionId: number): boolean {
    if (this.clickedOptionIds.has(optionId)) {
      console.log('Option already selected, ignoring click');
      return true;
    }
    return false;
  }

  private updateOptionState(index: number, optionId: number): void {
    const optionBinding = this.optionBindings[index];
    optionBinding.option.showIcon = true;
    this.iconVisibility[optionId] = true;
    this.clickedOptionIds.add(optionId);

    console.log(`Updated option state for optionId ${optionId}`);
  }

  private handleSelection(
    option: SelectedOption,
    index: number,
    optionId: number
  ): void {
    if (this.config.type === 'single') {
      for (const opt of this.config.optionsToDisplay) {
        opt.selected = false;
      }

      option.selected = true;
      this.config.selectedOptionIndex = index;
      this.selectedOption = option;

      this.selectedOptions.clear();
      this.selectedOptions.add(optionId);
      this.selectedOptionService.setSelectedOption(option);
    } else {
      option.selected = !option.selected;
      option.selected
        ? this.selectedOptions.add(optionId)
        : this.selectedOptions.delete(optionId);
    }

    const optionBinding = this.optionBindings[index];
    optionBinding.isSelected = option.selected;
    this.showIconForOption[optionId] = option.selected;
  }

  displayFeedbackForOption(
    option: SelectedOption,
    index: number,
    optionId: number
  ): void {
    if (!option) return;

    // Confirm feedback function is triggered
    const currentQuestionIndex = this.getActiveQuestionIndex() ?? 0;
    console.log('[🚨 Feedback Fired]', { currentQuestionIndex });
    this.lastFeedbackOptionMap[currentQuestionIndex] = optionId;

    // Set the last option selected (used to show only one feedback block)
    this.lastFeedbackOptionId = option.optionId ?? -1;

    // Ensure feedback visibility state is updated
    this.showFeedback = true;
    this.showFeedbackForOption[optionId] = true;

    // Log that we're emitting answered=true for this question
    console.log('[🔥 Q2 setAnswered call]', {
      questionIndex: currentQuestionIndex,
      value: true
    });
    this.selectedOptionService.setAnswered(true, true);

    // Verify we retrieved a valid hydrated option
    const hydratedOption = this.optionsToDisplay?.[index];
    if (!hydratedOption) {
      console.warn('[⚠️ FeedbackGen] No option found at index', index);
      return;
    }

    // Construct SelectedOption object
    const selectedOption: SelectedOption = {
      ...hydratedOption,
      selected: true,
      questionIndex: currentQuestionIndex,
      feedback: hydratedOption.feedback ?? ''
    };

    // Confirm feedback config is generated properly
    this.currentFeedbackConfig = this.generateFeedbackConfig(
      selectedOption,
      index
    );
    this.feedbackConfigs[optionId] = this.currentFeedbackConfig;

    console.log('[🧪 Storing Feedback Config]', {
      optionId,
      feedbackConfig: this.feedbackConfigs[optionId]
    });

    // Update the answered state
    this.selectedOptionService.updateAnsweredState();

    // Final debug state
    console.log('[✅ displayFeedbackForOption]', {
      optionId,
      feedback: this.currentFeedbackConfig.feedback,
      showFeedbackForOption: this.showFeedbackForOption,
      lastFeedbackOptionId: this.lastFeedbackOptionId,
      selectedOptions: this.selectedOptionService.selectedOptionsMap
    });
  }

  generateFeedbackConfig(
    option: SelectedOption,
    selectedIndex: number,
  ): FeedbackProps {
    if (!option) {
      console.warn('[⚠️ generateFeedbackConfig] option is null or undefined');
      return {
        selectedOption: null,
        correctMessage: '',
        feedback: 'Feedback unavailable.',
        showFeedback: false,
        idx: selectedIndex,
        options: this.optionsToDisplay ?? [],
        question: this.currentQuestion ?? null
      };
    }

    // Sync indices with visual options
    const validOptions = (this.optionsToDisplay || []).filter(isValidOption);
    const correctMessage = this.feedbackService.setCorrectMessage(validOptions);
    const isCorrect = option.correct ?? false;
    const rawFeedback = option.feedback?.trim();

    const finalFeedback = rawFeedback
      ? `${isCorrect ? "You're right! " : "That's wrong. "}${rawFeedback}`
      : `${isCorrect ? "You're right! " : "That's wrong. "}${correctMessage || 'No feedback available.'}`;

    return {
      selectedOption: option,
      correctMessage,
      feedback: finalFeedback,
      showFeedback: true,
      idx: selectedIndex,
      options: this.optionsToDisplay ?? [],
      question: this.currentQuestion ?? null
    } as FeedbackProps;
  }

  handleBackwardNavigationOptionClick(option: Option, index: number): void {
    const optionBinding = this.optionBindings[index];

    if (this.type === 'single') {
      // For single-select, clear all selections and select only the clicked option
      for (const binding of this.optionBindings) {
        binding.isSelected = binding === optionBinding;
        binding.option.selected = binding === optionBinding;
        binding.option.showIcon = binding === optionBinding;
      }
      this.selectedOption = option;
      this.selectedOptions.clear();

      const optId = option.optionId ?? -1;
      this.selectedOptions.add(optId);
    } else {
      // For multiple-select, toggle the selection
      optionBinding.isSelected = !optionBinding.isSelected;
      optionBinding.option.selected = optionBinding.isSelected;
      optionBinding.option.showIcon = optionBinding.isSelected;

      const id = option.optionId;
      if (id !== undefined) {
        if (optionBinding.isSelected) {
          this.selectedOptions.add(id);
        } else {
          this.selectedOptions.delete(id);
        }
      }
    }

    this.showFeedback = true;
    this.updateHighlighting();

    // Explicitly emit explanation since we removed it from updateHighlighting
    this.emitExplanation(this.resolvedQuestionIndex ?? 0);

    this.cdRef.detectChanges();

    // Reset the backward navigation flag
    this.isNavigatingBackwards = false;
  }

  public resetUIForNewQuestion(): void {
    this.hasUserClicked = false;
    this.highlightedOptionIds.clear();
    this.selectedOptionMap.clear();
    this.showFeedbackForOption = {};
    this.lastFeedbackOptionId = -1;
    this.lastSelectedOptionId = -1;
    this.selectedOptionHistory = [];
    this.feedbackConfigs = {};
    this.iconVisibility = [];
    this.lockedIncorrectOptionIds.clear();
  }

  getOptionBindings(
    option: Option,
    idx: number,
    isSelected: boolean = false
  ): OptionBindings {
    // Calculate the type based on the number of correct options
    const correctOptionsCount =
      this.optionsToDisplay?.filter((opt) => opt.correct).length ?? 0;
    const type = correctOptionsCount > 1 ? 'multiple' : 'single';

    return {
      option: {
        ...structuredClone(option),
        feedback: option.feedback ?? 'No feedback available',  // default string
      },
      index: idx,
      feedback: option.feedback ?? 'No feedback available',  // never undefined
      isCorrect: option.correct ?? false, // always boolean
      showFeedback: this.showFeedback,
      showFeedbackForOption: this.showFeedbackForOption,
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      highlightIncorrect: isSelected && !option.correct,
      highlightCorrect: isSelected && !!option.correct,
      allOptions: this.optionsToDisplay,
      type: this.type,
      appHighlightOption: false,
      appHighlightInputType: type === 'multiple' ? 'checkbox' : 'radio',
      appHighlightReset: this.shouldResetBackground,
      appResetBackground: this.shouldResetBackground,
      optionsToDisplay: this.optionsToDisplay,
      isSelected: this.isSelectedOption(option),
      active: option.active ?? false, // always a boolean
      change: () => this.handleOptionClick(option as SelectedOption, idx),
      disabled: option.selected ?? false,  // always a boolean
      ariaLabel: 'Option ' + (idx + 1),
      checked: this.isSelectedOption(option)
    };
  }

  public generateOptionBindings(): void {
    const currentIndex = this.getActiveQuestionIndex() ?? 0;

    // Always start from a fresh clone of options
    const localOpts = Array.isArray(this.optionsToDisplay)
      ? this.optionsToDisplay.map((o) =>
        ({ ...JSON.parse(JSON.stringify(o)) }))
      : [];

    // Defensive clone: eliminate any shared references
    this.optionsToDisplay = localOpts.map((opt, i) => ({
      ...opt,
      optionId:
        typeof opt.optionId === 'number' && Number.isFinite(opt.optionId)
          ? opt.optionId
          : currentIndex * 100 + (i + 1),
      selected: false,
      highlight: false,
      showIcon: false
    }));

    // Get stored selections for this specific question only
    const storedSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(currentIndex) ??
      [];

    // Apply stored state immutably
    const patched =
      this.optionsToDisplay.map((opt) => {
        const match = storedSelections.find((s) => s.optionId === opt.optionId);
        return {
          ...opt,
          selected: match?.selected ?? false,
          highlight: match?.highlight ?? false,
          showIcon: match?.showIcon ?? false
        };
      });

    // Replace with fresh cloned array to break identity chain
    this.optionsToDisplay =
      patched.map((o) => ({ ...o }));

    // Build the feedback map
    const showMap: Record<number, boolean> = {};
    const newBindings =
      this.optionsToDisplay.map((opt, idx) => {
        const selected = !!opt.selected;
        const enriched: SelectedOption = {
          ...(opt as SelectedOption),
          questionIndex: currentIndex,
          selected,
          highlight: opt.highlight ?? selected,
          showIcon: opt.showIcon
        };

        if (enriched.selected && enriched.optionId != null) {
          showMap[enriched.optionId] = true;
        }

        const binding = this.getOptionBindings(enriched, idx, selected);
        binding.option = enriched;
        binding.showFeedbackForOption = showMap;
        return binding;
      });

    // Assign brand-new objects to inputs (no mutation)
    this.optionBindings = [...newBindings];
    this.showFeedbackForOption = { ...showMap };

    // Reset UI lock state
    this.updateLockedIncorrectOptions?.();

    // ⚡ FIX: Set display flags BEFORE detectChanges so canDisplayOptions returns true
    this.showOptions = true;
    this.optionsReady = true;
    this.renderReady = true;

    // Force change detection and highlight refresh
    this.cdRef.detectChanges();
    let i = 0;

    for (const d of this.highlightDirectives ?? []) {
      try {
        d.updateHighlight();
      } catch (err) {
        console.warn(`[⚠️ Highlight update failed on index ${i}]`, err);
      }
      i++;
    }

    this.markRenderReady('Bindings refreshed');
    
    // Final detectChanges to ensure template updates after all state is set
    this.cdRef.detectChanges();
  }

  public hydrateOptionsFromSelectionState(): void {
    // If no options yet → bail out safely
    if (
      !Array.isArray(this.optionsToDisplay) ||
      this.optionsToDisplay.length === 0
    ) {
      return;
    }

    const currentIndex =
      this.getActiveQuestionIndex() ??
      this.currentQuestionIndex ??
      this.questionIndex ??
      0;

    const storedSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(currentIndex) ??
      [];

    // Now it's safe to map
    this.optionsToDisplay = this.optionsToDisplay.map((opt, i) => {
      const match = storedSelections.find(
        (s) =>
          Number(s.optionId) === Number(opt.optionId) &&
          Number(s.questionIndex) === Number(currentIndex)
      );

      return {
        ...opt,
        optionId:
          typeof opt.optionId === 'number' && Number.isFinite(opt.optionId)
            ? opt.optionId
            : currentIndex * 100 + (i + 1),
        selected: !!match?.selected,
        highlight: !!match?.highlight,
        showIcon: !!match?.showIcon,
        active: opt.active ?? true,
        disabled: false
      };
    });

    this.cdRef.markForCheck();
  }

  getFeedbackBindings(option: Option, idx: number): FeedbackProps {
    // Check if the option is selected (fallback to false if undefined or null)
    const isSelected = this.isSelectedOption(option) ?? false;

    const feedbackMap: Record<string | number, boolean> =
      this.showFeedbackForOption ?? {};
    const optionKey = option?.optionId ?? idx;
    const fallbackKey = idx;

    const showFeedback =
      isSelected &&
      (feedbackMap[optionKey] ??
        feedbackMap[String(optionKey)] ??
        feedbackMap[fallbackKey] ??
        feedbackMap[String(fallbackKey)]);

    // Safeguard to ensure options array and question exist
    const options = this.optionsToDisplay ?? [];

    const fallbackQuestion: QuizQuestion = {
      questionText: 'No question available',
      options: [],
      explanation: '',
      type: QuestionType.SingleAnswer
    };

    const question = this.currentQuestion ?? fallbackQuestion;

    // Prepare the feedback properties
    return {
      options,
      question,
      selectedOption: option,
      correctMessage:
        this.feedbackService.setCorrectMessage(this.optionsToDisplay) ??
        'No correct message available',
      feedback: option.feedback ?? 'No feedback available',
      showFeedback,
      idx
    } as FeedbackProps;
  }

  initializeOptionBindings(): void {
    try {
      if (this.optionBindingsInitialized) {
        console.warn('[🛑 Already initialized]');
        return;
      }

      this.optionBindingsInitialized = true;

      const options = this.optionsToDisplay;

      if (!options?.length) {
        console.warn('[⚠️ No options available on init - will be set by ngOnChanges]');
        this.optionBindingsInitialized = false;
        return;
      }

      // Use generateOptionBindings for consistency (handles deduplication, showOptions, etc.)
      this.generateOptionBindings();
    } catch (error) {
      console.error('[❌ initializeOptionBindings error]', error);
      this.optionBindingsInitialized = false;
    } finally {
      console.timeEnd('[🔧 initializeOptionBindings]');
    }
  }

  private processOptionBindings(): void {
    const options = this.optionsToDisplay ?? [];

    // Pre-checks
    if (!options.length) {
      console.warn(
        '[⚠️ processOptionBindings] No options to process. Exiting.'
      );
      this.optionBindingsInitialized = false;
      return;
    }
    if (this.freezeOptionBindings) {
      console.warn('[💣 ABORTED optionBindings reassignment after user click]');
      return;
    }
    if (!this.currentQuestion) return;

    const selectionMap = new Map<number, boolean>(
      (this.optionBindings ?? [])
        .map((b) => {
          const id = b.option.optionId ?? -1;  // fallback for undefined ids
          return [id, b.isSelected] as [number, boolean];
        })
        .filter(([id]) => id !== -1),  // drop any undefined/fallback ids
    );

    // Use this.currentQuestion which should match optionsToDisplay
    // Don't fetch from quizService.questions as it may have different option order
    const effectiveQuestion = this.currentQuestion;
    if (!effectiveQuestion) {
      console.warn('[processOptionBindings] No currentQuestion available');
      return;
    }

    // Get correct options from the same source as optionsToDisplay
    const correctOptions = options.filter(o => o.correct === true);
    const feedbackSentence =
      this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        options
      ) || 'No feedback available.';

    const highlightSet = this.highlightedOptionIds;
    const getBindings =
      this.getOptionBindings.bind(this);

    this.optionBindings = options
      .filter((o: Option) => o.optionId !== undefined)
      .map((opt, idx) => {
        const id = opt.optionId as number;
        const isSelected = selectionMap.get(id) ?? !!opt.selected;
        opt.feedback = feedbackSentence;

        if (isSelected || highlightSet.has(id)) {
          opt.highlight = true;
        }

        return getBindings(opt, idx, isSelected);
      });

    this.updateSelections(-1);
    this.updateHighlighting();
    this.updateLockedIncorrectOptions();

    // Flag updates with minimal delay
    this.optionsReady = true;
    this.renderReady = true;
    this.viewReady = true;
    this.cdRef.detectChanges();  // ensure view is in sync
  }

  initializeFeedbackBindings(): void {
    if (this.optionBindings?.some((b) => b.isSelected)) {
      console.warn('[🛡️ Skipped reassignment — already selected]');
      return;
    }

    this.feedbackBindings = this.optionBindings.map((optionBinding, idx) => {
      if (!optionBinding || !optionBinding.option) {
        console.warn(
          `Option binding at index ${idx} is null or undefined. Using default
           feedback properties.`
        );
        return this.getDefaultFeedbackProps(idx);  // return default values when binding is invalid
      }

      const feedbackBinding = this.getFeedbackBindings(
        optionBinding.option,
        idx
      );

      // Validate the generated feedback binding
      if (!feedbackBinding || !feedbackBinding.selectedOption) {
        console.warn(
          `Invalid feedback binding at index ${idx}:`,
          feedbackBinding
        );
      }

      return feedbackBinding;
    });
  }

  // Helper method to return default FeedbackProps
  private getDefaultFeedbackProps(idx: number): FeedbackProps {
    const defaultQuestion: QuizQuestion = {
      questionText: '',
      options: [],
      explanation: '',
      type: QuestionType.SingleAnswer
    };

    return {
      correctMessage: 'No correct message available',
      feedback: 'No feedback available',
      showFeedback: false,
      selectedOption: null,
      options: this.optionsToDisplay ?? [],
      question: this.currentQuestion ?? defaultQuestion,
      idx: idx
    };
  }

  isSelectedOption(option: Option): boolean {
    return this.selectedOptionId === option.optionId;
  }

  ensureOptionIds(): void {
    for (const [index, option] of this.optionsToDisplay.entries()) {
      option.optionId = option.optionId ?? index;
    }
  }

  public shouldShowIcon(option: Option, i: number): boolean {
    const k = this.keyOf(option, i);
    const showFromCfg = !!this.feedbackConfigs[k]?.showFeedback;
    const showLegacy = !!(option as any).showIcon;
    return showFromCfg || showLegacy;
  }

  shouldShowFeedbackFor(b: OptionBindings): boolean {
    const id = b.option.optionId;
    return (
      id === this.lastFeedbackOptionId &&
      !!this.feedbackConfigs[id]?.showFeedback
    );
  }

  public get canDisplayOptions(): boolean {
    return (
      !!this.form &&
      this.renderReady &&
      this.showOptions &&
      Array.isArray(this.optionBindings) &&
      this.optionBindings.length > 0 &&
      this.optionBindings.every((b) => !!b.option)
    );
  }

  private initializeDisplay(): void {
    if (
      this.form &&
      this.optionBindings?.length > 0 &&
      this.optionsToDisplay?.length > 0
    ) {
      this.renderReady = true;
      this.viewReady = true;
      this.displayReady = true;
    } else {
      console.warn('[🛑 Display init skipped — not ready]');
    }
  }

  public markRenderReady(reason: string = ''): void {
    const bindingsReady =
      Array.isArray(this.optionBindings) && this.optionBindings.length > 0;

    const optionsReady =
      Array.isArray(this.optionsToDisplay) && this.optionsToDisplay.length > 0;

    if (bindingsReady && optionsReady) {
      this.ngZone.run(() => {
        if (reason) {
          console.log(`[✅ renderReady]: ${reason}`);
        }

        this.renderReady = true;
        this.renderReadyChange.emit(true);
        this.renderReadySubject.next(true);
      });
    } else {
      console.warn(`[❌ markRenderReady skipped] Incomplete state:`, {
        bindingsReady,
        optionsReady,
        reason
      });
    }
  }

  // Helper to regenerate feedback for a specific question index
  private regenerateFeedback(idx: number): void {
    if (idx < 0 || !this.optionsToDisplay?.length) return;

    // ⚡ FIX: Use getQuestionAtDisplayIndex for shuffle-aware question lookup
    const question = this.getQuestionAtDisplayIndex(idx);
    if (question?.options) {
      const correctOptions = this.optionsToDisplay.filter(
        (o: Option) => o.correct === true
      );
      const freshFeedback = this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        this.optionsToDisplay
      );

      this.feedbackConfigs = {};
      for (const b of this.optionBindings ?? []) {
        if (!b.option) {
          continue;
        }

        b.option.feedback = freshFeedback;
        b.feedback = freshFeedback;

        const optId = b.option.optionId ?? -1;
        if (optId < 0) {
          continue;
        }

        this.feedbackConfigs[optId] = {
          feedback: freshFeedback,
          showFeedback: b.showFeedback ?? false,
          options: this.optionsToDisplay,
          question: question,
          selectedOption: b.option,
          correctMessage: freshFeedback,
          idx: b.index
        };
      }

      // Force change detection
      this.cdRef.markForCheck();
    }
  }

  // Determine relative component logic for Q-type
  private determineQuestionType(input: QuizQuestion): 'single' | 'multiple' {
    if (Array.isArray(input.options)) {
      const correctOptionsCount = input.options.filter(
        (opt: Option) => opt.correct
      ).length;

      if (correctOptionsCount > 1) {
        return 'multiple';
      }
      if (correctOptionsCount === 1) {
        return 'single';
      }
    }

    console.warn(
      `[⚠️ determineQuestionType] No valid options or input detected. 
      Defaulting to 'single'.`
    );

    // Final fallback based on explicit type property
    return input.type === QuestionType.MultipleAnswer ? 'multiple' : 'single';
  }

  private finalizeOptionPopulation(): void {
    if (!this.optionsToDisplay?.length) {
      console.warn('[🚨 No options to display. Skipping type determination.');
      return;
    }

    // Determine type based on the populated options (if not already set correctly)
    if (this.type !== 'multiple') {
      this.type = this.currentQuestion
        ? this.determineQuestionType(this.currentQuestion)
        : 'single';
    } else {
      console.log(
        '[SOC] 🛡️ finalizeOptionPopulation preserved type="multiple"'
      );
    }
  }

  public forceDisableAllOptions(): void {
    this.forceDisableAll = true;
    for (const binding of this.optionBindings ?? []) {
      binding.disabled = true;

      if (binding.option) {
        binding.option.active = false;
      }
    }
    for (const opt of this.optionsToDisplay ?? []) {
      if (opt) {
        opt.active = false;
      }
    }
    this.cdRef.markForCheck();
  }

  public clearForceDisableAllOptions(): void {
    this.forceDisableAll = false;
    for (const binding of this.optionBindings ?? []) {
      binding.disabled = false;

      if (binding.option) {
        binding.option.active = true;
      }
    }

    for (const opt of this.optionsToDisplay ?? []) {
      if (opt) opt.active = true;
    }

    try {
      const qIndex = this.currentQuestionIndex;
      this.selectedOptionService.unlockQuestion(qIndex);
    } catch { }

    this.cdRef.markForCheck();
  }

  // Hard-reset every row (flags and visual DOM) for a brand-new question
  private fullyResetRows(): void {
    // Zero every binding flag …
    for (const b of this.optionBindings) {
      b.isSelected = false;
      b.option.selected = false;
      b.option.highlight = false;
      b.option.showIcon = false;
      b.disabled = false;

      const id = b.option.optionId;
      if (id !== undefined) {
        b.showFeedbackForOption[id] = false;
      }
    }

    this.perQuestionHistory.clear();  // forget old clicks
    this.lockedIncorrectOptionIds.clear();

    // Force every directive to repaint now
    for (const d of this.highlightDirectives ?? []) {
      d.isSelected = false;
      d.updateHighlight();
    }
  }

  // Only (de)select the clicked option, leave others untouched
  private toggleSelectedOption(clicked: Option): void {
    const isMultiple = this.type === 'multiple';

    for (const o of this.optionsToDisplay) {
      const isClicked = o.optionId === clicked.optionId;

      if (isMultiple) {
        if (isClicked) {
          o.selected = !o.selected;
          o.showIcon = o.selected;
          o.highlight = o.selected;
        }
      } else {
        // SINGLE-ANSWER: deselect others
        o.selected = isClicked;
        o.showIcon = isClicked;
        o.highlight = isClicked;
      }
    }

    this.optionsToDisplay = [...this.optionsToDisplay];  // force change detection
    this.cdRef.detectChanges();
  }

  // Ensure every binding’s option.selected matches the map / history
  private syncSelectedFlags(): void {
    for (const b of this.optionBindings) {
      const id = b.option.optionId;

      // Safely skip bindings with undefined IDs
      if (id === undefined) {
        continue;
      }

      const chosen =
        this.selectedOptionMap.get(id) === true ||
        this.selectedOptionHistory.includes(id);

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  // Immediately updates all icons for the given array of selected options.
  public applySelectionsUI(selectedOptions: SelectedOption[]): void {
    if (!this.optionsToDisplay?.length) return;

    // Build a Set for fast lookups
    const selIds =
      new Set(selectedOptions.map((s) => s.optionId));

    // Sync all three flags in one pass
    for (const opt of this.optionsToDisplay) {
      const isSelected = selIds.has(opt.optionId);
      opt.selected = isSelected;
      opt.showIcon = isSelected;
      opt.highlight = isSelected;
    }

    this.generateOptionBindings();
    this.cdRef.markForCheck();
  }

  isLocked(b: any, i: number): boolean {
    try {
      const id = this.selectionMessageService.stableKey(b.option, i);
      const qIndex = this.resolveCurrentQuestionIndex();
      return this.selectedOptionService.isOptionLocked(qIndex, id);
    } catch {
      return false;
    }
  }

  // Single place to decide disabled
  public isDisabled(binding: OptionBindings, idx: number): boolean {
    // Check persistent disabled state first
    const qIndex = this.resolveCurrentQuestionIndex();
    const optionId = binding?.option?.optionId;
    const disabledSet =
      this.disabledOptionsPerQuestion.get(qIndex);
    const isInSet =
      disabledSet && typeof optionId === 'number' && disabledSet.has(optionId);

    if (isInSet) {
      console.log(`[isDisabled] ✅ RETURNING TRUE for option ${optionId}`);
      return true;
    }
    return this.shouldDisableOption(binding) || this.isLocked(binding, idx);
  }

  // Use the same key shape everywhere (STRING so we don't lose non-numeric ids)
  // Stable per-row key: prefer numeric optionId; fallback to stableKey + index
  private keyOf(o: Option, i: number): string {
    const raw =
      o?.optionId ?? this.selectionMessageService.stableKey(o, i);
    // Normalize to string to use mixed keys safely
    return Number.isFinite(Number(raw)) ? String(Number(raw)) : String(raw);
  }

  private resolveCurrentQuestionIndex(): number {
    return Number(this.currentQuestionIndex) || 0;
  }

  /**
   * ⚡ FIX: Helper to get question at a display index, respecting shuffle state.
   * When shuffle is enabled, uses shuffledQuestions (display order).
   * When shuffle is disabled, uses questions (original order).
   */
  private getQuestionAtDisplayIndex(displayIndex: number): QuizQuestion | null {
    const isShuffled = this.quizService?.isShuffleEnabled?.() &&
      this.quizService?.shuffledQuestions?.length > 0;
    const questionSource = isShuffled
      ? this.quizService.shuffledQuestions
      : this.quizService?.questions;
    return questionSource?.[displayIndex] ?? null;
  }

  canShowOptions(): boolean {
    const hasOptions = (this.optionsToDisplay?.length ?? 0) > 0;
    return this.canDisplayOptions && this.renderReady && hasOptions;
  }

  private normalizeQuestionIndex(candidate: unknown): number | null {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      return null;
    }

    if (candidate < 0) return 0;

    return Math.floor(candidate);
  }

  private updateResolvedQuestionIndex(candidate: unknown): void {
    if (typeof candidate !== 'number' && candidate !== null) {
      console.warn(
        `[SharedOption] Invalid candidate for updateResolvedQuestionIndex: 
        ${candidate}`
      );
      return;
    }
    const normalized = this.normalizeQuestionIndex(candidate);

    if (normalized !== null) this.resolvedQuestionIndex = normalized;
  }

  private getActiveQuestionIndex(): number {
    // Highest Priority: Local Input (most specific to this option instance)
    if (typeof this.questionIndex === 'number') {
      return this.questionIndex;
    }

    // Secondary: quizService.currentQuestionIndex (fallback)
    if (typeof this.quizService?.currentQuestionIndex === 'number') {
      return this.quizService.currentQuestionIndex;
    }

    // Tertiary: quizService.getCurrentQuestionIndex() method
    const svcIndex = this.quizService?.getCurrentQuestionIndex?.();
    if (typeof svcIndex === 'number') {
      return svcIndex;
    }

    // Fallback: component properties (may be stale)
    if (typeof (this.currentQuestionIndex as any) === 'number') {
      return this.currentQuestionIndex;
    }


    return 0;  // emergency fallback
  }

  public triggerViewRefresh(): void {
    this.cdRef.markForCheck();
  }
}