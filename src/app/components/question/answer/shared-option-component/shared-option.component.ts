
import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef,
  Component, DoCheck, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, OnInit,
  Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioModule, MatRadioChange } from '@angular/material/radio';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  animationFrameScheduler, BehaviorSubject, combineLatest, Observable, of, Subject,
  Subscription } from 'rxjs';
import { distinctUntilChanged, filter, observeOn, takeUntil } from 'rxjs/operators';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { Option } from '../../../../shared/models/Option.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
import { QuestionType } from '../../../../shared/models/question-type.enum';
import { SelectedOption } from '../../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../../shared/models/SharedOptionConfig.model';
import { FeedbackComponent } from '../feedback/feedback.component';
import { QuizService } from '../../../../shared/services/data/quiz.service';
import { QuizStateService } from '../../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/state/selectedoption.service';
import { SoundService } from '../../../../shared/services/ui/sound.service';
import { SharedOptionConfigDirective } from '../../../../directives/shared-option-config.directive';
import { correctAnswerAnim } from '../../../../animations/animations';
import { OptionItemComponent } from './option-item/option-item.component';
import type { OptionUIEvent } from './option-item/option-item.component';
import { OptionService } from '../../../../shared/services/options/view/option.service';
import { SharedOptionStateAdapterService, SharedOptionUiState } from '../../../../shared/services/state/shared-option-state-adapter.service';
import { OptionUiContextBuilderService } from '../../../../shared/services/options/engine/option-ui-context-builder.service';
import { OptionUiSyncContext } from '../../../../shared/services/options/engine/option-ui-sync.service';
import { OptionLockService } from '../../../../shared/services/options/policy/option-lock.service';
import { OptionSelectionUiService } from '../../../../shared/services/options/engine/option-selection-ui.service';
import { SharedOptionExplanationService, ExplanationContext } from '../../../../shared/services/features/shared-option-explanation.service';
import { OptionClickHandlerService } from '../../../../shared/services/options/engine/option-click-handler.service';
import { SharedOptionChangeHandlerService, ChangeResult } from '../../../../shared/services/options/engine/shared-option-change-handler.service';
import { SharedOptionFeedbackService, FeedbackContext, DisplayFeedbackResult } from '../../../../shared/services/features/shared-option-feedback.service';
import { SharedOptionInitService } from '../../../../shared/services/options/engine/shared-option-init.service';
import { SharedOptionBindingService } from '../../../../shared/services/options/engine/shared-option-binding.service';
import { SharedOptionClickService } from '../../../../shared/services/options/engine/shared-option-click.service';

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
  @Output() showExplanationChange = new EventEmitter<boolean>();
  @Output() explanationToDisplayChange = new EventEmitter<string>();
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
  public selectedOptionMap = new Map<number | string, boolean>();
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
  // Simple, bulletproof feedback tracker: set synchronously at the end of runOptionContentClick.
  // Bypasses complex service pipeline; cleared on question change.
  // Must be public for template access.
  public _feedbackDisplay: { idx: number; config: FeedbackProps } | null = null;
  selectedOptions: Set<number | string> = new Set();
  clickedOptionIds: Set<number | string> = new Set();
  selectedOptionHistory: (number | string)[] = [];
  // Track CORRECT option clicks per question for timer stop logic
  private correctClicksPerQuestion: Map<number, Set<number>> = new Map();
  // Track DISABLED option IDs per question - persists across binding recreations
  public disabledOptionsPerQuestion: Map<number, Set<number>> = new Map();
  lastSelectedOptionIndex = -1;
  private lastFeedbackQuestionIndex = -1;
  lastFeedbackOptionId: number | string = -1;
  lastSelectedOptionId: number | string = -1;
  lastClickedOptionId: number | string | null = null;
  lastClickTimestamp: number | null = null;
  hasUserClicked = false;
  freezeOptionBindings = false;
  highlightedOptionIds: Set<number | string> = new Set();

  // Counter to force OnPush re-render when disabled state changes
  disableRenderTrigger = 0;

  // Internal tracker for last processed question index
  // This is separate from the @Input currentQuestionIndex to handle timing issues
  private lastProcessedQuestionIndex: number = -1;

  private readonly optionsToDisplay$ = new BehaviorSubject<Option[]>([]);
  private optionsRestored = false;  // tracks if options are restored
  viewReady = false;
  optionsReady = false;
  showOptions = false;
  showNoOptionsFallback = false;
  form!: FormGroup;

  private renderReadySubject =
    new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();

  // Include disableRenderTrigger to force re-render when disabled state changes
  trackByOptionId = (b: OptionBindings, idx: number) => {
    const idPart = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : `idx-${idx}`;
    const questionPart = this.getActiveQuestionIndex();
    return `q${questionPart}_${idPart}_${idx}`;
  };

  public flashDisabledSet = new Set<number>();
  private lockedIncorrectOptionIds = new Set<number>();
  public forceDisableAll = false;
  public timerExpiredForQuestion = false;  // track timer expiration
  private timeoutCorrectOptionKeys = new Set<string>();
  private resolvedQuestionIndex: number | null = null;

  private _isMultiModeCache: boolean | null = null;
  private _lastHandledIndex: number | null = null;
  private _lastHandledTime: number | null = null;

  // BULLETPROOF feedback tracker: set synchronously in handleOptionClick,
  // NEVER cleared by ngOnChanges/generateOptionBindings/rebuild cycles.
  // Only cleared on question change.
  private _lastClickFeedback: { index: number; config: FeedbackProps; questionIdx: number } | null = null;

  // DURABLE multi-answer selection tracker. Survives binding regeneration.
  // Maps question index → Set of selected display indices.
  // Only cleared on question change (resetStateForNewQuestion / ngOnChanges).
  private _multiSelectByQuestion = new Map<number, Set<number>>();
  private _correctIndicesByQuestion = new Map<number, number[]>();

  destroy$ = new Subject<void>();

  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    public soundService: SoundService,
    private optionService: OptionService,
    private optionUiContextBuilder: OptionUiContextBuilderService,
    private optionLockService: OptionLockService,
    private optionSelectionUiService: OptionSelectionUiService,
    private sharedOptionStateAdapterService: SharedOptionStateAdapterService,
    private explanationHandler: SharedOptionExplanationService,
    private clickHandler: OptionClickHandlerService,
    private changeHandler: SharedOptionChangeHandlerService,
    private feedbackManager: SharedOptionFeedbackService,
    private initService: SharedOptionInitService,
    private bindingService: SharedOptionBindingService,
    private clickService: SharedOptionClickService,
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
    const idx = this.getActiveQuestionIndex();

    // Return cached result to avoid repeated computation on every CD cycle
    if (this._isMultiModeCache !== null) {
      if (this._isMultiModeCache) {
        console.warn(`[isMultiMode] (CACHED) Q${idx + 1} = TRUE (multiple)`);
      }
      return this._isMultiModeCache;
    }

    const currentQ = this.getQuestionAtDisplayIndex(idx) ?? this.currentQuestion;
    const result = this.clickHandler.detectMultiMode(
      currentQ, this.type, this.config?.type
    );

    this._isMultiModeCache = result;
    if (result) {
      console.warn(`[isMultiMode] Q${idx + 1} FINAL RESULT: MULTIPLE-ANSWER`);
    } else {
      console.log(`[isMultiMode] Q${idx + 1} FINAL RESULT: SINGLE-ANSWER`);
    }
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
    this.initService.resetStateForNewQuestion(this as any);
  }

  private subscribeToTimerExpiration(): void {
    this.initService.subscribeToTimerExpiration(this as any);
  }

  private setupFallbackRendering(): void {
    this.initService.setupFallbackRendering(this as any);
  }

  private initializeConfiguration(): void {
    this.initService.initializeConfiguration(this as any);
  }

  private initializeOptionDisplayWithFeedback(): void {
    this.initService.initializeOptionDisplayWithFeedback(this as any);
  }

  private setupSubscriptions(): void {
    this.initService.setupSubscriptions(this as any);
  }

  private subscribeToSelectionChanges(): void {
    this.initService.subscribeToSelectionChanges(this as any);
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const result = this.changeHandler.handleChanges(changes, {
      currentQuestionIndex: this.currentQuestionIndex,
      questionIndex: this.questionIndex,
      optionsToDisplay: this.optionsToDisplay,
      config: this.config,
      type: this.type,
      optionBindings: this.optionBindings,
      selectedOption: this.selectedOption,
      showFeedbackForOption: this.showFeedbackForOption,
      showFeedback: this.showFeedback,
      questionVersion: this.questionVersion,
      lastProcessedQuestionIndex: this.lastProcessedQuestionIndex,
      resolvedQuestionIndex: this.resolvedQuestionIndex,
      isMultiMode: this.isMultiMode,
      form: this.form,
      optionsToDisplay$: this.optionsToDisplay$,
      resolveCurrentQuestionIndex: () => this.resolveCurrentQuestionIndex(),
      updateResolvedQuestionIndex: (idx) => this.updateResolvedQuestionIndex(idx),
      computeDisabledState: (opt, idx) => this.computeDisabledState(opt, idx),
      hydrateOptionsFromSelectionState: () => this.hydrateOptionsFromSelectionState(),
      generateOptionBindings: () => this.generateOptionBindings(),
      resetStateForNewQuestion: () => this.resetStateForNewQuestion(),
      clearForceDisableAllOptions: () => this.clearForceDisableAllOptions(),
      fullyResetRows: () => this.fullyResetRows(),
      processOptionBindings: () => this.processOptionBindings(),
      updateHighlighting: () => this.updateHighlighting()
    });
    this.applyChangeResult(result);
  }

  private applyChangeResult(r: ChangeResult): void {
    // Apply simple field assignments
    if (r.selectedOptions === 'clear') this.selectedOptions.clear();
    if (r.clickedOptionIds === 'clear') this.clickedOptionIds.clear();
    if (r.selectedOptionMap === 'clear') this.selectedOptionMap.clear();
    if (r.selectedOptionHistory !== undefined) this.selectedOptionHistory = r.selectedOptionHistory;
    if (r.isMultiModeCache === null) this._isMultiModeCache = null;
    if (r.lastHandledIndex === null) this._lastHandledIndex = null;
    if (r.lastHandledTime === null) this._lastHandledTime = null;
    if (r.forceDisableAll !== undefined) this.forceDisableAll = r.forceDisableAll;
    if (r.lockedIncorrectOptionIds === 'clear') this.lockedIncorrectOptionIds.clear();
    if (r.showFeedbackForOption !== undefined) this.showFeedbackForOption = r.showFeedbackForOption;
    if (r.feedbackConfigs !== undefined) this.feedbackConfigs = r.feedbackConfigs;
    if (r.lastFeedbackOptionId !== undefined) this.lastFeedbackOptionId = r.lastFeedbackOptionId as number;
    if (r.lastFeedbackQuestionIndex !== undefined) this.lastFeedbackQuestionIndex = r.lastFeedbackQuestionIndex;
    if (r.showFeedback !== undefined) this.showFeedback = r.showFeedback;
    if (r.lastProcessedQuestionIndex !== undefined) this.lastProcessedQuestionIndex = r.lastProcessedQuestionIndex;
    if (r.lastClickFeedback === null) this._lastClickFeedback = null;
    if (r.feedbackDisplay === null) this._feedbackDisplay = null;
    if (r.resolvedQuestionIndex !== undefined) this.resolvedQuestionIndex = r.resolvedQuestionIndex;
    if (r.currentQuestionIndex !== undefined) this.currentQuestionIndex = r.currentQuestionIndex;
    if (r.disabledOptionsPerQuestion === 'clear') this.disabledOptionsPerQuestion.clear();
    if (r.activeFeedbackConfig === null) this.activeFeedbackConfig = null;
    if (r.disableRenderTrigger === 'increment') this.disableRenderTrigger++;
    if (r.optionsToDisplay !== undefined) this.optionsToDisplay = r.optionsToDisplay;
    if (r.highlightedOptionIds === 'clear') this.highlightedOptionIds.clear();
    if (r.selectedOption === null) this.selectedOption = null;
    if (r.type !== undefined) this.type = r.type;
    if (r.questionVersion !== undefined) this.questionVersion = r.questionVersion;
    if (r.flashDisabledSet === 'clear') this.flashDisabledSet.clear();
    if (r.correctClicksPerQuestion === 'clear') this.correctClicksPerQuestion.clear();

    // Push optionsToDisplay$ when options change
    if (r.optionsToDisplay !== undefined) {
      this.optionsToDisplay$.next(
        Array.isArray(this.optionsToDisplay) ? [...this.optionsToDisplay] : []
      );
    }

    // Method calls in order
    if (r.callResetStateForNewQuestion) this.resetStateForNewQuestion();
    if (r.callClearForceDisableAllOptions) this.clearForceDisableAllOptions();
    if (r.callFullyResetRows) this.fullyResetRows();
    if (r.resetFormSelectedOptionId) {
      this.form.get('selectedOptionId')?.setValue(null, { emitEvent: false });
    }
    if (r.callProcessOptionBindings) this.processOptionBindings();
    if (r.callHydrateAndGenerate) {
      this.hydrateOptionsFromSelectionState();
      this.generateOptionBindings();
    } else if (r.callGenerateOnly) {
      this.generateOptionBindings();
    }
    if (r.callUpdateHighlighting) this.updateHighlighting();

    // CD calls
    if (r.detectChanges) this.cdRef.detectChanges();
    else if (r.markForCheck) this.cdRef.markForCheck();
  }

  ngAfterViewInit(): void {
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
    this.bindingService.rehydrateUiFromState(this as any, reason);
  }

  private setupRehydrateTriggers(): void {
    this.initService.setupRehydrateTriggers(this as any);
  }

  private rebuildShowFeedbackMapFromBindings(): void {
    const result = this.feedbackManager.rebuildShowFeedbackMapFromBindings(
      this.optionBindings, this.lastFeedbackOptionId, this.selectedOptionHistory
    );
    this.showFeedback = result.showFeedback;
    this.showFeedbackForOption = result.showFeedbackForOption;
    for (const b of this.optionBindings ?? []) {
      b.showFeedbackForOption = this.showFeedbackForOption;
      if (this.showFeedback) b.showFeedback = true;
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
    this.clickService.ensureOptionsToDisplay(this as any);
  }

  private synchronizeOptionBindings(): void {
    this.bindingService.synchronizeOptionBindings(this as any);
  }

  ngDoCheck(): void {
    this.updateBindingSnapshots();
  }

  buildSharedOptionConfig(b: OptionBindings, i: number): SharedOptionConfig {
    return this.bindingService.buildSharedOptionConfig(this as any, b, i);
  }

  public getSharedOptionConfig(
    b: OptionBindings,
    i: number
  ): SharedOptionConfig {
    return this.buildSharedOptionConfig(b, i);
  }




  preserveOptionHighlighting(): void {
    this.clickService.preserveOptionHighlighting(this as any);
  }

  initializeFromConfig(): void {
    this.initService.initializeFromConfig(this as any);
  }

  private setOptionBindingsIfChanged(newOptions: Option[]): void {
    this.bindingService.setOptionBindingsIfChanged(this as any, newOptions);
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
    return this.clickHandler.computeDisabledState(option, index, {
      currentQuestionIndex: this.currentQuestionIndex,
      isMultiMode: this.isMultiMode,
      forceDisableAll: this.forceDisableAll,
      disabledOptionsPerQuestion: this.disabledOptionsPerQuestion,
      lockedIncorrectOptionIds: this.lockedIncorrectOptionIds,
      flashDisabledSet: this.flashDisabledSet
    });
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
    if (this.isDisabled(binding, index)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
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
    event: MatCheckboxChange | MatRadioChange,
    existingCtx?: OptionUiSyncContext
  ): void {
    this.clickService.updateOptionAndUI(this as any, optionBinding, index, event, existingCtx);
  }



  private enforceSingleSelection(selectedBinding: OptionBindings): void {
    this.clickService.enforceSingleSelection(this as any, selectedBinding);
  }

  updateHighlighting(): void {
    // Moved to OptionItemComponent
  }

  private resolveInteractionType(): 'single' | 'multiple' {
    return this.isMultiMode ? 'multiple' : 'single';
  }

  private buildFeedbackContext(): FeedbackContext {
    return {
      optionsToDisplay: this.optionsToDisplay,
      currentQuestion: this.currentQuestion,
      type: this.type as 'single' | 'multiple',
      selectedOptions: this.selectedOptions,
      optionBindings: this.optionBindings,
      timerExpiredForQuestion: this.timerExpiredForQuestion,
      activeQuestionIndex: this.getActiveQuestionIndex(),
      showFeedbackForOption: this.showFeedbackForOption,
      feedbackConfigs: this.feedbackConfigs,
      lastFeedbackOptionId: this.lastFeedbackOptionId as number,
      lastFeedbackQuestionIndex: this.lastFeedbackQuestionIndex,
      selectedOptionId: this.selectedOptionId,
      isMultiMode: this.isMultiMode,
      _feedbackDisplay: this._feedbackDisplay,
      _multiSelectByQuestion: this._multiSelectByQuestion,
      _correctIndicesByQuestion: this._correctIndicesByQuestion
    };
  }

  private buildOptionUiSyncContext(): OptionUiSyncContext {
    return this.optionUiContextBuilder.fromSharedOptionComponent(this);
  }

  private emitExplanation(questionIndex: number, skipGuard = false): void {
    const activeIndex = this.getActiveQuestionIndex();
    const resolvedIndex = Number.isFinite(activeIndex)
      ? Math.max(0, Math.trunc(activeIndex))
      : Number.isFinite(questionIndex)
        ? Math.max(0, Math.trunc(questionIndex))
        : this.resolveExplanationQuestionIndex(questionIndex);

    const question =
      this.getQuestionAtDisplayIndex(resolvedIndex)
      ?? this.currentQuestion
      ?? this.quizService.questions?.[resolvedIndex]
      ?? null;

    // Guard: Prevent stale deferred calls from emitting for the wrong question.
    if (this.currentQuestion && resolvedIndex !== questionIndex) {
      const questionAtIndex = this.getQuestionAtDisplayIndex(resolvedIndex)
        ?? this.quizService.questions?.[resolvedIndex];
      if (questionAtIndex && questionAtIndex.questionText !== this.currentQuestion.questionText) {
        console.warn(`[emitExplanation] BLOCKED: stale deferred call for index=${resolvedIndex}`);
        return;
      }
    }

    const ctx: ExplanationContext = {
      resolvedIndex,
      question,
      currentQuestion: this.currentQuestion,
      quizId: this.quizId,
      optionBindings: this.optionBindings,
      optionsToDisplay: this.optionsToDisplay,
      isMultiMode: this.isMultiMode
    };

    this.explanationHandler.emitExplanation(ctx, skipGuard);
  }

  private applyExplanationText(
    explanationText: string,
    displayIndex: number
  ): void {
    this.explanationHandler.applyExplanationText(explanationText, displayIndex);
    this.cdRef.markForCheck();
  }

  private resolveDisplayIndex(questionIndex: number): number {
    return this.explanationHandler.resolveDisplayIndex(
      questionIndex,
      () => this.getActiveQuestionIndex(),
      this.currentQuestionIndex,
      this.resolvedQuestionIndex
    );
  }

  private clearPendingExplanation(): void {
    this.explanationHandler.clearPendingExplanation();
  }

  private _pendingHighlightRAF: number | null = null;

  private deferHighlightUpdate(callback: () => void): void {
    // Cancel any pending deferred call to prevent stale Q(N) callbacks running during Q(N+1)
    if (this._pendingHighlightRAF !== null) {
      cancelAnimationFrame(this._pendingHighlightRAF);
    }
    this.ngZone.runOutsideAngular(() => {
      this._pendingHighlightRAF = requestAnimationFrame(() => {
        this._pendingHighlightRAF = null;
        this.ngZone.run(() => {
          callback();
        });
      });
    });
  }

  private cacheResolvedFormattedExplanation(index: number, formatted: string): void {
    this.explanationHandler.cacheResolvedFormattedExplanation(index, formatted);
  }

  private resolveExplanationText(questionIndex: number): string {
    const displayIndex = Number.isFinite(questionIndex) ? Math.max(0, Math.floor(questionIndex)) : 0;
    const indexQuestion = this.getQuestionAtDisplayIndex(displayIndex);
    const targetQuestion = indexQuestion || this.currentQuestion;

    const ctx: ExplanationContext = {
      resolvedIndex: displayIndex,
      question: targetQuestion,
      currentQuestion: targetQuestion,
      quizId: this.quizId,
      optionBindings: this.optionBindings,
      optionsToDisplay: this.optionsToDisplay,
      isMultiMode: this.isMultiMode
    };

    return this.explanationHandler.resolveExplanationText(ctx);
  }

  public async handleOptionClick(
    option: SelectedOption | undefined,
    index: number
  ): Promise<void> {
    if (!option) return;

    // Redirect to the unified UI flow which handles synchronization and services
    this.onOptionUI({
      optionId: option.optionId ?? -1,
      displayIndex: index,
      kind: 'interaction',
      inputType: this.isMultiMode ? 'checkbox' : 'radio',
      nativeEvent: new MouseEvent('click')
    });
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
    this.clickedOptionIds.add(optionId);
  }



  private handleSelection(option: SelectedOption, index: number, optionId: number): void {
    this.clickService.handleSelection(this as any, option, index, optionId);
  }

  displayFeedbackForOption(
    option: SelectedOption,
    index: number,
    optionId: number
  ): void {
    if (!option) return;
    const ctx = this.buildFeedbackContext();
    const result = this.feedbackManager.displayFeedbackForOption(option, index, optionId, ctx);
    if (!result) return;
    // Apply mutations
    this.showFeedback = result.showFeedback;
    this.showFeedbackForOption = result.showFeedbackForOption;
    this.feedbackConfigs = result.feedbackConfigs;
    this.currentFeedbackConfig = result.currentFeedbackConfig;
    this.activeFeedbackConfig = result.activeFeedbackConfig;
    this.lastFeedbackOptionId = result.lastFeedbackOptionId;
    this.lastFeedbackQuestionIndex = result.lastFeedbackQuestionIndex;
    this.cdRef.markForCheck();
  }

  generateFeedbackConfig(
    option: SelectedOption,
    selectedIndex: number,
  ): FeedbackProps {
    return this.feedbackManager.generateFeedbackConfig(option, selectedIndex, this.buildFeedbackContext());
  }

  handleBackwardNavigationOptionClick(option: Option, index: number): void {
    this.clickService.handleBackwardNavigationOptionClick(this as any, option, index);
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
    this.lockedIncorrectOptionIds.clear();
  }

  getOptionBindings(option: Option, idx: number, isSelected: boolean = false): OptionBindings {
    return this.bindingService.getOptionBindings(this as any, option, idx, isSelected);
  }

  public generateOptionBindings(): void {
    this.bindingService.generateOptionBindings(this as any);
  }

  public hydrateOptionsFromSelectionState(): void {
    this.bindingService.hydrateOptionsFromSelectionState(this as any);
  }

  getFeedbackBindings(option: Option, idx: number): FeedbackProps {
    return this.feedbackManager.getFeedbackBindings(option, idx, this.buildFeedbackContext());
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
    this.bindingService.processOptionBindings(this as any);
  }


  initializeFeedbackBindings(): void {
    this.feedbackBindings = this.feedbackManager.initializeFeedbackBindings(
      this.optionBindings, this.buildFeedbackContext()
    );
  }

  private getDefaultFeedbackProps(idx: number): FeedbackProps {
    return this.feedbackManager.getDefaultFeedbackProps(idx, this.buildFeedbackContext());
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
    const result = this.feedbackManager.regenerateFeedback(idx, this.optionsToDisplay, this.optionBindings);
    if (result) {
      this.feedbackConfigs = result.feedbackConfigs;
      this.cdRef.markForCheck();
    }
  }

  // Determine relative component logic for Q-type
  private determineQuestionType(input: QuizQuestion): 'single' | 'multiple' {
    return this.clickHandler.determineQuestionType(input);
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
    this.bindingService.forceDisableAllOptions(this as any);
  }

  public clearForceDisableAllOptions(): void {
    this.bindingService.clearForceDisableAllOptions(this as any);
  }

  private updateBindingSnapshots(): void {
    this.clickService.updateBindingSnapshots(this as any);
  }

  private fullyResetRows(): void {
    this.bindingService.fullyResetRows(this as any);
  }

  private syncSelectedFlags(): void {
    this.bindingService.syncSelectedFlags(this as any);
  }

  public applySelectionsUI(selectedOptions: SelectedOption[]): void {
    this.clickService.applySelectionsUI(this as any, selectedOptions);
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
    // ONLY trust _feedbackDisplay — it is set synchronously at end of click
    // processing with the exact display index. The legacy showFeedbackForOption
    // map uses optionId keys that can collide with other options' display indices.
    return this._feedbackDisplay !== null && this._feedbackDisplay.idx === i;
  }

  public getInlineFeedbackConfig(b: OptionBindings, i: number): FeedbackProps | null {
    return this.bindingService.getInlineFeedbackConfig(this as any, b, i);
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
    this.clickService.onOptionUI(this as any, ev);
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

  private _lastRunClickIndex: number | null = null;
  private _lastRunClickTime: number | null = null;

  private runOptionContentClick(binding: OptionBindings, index: number, event: any): void {
    this.clickService.runOptionContentClick(this as any, binding, index, event);
  }

  public triggerViewRefresh(): void {
    this.cdRef.markForCheck();
  }

  private onSelectionControlChanged(rawId: number | string): void {
    // NO-OP: Selection processing is handled exclusively by onOptionUI('change')
    // triggered by the mat-radio-button (change) event. The form valueChanges
    // subscription fires for the SAME user click, causing double-processing
    // which corrupts highlight/feedback state (two options highlighted at once).
    // Keeping this method as a no-op to avoid breaking the subscription setup.
  }
}