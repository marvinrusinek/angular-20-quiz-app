import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
  Output, QueryList, SimpleChanges, ViewChildren
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioChange } from '@angular/material/radio';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  animationFrameScheduler, BehaviorSubject, combineLatest, defer, Observable, of, Subject,
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
    SharedOptionConfigDirective,
    OptionItemComponent
  ],
  templateUrl: './shared-option.component.html',
  styleUrls: ['../../quiz-question/quiz-question.component.scss'],
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedOptionComponent
  implements OnInit, OnChanges, OnDestroy, AfterViewInit {


  @Output() optionClicked =
    new EventEmitter<OptionClickedPayload>();
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
  public ui!: SharedOptionUiState;
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
  trackByOptionId = (b: OptionBindings, idx: number) =>
    `${b.option.optionId ?? idx}_${this.disableRenderTrigger}`;

  public flashDisabledSet = new Set<number>();
  private lockedIncorrectOptionIds = new Set<number>();
  public forceDisableAll = false;
  public timerExpiredForQuestion = false;  // track timer expiration
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
    // Explicit check
    if (this.type === 'multiple' || this.config?.type === 'multiple') {
      console.log(`[isMultiMode] Returning TRUE due to explicit type='multiple'`);
      return true;
    }

    // Use getActiveQuestionIndex for most reliable index
    // Then use getQuestionAtDisplayIndex for shuffle-aware question lookup
    const idx = this.getActiveQuestionIndex();
    const currentQ = this.getQuestionAtDisplayIndex(idx) ?? this.currentQuestion;

    // Data inference (fixes multiple-answer questions)
    if (currentQ?.options) {
      const count = currentQ.options.filter((o: Option) => o.correct).length;
      console.log(`[isMultiMode] Q${idx + 1} from question: correctCount=${count}, returning ${count > 1}`);
      if (count > 1) return true;
    }

    // Fallback: Check optionsToDisplay (most reliable for shuffled mode)
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

    // Also initialize lastProcessedQuestionIndex to prevent -1 value during 
    // first render before the subscription fires
    this.lastProcessedQuestionIndex = qIndex;

    this.updateResolvedQuestionIndex(qIndex);
  }

  private resetStateForNewQuestion(): void {
    this.disabledOptionsPerQuestion.clear();
    this.lockedIncorrectOptionIds.clear();
    this.flashDisabledSet.clear();
    this.timerExpiredForQuestion = false;
    this.timeoutCorrectOptionKeys.clear();
    this.forceDisableAll = false;  // reset forceDisableAll for new question
  }

  private subscribeToTimerExpiration(): void {
    this.timerService.expired$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      console.log('[SOC] Timer expired - setting timerExpiredForQuestion = true');
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
          console.log(`[SOC] 🔄 Fallback retry ${attempt}: Options arrived, generating bindings`);
          this.generateOptionBindings();
          this.cdRef.detectChanges();  // force immediate update for OnPush
          return;
        }

        // If we have options and bindings but display flags aren't set, fix them
        if (this.optionsToDisplay?.length && this.optionBindings?.length) {
          if (!this.showOptions || !this.renderReady) {
            console.log(`[SOC] Fallback retry ${attempt}: Fixing display flags`);
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
          console.log(`[SOC] Question changed from ${this.lastProcessedQuestionIndex} to ${idx} - RESETTING STATE`);
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
        '[ngOnChanges] Cleared disabledOptionsPerQuestion for new question'
      );

      this.disableRenderTrigger++;
      console.log(
        '[ngOnChanges] Question changed, disableRenderTrigger incremented to:',
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
        // Hard clone and purge any reference identity leaks
        this.optionsToDisplay = JSON.parse(
          JSON.stringify(this.optionsToDisplay)
        );

        // Publish the latest options snapshot for SOC reactive logic
        this.optionsToDisplay$.next(
          Array.isArray(this.optionsToDisplay) ? [...this.optionsToDisplay] : []
        );

        // DO NOT clear optionBindings array (can cause blank options on first load)
        // Instead, clear visual state on existing bindings
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

        // Highlight directives are now handled in OptionItemComponent


        this.highlightedOptionIds.clear();
        this.selectedOption = null;
        console.log(
          '[HARD RESET] optionsToDisplay deep-cloned and state cleared'
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
      // Highlight directives are now handled in OptionItemComponent


      this.updateHighlighting();
      this.cdRef.detectChanges();
    }

    // Full local visual reset to prevent ghost highlighting
    if (questionChanged || optionsChanged) {
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

    const savedIds = this.optionHydrationService.toIdSet(saved) as Set<string | number>;

    // Single truth: bindings selection
    if (this.optionBindings?.length) {
      this.optionHydrationService.applySavedSelections(this.optionBindings, savedIds);
    }

    // Visuals should derive from bindings state
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
    const showMap: Record<number, boolean> = {};

    // NOTE: For multi-select, we want feedback to display ONLY for the most recently
    // selected (or toggled) option row, not for every selected option — otherwise
    // feedback can appear under the wrong row after hydration/back nav.
    const lastClickedId: number | undefined =
      Array.isArray(this.selectedOptionHistory) && this.selectedOptionHistory.length > 0
        ? this.selectedOptionHistory[this.selectedOptionHistory.length - 1]
        : undefined;

    let fallbackSelectedId: number | undefined;

    for (const b of this.optionBindings ?? []) {
      const id = b?.option?.optionId;
      if (id == null) continue;

      // Default off for every row until we pick the target row below
      showMap[id] = false;

      // Capture a stable fallback id in case we don't have a last-clicked id
      if (fallbackSelectedId === undefined && b.isSelected === true) {
        fallbackSelectedId = id;
      }
    }

    // Prefer the last-clicked id when available; otherwise fall back to the first selected binding
    const targetId =
      typeof lastClickedId === 'number' && Number.isFinite(lastClickedId)
        ? lastClickedId
        : fallbackSelectedId;

    if (targetId !== undefined) {
      showMap[targetId] = true;
    }

    // Assign brand-new object to avoid shared reference bleed
    this.showFeedbackForOption = { ...showMap };

    // If your bindings store the ref, update them too:
    for (const b of this.optionBindings ?? []) {
      b.showFeedbackForOption = this.showFeedbackForOption;
    }
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
      this.showOptions = true;  // ensure showOptions is set
      this.renderReady = true;  // ensure renderReady is set
      this.cdRef.detectChanges();  // force immediate update for OnPush
      console.warn('[SOC] optionBindings REASSIGNED', bindings);
    });

    // Restore highlights after binding reassignment
    this.updateHighlighting();
  }

  buildSharedOptionConfig(b: OptionBindings, i: number): SharedOptionConfig {
    // Verify selection state from service, not from potentially stale binding
    // Use lastProcessedQuestionIndex which is synchronized with Input in ngOnChanges.
    // Preferring quizService.currentQuestionIndex caused a race condition where we fetched 
    // selections for the PREVIOUS question because the service hadn't updated yet.
    const qIndex = this.lastProcessedQuestionIndex ?? this.resolveCurrentQuestionIndex();
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const isActuallySelected = currentSelections.some(s => s.optionId === b.option.optionId);

    // Also check if we're on the correct question (prevent Q2 state showing on Q3)
    const isOnCorrectQuestion = this.lastProcessedQuestionIndex === qIndex;

    // STRICTLY trust the service.
    // 'b.isSelected' comes from inputs that may contain stale option objects from the previous question.
    // By ignoring b.isSelected and relying only on isActuallySelected (which checks the service for the specific qIndex),
    // we ensure we never show stale selections.
    const showAsSelected = isActuallySelected;
    const optionKey = this.keyOf(b.option, i);
    const showCorrectOnTimeout = this.timerExpiredForQuestion
      && (this.timeoutCorrectOptionKeys.has(optionKey) || !!b.option.correct);

    // Create a copy of the option with verified selected state
    // This prevents the directive from reading stale option.selected values
    const verifiedOption = {
      ...b.option,
      selected: showAsSelected,  // override with verified state
      highlight: showAsSelected || showCorrectOnTimeout,  // also update highlight flag
      showIcon: showAsSelected || showCorrectOnTimeout   // ensure the copy has the icon state
    };

    // Vital to update the ORIGINAL option's showIcon property
    // because the template reads 'b.option.showIcon' to display the mat-icon.
    // Since this method is called during change detection before the icon check,
    // this effectively syncs the visual state.
    b.option.showIcon = showAsSelected || showCorrectOnTimeout;

    return {
      option: verifiedOption,  // use verified option, not original
      idx: i,
      type: this.type,
      isOptionSelected: showAsSelected, // use verified selection state
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

    // Mark that user has interacted with this question this session
    // This is required for the displayText$ pipeline's shouldShowFet logic
    this.quizStateService.markUserInteracted(activeQuestionIndex);
    console.log(`[SOC] Marked user interaction for Q${activeQuestionIndex + 1}`);

    // Set display mode to 'explanation' - critical for FET display!
    // The displayText$ pipeline checks: 
    // shouldShowFet = hasInteractedThisSession && currentMode === 'explanation'
    // Without this call, currentMode stays 'question' and FET never displays.
    this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
    console.log(`[SOC] Set display mode to 'explanation' for Q${activeQuestionIndex + 1}`);

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

    // Run score check after parent updates service (next tick)
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

      console.log(`[SOC] Updated Answers for Q${activeQuestionIndex}. 
        Type=${this.type}, Answers=${currentAnswers.length}`);
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

    console.info('[State Reset Completed]');

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
        '[initializeFromConfig] optionsToDisplay is empty after processing.'
      );
      return;
    }

    // Rehydrate selection state from Service (persistence)
    // This ensures that when navigating back, the options show as selected
    // (Green/Red).
    // Use quizService.currentQuestionIndex (authoritative) instead of 
    // resolveCurrentQuestionIndex() which may return stale @Input value
    const qIndex = this.quizService.currentQuestionIndex ?? this.resolveCurrentQuestionIndex();
    const inputIndex = this.resolveCurrentQuestionIndex();

    // Mismatch Guard: If service index differs from input, use service index
    // This prevents Q2 selections from being applied to Q3
    if (qIndex !== inputIndex) {
      console.warn(`[initializeFromConfig] INDEX MISMATCH: Service says ${qIndex}, Input says ${inputIndex}. Using ${qIndex}.`);
    }

    console.log(`[initializeFromConfig] Rehydrating for Q${qIndex + 1} (service: ${this.quizService.currentQuestionIndex}, input: ${inputIndex})`);

    const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex);
    if (saved?.length > 0) {
      const savedIds = new Set(saved.map(s => s.optionId));

      for (const opt of this.optionsToDisplay) {

        if (opt.optionId !== undefined && savedIds.has(opt.optionId)) {
          opt.selected = true;
          opt.showIcon = true;
        }
      }
    } else {
      console.log(
        `[initializeFromConfig] No saved selections for Q${qIndex + 1} - starting clean`
      );
    }

    // Determine question type based on options, but Respect explicit input first!
    if (this.type !== 'multiple') {
      this.type = this.determineQuestionType(this.currentQuestion);
    } else {
      console.log('[SOC] Preserving type="multiple" from Input');
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
         
        console.log(`[SOC] Option bindings checked for Q${currentIdx + 1} with active explanation - refreshing FET.`);
        this.deferHighlightUpdate(() => this.emitExplanation(currentIdx));
      }
    }
  }

  getOptionDisplayText(option: Option, idx: number): string {
    return this.optionService.getOptionDisplayText(option, idx);
  }

  public getOptionIcon(option: Option, i: number): string {
    return this.optionService.getOptionIcon(option, i);
  }

  public getOptionClasses(binding: OptionBindings): { [key: string]: boolean } {
    return this.optionService.getOptionClasses(
      binding,
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

    // Prevent reselection: disable correct options that are already selected in
    // multiple-answer questions
    const isMultipleAnswer = this.isMultiMode;  // use robust getter
    if (isMultipleAnswer && binding.isSelected && option.correct) {
      console.log(`[SOC] Option ${optionId} is a selected correct answer - 
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
      console.log('[SOC] onOptionInteraction: Option is disabled, blocking click:', binding.option?.optionId);
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

  private buildOptionUiSyncContext(): OptionUiSyncContext {
    return this.optionUiContextBuilder.fromSharedOptionComponent(this);
  }

  private emitExplanation(questionIndex: number): void {
    const displayIndex = this.resolveDisplayIndex(questionIndex);
    const explanationText = this.resolveExplanationText(displayIndex);
    this.pendingExplanationIndex = displayIndex;
    this.applyExplanationText(explanationText, displayIndex);
    this.scheduleExplanationVerification(displayIndex, explanationText);
  }

  private applyExplanationText(
    explanationText: string,
    displayIndex: number
  ): void {
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
    // We search the canonical quiz data for a text match to avoid any index-out-of-sync issues.
    const currentQText = normalize(this.currentQuestion?.questionText);
    const allCanonical = this.quizService.getCanonicalQuestions(this.quizId) || [];
    const authQ = allCanonical.find(q => normalize(q.questionText) === currentQText) || this.currentQuestion;

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
                          (opt.correct === true);
        
        if (isCorrect) {
          console.log(`[FET-SOC] Q${displayIndex + 1} | Found Match: Option ${i + 1} (ID=${id}, Text="${opt.text?.slice(0, 20)}...")`);
        }
        return isCorrect ? i + 1 : null;
      })
      .filter((n): n is number => n !== null);

    console.error(`🔴🔴🔴 [FET-SOC] Q${displayIndex + 1} | CORRECT INDICES: ${JSON.stringify(correctIndices)}`);

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
    console.log('[Feedback Fired]', { currentQuestionIndex });
    this.lastFeedbackOptionMap[currentQuestionIndex] = optionId;

    // Set the last option selected (used to show only one feedback block)
    this.lastFeedbackOptionId = option.optionId ?? -1;

    // Ensure feedback visibility state is updated
    this.showFeedback = true;
    this.showFeedbackForOption[optionId] = true;

    // Log that we're emitting answered=true for this question
    console.log('[Q2 setAnswered call]', {
      questionIndex: currentQuestionIndex,
      value: true
    });
    this.selectedOptionService.setAnswered(true, true);

    // Verify we retrieved a valid hydrated option
    const hydratedOption = this.optionsToDisplay?.[index];
    if (!hydratedOption) {
      console.warn('[FeedbackGen] No option found at index', index);
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

    console.log('[Storing Feedback Config]', {
      optionId,
      feedbackConfig: this.feedbackConfigs[optionId]
    });

    // Update the answered state
    this.selectedOptionService.updateAnsweredState();

    // Final debug state
    console.log('[displayFeedbackForOption]', {
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

    // Sync indices with visual options
    const validOptions = (this.optionsToDisplay || []).filter(isValidOption);
    const correctMessage = this.feedbackService.setCorrectMessage(validOptions, this.currentQuestion!);
    const isCorrect = option.correct ?? false;
    const rawFeedback = option.feedback?.trim();

    let finalFeedback = '';
    if (rawFeedback) {
      finalFeedback = (isCorrect ? "You're right! " : "That's wrong. ") + rawFeedback;
    } else {
      finalFeedback = (isCorrect ? "You're right! " : "That's wrong. ") + (correctMessage || 'No feedback available.');
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
    // Calculate the type based on the number of correct options
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
      type: this.type,

      appHighlightOption: false,
      appHighlightInputType: inferredType === 'multiple' ? 'checkbox' : 'radio',
      appHighlightReset: this.shouldResetBackground,
      appResetBackground: this.shouldResetBackground,
      optionsToDisplay: this.optionsToDisplay,

      isSelected: selected,
      active: option.active ?? true,  // always a boolean
      change: () => this.handleOptionClick(option as SelectedOption, idx),

      // Do not derive disabled from option.selected
      disabled: false,

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
        disabled: false
      };
    });

    // Build bindings via factory (single place that constructs the VM)
    this.optionBindings = this.optionBindingFactory.createBindings({
      optionsToDisplay: this.optionsToDisplay,
      type: this.type,
      showFeedback: this.showFeedback,
      showFeedbackForOption: {}, // placeholder; we rebuild immediately after hydration
      highlightCorrectAfterIncorrect: this.highlightCorrectAfterIncorrect,
      shouldResetBackground: this.shouldResetBackground,
      ariaLabelPrefix: 'Option',
      onChange: (opt, idx) => this.handleOptionClick(opt, idx),
      // During migration, safest is to rely on rehydrate as the single truth:
      isSelected: () => false,
      isDisabled: () => false
    });

    // Apply persisted selection to bindings (bindings-only)
    this.rehydrateUiFromState('generateOptionBindings');

    // Now rebuild the feedback visibility map based on bindings selection
    this.rebuildShowFeedbackMapFromBindings();

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
        this.feedbackService.setCorrectMessage(this.optionsToDisplay, this.currentQuestion!) ??
        'No correct message available',
      feedback: option.feedback ?? 'No feedback available',
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

    // Pre-checks
    if (!options.length) {
      console.warn('[processOptionBindings] No options to process. Exiting.');
      this.optionBindingsInitialized = false;
      return;
    }
    if (this.freezeOptionBindings) {
      console.warn('[ABORTED optionBindings reassignment after user click]');
      return;
    }
    if (!this.currentQuestion) return;

    const selectionMap = new Map<number, boolean>(
      (this.optionBindings ?? [])
        .map((b) => {
          const id = b.option.optionId ?? -1;  // fallback for undefined ids
          return [id, b.isSelected] as [number, boolean];
        })
        .filter(([id]) => id !== -1)  // drop any undefined/fallback ids
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

    // Flag updates with minimal delay
    this.optionsReady = true;
    this.renderReady = true;
    this.viewReady = true;
    this.cdRef.detectChanges();  // ensure view is in sync
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
      "[determineQuestionType] No valid options or input detected. Defaulting to 'single'."
    );

    // Final fallback based on explicit type property
    return input.type === QuestionType.MultipleAnswer ? 'multiple' : 'single';
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
    // Highlight directives are now handled in OptionItemComponent

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
    const selIds = new Set(selectedOptions.map((s) => s.optionId));

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

  isLocked(b: OptionBindings, i: number): boolean {
    return this.optionLockService.isLocked(b, i, this.resolveCurrentQuestionIndex());
  }

  // Single place to decide disabled
  public isDisabled(binding: OptionBindings, idx: number): boolean {
    const qIndex = this.resolveCurrentQuestionIndex();
    const locked = this.optionLockService.isLocked(binding, idx, qIndex);

    return this.optionService.isDisabled(
      binding,
      idx,
      this.disabledOptionsPerQuestion,
      this.currentQuestionIndex,
      this.forceDisableAll,
      this.timerExpiredForQuestion,
      locked
    );
  }

  // Use the same key shape everywhere (STRING so we don't lose non-numeric ids)
  // Stable per-row key: prefer numeric optionId; fallback to stableKey + index
  public keyOf(o: Option, i: number): string {
    return this.optionService.keyOf(o, i);
  }

  private resolveCurrentQuestionIndex(): number {
    return Number(this.currentQuestionIndex) || 0;
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
    return this.canDisplayOptions && this.renderReady;
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

  public onOptionUI(ev: OptionUIEvent): void {
    // Guard: ignore bad IDs
    if (!Number.isFinite(ev?.optionId) || ev.optionId < 0) return;

    // Find binding + index (SOC still owns bindings list for now)
    const found = this.findBindingByOptionId(ev.optionId);
    if (!found) return;

    const { b: binding, i: index } = found;


    if (!this.isDisabled(binding, index)) {
      this.cdRef.markForCheck();  // ensure UI updates
      this.soundService.playOnceForOption({
        ...binding.option,
        selected: true,
        questionIndex: this.currentQuestionIndex
      });
    }

    if (ev.kind === 'change') {
      // Keep your existing “change → sync UI/form” path
      this.updateOptionAndUI(binding, index, ev.nativeEvent as MatCheckboxChange | MatRadioChange);
      return;
    }

    if (ev.kind === 'interaction') {
      // Preserve your “interaction guard” behavior exactly
      const event = ev.nativeEvent as MouseEvent;

      if (this.isDisabled(binding, index)) {
        console.log('[SOC] onOptionInteraction: Option is disabled, blocking click:', binding.option?.optionId);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = event.target as HTMLElement;
      if (target?.tagName === 'INPUT') {
        return; // let native input handle it
      }

      // treat as content click
      this.runOptionContentClick(binding, index, event);
      return;
    }

    if (ev.kind === 'contentClick') {
      this.runOptionContentClick(binding, index, ev.nativeEvent as MouseEvent);
      return;
    }
  }

  private findBindingByOptionId(optionId: number): { b: OptionBindings; i: number } | null {
    const opts = this.optionBindings ?? [];
    const i = opts.findIndex(x => Number(x?.option?.optionId) === Number(optionId));
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

    // Call handleOptionClick as-is (no behavior change)
    this.optionInteractionService.handleOptionClick(
      binding,
      index,
      event,
      state,
      (idx) => this.getQuestionAtDisplayIndex(idx),
      (idx) => this.emitExplanation(idx),
      (b, i, ev) => this.updateOptionAndUI(b, i, ev)
    );

    // Sync back mutated state
    this.optionBindings = state.optionBindings;
    this.disableRenderTrigger = state.disableRenderTrigger;
    this.feedbackConfigs = state.feedbackConfigs;
    this.showFeedbackForOption = state.showFeedbackForOption;
    this.lastFeedbackOptionId = state.lastFeedbackOptionId;
    this.lastFeedbackQuestionIndex = state.lastFeedbackQuestionIndex;
    this.lastClickedOptionId = state.lastClickedOptionId;
    this.lastClickTimestamp = state.lastClickTimestamp;
    this.hasUserClicked = state.hasUserClicked;
    this.freezeOptionBindings = state.freezeOptionBindings;
    this.showFeedback = state.showFeedback;

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

    const binding = (this.optionBindings ?? []).find(
      (b) => b?.option?.optionId === selectedId
    );

    if (!binding?.option) return;

    // ✅ Single source of truth: this MUST be the path that triggers:
    // - sounds
    // - SelectedOptionService updates / answered state
    // - emits to parent
    // - next button enabling
    this.handleOptionClick(binding.option as any, binding.index);
  }
}


