import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef,
  Component, DoCheck, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
  Output, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioModule, MatRadioChange } from '@angular/material/radio';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  animationFrameScheduler, BehaviorSubject, combineLatest, Observable, of, Subject,
  Subscription
} from 'rxjs';
import { distinctUntilChanged, filter, observeOn, take, takeUntil } from 'rxjs/operators';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { Option } from '../../../../shared/models/Option.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
import { QuestionType } from '../../../../shared/models/question-type.enum';
import { SelectedOption } from '../../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../../shared/models/SharedOptionConfig.model';
import { FeedbackComponent } from '../feedback/feedback.component';
import { ExplanationTextService } from '../../../../shared/services/features/explanation-text.service';
import { FeedbackService } from '../../../../shared/services/features/feedback.service';
import { QuizService } from '../../../../shared/services/data/quiz.service';
import { QuizStateService } from '../../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../../../shared/services/features/selection-message.service';
import { TimerService } from '../../../../shared/services/features/timer.service';
import { SoundService } from '../../../../shared/services/ui/sound.service';
import { SharedOptionConfigDirective } from '../../../../directives/shared-option-config.directive';
import { correctAnswerAnim } from '../../../../animations/animations';
import { isValidOption } from '../../../../shared/utils/option-utils';
import { OptionItemComponent } from './option-item/option-item.component';
import type { OptionUIEvent } from './option-item/option-item.component';
import { OptionService } from '../../../../shared/services/options/view/option.service';
import { OptionInteractionService, OptionInteractionState } from '../../../../shared/services/options/engine/option-interaction.service';
import { SharedOptionStateAdapterService } from '../../../../shared/services/state/shared-option-state-adapter.service';
import { OptionUiContextBuilderService } from '../../../../shared/services/options/engine/option-ui-context-builder.service';
import { OptionHydrationService } from '../../../../shared/services/options/engine/option-hydration.service';
import { OptionUiSyncContext, OptionUiSyncService } from '../../../../shared/services/options/engine/option-ui-sync.service';
import { OptionLockService } from '../../../../shared/services/options/policy/option-lock.service';
import { OptionLockPolicyService } from '../../../../shared/services/options/policy/option-lock-policy.service';
import { OptionSelectionPolicyService } from '../../../../shared/services/options/policy/option-selection-policy.service';
import { OptionSelectionUiService } from '../../../../shared/services/options/engine/option-selection-ui.service';
import { OptionVisualEffectsService } from '../../../../shared/services/options/view/option-visual-effects.service';
import { SharedOptionUiState } from '../../../../shared/services/state/shared-option-state-adapter.service';
import { OptionBindingFactoryService } from '../../../../shared/services/options/engine/option-binding-factory.service';

