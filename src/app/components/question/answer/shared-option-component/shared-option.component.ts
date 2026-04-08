import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, DoCheck,
  HostListener, OnChanges, OnDestroy, OnInit,
  SimpleChanges, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioModule, MatRadioChange } from '@angular/material/radio';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { Option } from '../../../../shared/models/Option.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
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
import { SharedOptionExplanationService } from '../../../../shared/services/features/shared-option/shared-option-explanation.service';
import { OptionClickHandlerService } from '../../../../shared/services/options/engine/option-click-handler.service';
import { SharedOptionChangeHandlerService, ChangeResult } from '../../../../shared/services/options/engine/shared-option-change-handler.service';
import { SharedOptionFeedbackService, FeedbackContext, DisplayFeedbackResult } from '../../../../shared/services/features/shared-option/shared-option-feedback.service';
import { SharedOptionInitService } from '../../../../shared/services/options/engine/shared-option-init.service';
import { SharedOptionBindingService } from '../../../../shared/services/options/engine/shared-option-binding.service';
import { SharedOptionClickService } from '../../../../shared/services/options/engine/shared-option-click.service';
import { SharedOptionOrchestratorService } from '../../../../shared/services/features/shared-option/shared-option-orchestrator.service';

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
  styleUrls: [
    '../../quiz-question/quiz-question.component.scss',
    './shared-option.component.scss'
  ],
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedOptionComponent
    implements OnInit, OnChanges, DoCheck, OnDestroy, AfterViewInit {
  readonly optionClicked = output<OptionClickedPayload>();
  readonly optionEvent = output<OptionUIEvent>();
  readonly reselectionDetected = output<boolean>();
  readonly explanationUpdate = output<number>();
  readonly renderReadyChange = output<boolean>();
  readonly showExplanationChange = output<boolean>();
  readonly explanationToDisplayChange = output<string>();
  readonly currentQuestion = model<QuizQuestion | null>(null);
  readonly currentQuestionIndex = model<number>(undefined as unknown as number);
  readonly questionIndex = input<number | null>(null);
  readonly optionsToDisplay = model<Option[]>([]);
  readonly quizId = input<string>(undefined as unknown as string);
  readonly type = model<'single' | 'multiple'>('single');
  readonly config = input<SharedOptionConfig>(undefined as unknown as SharedOptionConfig);
  readonly selectedOption = model<Option | null>(null);
  readonly showFeedbackForOption = model<{ [key: string | number]: boolean }>({});
  readonly correctMessage = model<string>('');
  readonly showFeedback = model<boolean>(false);
  readonly shouldResetBackground = model<boolean>(false);
  readonly highlightCorrectAfterIncorrect = input<boolean>(false);
  readonly quizQuestionComponentOnOptionClicked = input<(option: SelectedOption, index: number) => void>(undefined as unknown as (option: SelectedOption, index: number) => void);
  readonly optionBindings = model<OptionBindings[]>([]);
  readonly selectedOptionId = input<number | null>(null);
  readonly selectedOptionIndex = model<number | null>(null);
  readonly isNavigatingBackwards = model<boolean>(false);
  readonly renderReady = model<boolean>(false);
  readonly finalRenderReady$ = input<Observable<boolean> | null>(null);
  readonly questionVersion = input<number>(0);  // increments every time questionIndex changes
  readonly sharedOptionConfig = input<SharedOptionConfig>(undefined as unknown as SharedOptionConfig);
  public selectedOptionMap = new Map<number | string, boolean>();
  public ui!: SharedOptionUiState;
  public finalRenderReadySub?: Subscription;
  public selectionSub!: Subscription;
  public isSelected = false;
  public optionBindingsInitialized = false;

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
  public correctClicksPerQuestion: Map<number, Set<number>> = new Map();
  // Track DISABLED option IDs per question - persists across binding recreations
  public disabledOptionsPerQuestion: Map<number, Set<number>> = new Map();
  public lastFeedbackQuestionIndex = -1;
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
  public lastProcessedQuestionIndex: number = -1;

  public readonly optionsToDisplay$ = new BehaviorSubject<Option[]>([]);
  viewReady = false;
  showOptions = false;
  form!: FormGroup;

  public renderReadySubject =
    new BehaviorSubject<boolean>(false);
  public renderReady$ = this.renderReadySubject.asObservable();

  // Include disableRenderTrigger to force re-render when disabled state changes
  trackByOptionId = (b: OptionBindings, idx: number) => {
    const idPart = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : `idx-${idx}`;
    const questionPart = this.getActiveQuestionIndex();
    return `q${questionPart}_${idPart}_${idx}`;
  };

  public flashDisabledSet = new Set<number>();
  public lockedIncorrectOptionIds = new Set<number>();
  public forceDisableAll = false;
  public timerExpiredForQuestion = false;  // track timer expiration
  public timeoutCorrectOptionKeys = new Set<string>();
  public resolvedQuestionIndex: number | null = null;

  public _isMultiModeCache: boolean | null = null;
  public _lastHandledIndex: number | null = null;
  public _lastHandledTime: number | null = null;

  // BULLETPROOF feedback tracker: set synchronously in handleOptionClick,
  // NEVER cleared by ngOnChanges/generateOptionBindings/rebuild cycles.
  // Only cleared on question change.
  public _lastClickFeedback: { index: number; config: FeedbackProps; questionIdx: number } | null = null;

  // DURABLE multi-answer selection tracker. Survives binding regeneration.
  // Maps question index → Set of selected display indices.
  // Only cleared on question change (resetStateForNewQuestion / ngOnChanges).
  public _multiSelectByQuestion = new Map<number, Set<number>>();
  public _correctIndicesByQuestion = new Map<number, number[]>();

  destroy$ = new Subject<void>();

  // Ghost/legacy fields written by services but not read. Kept as public
  // no-ops so the strict-typed SOC boundary doesn't explode. Safe to delete
  // once all writers are cleaned up.
  public optionsReady = false;
  public showNoOptionsFallback = false;
  public finalRenderReady = false;
  public optionsRestored = false;
  public lastSelectedOptionIndex: number = -1;

  // Dead-call compatibility: some services invoke comp.isCorrect(opt)
  // Used to exist; now just reads the option's `correct` flag.
  public isCorrect(option: Option | null | undefined): boolean {
    return !!(option && (option as any).correct);
  }

  constructor(
    public quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    public soundService: SoundService,
    public optionService: OptionService,
    private optionUiContextBuilder: OptionUiContextBuilderService,
    private optionLockService: OptionLockService,
    public optionSelectionUiService: OptionSelectionUiService,
    private sharedOptionStateAdapterService: SharedOptionStateAdapterService,
    public explanationHandler: SharedOptionExplanationService,
    public clickHandler: OptionClickHandlerService,
    public changeHandler: SharedOptionChangeHandlerService,
    public feedbackManager: SharedOptionFeedbackService,
    private initService: SharedOptionInitService,
    private bindingService: SharedOptionBindingService,
    public clickService: SharedOptionClickService,
    private orchestrator: SharedOptionOrchestratorService,
    public cdRef: ChangeDetectorRef,
    private fb: FormBuilder
  ) {
    this.ui = this.sharedOptionStateAdapterService.createInitialUiState();
    this.form = this.fb.group({
      selectedOptionId: [null, Validators.required]
    });
    this.installModelAssignmentTraps();
  }

  /**
   * Many legacy services do `host.optionBindings = X` etc. With model() inputs,
   * such assignment overwrites the signal function and breaks reactivity/templates.
   * This installs per-instance accessor properties that forward plain assignments
   * to the underlying signal's `.set()`, while reads still return the signal fn
   * (so template auto-calls and `host.x()` call form continue to work).
   */
  private installModelAssignmentTraps(): void {
    const fields = [
      'currentQuestion',
      'currentQuestionIndex',
      'optionsToDisplay',
      'type',
      'selectedOption',
      'showFeedbackForOption',
      'correctMessage',
      'showFeedback',
      'shouldResetBackground',
      'optionBindings',
      'selectedOptionIndex',
      'isNavigatingBackwards',
      'renderReady'
    ];
    for (const f of fields) {
      const sig: any = (this as any)[f];
      if (typeof sig !== 'function' || typeof sig.set !== 'function') continue;
      Object.defineProperty(this, f, {
        configurable: true,
        enumerable: true,
        get: () => sig,
        set: (v: any) => sig.set(v)
      });
    }
  }

  get isMultiMode(): boolean {
    return this.orchestrator.runIsMultiMode(this);
  }

  ngOnInit(): void {
    this.orchestrator.runOnInit(this);
  }

  public initializeQuestionIndex(): void {
    this.orchestrator.runInitializeQuestionIndex(this);
  }

  public resetStateForNewQuestion(): void {
    this.initService.resetStateForNewQuestion(this as any);
  }

  public subscribeToTimerExpiration(): void {
    this.initService.subscribeToTimerExpiration(this as any);
  }

  public setupFallbackRendering(): void {
    this.initService.setupFallbackRendering(this as any);
  }

  public initializeConfiguration(): void {
    this.initService.initializeConfiguration(this as any);
  }

  public initializeOptionDisplayWithFeedback(): void {
    this.initService.initializeOptionDisplayWithFeedback(this as any);
  }

  public setupSubscriptions(): void {
    this.initService.setupSubscriptions(this as any);
  }

  public subscribeToSelectionChanges(): void {
    this.initService.subscribeToSelectionChanges(this as any);
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    return this.orchestrator.runOnChanges(this, changes);
  }

  ngAfterViewInit(): void {
    this.orchestrator.runAfterViewInit(this);
  }

  ngOnDestroy(): void {
    this.orchestrator.runOnDestroy(this);
  }

  public rehydrateUiFromState(reason: string): void {
    this.bindingService.rehydrateUiFromState(this as any, reason);
  }

  public setupRehydrateTriggers(): void {
    this.initService.setupRehydrateTriggers(this as any);
  }

  public rebuildShowFeedbackMapFromBindings(): void {
    this.orchestrator.runRebuildShowFeedbackMapFromBindings(this);
  }

  @HostListener('window:visibilitychange', [])
  onVisibilityChange(): void {
    this.orchestrator.runOnVisibilityChange(this);
  }

  public updateSelections(rawSelectedId: number | string): void {
    this.orchestrator.runUpdateSelections(this, rawSelectedId);
  }

  public ensureOptionsToDisplay(): void {
    this.clickService.ensureOptionsToDisplay(this as any);
  }

  public synchronizeOptionBindings(): void {
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

  public setOptionBindingsIfChanged(newOptions: Option[]): void {
    this.bindingService.setOptionBindingsIfChanged(this as any, newOptions);
  }

  getOptionDisplayText(option: Option, idx: number): string {
    return this.optionService.getOptionDisplayText(option, idx);
  }

  public getOptionIcon(binding: OptionBindings, i: number): string {
    return this.optionService.getOptionIcon(binding, i);
  }

  public getOptionClasses(binding: OptionBindings): { [key: string]: boolean } {
    return this.orchestrator.runGetOptionClasses(this, binding);
  }

  // Returns cursor style for option - 'not-allowed' for disabled/incorrect
  // options or when timer expired
  public getOptionCursor(binding: OptionBindings, index: number): string {
    return this.optionService.getOptionCursor(binding, index, this.isDisabled(binding, index), this.timerExpiredForQuestion);
  }

  // Decide if an option should be disabled, only checks disabledOptionsPerQuestion
  // Map. All actual disabling decisions are made in onOptionContentClick
  public shouldDisableOption(binding: OptionBindings): boolean {
    return this.orchestrator.runShouldDisableOption(this, binding);
  }

  public computeDisabledState(option: Option, index: number): boolean {
    return this.orchestrator.runComputeDisabledState(this, option, index);
  }

  // Wrapper for template compatibility or legacy calls
  public isDisabled(binding: OptionBindings, index: number): boolean {
    // Return the pre-computed state from the binding snapshot if available/trusted,
    // otherwise re-compute for robust click guarding.
    return this.computeDisabledState(binding.option, index);
  }

  public onOptionInteraction(binding: OptionBindings, index: number, event: MouseEvent): void {
    this.orchestrator.runOnOptionInteraction(this, binding, index, event);
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

  public resolveInteractionType(): 'single' | 'multiple' {
    return this.isMultiMode ? 'multiple' : 'single';
  }

  public buildFeedbackContext(): FeedbackContext {
    return this.orchestrator.runBuildFeedbackContext(this);
  }

  public buildOptionUiSyncContext(): OptionUiSyncContext {
    return this.optionUiContextBuilder.fromSharedOptionComponent(this);
  }

  public emitExplanation(questionIndex: number, skipGuard = false): void {
    this.orchestrator.runEmitExplanation(this, questionIndex, skipGuard);
  }

  private applyExplanationText(
      explanationText: string,
      displayIndex: number
  ): void {
    this.explanationHandler.applyExplanationText(explanationText, displayIndex);
    this.cdRef.markForCheck();
  }

  public resolveDisplayIndex(questionIndex: number): number {
    return this.explanationHandler.resolveDisplayIndex(
        questionIndex,
        () => this.getActiveQuestionIndex(),
        this.currentQuestionIndex(),
        this.resolvedQuestionIndex
    );
  }

  private clearPendingExplanation(): void {
    this.explanationHandler.clearPendingExplanation();
  }

  public _pendingHighlightRAF: number | null = null;

  public deferHighlightUpdate(callback: () => void): void {
    this.orchestrator.runDeferHighlightUpdate(this, callback);
  }

  private cacheResolvedFormattedExplanation(index: number, formatted: string): void {
    this.explanationHandler.cacheResolvedFormattedExplanation(index, formatted);
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

  private handleSelection(option: SelectedOption, index: number, optionId: number): void {
    this.clickService.handleSelection(this as any, option, index, optionId);
  }

  displayFeedbackForOption(
      option: SelectedOption,
      index: number,
      optionId: number
  ): void {
    this.orchestrator.runDisplayFeedbackForOption(this, option, index, optionId);
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
    this.orchestrator.runResetUIForNewQuestion(this);
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

  public processOptionBindings(): void {
    this.bindingService.processOptionBindings(this as any);
  }

  initializeOptionBindings(): void {
    this.orchestrator.runInitializeOptionBindings(this);
  }

  initializeFeedbackBindings(): void {
    this.feedbackBindings = this.feedbackManager.initializeFeedbackBindings(
        this.optionBindings(), this.buildFeedbackContext()
    );
  }

  private getDefaultFeedbackProps(idx: number): FeedbackProps {
    return this.feedbackManager.getDefaultFeedbackProps(idx, this.buildFeedbackContext());
  }

  isSelectedOption(option: Option): boolean {
    return this.selectedOptionId() === option.optionId;
  }

  ensureOptionIds(): void {
    this.orchestrator.runEnsureOptionIds(this);
  }

  public shouldShowIcon(option: Option, i: number): boolean {
    return this.orchestrator.runShouldShowIcon(this, option, i);
  }

  shouldShowFeedbackFor(b: OptionBindings): boolean {
    const id = b.option.optionId;
    return (
        id === this.lastFeedbackOptionId &&
        !!this.feedbackConfigs[id]?.showFeedback
    );
  }

  public canDisplayOptions(): boolean {
    return this.orchestrator.runCanDisplayOptions(this);
  }

  public markRenderReady(reason: string = ''): void {
    this.orchestrator.runMarkRenderReady(this, reason);
  }

  public regenerateFeedback(idx: number): void {
    this.orchestrator.runRegenerateFeedback(this, idx);
  }

  // Determine relative component logic for Q-type
  public determineQuestionType(input: QuizQuestion): 'single' | 'multiple' {
    return this.clickHandler.determineQuestionType(input);
  }

  public finalizeOptionPopulation(): void {
    this.orchestrator.runFinalizeOptionPopulation(this);
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

  public fullyResetRows(): void {
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

  public resolveCurrentQuestionIndex(): number {
    return this.orchestrator.runResolveCurrentQuestionIndex(this);
  }

  private resolveExplanationQuestionIndex(questionIndex: number): number {
    return this.explanationHandler.resolveExplanationQuestionIndex(
        questionIndex, this.getActiveQuestionIndex()
    );
  }

  public getQuestionAtDisplayIndex(displayIndex: number): QuizQuestion | null {
    return this.orchestrator.runGetQuestionAtDisplayIndex(this, displayIndex);
  }

  canShowOptions(): boolean {
    return this.orchestrator.runCanShowOptions(this);
  }

  public normalizeQuestionIndex(candidate: unknown): number | null {
    return this.orchestrator.runNormalizeQuestionIndex(this, candidate);
  }

  public updateResolvedQuestionIndex(candidate: unknown): void {
    this.orchestrator.runUpdateResolvedQuestionIndex(this, candidate);
  }

  public getActiveQuestionIndex(): number {
    return this.orchestrator.runGetActiveQuestionIndex(this);
  }

  public onOptionUI(ev: OptionUIEvent): void {
    this.clickService.onOptionUI(this as any, ev);
  }

  public findBindingByOptionId(optionId: number): { b: OptionBindings; i: number } | null {
    return this.orchestrator.runFindBindingByOptionId(this, optionId);
  }

  public _lastRunClickIndex: number | null = null;
  public _lastRunClickTime: number | null = null;

  public runOptionContentClick(binding: OptionBindings, index: number, event: any): void {
    this.clickService.runOptionContentClick(this as any, binding, index, event);
  }

  public triggerViewRefresh(): void {
    this.cdRef.markForCheck();
  }
}