@Component({
  selector: 'app-shared-option',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatIconModule,
    MatRadioModule,
    MatCheckboxModule,
    SharedOptionConfigDirective,
    OptionItemComponent,
    FeedbackComponent
  ],
  templateUrl: './shared-option.component.html',
  styleUrls: ['../../quiz-question/quiz-question.component.scss', './shared-option.component.scss'],
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedOptionComponent
  implements OnInit, OnChanges, DoCheck, OnDestroy, AfterViewInit {
  @Output() optionClicked = new EventEmitter<OptionClickedPayload>();
  @Output() optionEvent = new EventEmitter<OptionUIEvent>();
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
  @Input() showFeedbackForOption!: { [key: string | number]: boolean };
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
  public ui!: SharedOptionUiState;
  public finalRenderReady = false;
  private finalRenderReadySub?: Subscription;
  private selectionSub!: Subscription;
  public isSelected = false;

  private optionBindingsInitialized = false;
  feedbackBindings: FeedbackProps[] = [];
  currentFeedbackConfig!: FeedbackProps;
  feedbackConfigs: { [key: string]: FeedbackProps } = {};
  activeFeedbackConfig: FeedbackProps | null = null;
  selectedOptions: Set<number> = new Set();
  clickedOptionIds: Set<number> = new Set();
  private readonly perQuestionHistory = new Set<number>();
  // Track CORRECT option clicks per question for timer stop logic
  private correctClicksPerQuestion: Map<number, Set<number>> = new Map();
  // Track DISABLED option IDs per question - persists across binding recreations
  public disabledOptionsPerQuestion: Map<number, Set<number>> = new Map();
  iconVisibility: boolean[] = []; // array to store visibility state of icons
  showIconForOption: { [optionId: number]: boolean } = {};
  lastSelectedOptionIndex = -1;
  private lastFeedbackQuestionIndex = -1;
  lastFeedbackOptionId = -1;
  lastSelectedOptionId = -1;
  highlightedOptionIds: Set<number> = new Set();

  // Counter to force OnPush re-render when disabled state changes
  disableRenderTrigger = 0;

  // Internal tracker for last processed question index
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
  trackByOptionId = (b: OptionBindings, idx: number) => {
    const idPart = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : `idx-${idx}`;
    return `${idPart}_${idx}_${this.disableRenderTrigger}`;
  };

  public flashDisabledSet = new Set<number>();
  private lockedIncorrectOptionIds = new Set<number>();
  public forceDisableAll = false;
  public timerExpiredForQuestion = false;  // track timer expiration
  private timeoutCorrectOptionKeys = new Set<string>();
  private pendingExplanationIndex = -1;
  private resolvedQuestionIndex: number | null = null;

  private _isMultiModeCache: boolean | null = null;

  // BULLETPROOF feedback tracker: set synchronously in handleOptionClick,
  // NEVER cleared by ngOnChanges/generateOptionBindings/rebuild cycles.
  // Only cleared on question change.
  private _lastClickFeedback: { index: number; config: FeedbackProps; questionIdx: number } | null = null;

  destroy$ = new Subject<void>();

  constructor(
    private explanationTextService: ExplanationTextService,
    private feedbackService: FeedbackService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService,
    public soundService: SoundService,
    private timerService: TimerService,
    private optionService: OptionService,
    private optionHydrationService: OptionHydrationService,
    private optionInteractionService: OptionInteractionService,
    private optionUiContextBuilder: OptionUiContextBuilderService,
    private optionUiSyncService: OptionUiSyncService,
    private optionLockService: OptionLockService,
    private optionLockPolicyService: OptionLockPolicyService,
    private optionSelectionPolicyService: OptionSelectionPolicyService,
    private optionSelectionUiService: OptionSelectionUiService,
    public optionVisualEffectsService: OptionVisualEffectsService,
    private sharedOptionStateAdapterService: SharedOptionStateAdapterService,
    private optionBindingFactory: OptionBindingFactoryService,
    private cdRef: ChangeDetectorRef,
    private fb: FormBuilder,
    private ngZone: NgZone
  ) {
    this.ui = this.sharedOptionStateAdapterService.createInitialUiState();
    this.form = this.fb.group({
      selectedOptionId: [null, Validators.required]
    });

    // React to form-control changes, capturing id into updateSelections which 
    // highlights any option that has been chosen
    this.form.get('selectedOptionId')!.valueChanges
      .pipe(
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe((id: number | string) => this.onSelectionControlChanged(id));
  }

  // Robust Multi-Mode Detection (Infers from Data if Type is missing)
  get isMultiMode(): boolean {
    // Return cached result to avoid repeated computation on every CD cycle
    if (this._isMultiModeCache !== null) return this._isMultiModeCache;

    let result = false;

    // Explicit check
    if (this.type === 'multiple' || this.config?.type === 'multiple') {
      console.log(`[isMultiMode] Returning TRUE due to explicit type='multiple'`);
      result = true;
    }

    if (!result) {
      // Use getActiveQuestionIndex for most reliable index
      // Then use getQuestionAtDisplayIndex for shuffle-aware question lookup
      const idx = this.getActiveQuestionIndex();
      const currentQ = this.getQuestionAtDisplayIndex(idx) ?? this.currentQuestion;

      // Data inference (fixes multiple-answer questions)
      if (currentQ?.options) {
        // Robust count: handle boolean, string 'true', number 1, and string '1'
        const count = currentQ.options.filter((o: Option) => {
          const c = (o as any).correct;
          return c === true || String(c) === 'true' || c === 1 || c === '1';
        }).length;
        console.log(`[isMultiMode] Q${idx + 1} from question: correctCount=${count}, returning ${count > 1}`);
        if (count > 1) result = true;
      }

      // Fallback: Check optionsToDisplay (most reliable for shuffled mode)
      if (!result && this.optionsToDisplay?.length > 0) {
        const displayCount = this.optionsToDisplay.filter((o: Option) => {
          const c = (o as any).correct;
          return c === true || String(c) === 'true' || c === 1 || c === '1';
        }).length;
        console.log(`[isMultiMode] Q${idx + 1} from optionsToDisplay: correctCount=${displayCount}, returning ${displayCount > 1}`);
        if (displayCount > 1) result = true;
      }

      if (!result) {
        console.log(`[isMultiMode] Q${idx + 1}: No multi-answer detected, returning false`);
      }
    }

    // Cache result to prevent redundant computation across CD cycles
    this._isMultiModeCache = result;
    return result;
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

    // Also initialize lastProcessedQuestionIndex to prevent -1 value during 
    // first render before the subscription fires
    this.lastProcessedQuestionIndex = qIndex;

    this.updateResolvedQuestionIndex(qIndex);
  }

  private resetStateForNewQuestion(): void {
    this._isMultiModeCache = null; // invalidate: new question may have different answer count
    this.disabledOptionsPerQuestion.clear();
    this.lockedIncorrectOptionIds.clear();
    this.flashDisabledSet.clear();
    this.timerExpiredForQuestion = false;
    this.timeoutCorrectOptionKeys.clear();
    this.forceDisableAll = false;  // reset forceDisableAll for new question
    this.selectedOptions.clear();
    this.feedbackConfigs = {};
  }

  private subscribeToTimerExpiration(): void {
    this.timerService.expired$.pipe(takeUntil(this.destroy$)).subscribe(() => {

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
    // Stackblitz can be slower, so we retry at multiple intervals before 
    // showing the fallback message
    const checkAndRetry = (attempt: number) => {
      const maxAttempts = 5;  // increased for Stackblitz
      const delays = [100, 200, 400, 800, 1500];  // progressive delays for retries

      setTimeout(() => {
        // If options are now ready, try to initialize them
        if (this.optionsToDisplay?.length && !this.optionBindings?.length) {

          this.generateOptionBindings();
          this.cdRef.detectChanges();  // force immediate update for OnPush
          return;
        }

        // If we have options and bindings but display flags aren't set, fix them
        if (this.optionsToDisplay?.length && this.optionBindings?.length) {
          if (!this.showOptions || !this.renderReady) {

            this.showOptions = true;
            this.renderReady = true;
            this.optionsReady = true;
            this.showNoOptionsFallback = false;
            this.cdRef.detectChanges();  // force immediate update for OnPush
          }
          return;
        }

        // If we've exhausted retries, show fallback
        if (attempt >= maxAttempts) {
          if (!this.renderReady || !this.optionsToDisplay?.length) {
            console.warn('[SOC] Options still not ready after retries, showing fallback');
            this.showNoOptionsFallback = true;
            this.cdRef.detectChanges();  // force immediate update for OnPush
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

    // Immediately set display flags if options are available
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
    // Combine index + latest @Input options to avoid race conditions
    combineLatest([
      this.quizService.currentQuestionIndex$.pipe(distinctUntilChanged()),
      this.optionsToDisplay$
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([idx, opts]: [number, Option[]]) => {
        // Use opts (synced latest options) for logging/logic
        console.log(
          `[SOC] currentQuestionIndex$ fired: idx=${idx}, optionsToDisplay.length=${opts?.length}`
        );

        // Reset all state when question index changes
        // This fixes highlighting/disabled state persisting from previous questions
        // Use lastProcessedQuestionIndex (internal tracker) instead of @Input currentQuestionIndex
        // because the @Input might not have been updated yet when this subscription fires
        if (this.lastProcessedQuestionIndex !== idx) {

          this.resetStateForNewQuestion();

          // Clear highlighting state
          this.highlightedOptionIds.clear();
          this.selectedOptions.clear();
          this.feedbackConfigs = {};
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

        // Use opts (synced) instead of this.optionsToDisplay (may be stale)
        if (idx >= 0 && Array.isArray(opts) && opts.length > 0) {
          //  Use helper method that respects shuffle state
          const question = this.getQuestionAtDisplayIndex(idx);

          if (question?.options) {
            const correctOptions = opts.filter(
              (o: Option) => o.correct === true
            );
            console.log(
              `[SOC] Q${idx + 1} correctOptions from optionsToDisplay:`,
              correctOptions?.map((o) => o.optionId)
            );

            const serviceDisplayOrders = question.options
              ?.map((o: Option) => o.displayOrder)
              .join(',');
            const inputDisplayOrders = opts
              ?.map((o) => o.displayOrder)
              .join(',');
            console.log(
              `[SOC] Service DisplayOrders: [${serviceDisplayOrders}] | 
                 Input DisplayOrders: [${inputDisplayOrders}]`
            );

            const selections = this.selectedOptionService.getSelectedOptionsForQuestion(idx) || [];
            const freshFeedback = this.feedbackService.buildFeedbackMessage(
              question,
              selections,
              false,
              false,
              idx,
              this.optionsToDisplay
            );

            this.feedbackConfigs = {};
            this.activeFeedbackConfig = null;

            let lastSelectedId = -1;
            let hasSelection = false;

            for (const [i, b] of (this.optionBindings ?? []).entries()) {
              if (!b.option) continue;

              b.option.feedback = freshFeedback;
              b.feedback = freshFeedback;

              const key = this.keyOf(b.option, i);
              const optId = (b.option.optionId != null && b.option.optionId > -1) ? b.option.optionId : i;

              if (b.isSelected) {
                lastSelectedId = optId;
                hasSelection = true;
              }

              this.feedbackConfigs[key] = {
                feedback: freshFeedback,
                showFeedback: true,
                options: opts,
                question: question,
                selectedOption: b.option,
                correctMessage: freshFeedback,
                idx: b.index
              };

              if (this.feedbackConfigs[key].showFeedback) {
                this.activeFeedbackConfig = this.feedbackConfigs[key];
              }
            }

            if (hasSelection) {
              this.showFeedback = true;

              // Only overwrite lastFeedbackOptionId if it's invalid or no longer selected.
              // This ensures feedback stays with the most recently clicked option (which 
              // displayFeedbackForOption sets) rather than jumping to the last option in the list.
              const isCurrentFeedbackSelected =
                this.lastFeedbackOptionId !== -1 &&
                this.selectedOptions.has(this.lastFeedbackOptionId);

              if (!isCurrentFeedbackSelected) {
                this.lastFeedbackOptionId = lastSelectedId;
              }
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

      this.ensureOptionIds(); // Fix IDs BEFORE processing interaction
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
    const currentIdx = this.resolveCurrentQuestionIndex();
    const hasIndexChanged = changes['currentQuestionIndex'] || this.lastProcessedQuestionIndex !== currentIdx;
    const hasQuestionChanged = changes['question'] || changes['options'];

    if (hasIndexChanged || hasQuestionChanged) {
      console.log(`[SharedOptionComponent] Question index changed from ${this.lastProcessedQuestionIndex} to ${currentIdx}. Performing full state reset.`);

      // AUTHORITATIVE RESET of all local tracking to prevent leakage
      this.selectedOptions.clear();
      this.clickedOptionIds.clear();
      this.perQuestionHistory.clear();
      this.selectedOptionMap.clear();
      this.selectedOptionHistory = [];
      this._isMultiModeCache = null;
      this.forceDisableAll = false;
      this.lockedIncorrectOptionIds.clear();
      this.showFeedbackForOption = {};
      this.feedbackConfigs = {};
      this.lastFeedbackOptionId = -1;
      this.lastFeedbackQuestionIndex = currentIdx;
      this.showFeedback = false;
      this.isOptionSelected = false;

      this.lastProcessedQuestionIndex = currentIdx;
      this._lastClickFeedback = null; // Clear feedback on question change
    }

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
    // Only reset state if the question index has actually changed (moving to a new question)
    const qIdxChanged =
      (changes['questionIndex'] && !changes['questionIndex'].firstChange && changes['questionIndex'].previousValue !== changes['questionIndex'].currentValue) ||
      (changes['currentQuestionIndex'] && !changes['currentQuestionIndex'].firstChange && changes['currentQuestionIndex'].previousValue !== changes['currentQuestionIndex'].currentValue);

    if (qIdxChanged) {
      // Clear all disabled options - new question starts fresh
      this.disabledOptionsPerQuestion.clear();
      this.activeFeedbackConfig = null;
      this.feedbackConfigs = {};
      this.lastFeedbackOptionId = -1;
      this.showFeedback = false;
      console.log(
        '[ngOnChanges] Moving to NEW question: Cleared state'
      );

      this.disableRenderTrigger++;
    }


    console.log(
      `[HYDRATE-INDEX FIX] Resolved questionIndex=${this.currentQuestionIndex}`
    );

    // Hard Reset: Deep clone & purge any reference identity leaks immediately
    // when options change
    if (changes['optionsToDisplay'] && Array.isArray(this.optionsToDisplay)) {
      try {
        // Hard clone and purge any reference identity leaks
        this.optionsToDisplay = JSON.parse(
          JSON.stringify(this.optionsToDisplay)
        );

        // Publish the latest options snapshot for SOC reactive logic
        this.optionsToDisplay$.next(
          Array.isArray(this.optionsToDisplay) ? [...this.optionsToDisplay] : []
        );

        // DO NOT clear optionBindings array (can cause blank options on first load)
        // Instead, clear visual state on existing bindings ONLY if question changed
        if (qIdxChanged) {
          for (const b of this.optionBindings ?? []) {
            b.isSelected = false;
            b.showFeedback = false;
            b.highlightCorrect = false;
            b.highlightIncorrect = false;
            b.highlightCorrectAfterIncorrect = false;
            // Restore from service state instead of clearing blindly
            b.disabled = this.computeDisabledState(b.option, b.index);
            b.option.selected = false;
            b.option.showIcon = false;
          }
        }

        this.highlightedOptionIds.clear();
        this.selectedOption = null;
        console.log(
          '[HARD RESET] Question changed: selection state cleared'
        );

        // Help first paint with OnPush
        this.cdRef.markForCheck();
      } catch (error: any) {
        console.warn('[HARD RESET] deep clone failed', error);

        // Still push something predictable so combineLatest doesn't stall
        this.optionsToDisplay$.next(
          Array.isArray(this.optionsToDisplay) ? [...this.optionsToDisplay] : []
        );

        this.cdRef.markForCheck();
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
      } catch (error: any) {
        console.warn('[HARD CLONE BARRIER] clone failed', error);
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
        '[currentQuestionIndex changed]', changes['currentQuestionIndex']
      );

      // Update lastProcessedQuestionIndex when input changes
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

      // Synchronize type from data-detected multi-mode to ensure 
      // OptionInteractionService/OptionUiSyncService use correct logic
      if (this.isMultiMode) {
        this.type = 'multiple';
      }

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
        '[generateOptionBindings skipped] No triggering inputs changed'
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
      console.log(`[RESET] Question changed - resetting to question mode`);

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

      console.log(`[RESET] Cleared explanation text service for new question`);
    }

    // Handle TYPE changes explicitly
    if (changes['type']) {
      this.type = changes['type'].currentValue;

    }

    // UI cleanup ONLY when question index changes
    if (questionChanged && this.optionsToDisplay?.length) {
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
      // Highlight directives are now handled in OptionItemComponent


      this.updateHighlighting();
      this.cdRef.detectChanges();
    }

    // Full local visual reset to prevent ghost highlighting ONLY when question changes
    if (questionChanged) {
      console.log(
        `[SOC] Resetting local visual state for Q${this.resolvedQuestionIndex}`
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
    this.viewInitialized = true;
    this.viewReady = true;

    this.setupRehydrateTriggers();

    if (this.form) {
      console.log('form value:', this.form.value);
    } else {
      console.warn('[SOC] form is undefined in ngAfterViewInit');
    }

    if (!this.optionBindings?.length && this.optionsToDisplay?.length) {
      console.warn('[SOC] ngOnChanges not triggered, forcing optionBindings generation');
      this.generateOptionBindings();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.selectionSub?.unsubscribe();
    this.finalRenderReadySub?.unsubscribe();
  }

  private rehydrateUiFromState(reason: string): void {
    const qIndex = this.resolveCurrentQuestionIndex();
    const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    if (!saved.length) return;

    // Unified Selection Source of Truth: sync ALL flags (selected, highlight, showIcon)
    // exclusively by index to prevent row-level isolation issues with non-unique IDs.
    const savedByIndex = new Map<number, SelectedOption>();
    for (const s of saved) {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      if (sIdx != null && Number.isFinite(Number(sIdx))) {
        savedByIndex.set(Number(sIdx), s);
      }
    }

    // Sync bindings exclusively by index
    if (this.optionBindings?.length) {
      this.optionBindings.forEach((b, idx) => {
        const match = savedByIndex.get(idx);
        if (match) {
          b.isSelected = !!match.selected;
          b.option.selected = !!match.selected;
          b.option.highlight = !!match.highlight;
          b.option.showIcon = !!match.showIcon;
        } else {
          // Explicitly clear highlighting if it's no longer in the service sync
          b.isSelected = false;
          b.option.selected = false;
          b.option.highlight = false;
          b.option.showIcon = false;
        }
        // Force sync disabled state during rehydration
        b.disabled = this.computeDisabledState(b.option, idx);
        b.showFeedback = true; // Answers exist, show feedback
      });
    }

    // Also sync optionsToDisplay (which may be what some components/directives use)
    if (this.optionsToDisplay?.length) {
      this.optionsToDisplay.forEach((opt, idx) => {
        const match = savedByIndex.get(idx);

        if (match) {
          opt.selected = !!match.selected;
          opt.highlight = !!match.highlight;
          opt.showIcon = !!match.showIcon;
        } else {
          opt.selected = false;
          opt.highlight = false;
          opt.showIcon = false;
        }
      });
    }

    // Restore last feedback target for anchor calculation
    if (saved.length > 0) {
      const last = saved[saved.length - 1];
      const lastIdx = (last as any).displayIndex ?? (last as any).index ?? (last as any).idx;
      if (lastIdx != null && Number.isFinite(Number(lastIdx))) {
        this.lastFeedbackOptionId = Number(lastIdx);
        this.showFeedback = true;
      }
    }

    this.rebuildShowFeedbackMapFromBindings();
    this.updateHighlighting();
    this.cdRef.markForCheck();
  }

  private setupRehydrateTriggers(): void {
    const renderReady$ =
      this.finalRenderReady$ ??
      this.renderReadySubject.asObservable();

    const qIndex$ =
      this.quizService?.currentQuestionIndex$ ?? of(0);

    combineLatest([renderReady$, qIndex$])
      .pipe(
        filter(([ready, _index]: [boolean, number]) => ready === true),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        // Ensure bindings exist
        if (!this.optionBindings?.length && this.optionsToDisplay?.length) {
          this.generateOptionBindings();
        }

        // Hydrate selection + highlighting from persisted state
        this.rehydrateUiFromState('renderReady/qIndex');
      });
  }

  private rebuildShowFeedbackMapFromBindings(): void {
    const showMap: Record<string | number, boolean> = {};

    // PREFER lastFeedbackOptionId for the anchor; it tracks the MOST RECENT click reliably
    const targetId =
      typeof this.lastFeedbackOptionId === 'number' && this.lastFeedbackOptionId !== -1
        ? this.lastFeedbackOptionId
        : (Array.isArray(this.selectedOptionHistory) && this.selectedOptionHistory.length > 0)
          ? this.selectedOptionHistory[this.selectedOptionHistory.length - 1]
          : undefined;

    let fallbackSelectedId: number | undefined
    for (const b of this.optionBindings ?? []) {
      const id = b?.option?.optionId;
      if (id == null) continue;

      showMap[id] = false;
      showMap[String(id)] = false;

      if (fallbackSelectedId === undefined && b.isSelected === true) {
        fallbackSelectedId = id;
      }
    }

    const finalTargetId = targetId !== undefined ? targetId : fallbackSelectedId;

    if (finalTargetId !== undefined) {
      showMap[finalTargetId] = true;
      showMap[String(finalTargetId)] = true;
      this.showFeedback = true;
    }

    // CRITICAL: Preserve the existing feedbackConfigs - do NOT clear them.
    // They were set by displayFeedbackForOption() and contain the correct message.
    // Only update the showFeedbackForOption map (which controls WHERE feedback shows).
    this.showFeedbackForOption = { ...showMap };

    for (const b of this.optionBindings ?? []) {
      b.showFeedbackForOption = this.showFeedbackForOption;
      if (this.showFeedback) {
        b.showFeedback = true;
      }
    }
    this.cdRef.detectChanges();
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
        '[SharedOptionComponent] Error during visibility change handling:', error
      );
    }
  }

  // Push the newly‐clicked option into history, then synchronize every binding’s
  // visual state (selected, highlight, icon, feedback) in one synchronous pass.
  private updateSelections(rawSelectedId: number | string): void {
    this.optionSelectionUiService.applySingleSelectClick(
      this.optionBindings,
      rawSelectedId,
      this.selectedOptionHistory
    );

    // Keep feedback targeted to the correct row (especially for multi-select/back-nav)
    if (this.showFeedback === true) {
      this.rebuildShowFeedbackMapFromBindings();
    }

    // Prefer OnPush-friendly invalidation; avoid forcing sync CD unless necessary
    this.cdRef.markForCheck();
  }

  private ensureOptionsToDisplay(): void {
    const activeIdx = this.getActiveQuestionIndex();
    const displayQuestion = this.getQuestionAtDisplayIndex(activeIdx);
    const fallbackOptions =
      displayQuestion?.options?.length
        ? displayQuestion.options
        : this.currentQuestion?.options;

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
        '[SharedOptionComponent] Restored optionsToDisplay from display-order question/options fallback'
      );
    } else {
      console.warn(
        '[SharedOptionComponent] No valid options available to restore.'
      );
      this.optionsToDisplay = [];
    }

    this.ensureOptionIds(); // FORCE unique positive IDs immediately
  }

  private synchronizeOptionBindings(): void {
    // Hard Guard: optionsToDisplay not ready
    if (
      !Array.isArray(this.optionsToDisplay) ||
      this.optionsToDisplay.length === 0
    ) {
      console.warn(
        '[SOC] synchronizeOptionBindings() aborted — optionsToDisplay EMPTY'
      );

      // If no user selection exists, clear; otherwise keep old bindings
      const hasSelection = this.optionBindings?.some((opt) => opt.isSelected);

      if (!hasSelection && !this.freezeOptionBindings) {
        this.optionBindings = [];
      }

      return;
    }

    // Guard: user clicked recently → freeze updates
    if (this.freezeOptionBindings) {
      console.warn('[SOC] 🔒 freezeOptionBindings active — ABORTING reassignment');
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
        disabled: this.computeDisabledState(option, idx),
        type: this.resolveInteractionType(),
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
      this.showOptions = true;  // ensure showOptions is set
      this.renderReady = true;  // ensure renderReady is set
      this.cdRef.detectChanges();  // force immediate update for OnPush
      console.warn('[SOC] optionBindings REASSIGNED', bindings);
    });

    // Restore highlights after binding reassignment
    this.updateHighlighting();
  }

  ngDoCheck(): void {
    this.updateBindingSnapshots();
  }

  buildSharedOptionConfig(b: OptionBindings, i: number): SharedOptionConfig {
    // Verify selection state from service.
    const qIndex = this.resolveCurrentQuestionIndex();
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    const isActuallySelected = currentSelections.some(s => {
      const selIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      return selIdx != null && Number(selIdx) === i;
    });

    const isCorrect = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const isMulti = this.isMultiMode;

    // Identify last correct selected among ALL current bindings
    let lastCorrectIdx: number | null = null;
    if (isMulti) {
      for (let j = this.optionBindings.length - 1; j >= 0; j--) {
        const bRef = this.optionBindings[j];
        if (bRef.isSelected && isCorrect(bRef.option)) {
          lastCorrectIdx = j;
          break;
        }
      }
    }

    const optionKey = this.keyOf(b.option, i);
    const showCorrectOnTimeout = this.timerExpiredForQuestion
      && (this.timeoutCorrectOptionKeys.has(optionKey) || !!b.option.correct);

    const isCorrectRow = isCorrect(b.option);

    // Prefer existing highlight/selected flags if they were already set by services
    // Otherwise calculate based on the rule
    let shouldHighlight = !!b.option.highlight;
    if (!shouldHighlight && (isActuallySelected || showCorrectOnTimeout)) {
      if (isMulti) {
        if (isCorrectRow) {
          shouldHighlight = (lastCorrectIdx !== null && i === lastCorrectIdx) || showCorrectOnTimeout;
        } else {
          shouldHighlight = true;
        }
      } else {
        shouldHighlight = true;
      }
    }

    // Also check if we're on the correct question (prevent Q2 state showing on Q3)
    const isOnCorrectQuestion = this.lastProcessedQuestionIndex === qIndex;

    const verifiedOption = {
      ...b.option,
      selected: isActuallySelected,
      highlight: shouldHighlight,
      showIcon: shouldHighlight
    };

    b.option.showIcon = shouldHighlight;
    b.option.highlight = shouldHighlight;
    b.isSelected = isActuallySelected;
    b.option.selected = isActuallySelected;

    return {
      option: verifiedOption,  // use verified option, not original
      idx: i,
      type: this.resolveInteractionType(),
      isOptionSelected: isActuallySelected, // use verified selection state
      isAnswerCorrect: b.isCorrect,
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      // Only force reset when:
      // 1. The component's shouldResetBackground is true (explicit reset), OR
      // 2. We're on a different question AND there are no current selections (fresh navigation)
      shouldResetBackground:
        this.shouldResetBackground || (!isOnCorrectQuestion && currentSelections.length === 0),
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
      highlight: shouldHighlight
    };
  }

  public getSharedOptionConfig(
    b: OptionBindings,
    i: number
  ): SharedOptionConfig {
    return this.buildSharedOptionConfig(b, i);
  }




  preserveOptionHighlighting(): void {
    // const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const isMulti = this.isMultiMode;

    // For multiple-answer mode, we must NOT highlight all correct answers.
    /* if (isMulti) {
      // Find the last selected correct option (if any)
      let lastSelectedCorrectId = -1;
      for (const opt of [...this.optionsToDisplay].reverse()) {
        if (opt.selected && isCorrectHelper(opt)) {
          lastSelectedCorrectId = opt.optionId ?? -1;
          break;
        }
      }
  
      for (const option of this.optionsToDisplay) {
        if (!option.selected) {
          option.highlight = false;
          continue;
        }
        
        const isCorrect = isCorrectHelper(option);
        if (isCorrect) {
          // Rule: only last correct stays highlighted
          option.highlight = (option.optionId === lastSelectedCorrectId);
        } else {
          // Rule: incorrect stays highlighted if selected
          option.highlight = true;
        }
      }
    } else {
      // Single-answer mode: standard rule (highlight the selected one)
      for (const option of this.optionsToDisplay) {
        if (option.selected) {
          option.highlight = true;
        }
      } */
    for (const option of this.optionsToDisplay) {
      // In multi-answer mode each selected option should keep its own highlight
      // state (wrong=red, correct=green) and should not drive sibling highlights.
      option.highlight = isMulti ? !!option.selected : !!option.selected;
    }
  }

  initializeFromConfig(): void {
    if (this.freezeOptionBindings) {
      console.warn(
        '[initializeFromConfig] Skipping initialization - option bindings frozen'
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



    // Guard: Config or options missing
    if (!this.config || !this.config.optionsToDisplay?.length) {
      console.warn('[initializeFromConfig] Config missing or empty.');
      return;
    }

    // Assign current question
    this.currentQuestion = this.config.currentQuestion;

    // Validate currentQuestion before proceeding
    if (!this.currentQuestion || !Array.isArray(this.currentQuestion.options)) {
      console.error(
        '[initializeFromConfig] Invalid or missing currentQuestion options.'
      );
      return;
    }

    // Populate optionsToDisplay with structured data
    this.optionsToDisplay = this.currentQuestion.options.map((opt, idx) => {
      // Ensure we have a unique and valid numeric optionId
      // Fallback to index if source is missing ID or has placeholder -1
      const rawId = opt.optionId;
      const finalId = (rawId !== undefined && rawId !== null && String(rawId) !== '-1') ? rawId : idx;

      return {
        ...opt,
        optionId: finalId,
        correct: opt.correct ?? false,
        feedback: typeof opt.feedback === 'string' ? opt.feedback.trim() : '',
        selected: opt.selected ?? false,
        active: true,
        showIcon: false
      };
    });

    if (!this.optionsToDisplay.length) {
      console.warn(
        '[initializeFromConfig] optionsToDisplay is empty after processing.'
      );
      return;
    }

    // Rehydrate selection state from Service (persistence)
    // This ensures that when navigating back, the options show as selected
    // (Green/Red).
    // Resolve index via content matching to avoid race conditions between Service and Input
    // We search the QuizService for the question that actually contains these options.
    let qIndex = this.quizService.currentQuestionIndex ?? 0;
    const inputIndex = this.resolveCurrentQuestionIndex();

    if (this.quizService.questions && this.optionsToDisplay?.length > 0) {
      const firstOptId = this.optionsToDisplay[0].optionId;
      const matchIdx = this.quizService.questions.findIndex((q: QuizQuestion) =>
        q.options?.some((o: Option) => o.optionId === firstOptId)
      );

      if (matchIdx !== -1) {
        this.resolvedQuestionIndex = matchIdx;
        qIndex = matchIdx; // Found authentic index via content match
        if (qIndex !== inputIndex && Number.isFinite(inputIndex)) {

        }
      } else {
        // No match found? Fallback to input index if valid
        if (Number.isFinite(inputIndex)) {
          this.resolvedQuestionIndex = inputIndex;
          qIndex = inputIndex;
        }
      }
    }

    // Mismatch Guard logging only
    if (qIndex !== inputIndex && Number.isFinite(inputIndex)) {
      console.warn(`[initializeFromConfig] Index divergence noted: Service/Calculated says ${qIndex}, Input says ${inputIndex}. Using ${qIndex}.`);
    }



    const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex);
    if (saved?.length > 0) {
      // Robust check: match by ID, index, or text
      for (let idx = 0; idx < this.optionsToDisplay.length; idx++) {
        const opt = this.optionsToDisplay[idx];
        const isSaved = saved.some(s =>
          (s.displayIndex === idx) || ((s as any).index === idx)
        );

        if (isSaved) {
          opt.selected = true;
          opt.showIcon = true;
          // also sync to internal set if needed
          const effectiveId = (opt.optionId != null && opt.optionId !== -1) ? opt.optionId : idx;
          this.selectedOptions.add(Number(effectiveId));
        }
      }
    } else {
      console.log(
        `[initializeFromConfig] No saved selections for Q${qIndex + 1} - starting clean`
      );
    }

    // Determine question type based on options, but Respect explicit input first!
    // Use authoritative question from service to ensure 'correct' flags are present for type determination
    const authoritativeQuestion = this.quizService.questions[qIndex] || this.currentQuestion;
    if (this.type !== 'multiple' && authoritativeQuestion) {
      this.type = this.determineQuestionType(authoritativeQuestion);
    } else {

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
        option: { ...option }, // Deep clone to isolate row state
        index: idx,
        isSelected: !!option.selected,
        isCorrect: option.correct ?? false,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: false,
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        disabled: this.computeDisabledState(option, idx),
        type: this.resolveInteractionType(),
        appHighlightOption: false,
        appHighlightInputType: '',
        allOptions: this.optionsToDisplay ?? []
      })) as unknown as OptionBindings[];
    } else {
      let idx = 0;
      for (const binding of this.optionBindings ?? []) {
        const updated = newOptions[idx];
        if (updated) {
          binding.option = { ...updated }; // Re-clone on update
          binding.isSelected = !!updated.selected;
          binding.isCorrect = updated.correct ?? false;
        }
        idx++;
      }
    }

    // Immediate update instead of deferring
    this.optionsReady = true;
    this.showOptions = true;

    // FIX: If options have shifted (e.g. Canonical -> Shuffled) while an explanation is active,
    // we MUST regenerate the explanation to ensure "Option #" references match the new visual order.
    // Q1 hydration is the common culprit.
    if (this.explanationTextService.latestExplanation) {
      const currentIdx = this.resolveDisplayIndex(this.currentQuestionIndex);
      // Only if this component is actively showing the explanation for the current question
      if (this.explanationTextService.latestExplanationIndex === currentIdx) {
        // Robust check: Only regenerate if the options differ from what might have been used before.
        // We use incomingIds vs existingIds (captured above) logic but more explicitly here.
        const incomingIds = newOptions.map((o) => o.optionId).join(',');
        // We can't easily track "what IDs generated the last FET", but we do know
        // that if we just updated bindings (incomingIds !== existingIds check above),
        // we likely need to refresh the FET.

        // However, the `if (incomingIds !== existingIds)` block (lines 1350-1368) handles the creation.
        // If we fell into the `else` block (lines 1369-1379), IDs might match but object references changed.
        // Let's rely on the explicit change of IDs to be safe.

        // Re-calculate previous IDs for this check scope
        const prevIds = this.optionBindings
          ?.map(b => b.option.optionId)
          .join(',') || '';

        // If we just rebuilt bindings, incomingIds won't match prevIds (because prevIds is from BEFORE the rebuild).
        // Actually, `this.optionBindings` is ALREADY updated by lines 1351 or 1374.
        // So we can't compare against "old" bindings here easily without storing them.

        // BUT, we know `setOptionBindingsIfChanged` is called when `optionsToDisplay` updates.
        // A simple approach: Always regenerate if active. `emitExplanation` is relatively cheap and idempotent-safe.
        // To avoid infinite loops, ensure we don't spin.


        this.deferHighlightUpdate(() => this.emitExplanation(currentIdx));
      }
    }
  }

  getOptionDisplayText(option: Option, idx: number): string {
    return this.optionService.getOptionDisplayText(option, idx);
  }

  public getOptionIcon(binding: OptionBindings, i: number): string {
    return this.optionService.getOptionIcon(binding, i);
  }

  public getOptionClasses(binding: OptionBindings): { [key: string]: boolean } {
    return this.optionService.getOptionClasses(
      binding,
      binding.index,
      this.highlightedOptionIds,
      this.flashDisabledSet,
      this.isLocked(binding, binding.index),
      this.timerExpiredForQuestion
    );
  }

  // Returns cursor style for option - 'not-allowed' for disabled/incorrect
  // options or when timer expired
  public getOptionCursor(binding: OptionBindings, index: number): string {
    return this.optionService.getOptionCursor(binding, index, this.isDisabled(binding, index), this.timerExpiredForQuestion);
  }

  // Decide if an option should be disabled, only checks disabledOptionsPerQuestion
  // Map. All actual disabling decisions are made in onOptionContentClick
  public shouldDisableOption(binding: OptionBindings): boolean {
    if (!binding || !binding.option) return false;

    const option = binding.option;
    const optionId = option.optionId;
    // Use quizService.currentQuestionIndex (authoritative) instead of 
    // resolveCurrentQuestionIndex() which may return stale @Input value
    const qIndex = this.quizService.currentQuestionIndex ?? this.resolveCurrentQuestionIndex();

    // Force unlock for Multi-Select (fix "green to red" lock)
    if (this.isMultiMode) {
      if (this.forceDisableAll) return true;
      return false;
    }
    return true;
  }


  public computeDisabledState(option: Option, index: number): boolean {
    const qIndex = this.currentQuestionIndex;
    const lockId = (option?.optionId != null && Number(option.optionId) !== -1) ? option.optionId : index;

    const disabledSet = this.disabledOptionsPerQuestion.get(qIndex);
    if (disabledSet && (disabledSet.has(index) || disabledSet.has(lockId))) {
      return true;
    }

    // Check other global disable conditions
    if (this.forceDisableAll) return true;

    try {
      if (this.selectedOptionService.isQuestionLocked(qIndex)) {
        return true;
      }
    } catch { }

    try {
      // Use both index and lockId for service-level lock checking
      if (this.selectedOptionService.isOptionLocked(qIndex, index) ||
        this.selectedOptionService.isOptionLocked(qIndex, lockId)) {
        return true;
      }
    } catch { }

    if (this.lockedIncorrectOptionIds.has(index) || this.lockedIncorrectOptionIds.has(lockId)) {
      return true;
    }

    return this.flashDisabledSet.has(index) || this.flashDisabledSet.has(lockId);
  }

  // Wrapper for template compatibility or legacy calls
  public isDisabled(binding: OptionBindings, index: number): boolean {
    // Return the pre-computed state from the binding snapshot if available/trusted,
    // otherwise re-compute for robust click guarding.
    return this.computeDisabledState(binding.option, index);
  }

  private resolveQuestionType(): QuestionType {
    if (this.currentQuestion?.type) {
      return this.currentQuestion.type;
    }

    const candidateIndex = this.getActiveQuestionIndex();

    // Use helper method that respects shuffle state
    const question = this.getQuestionAtDisplayIndex(candidateIndex);
    if (question?.type) {
      return question.type;
    }

    return this.type === 'multiple'
      ? QuestionType.MultipleAnswer
      : QuestionType.SingleAnswer;
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

  public onOptionInteraction(binding: OptionBindings, index: number, event: MouseEvent): void {
    // Guard: Skip if this option is disabled (check persistent Map)
    if (this.isDisabled(binding, index)) {

      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target as HTMLElement;
    // If we clicked the native input, let it do its thing.
    if (target.tagName === 'INPUT') {
      return;
    }

    // If we clicked padding/background (not the native input), treat as content click.
    this.runOptionContentClick(binding, index, event);
  }

  public onOptionChanged(
    binding: OptionBindings,
    index: number,
    event: MatCheckboxChange | MatRadioChange
  ): void {
    this.updateOptionAndUI(binding, index, event);
  }

  public updateOptionAndUI(
    optionBinding: OptionBindings,
    index: number,
    event: MatCheckboxChange | MatRadioChange
  ): void {
    const ctx = this.buildOptionUiSyncContext();

    this.optionUiSyncService.updateOptionAndUI(optionBinding, index, event, ctx);

    // Sync ALL feedback and selection state back from ctx.
    this.feedbackConfigs = { ...ctx.feedbackConfigs };
    this.showFeedbackForOption = { ...ctx.showFeedbackForOption };
    this.showFeedback = ctx.showFeedback;
    this.lastFeedbackOptionId = Number(ctx.lastFeedbackOptionId);
    this.lastFeedbackQuestionIndex = ctx.lastFeedbackQuestionIndex;
    this.lastSelectedOptionIndex = index;
    this.lastSelectedOptionId = this.lastFeedbackOptionId;

    // CRITICAL: Also sync _lastClickFeedback and activeFeedbackConfig
    // so that shouldShowFeedbackAfter() and getInlineFeedbackConfig() work.
    // The service stores configs by keyOf() key, so look it up.
    const feedbackKey = this.keyOf(optionBinding.option, index);
    const syncedConfig = this.feedbackConfigs[feedbackKey] as FeedbackProps | undefined;
    if (syncedConfig?.showFeedback) {
      this.activeFeedbackConfig = syncedConfig;
      this.currentFeedbackConfig = syncedConfig;
      this._lastClickFeedback = {
        index,
        config: syncedConfig,
        questionIdx: this.resolveCurrentQuestionIndex()
      };
    }

    // Sync the internal selection Set to avoid jumping in reactive subscriptions
    this.selectedOptions.clear();
    for (const id of ctx.selectedOptionMap.keys()) {
      this.selectedOptions.add(Number(id));
    }

    this.optionBindings = this.optionBindings.map(b => ({
      ...b,
      showFeedbackForOption: { ...this.showFeedbackForOption },
      showFeedback: this.showFeedback,
      disabled: this.computeDisabledState(b.option, b.index)
    }));

    this.updateBindingSnapshots();

    // Force CD
    this.cdRef.detectChanges();
  }



  private enforceSingleSelection(selectedBinding: OptionBindings): void {
    this.optionSelectionPolicyService.enforceSingleSelection({
      optionBindings: this.optionBindings,
      selectedBinding,
      showFeedbackForOption: this.showFeedbackForOption,
      updateFeedbackState: (id) => this.updateFeedbackState(id),
    });
  }

  private updateFeedbackState(optionId: number): void {
    if (!this.showFeedbackForOption) {
      this.showFeedbackForOption = {};  // ensure initialization
    }

    this.showFeedback = true;
    this.showFeedbackForOption[optionId] = true;
  }

  updateHighlighting(): void {
    // Moved to OptionItemComponent
  }

  private resolveInteractionType(): 'single' | 'multiple' {
    return this.isMultiMode ? 'multiple' : 'single';
  }

  private buildOptionUiSyncContext(): OptionUiSyncContext {
    return this.optionUiContextBuilder.fromSharedOptionComponent(this);
  }

  private emitExplanation(questionIndex: number): void {
    // Use resolveExplanationText so option numbering matches what the user
    // sees (shuffle-safe, multi-answer aware) instead of raw canonical explanation.
    // Falls back to canonical source if resolveExplanationText returns empty
    // to avoid shuffle index confusion.
    const activeIndex = this.getActiveQuestionIndex();
    const resolvedIndex = Number.isFinite(activeIndex)
      ? Math.max(0, Math.trunc(activeIndex))
      : Number.isFinite(questionIndex)
        ? Math.max(0, Math.trunc(questionIndex))
        : this.resolveExplanationQuestionIndex(questionIndex);

    const question =
      this.currentQuestion
      ?? this.getQuestionAtDisplayIndex(resolvedIndex)
      ?? this.quizService.questions?.[resolvedIndex]
      ?? null;

    console.log(`[SharedOptionComponent] emitExplanation checking Q${resolvedIndex + 1}...`);

    // Guard: Emit FET only when the question is resolved correctly.
    // Build selection state from live UI first (optionBindings/optionsToDisplay),
    // then fall back to service snapshots to handle persistence timing gaps.
    if (question && Array.isArray(question.options)) {
      const correctCount = question.options.filter(
        (o: any) => o.correct === true || String(o.correct) === 'true'
      ).length;

      const visualOptions = (Array.isArray(this.optionBindings) && this.optionBindings.length > 0)
        ? this.optionBindings.map((b: OptionBindings) => b.option)
        : (this.optionsToDisplay ?? []);

      const selectedFromUi = visualOptions
        .map((opt: any, idx: number) => {
          const bindingSelected = this.optionBindings?.[idx]?.isSelected === true;
          const optionSelected = opt?.selected === true || bindingSelected;
          return optionSelected
            ? ({
              optionId: opt?.optionId,
              text: opt?.text,
              correct: opt?.correct,
              displayIndex: idx
            } as any)
            : null;
        })
        .filter((opt: any) => opt != null);

      const selectedFromService =
        this.selectedOptionService.getSelectedOptionsForQuestion(resolvedIndex) ?? [];

      const normalize = (value: unknown): string =>
        String(value ?? '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\u00A0/g, ' ')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');

      const isSelectionCorrect = (sel: any): boolean => {
        if (sel?.correct === true || String(sel?.correct) === 'true') return true;

        const selId = sel?.optionId;
        const selText = normalize(sel?.text);

        const byId = question.options.find((o: any) =>
          o?.optionId !== undefined && o?.optionId !== null &&
          String(o.optionId) === String(selId)
        );
        if (byId) return byId.correct === true || String(byId.correct) === 'true';

        const byText = question.options.find((o: any) =>
          normalize(o?.text) !== '' && normalize(o?.text) === selText
        );
        if (byText) return byText.correct === true || String(byText.correct) === 'true';

        return false;
      };

      const uiResolved = (() => {
        if (selectedFromUi.length === 0) return false;

        const correctSelected = selectedFromUi.filter(isSelectionCorrect).length;
        const incorrectSelected = selectedFromUi.filter(s => !isSelectionCorrect(s)).length;

        if (correctCount > 1) {
          // Multi-answer: Lenient resolution (all correct selected, ignore incorrect)
          const allCorrect = correctSelected >= correctCount;
          if (allCorrect) {
            console.log(`[emitExplanation] Multi-answer UI Resolved: correct=${correctSelected}/${correctCount}, inc=${incorrectSelected}`);
          }
          return allCorrect;
        }
        // Single-answer: Must be correct and no other (incorrect) selection
        return correctSelected >= 1 && incorrectSelected === 0;
      })();

      const status = this.selectedOptionService.getResolutionStatus(
        question,
        selectedFromService as any,
        false // Lenient
      );

      // Autoritative resolved flag: use UI state if fresh, otherwise service state
      let resolved = (selectedFromUi.length > 0) ? uiResolved : status.resolved;

      // Safety: If service says it's resolved but UI check failed (e.g. metadata mismatch), trust the service.
      if (!resolved && status.resolved) {
        console.log(`[emitExplanation] Q${resolvedIndex + 1} UI check failed but Service check PASSED. Overriding to RESOLVED=true.`);
        resolved = true;
      }

      console.log(`[emitExplanation] Q${resolvedIndex + 1} | correctTotal=${correctCount} | uiResolved=${uiResolved} | serviceResolved=${status.resolved} -> FINAL=${resolved}`);

      if (!resolved) {
        console.log(`[emitExplanation] Q${resolvedIndex + 1} NOT resolved. Skipping FET.`);
        return;
      }
    }

    const explanationText = this.resolveExplanationText(resolvedIndex)?.trim()
      || question?.explanation
      || '';

    if (!explanationText) {
      console.warn(`[emitExplanation] No explanation text resolved for Q${resolvedIndex + 1}`);
      return;
    }

    console.log(`[SharedOptionComponent] emitExplanation proceeding for Q${resolvedIndex + 1}: "${explanationText.substring(0, 30)}..."`);

    // Cache the resolved formatted text so other components (e.g. Q4, post-restart)
    // can find it without recomputing
    this.cacheResolvedFormattedExplanation(resolvedIndex, explanationText);

    // BRUTE FORCE: Clear locks and pulse stream to bypass distinctUntilChanged/duplicate checks
    // This handles the "Back and Forth" requirement reported by user
    // and the "displays once then stops on restart" issue
    try {
      (this.explanationTextService as any)._fetLocked = false;
      this.explanationTextService.unlockExplanation();
      this.explanationTextService.explanationText$.next('');
    } catch (e) { console.warn('[SOC] Failed to unlock/pulse FET', e); }

    // Force display flags to TRUE to ensure visibility
    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.explanationTextService.shouldDisplayExplanationSource.next(true);

    // Use canonical index for logic tracking
    this.pendingExplanationIndex = resolvedIndex;
    this.applyExplanationText(explanationText, resolvedIndex);
    this.scheduleExplanationVerification(resolvedIndex, explanationText);

    console.log(`[SharedOptionComponent] emitExplanation COMPLETED for Q${resolvedIndex + 1}`);
  }

  private applyExplanationText(
    explanationText: string,
    displayIndex: number
  ): void {
    console.log(`[SharedOptionComponent] applyExplanationText displaying for Q${displayIndex + 1}`);
    // Mark interaction FIRST so that when emitFormatted triggers the subscriber,
    // the 'hasUserInteracted' check passes immediately.
    this.quizStateService.markUserInteracted(displayIndex);

    const contextKey = this.buildExplanationContext(displayIndex);

    // Set active index and emit FET before locking
    this.explanationTextService._activeIndex = displayIndex;
    this.explanationTextService.latestExplanation = explanationText;
    this.explanationTextService.latestExplanationIndex = displayIndex;

    // Emit the formatted explanation to the _fetSubject stream
    this.explanationTextService.emitFormatted(displayIndex, explanationText);

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
    console.log(`[SharedOptionComponent] DisplayState set to EXPLANATION for Q${displayIndex + 1}`);
  }

  private buildExplanationContext(questionIndex: number): string {
    const normalized = Number.isFinite(questionIndex)
      ? Math.max(0, Math.floor(questionIndex))
      : 0;

    return `question:${normalized}`;
  }

  private scheduleExplanationVerification(
    displayIndex: number,
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

        if (this.pendingExplanationIndex !== displayIndex) {
          return;
        }

        if (latest?.trim() === explanationText.trim()) {
          this.clearPendingExplanation();
          return;
        }

        this.ngZone.run(() => {
          console.warn('[Re-applying explanation text after mismatch]', {
            expected: explanationText,
            latest,
            displayIndex
          });

          this.explanationTextService.unlockExplanation();
          this.applyExplanationText(explanationText, displayIndex);
          this.cdRef.markForCheck();
          this.clearPendingExplanation();
        });
      });
    });
  }

  private resolveDisplayIndex(questionIndex: number): number {
    const explicit = Number.isFinite(questionIndex)
      ? Math.max(0, Math.floor(questionIndex))
      : null;

    // Prefer the explicit index supplied by the caller for this interaction.
    // Falling back to service state first can pick a stale index during shuffle hydration
    // and misalign Q1 explanation numbering.
    const resolved =
      explicit ??
      this.getActiveQuestionIndex() ??
      this.currentQuestionIndex ??
      this.resolvedQuestionIndex;
    return Number.isFinite(resolved) ? Math.max(0, Math.floor(resolved)) : 0;
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

  private cacheResolvedFormattedExplanation(index: number, formatted: string): void {
    const text = (formatted ?? '').trim();
    if (!text) return;

    this.explanationTextService.formattedExplanations[index] = {
      questionIndex: index,
      explanation: text
    };
    this.explanationTextService.fetByIndex.set(index, text);
    this.explanationTextService.updateFormattedExplanation(text);
  }

  private resolveExplanationText(questionIndex: number): string {
    const displayIndex = Number.isFinite(questionIndex) ? Math.max(0, Math.floor(questionIndex)) : 0;

    const normalize = (value: unknown): string =>
      String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');

    console.error(`🔴🔴🔴 [FET-SOC] Q${displayIndex + 1} | Resolving for display...`);

    // 1. Determine which options are ACTUALLY displayed right now
    // Priority 1: optionBindings (what's on screen)
    // Priority 2: optionsToDisplay (input property)
    const displayOptions = (Array.isArray(this.optionBindings) && this.optionBindings.length > 0)
      ? this.optionBindings.map(b => b.option)
      : (Array.isArray(this.optionsToDisplay) && this.optionsToDisplay.length > 0)
        ? this.optionsToDisplay
        : [];

    if (displayOptions.length === 0) {
      console.warn(`[FET-SOC] Q${displayIndex + 1} | No visual options found! Falling back to raw.`);
      return (this.currentQuestion?.explanation || '').trim();
    }

    // 2. Identify the authoritative canonical question for "truth" data
    const currentQText = normalize(this.currentQuestion?.questionText);
    const allCanonical = this.quizService.getCanonicalQuestions(this.quizId) || [];

    // Improved matching: try Text (most reliable without ID)
    let authQ = allCanonical.find(q => normalize(q.questionText) === currentQText);

    // Final fallback: use currentQuestion if no canonical match
    // Cast to remove null from type union since we return early if not found
    authQ = authQ || (this.currentQuestion as QuizQuestion);

    if (!authQ) {
      console.warn(`[FET-SOC] Q${displayIndex + 1} | No auth question found. Using raw.`);
      return (this.currentQuestion?.explanation || '').trim();
    }

    // 3. Build sets of correct identifiers from the authoritative source
    const correctIds = new Set<number>();
    const correctTexts = new Set<string>();

    // Check answers array
    if (Array.isArray(authQ.answer)) {
      authQ.answer.forEach(a => {
        if (!a) return;
        const id = Number(a.optionId);
        if (!isNaN(id)) correctIds.add(id);
        const t = normalize(a.text);
        if (t) correctTexts.add(t);
      });
    }
    // Check options array (if answers array is insufficient)
    if (correctIds.size === 0 && Array.isArray(authQ.options)) {
      authQ.options.forEach(o => {
        if (!o || !o.correct) return;
        const id = Number(o.optionId);
        if (!isNaN(id)) correctIds.add(id);
        const t = normalize(o.text);
        if (t) correctTexts.add(t);
      });
    }

    // 4. Calculate indices based on VISUAL POSITIONS
    const correctIndices = displayOptions
      .map((opt, i) => {
        const id = Number(opt.optionId);
        const text = normalize(opt.text);
        const isCorrect = (!isNaN(id) && correctIds.has(id)) ||
          (text && correctTexts.has(text)) ||
          !!opt.correct;

        if (isCorrect) {

        }
        return isCorrect ? i + 1 : null;
      })
      .filter((n): n is number => n !== null);

    console.log(`[FET-SOC] Q${displayIndex + 1} | CORRECT INDICES: ${JSON.stringify(correctIndices)}`);

    // 5. Format and Emit
    const rawExplanation = (authQ.explanation || '').trim();
    const formatted = this.explanationTextService.formatExplanation(
      { ...authQ, options: displayOptions }, // Use visual options for labeling
      correctIndices,
      rawExplanation,
      displayIndex
    );

    // Cache the result in the service for other components to use
    this.explanationTextService.storeFormattedExplanation(
      displayIndex,
      formatted,
      authQ,
      displayOptions,
      true
    );

    return formatted;
  }

  async handleOptionClick(
    option: SelectedOption | undefined,
    index: number
  ): Promise<void> {
    // Validate the option object immediately
    if (!option || typeof option !== 'object') {
      console.error(
        `Invalid or undefined option at index ${index}. Option:`, option
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
      console.error('Failed to access optionId. Option data:', JSON.stringify(clonedOption, null, 2));
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

    // BULLETPROOF: Store the feedback result in a property that NO rebuild cycle can wipe.
    // This is the single source of truth for shouldShowFeedbackAfter/getInlineFeedbackConfig.
    if (this.activeFeedbackConfig) {
      this._lastClickFeedback = {
        index,
        config: this.activeFeedbackConfig,
        questionIdx: this.resolveCurrentQuestionIndex()
      };
    }


    // Generate feedbackConfig per option using hydrated data
    const hydratedOption = this.optionsToDisplay[index];
    if (!hydratedOption) {
      console.warn('[Feedback] No hydrated option found at index ' + index);
    } else {
      const activeQuestionIndex = this.getActiveQuestionIndex() ?? 0;
      const selectedHydratedOption: SelectedOption = {
        ...hydratedOption,
        selected: true,
        questionIndex: activeQuestionIndex
      };

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
    // For multi-answer questions, NEVER ignore re-clicks - toggling is allowed
    if (this.isMultiMode) {
      return false;
    }
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
  }



  private handleSelection(
    option: SelectedOption,
    index: number,
    optionId: number
  ): void {
    const normalizedId = (optionId != null && !isNaN(Number(optionId))) ? Number(optionId) : null;
    const effectiveId = (normalizedId !== null && normalizedId > -1) ? normalizedId : index;

    // Robust Multi-Answer Detection: Check component property, config type, OR count of correct options in current metadata
    const correctCount = (this.currentQuestion?.options?.filter(o => {
      const c = (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }).length ?? 0);
    const isMultiMode = this.type === 'multiple' ||
      this.config.type === 'multiple' ||
      correctCount > 1;

    if (!isMultiMode) {
      for (const opt of this.optionsToDisplay || []) {
        opt.selected = false;
      }
      for (const b of this.optionBindings || []) {
        b.isSelected = false;
        b.option.selected = false;
      }

      // 2. Set the new selection
      option.selected = true;
      if (this.optionsToDisplay?.[index]) {
        this.optionsToDisplay[index].selected = true;
      }
      this.config.selectedOptionIndex = index;
      this.selectedOption = option;

      this.selectedOptions.clear();
      this.selectedOptions.add(effectiveId);
      this.selectedOptionService.setSelectedOption(option);
    } else {
      // Multiple mode - toggle locally
      const qIdx = this.getActiveQuestionIndex() ?? 0;

      option.selected = !option.selected;
      if (this.optionsToDisplay?.[index]) {
        this.optionsToDisplay[index].selected = option.selected;
      }

      option.selected
        ? this.selectedOptions.add(effectiveId)
        : this.selectedOptions.delete(effectiveId);

      // CRITICAL: Push to service immediately (for both selection and unselection)
      // The Service now handles ALL exclusive highlight/icon logic centrally.
      const selOpt: SelectedOption = {
        ...option,
        optionId: (option.optionId != null && option.optionId !== -1) ? option.optionId : effectiveId,
        questionIndex: qIdx,
        selected: option.selected
      };
      this.selectedOptionService.addOption(qIdx, selOpt);
    }

    const optionBinding = this.optionBindings[index];
    if (optionBinding) {
      optionBinding.isSelected = option.selected;
    }
    this.showIconForOption[effectiveId] = option.selected;
  }

  displayFeedbackForOption(
    option: SelectedOption,
    index: number,
    optionId: number
  ): void {
    if (!option) return;

    // Confirm feedback function is triggered
    const currentQuestionIndex = this.getActiveQuestionIndex() ?? 0;

    // Clear stale feedback anchors for different question
    if (this.lastFeedbackQuestionIndex !== currentQuestionIndex) {
      this.showFeedbackForOption = {};
      this.feedbackConfigs = {};
      this.lastFeedbackQuestionIndex = currentQuestionIndex;
    }

    this.lastFeedbackOptionMap[currentQuestionIndex] = optionId;

    // Set the last option selected (used to show only one feedback block)
    this.lastFeedbackOptionId = option.optionId ?? -1;

    // Use consistent effective ID (matching shouldShowFeedbackAfter)
    const normalizedIdForAnchor = (optionId != null && !isNaN(Number(optionId))) ? Number(optionId) : null;
    const effectiveId = (normalizedIdForAnchor !== null && normalizedIdForAnchor > -1) ? normalizedIdForAnchor : index;

    // Ensure feedback visibility state is updated for JUST THIS option (mutate to clear others)
    this.showFeedback = true;
    for (const k of Object.keys(this.showFeedbackForOption)) {
      delete (this.showFeedbackForOption as any)[k];
    }

    // Set both number and string keys to be bulletproof for template lookups
    this.showFeedbackForOption[effectiveId] = true;
    this.showFeedbackForOption[String(effectiveId)] = true;
    if (typeof effectiveId === 'string' && !isNaN(Number(effectiveId))) {
      this.showFeedbackForOption[Number(effectiveId)] = true;
    }

    // 🚀 CRITICAL FIX: Only set as "answered" when resolution is TRUE.
    // Do NOT infer resolved state from feedback copy text (it varies by question).
    const feedbackConfig = this.generateFeedbackConfig(option, index);

    const questionForResolution =
      this.quizService.questions?.[currentQuestionIndex] ?? this.currentQuestion;
    const selectedForResolution =
      this.selectedOptionService.getSelectedOptionsForQuestion(currentQuestionIndex) ?? [];

    let isResolved = false;
    if (questionForResolution) {
      isResolved = this.selectedOptionService.isQuestionResolvedCorrectly(
        questionForResolution,
        selectedForResolution as any
      );
    }

    // Single-answer fallback for immediate UI click before persistence catches up.
    if (!isResolved) {
      const correctCount = questionForResolution?.options?.filter(
        (o: any) => o.correct === true || String(o.correct) === 'true'
      ).length ?? 0;
      const isSingleAnswer = correctCount <= 1;
      if (isSingleAnswer && option?.correct === true) {
        isResolved = true;
      }
    }

    if (isResolved) {
      console.log('[SharedOption] Question resolved. Setting answered=true.', {
        questionIndex: currentQuestionIndex,
        selectedCount: selectedForResolution.length,
        feedback: feedbackConfig.feedback
      });
      this.selectedOptionService.setAnswered(true, true);
    } else {
      console.log('[SharedOption] Question not yet resolved. Staying in question mode.', {
        questionIndex: currentQuestionIndex,
        selectedCount: selectedForResolution.length,
        feedback: feedbackConfig.feedback
      });
      // Ensure we don't accidentally reveal the explanation path
      this.selectedOptionService.setAnswered(false, false);
    }

    // Update active reference and trigger change detection
    this.currentFeedbackConfig = feedbackConfig;
    this.activeFeedbackConfig = this.currentFeedbackConfig;

    // CRITICAL: Store config under BOTH the numeric effectiveId AND the string key
    // that keyOf() returns. The template looks up feedbackConfigs[keyOf(b.option, i)]
    // which returns String(optionId). If we only store under the number, JS treats
    // feedbackConfigs[201] and feedbackConfigs["201"] as the same for arrays but
    // NOT for plain objects, causing the template to miss the config.
    this.feedbackConfigs[effectiveId] = feedbackConfig;
    this.feedbackConfigs[String(effectiveId)] = feedbackConfig;

    // Also store under the canonical keyOf() key for the option at this index
    const hydratedOpt = this.optionsToDisplay?.[index];
    if (hydratedOpt) {
      const canonicalKey = this.keyOf(hydratedOpt, index);
      this.feedbackConfigs[canonicalKey] = feedbackConfig;
    }

    // CRITICAL: Re-generate configs for ALL options that are currently showing feedback
    // This ensures that if the latest click solves the question, any previous "Select 1 more"
    // blocks also update to "You're right!" for consistency.
    if (this.optionBindings) {
      this.optionBindings.forEach((b, i) => {
        const id = (b.option?.optionId != null && b.option.optionId > -1) ? b.option.optionId : i;
        if (this.showFeedbackForOption[id] === true && id !== effectiveId && String(id) !== String(effectiveId)) {
          const hydrated = this.optionsToDisplay?.[i];
          if (hydrated) {
            const selOpt: SelectedOption = {
              ...hydrated,
              selected: true,
              questionIndex: currentQuestionIndex,
              displayIndex: i,
              feedback: hydrated.feedback ?? ''
            };
            const updatedCfg = this.generateFeedbackConfig(selOpt, i);
            this.feedbackConfigs[id] = updatedCfg;
            this.feedbackConfigs[String(id)] = updatedCfg;
            // Also update under canonical key
            const bKey = this.keyOf(hydrated, i);
            this.feedbackConfigs[bKey] = updatedCfg;
          }
        }
      });
    }

    this.cdRef.markForCheck();

    // Update the answered state in the service
    this.selectedOptionService.updateAnsweredState();

    // Final debug state
    console.log('[displayFeedbackForOption] Sync Complete', {
      effectiveId,
      feedback: this.currentFeedbackConfig?.feedback,
      showFeedbackForOption: this.showFeedbackForOption,
      activeQuestionIndex: currentQuestionIndex
    });
  }

  generateFeedbackConfig(
    option: SelectedOption,
    selectedIndex: number,
  ): FeedbackProps {
    if (!option) {
      console.warn('[generateFeedbackConfig] option is null or undefined');
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

    // Ensure the main option has a displayIndex
    if (option.displayIndex === undefined) {
      option.displayIndex = selectedIndex;
    }

    const question = this.currentQuestion;
    // Robust detection: check type OR count of correct answers in the raw question data
    const isMulti = this.type === 'multiple' ||
      question?.type === QuestionType.MultipleAnswer ||
      (question as any)?.multipleAnswer ||
      ((question?.options?.filter(o => {
        const c = (o as any).correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }).length ?? 0) > 1);

    // For Multi-Answer: We must consider ALL selected options to return "Select 1 more" etc.
    // For Single-Answer: Just the current one is fine (since only one can be selected).
    let optionsToCheck: SelectedOption[] = [option];

    if (isMulti) {
      // Gather all currently selected options. 
      // Use consistent effectiveId (id || index) for Set lookups to match handleSelection
      // Also query the service for persisted selections (local state can be stale between clicks)
      const activeQIdx = this.getActiveQuestionIndex() ?? 0;
      const serviceSelections = this.selectedOptionService.getSelectedOptionsForQuestion(activeQIdx) ?? [];
      const serviceSelectedIds = new Set<number | string>();
      for (const sel of serviceSelections) {
        const sId = (sel as any).optionId ?? (sel as any).index;
        if (sId != null && sId !== -1) {
          serviceSelectedIds.add(sId);
          serviceSelectedIds.add(Number(sId));
          serviceSelectedIds.add(String(sId));
        }
      }

      const selectedModels = (this.optionsToDisplay || []).filter((opt, i) => {
        const id = opt.optionId;
        const normIdForFilter = (id != null && !isNaN(Number(id))) ? Number(id) : null;
        const currentEffectiveId = (normIdForFilter !== null && normIdForFilter > -1) ? normIdForFilter : i;

        // Check 1: ID is in local selectedOptions Set
        if (this.selectedOptions.has(currentEffectiveId)) return true;

        // Check 2: Option object itself is marked selected
        if (opt.selected) return true;

        // Check 3: It is the option currently being processed (fallback)
        if (i === selectedIndex) return true;
        if (option && opt === option) return true;
        if (option && id != null && id === option.optionId) return true;

        // Check 4: Service has this option as selected (handles stale local state)
        if (serviceSelectedIds.has(currentEffectiveId)) return true;
        if (id != null && serviceSelectedIds.has(id)) return true;

        return false;
      });

      console.log(`[SOC.generateFeedbackConfig] Q${activeQIdx + 1} | selectedOptionsSet:`, Array.from(this.selectedOptions));
      console.log(`[SOC.generateFeedbackConfig] Q${activeQIdx + 1} | serviceSelectedIds:`, Array.from(serviceSelectedIds));
      console.log(`[SOC.generateFeedbackConfig] Q${activeQIdx + 1} | selectedModels:`, selectedModels.map(m => m.optionId));

      // Map to include displayIndex for FeedbackService reconciliation
      optionsToCheck = selectedModels.map(m => {
        const idx = (this.optionsToDisplay || []).findIndex(orig =>
          orig === m || (m.optionId != null && m.optionId > -1 && orig.optionId === m.optionId)
        );
        return {
          ...m,
          displayIndex: idx >= 0 ? idx : undefined
        } as SelectedOption;
      });

      // Safety: ensure the current option is included if not found above
      if (!optionsToCheck.find(o => o === option || (o.optionId != null && o.optionId > -1 && o.optionId === option.optionId))) {
        optionsToCheck.push(option);
      }
      console.log(`[SOC.generateFeedbackConfig] Q${activeQIdx + 1} | finalOptionsToCheck IDs:`, optionsToCheck.map(o => o.optionId));
    }

    // Ensure correct feedback message context
    const feedbackMessage = this.feedbackService.buildFeedbackMessage(
      question as QuizQuestion,
      optionsToCheck,
      false, // strict
      this.timerExpiredForQuestion,
      this.getActiveQuestionIndex(),
      this.optionsToDisplay,
      option // targetOption
    );

    const validOptions = (this.optionsToDisplay || []).filter(isValidOption);
    const correctMessage = this.feedbackService.setCorrectMessage(validOptions, this.currentQuestion!);

    // DIRECT OVERRIDE: Check if all correct options are selected using EVERY available
    // source of truth (selectedOptions Set, optionBindings, optionsToDisplay, current click).
    let finalFeedback = feedbackMessage;
    if (isMulti) {
      const isCorrectFlag = (o: any) => o && (o.correct === true || String(o.correct) === 'true');
      const displayOpts = this.optionsToDisplay || [];

      // Count correct options
      const correctIndices: number[] = [];
      displayOpts.forEach((o, i) => {
        if (isCorrectFlag(o)) correctIndices.push(i);
      });
      const correctCount = correctIndices.length;

      // Check selection using MULTIPLE sources: any match = selected
      const isOptSelected = (opt: Option, idx: number): boolean => {
        // Source 1: optionsToDisplay item's selected flag
        if (opt.selected) return true;
        // Source 2: local selectedOptions Set (maintained by handleSelection)
        const oid = opt.optionId;
        const normId = (oid != null && !isNaN(Number(oid))) ? Number(oid) : null;
        const effId = (normId !== null && normId > -1) ? normId : idx;
        if (this.selectedOptions.has(effId)) return true;
        // Source 3: optionBindings isSelected
        if (this.optionBindings?.[idx]?.isSelected) return true;
        if (this.optionBindings?.[idx]?.option?.selected) return true;
        // Source 4: is this the option being clicked right now?
        if (idx === selectedIndex) return true;
        return false;
      };

      let correctSelectedCount = 0;
      let incorrectSelectedCount = 0;
      displayOpts.forEach((o, i) => {
        const selected = isOptSelected(o, i);
        if (isCorrectFlag(o) && selected) correctSelectedCount++;
        if (!isCorrectFlag(o) && selected) incorrectSelectedCount++;
      });

      console.log(`[SOC.override] Q${(this.getActiveQuestionIndex() ?? 0) + 1} | correctCount=${correctCount} correctSelected=${correctSelectedCount} incorrectSelected=${incorrectSelectedCount} selectedOptionsSet=[${Array.from(this.selectedOptions)}] selectedIndex=${selectedIndex}`);

      if (correctCount > 0 && correctSelectedCount >= correctCount && incorrectSelectedCount === 0) {
        finalFeedback = `You're right! ${correctMessage}`;
        console.log(`[SOC.override] OVERRIDE APPLIED → "${finalFeedback}"`);
      }
    }

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
        const isThis = binding === optionBinding;
        binding.isSelected = isThis;
        // binding.option.selected = isThis; // ❌ removed (bindings are the truth)
        binding.option.showIcon = isThis;
      }
      this.selectedOption = option;
      this.selectedOptions.clear();

      const optId = option.optionId ?? -1;
      this.selectedOptions.add(optId);
    } else {
      // For multiple-select, toggle the selection
      optionBinding.isSelected = !optionBinding.isSelected;
      // optionBinding.option.selected = optionBinding.isSelected; // ❌ removed
      optionBinding.option.showIcon = optionBinding.isSelected;

      const id = option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : index;
      if (optionBinding.isSelected) {
        this.selectedOptions.add(Number(effectiveId));
      } else {
        this.selectedOptions.delete(Number(effectiveId));
      }
    }

    this.showFeedback = true;
    this.updateHighlighting();

    // Explicitly emit explanation since removed from updateHighlighting
    this.emitExplanation(this.resolvedQuestionIndex ?? 0);

    // Prefer OnPush-friendly invalidation; avoid forcing sync CD unless necessary
    this.cdRef.markForCheck();

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
    const correctOptionsCount =
      this.optionsToDisplay?.filter((opt) => opt.correct).length ?? 0;
    const inferredType = correctOptionsCount > 1 ? 'multiple' : 'single';

    // Single truth for selection in the binding
    const selected = isSelected;

    return {
      option: {
        ...structuredClone(option),
        feedback: option.feedback ?? 'No feedback available',  // default string
        // NOTE: do NOT rely on option.selected going forward
      },
      index: idx,
      feedback: option.feedback ?? 'No feedback available',  // never undefined
      isCorrect: option.correct ?? false,  // always boolean
      showFeedback: this.showFeedback,
      showFeedbackForOption: this.showFeedbackForOption,
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      highlightIncorrect: selected && !option.correct,
      highlightCorrect: selected && !!option.correct,
      allOptions: this.optionsToDisplay,

      // Use the component's resolved type if it's trustworthy; otherwise use inferredType.
      type: this.resolveInteractionType(),

      appHighlightOption: false,
      appHighlightInputType: inferredType === 'multiple' ? 'checkbox' : 'radio',
      appHighlightReset: this.shouldResetBackground,
      appResetBackground: this.shouldResetBackground,
      optionsToDisplay: this.optionsToDisplay,

      isSelected: selected,
      active: option.active ?? true,  // always a boolean
      change: () => this.handleOptionClick(option as SelectedOption, idx),

      // Do not derive disabled from option.selected
      disabled: this.computeDisabledState(option, idx),

      ariaLabel: 'Option ' + (idx + 1),
      checked: selected
    };
  }

  public generateOptionBindings(): void {
    const currentIndex = this.getActiveQuestionIndex() ?? 0;

    // Always start from a fresh clone of options (defensive)
    const localOpts = Array.isArray(this.optionsToDisplay)
      ? this.optionsToDisplay.map((o) => structuredClone(o))
      : [];

    // Build a set of correct texts/IDs from the question's answers for robust matching
    const correctTexts = new Set<string>();
    const correctIds = new Set<number>();
    if (this.currentQuestion && Array.isArray(this.currentQuestion.answer)) {
      this.currentQuestion.answer.forEach(a => {
        if (!a) return;
        if (a.text) correctTexts.add(a.text.trim().toLowerCase());
        const id = Number(a.optionId);
        if (!isNaN(id)) correctIds.add(id);
      });
    }

    // Normalize optionIds and reset UI-ish flags on the option model
    this.optionsToDisplay = localOpts.map((opt, i) => {
      const oIdNum = Number(opt.optionId);
      const oId = !isNaN(oIdNum) ? oIdNum : (currentIndex + 1) * 100 + (i + 1);
      const oText = (opt.text ?? '').trim().toLowerCase();

      const isCorrect = opt.correct === true ||
        (opt as any).correct === "true" ||
        (!isNaN(oIdNum) && correctIds.has(oIdNum)) ||
        !!(oText && correctTexts.has(oText));

      return {
        ...opt,
        optionId: oId,
        correct: isCorrect,
        highlight: false,
        showIcon: false,
        active: opt.active ?? true,
        disabled: this.computeDisabledState(opt, i)
      };
    });

    // Build bindings via factory (single place that constructs the VM)
    this.optionBindings = this.optionBindingFactory.createBindings({
      optionsToDisplay: this.optionsToDisplay,
      type: this.resolveInteractionType(),
      showFeedback: this.showFeedback,
      showFeedbackForOption: {}, // placeholder; we rebuild immediately after hydration
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      shouldResetBackground: this.shouldResetBackground,
      ariaLabelPrefix: 'Option',
      onChange: (opt, idx) => this.handleOptionClick(opt, idx),
      // During migration, safest is to rely on rehydrate as the single truth:
      isSelected: () => false,
      isDisabled: (opt, idx) => this.computeDisabledState(opt, idx)
    });

    // Apply persisted selection to bindings (bindings-only)
    this.rehydrateUiFromState('generateOptionBindings');

    // Now rebuild the feedback visibility map based on bindings selection
    // BUT only if there are no active feedbackConfigs (otherwise we'd wipe
    // the configs that were just set by displayFeedbackForOption)
    const hasFreshFeedback = Object.keys(this.feedbackConfigs).length > 0;
    if (!hasFreshFeedback) {
      this.rebuildShowFeedbackMapFromBindings();
    }

    // Set display flags before CD so canDisplayOptions returns true
    this.showOptions = true;
    this.optionsReady = true;
    this.renderReady = true;

    this.markRenderReady('Bindings refreshed');

    // Avoid forcing sync CD unless you have a proven need
    this.cdRef.markForCheck();
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
            : (currentIndex + 1) * 100 + (i + 1),
        selected: !!match?.selected,
        highlight: !!match?.highlight,
        showIcon: !!match?.showIcon,
        active: opt.active ?? true,
        disabled: this.computeDisabledState(opt, i)
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
        this.feedbackService.setCorrectMessage(this.optionsToDisplay, this.currentQuestion!) ??
        'No correct message available',
      feedback: option.feedback ?? '',
      showFeedback,
      idx
    } as FeedbackProps;
  }

  initializeOptionBindings(): void {
    try {
      if (this.optionBindingsInitialized) {
        console.warn('[Already initialized]');
        return;
      }

      this.optionBindingsInitialized = true;

      const options = this.optionsToDisplay;

      if (!options?.length) {
        console.warn('[No options available on init - will be set by ngOnChanges]');
        this.optionBindingsInitialized = false;
        return;
      }

      // Use generateOptionBindings for consistency (handles deduplication, showOptions, etc.)
      this.generateOptionBindings();
    } catch (error) {
      console.error('[initializeOptionBindings error]', error);
      this.optionBindingsInitialized = false;
    } finally {
      console.timeEnd('[initializeOptionBindings]');
    }
  }

  private processOptionBindings(): void {
    const options = this.optionsToDisplay ?? [];

    if (!options.length) {
      this.optionBindingsInitialized = false;
      return;
    }
    if (this.freezeOptionBindings) return;
    if (!this.currentQuestion) return;

    const currentIdx = this.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex();

    // 1. Fetch AUTHORITATIVE selections for THIS question from the state service
    const savedSelections = this.selectedOptionService.getSelectedOptionsForQuestion(currentIdx) || [];
    const savedIds = this.optionHydrationService.toIdSet(savedSelections);

    const getBindings = this.getOptionBindings.bind(this);
    const highlightSet = this.highlightedOptionIds;

    // 2. Generate the feedback sentence (needed for row-level feedback)
    const feedbackSentence = this.feedbackService.buildFeedbackMessage(
      this.currentQuestion,
      savedSelections,
      false,
      false,
      currentIdx,
      this.optionsToDisplay
    ) || '';

    // 3. Map options to bindings, applying restored selection state
    this.optionBindings = options.map((opt, idx) => {
      // Prioritize stored ID, fallback to index
      const oIdNum = Number(opt.optionId);
      const effectiveId = (!isNaN(oIdNum) && oIdNum > -1) ? oIdNum : idx;

      // Update the option object only if it lacks a valid ID
      if (opt.optionId == null) {
        opt.optionId = effectiveId;
      }

      // Ensure row feedback is populated
      opt.feedback = feedbackSentence;

      const isSelected = savedIds.has(effectiveId) || savedIds.has(String(effectiveId));

      if (isSelected || highlightSet.has(effectiveId)) {
        opt.highlight = true;
      }

      return getBindings(opt, idx, isSelected);
    });

    // 4. Rebuild feedback visibility based on the restored selections
    this.rebuildShowFeedbackMapFromBindings();

    this.updateSelections(-1);
    this.updateHighlighting();

    this.optionsReady = true;
    this.renderReady = true;
    this.viewReady = true;
    this.cdRef.detectChanges();
  }


  initializeFeedbackBindings(): void {
    if (this.optionBindings?.some((b) => b.isSelected)) {
      console.warn('[Skipped reassignment — already selected]');
      return;
    }

    this.feedbackBindings = this.optionBindings.map((optionBinding, idx) => {
      if (!optionBinding || !optionBinding.option) {
        console.warn('Option binding at index ' + idx + ' is null or undefined. Using default feedback properties.');
        return this.getDefaultFeedbackProps(idx);  // return default values when binding is invalid
      }

      const feedbackBinding = this.getFeedbackBindings(
        optionBinding.option,
        idx
      );

      // Validate the generated feedback binding
      if (!feedbackBinding || !feedbackBinding.selectedOption) {
        console.warn('Invalid feedback binding at index ' + idx + ':', feedbackBinding);
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
      feedback: '',
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
    for (const [index, option] of (this.optionsToDisplay ?? []).entries()) {
      const id = Number(option.optionId);
      if (option.optionId == null || isNaN(id) || id < 0) {
        option.optionId = index;
      }
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

  public canDisplayOptions(): boolean {
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
      console.warn('[Display init skipped — not ready]');
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
          console.log('[renderReady]: ' + reason);
        }

        this.renderReady = true;
        this.renderReadyChange.emit(true);
        this.renderReadySubject.next(true);
      });
    } else {
      console.warn('[markRenderReady skipped] Incomplete state:', {
        bindingsReady,
        optionsReady,
        reason
      });
    }
  }

  // Helper to regenerate feedback for a specific question index
  private regenerateFeedback(idx: number): void {
    if (idx < 0 || !this.optionsToDisplay?.length) return;

    // Use getQuestionAtDisplayIndex for shuffle-aware question lookup
    const question = this.getQuestionAtDisplayIndex(idx);
    if (question?.options) {
      const correctOptions = this.optionsToDisplay.filter(
        (o: Option) => o.correct === true
      );
      const selections = this.selectedOptionService.getSelectedOptionsForQuestion(idx) || [];
      const freshFeedback = this.feedbackService.buildFeedbackMessage(
        question,
        selections,
        false,
        false,
        idx,
        this.optionsToDisplay
      );

      this.feedbackConfigs = {};
      for (const [i, b] of (this.optionBindings ?? []).entries()) {
        if (!b.option) continue;

        b.option.feedback = freshFeedback;
        b.feedback = freshFeedback;

        const key = this.keyOf(b.option, i);
        const optId = (b.option.optionId != null && b.option.optionId > -1) ? b.option.optionId : i;

        this.feedbackConfigs[key] = {
          feedback: freshFeedback,
          showFeedback: true,
          options: this.optionsToDisplay,
          question: question,
          selectedOption: b.option,
          correctMessage: freshFeedback,
          idx: b.index,
          questionIndex: idx
        };
      }

      // Force change detection
      this.cdRef.markForCheck();
    }
  }

  // Determine relative component logic for Q-type
  private determineQuestionType(input: QuizQuestion): 'single' | 'multiple' {
    if (input && Array.isArray(input.options)) {
      const isCorrectHelper = (v: any) => v === true || String(v) === 'true' || v === 1 || v === '1';
      const correctOptionsCount = input.options.filter(o => isCorrectHelper(o.correct)).length;

      if (correctOptionsCount > 1 || input.type === QuestionType.MultipleAnswer || (input as any).multipleAnswer === true) {
        return 'multiple';
      }
    }

    return 'single';
  }

  private finalizeOptionPopulation(): void {
    if (!this.optionsToDisplay?.length) {
      console.warn('[No options to display. Skipping type determination.');
      return;
    }

    // Determine type based on the populated options (if not already set correctly)
    if (this.type !== 'multiple') {
      this.type = this.currentQuestion
        ? this.determineQuestionType(this.currentQuestion)
        : 'single';
    } else {
      console.log(
        '[SOC] finalizeOptionPopulation preserved type="multiple"'
      );
    }
  }

  public forceDisableAllOptions(): void {
    this.forceDisableAll = true;
    // Update active flag explicitly if needed, but rely on snapshot for disabled
    for (const binding of this.optionBindings ?? []) {
      if (binding.option) {
        binding.option.active = false;
      }
    }
    this.updateBindingSnapshots();
    for (const opt of this.optionsToDisplay ?? []) {
      if (opt) {
        opt.active = false;
      }
    }
    this.cdRef.markForCheck();
  }

  public clearForceDisableAllOptions(): void {
    this.forceDisableAll = false;
    // Update active flag explicitly if needed, but rely on snapshot for disabled
    for (const binding of this.optionBindings ?? []) {
      // binding.disabled = false; // handled by updateBindingSnapshots

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

    this.updateBindingSnapshots();
  }

  private updateBindingSnapshots(): void {
    if (!this.optionBindings?.length) return;

    for (const binding of this.optionBindings) {
      if (binding && binding.option) {
        // 1. Calculate Disabled State
        binding.disabled = this.computeDisabledState(binding.option, binding.index);

        // 2. Prepare context for OptionService
        // Need isLocked(binding, index).
        const qIndex = this.currentQuestionIndex;
        const isLocked = this.optionLockService.isLocked(binding, binding.index, qIndex);

        // 3. Calculate Visual State
        binding.cssClasses = this.optionService.getOptionClasses(
          binding,
          binding.index,
          this.highlightedOptionIds,
          this.flashDisabledSet,
          isLocked,
          this.timerExpiredForQuestion
        );

        binding.optionIcon = this.optionService.getOptionIcon(binding, binding.index);

        binding.optionCursor = this.optionService.getOptionCursor(
          binding,
          binding.index,
          binding.disabled,
          this.timerExpiredForQuestion
        );
      }
    }
    this.cdRef.markForCheck();
  }

  // Hard-reset every row (flags and visual DOM) for a brand-new question
  private fullyResetRows(): void {
    // Zero every binding flag …
    for (let i = 0; i < (this.optionBindings?.length ?? 0); i++) {
      const b = this.optionBindings[i];
      b.isSelected = false;
      b.option.selected = false;
      b.option.highlight = false;
      b.option.showIcon = false;
      b.disabled = false;

      const id = b.option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : i;
      b.showFeedbackForOption[effectiveId as any] = false;
    }

    this.perQuestionHistory.clear();  // forget old clicks
    this.lockedIncorrectOptionIds.clear();

    // Force every directive to repaint now
    // Highlight directives are now handled in OptionItemComponent

  }

  // Ensure every binding’s option.selected matches the map / history
  private syncSelectedFlags(): void {
    for (let i = 0; i < (this.optionBindings?.length ?? 0); i++) {
      const b = this.optionBindings[i];
      const id = b.option.optionId;
      const numericId = (id != null && id !== -1) ? Number(id) : i;

      // Check map by ID or index
      let chosen = this.selectedOptionMap.has(i) ||
        (Number.isFinite(numericId) && this.selectedOptionMap.has(numericId));

      // Fallback to history
      if (!chosen) {
        chosen = this.selectedOptionHistory.some(h => Number(h) === numericId || Number(h) === i);
      }

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  // Immediately updates all icons for the given array of selected options.
  public applySelectionsUI(selectedOptions: SelectedOption[]): void {
    if (!this.optionsToDisplay?.length) return;

    // Build a Set of UNIQUE display indices for fast lookup
    const selIndices = new Set<number>();
    for (const s of selectedOptions) {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      if (sIdx != null && Number.isFinite(Number(sIdx))) {
        selIndices.add(Number(sIdx));
      }
    }

    const isCorrect = (o: any) => {
      if (!o) return false;
      return o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1';
    };

    // Identify the VERY LAST correct selection's index for "exclusive" green highlight
    let lastCorrectIdx: number | null = null;
    for (let i = selectedOptions.length - 1; i >= 0; i--) {
      const s = selectedOptions[i];
      if (isCorrect(s)) {
        const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
        if (sIdx != null && Number.isFinite(Number(sIdx))) {
          lastCorrectIdx = Number(sIdx);
          break;
        }
      }
    }

    // Sync all visual flags strictly by array index
    for (let i = 0; i < this.optionsToDisplay.length; i++) {
      const opt = this.optionsToDisplay[i];
      const isSelected = selIndices.has(i);
      opt.selected = isSelected;

      if (this.type === 'multiple') {
        const isOptCorrect = isCorrect(opt);
        if (isOptCorrect) {
          // Rule: Only the most recent correct one is highlighted green
          opt.highlight = (lastCorrectIdx !== null && i === lastCorrectIdx);
          opt.showIcon = opt.highlight;
        } else {
          // Rule: ALL selected incorrect ones are highlighted red
          opt.highlight = isSelected;
          opt.showIcon = isSelected;
        }
      } else {
        // Single answer: standard selection behavior (all selected show icons)
        opt.showIcon = isSelected;
        opt.highlight = isSelected;
      }
    }

    this.generateOptionBindings();
    this.cdRef.markForCheck();
  }

  isLocked(b: OptionBindings, i: number): boolean {
    return this.optionLockService.isLocked(b, i, this.resolveCurrentQuestionIndex());
  }

  // Single place to decide disabled


  // Use the same key shape everywhere (STRING so we don't lose non-numeric ids)
  // Stable per-row key: prefer numeric optionId; fallback to stableKey + index
  public keyOf(o: Option, i: number): string {
    return this.optionService.keyOf(o, i);
  }

  public shouldShowFeedbackAfter(b: OptionBindings, i: number): boolean {
    // Priority 1: Check by index (most stable per-row marker)
    if (this.showFeedbackForOption[i] === true || this.showFeedbackForOption[String(i)] === true) {
      return true;
    }

    // Priority 2: Check by optionId
    const optId = (b?.option?.optionId != null && b.option.optionId > -1) ? b.option.optionId : -1;
    if (optId !== -1 && (this.showFeedbackForOption[optId] === true || this.showFeedbackForOption[String(optId)] === true)) {
      return true;
    }

    return false;
  }

  /**
   * Gets the feedback config to show inline below the last selected option.
   * Derives from feedbackConfigs (reliably set by all interaction paths)
   * rather than activeFeedbackConfig (which was not always synced).
   */
  public getInlineFeedbackConfig(b: OptionBindings, i: number): FeedbackProps | null {
    if (!this.shouldShowFeedbackAfter(b, i)) return null;

    // Highest priority: check by canonical key
    const key = this.keyOf(b.option, i);
    const cfg = this.feedbackConfigs[key];
    if (cfg?.showFeedback) return cfg;

    // Second: search all keys for matching index
    for (const k of Object.keys(this.feedbackConfigs)) {
      const c = this.feedbackConfigs[k];
      if (c && c.idx === i && c.showFeedback) return c;
    }

    // Third: search by optionId key
    const optId = (b?.option?.optionId != null && b.option.optionId > -1) ? b.option.optionId : -1;
    if (optId !== -1) {
      const cfgById = this.feedbackConfigs[String(optId)] ?? this.feedbackConfigs[optId];
      if (cfgById?.showFeedback) return cfgById;
    }

    // Final fallback: activeFeedbackConfig
    if (i === this.lastSelectedOptionIndex && this.activeFeedbackConfig?.showFeedback) {
      return this.activeFeedbackConfig;
    }

    return null;
  }

  private resolveCurrentQuestionIndex(): number {
    const active = this.getActiveQuestionIndex();
    return Number.isFinite(active) ? Math.max(0, Math.floor(active)) : 0;
  }

  private resolveExplanationQuestionIndex(questionIndex: number): number {
    if (Number.isFinite(questionIndex)) {
      return Math.max(0, Math.trunc(questionIndex));
    }

    const active = this.getActiveQuestionIndex();
    if (Number.isFinite(active)) {
      return Math.max(0, Math.trunc(active));
    }

    const svcIndex = this.quizService?.getCurrentQuestionIndex?.() ?? this.quizService?.currentQuestionIndex;
    if (typeof svcIndex === 'number' && Number.isFinite(svcIndex)) {
      return Math.max(0, Math.trunc(svcIndex));
    }

    return 0;
  }

  private resolveQuestionIndexFromCurrentQuestion(): number | null {
    const current = this.currentQuestion;
    if (!current) return null;

    const source = (this.quizService?.isShuffleEnabled?.() && Array.isArray(this.quizService?.shuffledQuestions)
      && this.quizService.shuffledQuestions.length > 0)
      ? this.quizService.shuffledQuestions
      : this.quizService?.questions;

    if (!Array.isArray(source) || source.length === 0) return null;

    const idxByRef = source.findIndex((q) => q === current);
    return idxByRef >= 0 ? idxByRef : null;
  }

  /**
   * Helper to get question at a display index, respecting shuffle state.
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
    // Data readiness is the primary gate
    const hasBindings = (this.optionBindings?.length ?? 0) > 0;
    if (!hasBindings) return false;

    // UI flags are secondary
    return this.canDisplayOptions() && this.renderReady;
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
      console.warn('[SharedOption] Invalid candidate for updateResolvedQuestionIndex:', candidate);
      return;
    }
    const normalized = this.normalizeQuestionIndex(candidate);

    if (normalized !== null) this.resolvedQuestionIndex = normalized;
  }

  public getActiveQuestionIndex(): number {
    // 1. Highest Priority: Per-question input index.
    // In review/results views multiple SharedOptionComponent instances can exist
    // at once, and currentQuestionIndex may point to the currently focused question.
    // Prefer questionIndex first so each instance resolves its own question state.
    if (typeof this.questionIndex === 'number' && Number.isFinite(this.questionIndex)) {
      return this.questionIndex;
    }
    if (typeof this.currentQuestionIndex === 'number' && Number.isFinite(this.currentQuestionIndex)) {
      return this.currentQuestionIndex;
    }

    // 2. Secondary: Resolved Index from Content Match
    if (Number.isFinite(this.resolvedQuestionIndex)) {
      return this.resolvedQuestionIndex!;
    }

    // 3. Fallback: Service State
    const svcIndex = this.quizService?.getCurrentQuestionIndex?.() ?? this.quizService?.currentQuestionIndex;
    if (typeof svcIndex === 'number' && Number.isFinite(svcIndex)) {
      return svcIndex;
    }

    return 0; // emergency fallback
  }

  public onOptionUI(ev: OptionUIEvent): void {
    // Guard: ignore null/undefined
    if (ev == null || ev.optionId == null) return;

    // Use displayIndex if provided to guarantee unique mapping, fallback to ID lookup
    const index = ev.displayIndex ?? this.findBindingByOptionId(ev.optionId)?.i;
    if (index === undefined || index < 0) return;
    const binding = this.optionBindings[index];
    if (!binding) return;


    if (!this.isDisabled(binding, index)) {
      this.cdRef.markForCheck();  // ensure UI updates
      this.soundService.playOnceForOption({
        ...binding.option,
        selected: true,
        questionIndex: this.currentQuestionIndex
      });
    }

    if (ev.kind === 'change') {
      const native = ev.nativeEvent as MatCheckboxChange | MatRadioChange;
      // updateOptionAndUI now triggers the emit via OptionUiSyncService -> ctx.onSelect
      this.updateOptionAndUI(binding, index, native);
      return;
    }

    if (ev.kind === 'interaction') {
      // Preserve your “interaction guard” behavior exactly
      const event = ev.nativeEvent as MouseEvent;

      if (this.isDisabled(binding, index)) {

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = event.target as HTMLElement;
      if (target?.tagName === 'INPUT') {
        return; // let native input handle it
      }

      // treat as content click; runOptionContentClick calls updateOptionAndUI internally
      this.runOptionContentClick(binding, index, event);
      return;
    }

    if (ev.kind === 'contentClick') {
      // runOptionContentClick calls updateOptionAndUI internally
      this.runOptionContentClick(binding, index, ev.nativeEvent as MouseEvent);
      return;
    }
  }

  private findBindingByOptionId(optionId: number): { b: OptionBindings; i: number } | null {
    const opts = this.optionBindings ?? [];

    const i = opts.findIndex((x, idx) => {
      const explicitId = x?.option?.optionId;
      const effectiveId = (explicitId != null && Number(explicitId) > -1)
        ? Number(explicitId)
        : idx;
      return effectiveId === Number(optionId);
    });

    if (i < 0) return null;
    return { b: opts[i], i };
  }

  private runOptionContentClick(binding: OptionBindings, index: number, event: MouseEvent): void {
    const state: OptionInteractionState = {
      optionBindings: this.optionBindings,
      optionsToDisplay: this.optionsToDisplay,
      // Use the active display-aligned index to avoid hydration races where
      // currentQuestionIndex can be stale (notably on Q1 after new-tab restore).
      currentQuestionIndex: this.getActiveQuestionIndex(),
      selectedOptionHistory: this.selectedOptionHistory,
      disabledOptionsPerQuestion: this.disabledOptionsPerQuestion,
      correctClicksPerQuestion: this.correctClicksPerQuestion,
      feedbackConfigs: this.feedbackConfigs,
      showFeedbackForOption: this.showFeedbackForOption,
      lastFeedbackOptionId: this.lastFeedbackOptionId,
      lastFeedbackQuestionIndex: this.lastFeedbackQuestionIndex,
      lastClickedOptionId: this.lastClickedOptionId,
      lastClickTimestamp: this.lastClickTimestamp,
      hasUserClicked: this.hasUserClicked,
      freezeOptionBindings: this.freezeOptionBindings,
      showFeedback: this.showFeedback,
      disableRenderTrigger: this.disableRenderTrigger,
      type: this.type,
      currentQuestion: this.currentQuestion
    };

    // FREEZE bindings during interaction to prevent recreation race conditions
    this.freezeOptionBindings = true;
    state.freezeOptionBindings = true;

    try {
      this.optionInteractionService.handleOptionClick(
        binding,
        index,
        event,
        state,
        (idx) => this.getQuestionAtDisplayIndex(idx),
        (idx) => this.emitExplanation(idx),
        (b, i, ev) => {
          this.updateOptionAndUI(b, i, ev);
          // Sync UI flags back into state so they persist when onOptionUI returns
          state.showFeedback = this.showFeedback;
          state.showFeedbackForOption = this.showFeedbackForOption;
          state.feedbackConfigs = this.feedbackConfigs;
          state.lastFeedbackOptionId = this.lastFeedbackOptionId;
          state.disableRenderTrigger = this.disableRenderTrigger;
        }
      );
    } finally {
      this.freezeOptionBindings = false;
      state.freezeOptionBindings = false;
    }

    // Sync back mutated state (including all visual/logic flags).
    // CRITICAL: Ensure we use the bindings that were potentially modified by handleOptionClick
    this.optionBindings = state.optionBindings;
    this.disableRenderTrigger = state.disableRenderTrigger;
    this.lastClickedOptionId = state.lastClickedOptionId;
    this.lastClickTimestamp = state.lastClickTimestamp;
    this.hasUserClicked = state.hasUserClicked;
    this.freezeOptionBindings = state.freezeOptionBindings;
    this.showFeedback = state.showFeedback;
    this.showFeedbackForOption = state.showFeedbackForOption;
    this.feedbackConfigs = state.feedbackConfigs;
    this.lastFeedbackOptionId = state.lastFeedbackOptionId;

    // Force immediate sync for OnPush
    this.cdRef.detectChanges();
  }

  public triggerViewRefresh(): void {
    this.cdRef.markForCheck();
  }

  private onSelectionControlChanged(rawId: number | string): void {
    const parsedId =
      typeof rawId === 'string' ? Number.parseInt(rawId, 10) : rawId;

    if (!Number.isFinite(parsedId)) return;

    // Ignore the synthetic “-1 repaint” that runs right after question load
    if (parsedId === -1) return;

    const selectedId = parsedId as number;

    // Direct index-based lookup (Template uses [value]="i")
    const binding = (this.optionBindings ?? [])[selectedId];

    if (!binding?.option) return;

    // Single source of truth: this MUST be the path that triggers:
    // - sounds
    // - SelectedOptionService updates / answered state
    // - emits to parent
    // - next button enabling
    this.handleOptionClick(binding.option as any, binding.index);
  }
}