import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component,
  EventEmitter, Input, OnChanges, OnInit, Output, QueryList, SimpleChanges,
  ViewChild, ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Option } from '../../../../shared/models/Option.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { QuestionType } from '../../../../shared/models/question-type.enum';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
import { SelectedOption } from '../../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../../shared/models/SharedOptionConfig.model';
import { DynamicComponentService } from '../../../../shared/services/ui/dynamic-component.service';
import { FeedbackService } from '../../../../shared/services/features/feedback.service';
import { QuizService } from '../../../../shared/services/data/quiz.service';
import { QuizQuestionLoaderService } from '../../../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../../shared/services/flow/quizquestionmgr.service';
import { QuizStateService } from '../../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/state/selectedoption.service';

import { TimerService } from '../../../../shared/services/features/timer.service';
import { BaseQuestion } from '../../base/base-question';
import { SharedOptionComponent } from '../shared-option-component/shared-option.component';

@Component({
  selector: 'codelab-question-answer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedOptionComponent],
  templateUrl: './answer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnswerComponent extends BaseQuestion<OptionClickedPayload>
  implements OnInit, OnChanges, AfterViewInit {

  viewContainerRefs!: QueryList<ViewContainerRef>;
  viewContainerRef!: ViewContainerRef;
  @ViewChild(SharedOptionComponent)
  sharedOptionComponent!: SharedOptionComponent;

  @Output() componentLoaded = new EventEmitter<any>();
  @Output() optionSelected = new EventEmitter<{
    option: SelectedOption,
    index: number,
    checked: boolean
  }>();
  @Output() override optionClicked =
    new EventEmitter<OptionClickedPayload>() as any;
  @Input() questionData!: QuizQuestion;
  @Input() isNavigatingBackwards: boolean = false;
  override quizQuestionComponentOnOptionClicked!: (
    option: SelectedOption,
    index: number
  ) => void;
  @Input() currentQuestionIndex!: number;
  @Input() quizId!: string;
  @Input() override optionsToDisplay: Option[] = [];
  @Input() override optionBindings: OptionBindings[] = [];
  private _questionIndex: number | null = null;
  private optionBindingsSource: Option[] = [];
  override showFeedbackForOption: { [optionId: number]: boolean } = {};
  override selectedOption: SelectedOption | null = null;
  selectedOptions: SelectedOption[] = [];
  incomingOptions: Option[] = [];
  override sharedOptionConfig!: SharedOptionConfig;
  hasComponentLoaded = false;
  override type: 'single' | 'multiple' = 'single';  // store the type (single/multiple answer)
  override selectedOptionIndex = -1;
  @Input() form!: FormGroup;
  renderReady = false;

  public quizQuestionComponentLoaded = new EventEmitter<void>();

  private _wasComplete = false;

  private destroy$ = new Subject<void>();

  @Input()
  set questionIndex(v: number | null) {
    this._questionIndex = v;
  }

  get questionIndex(): number | null {
    return this._questionIndex;
  }

  constructor(
    protected quizQuestionLoaderService: QuizQuestionLoaderService,
    protected quizQuestionManagerService: QuizQuestionManagerService,
    protected timerService: TimerService,
    protected override dynamicComponentService: DynamicComponentService,
    protected override feedbackService: FeedbackService,
    protected override quizService: QuizService,
    protected override quizStateService: QuizStateService,
    protected override selectedOptionService: SelectedOptionService,

    protected override fb: FormBuilder,
    protected override cdRef: ChangeDetectorRef
  ) {
    super(
      fb,
      dynamicComponentService,
      feedbackService,
      quizService,
      quizStateService,
      selectedOptionService,
      cdRef
    );
  }

  override async ngOnInit(): Promise<void> {
    await this.initializeAnswerConfig();
    await this.initializeSharedOptionConfig();

    // Guard against the first render missing its options because the
    // options stream may not have emitted yet when the template binds.
    if (this.optionsToDisplay?.length) {
      this.applyIncomingOptions(this.optionsToDisplay);
    }

    this.quizService.getCurrentQuestion(this.quizService.currentQuestionIndex)
      .pipe(takeUntil(this.destroy$))
      .subscribe((currentQuestion: QuizQuestion | null) => {
        if (!currentQuestion) return;

        // ROBUST MULTI-ANSWER CHECK
        const opts = currentQuestion.options || [];
        const correctCount = opts.filter(o =>
          o.correct === true || (o as any).correct === 'true' || (o as any).correct === 1
        ).length;

        this.type = correctCount > 1 ? 'multiple' : 'single';
        console.log(`[AnswerComponent] Q${this.currentQuestionIndex + 1} detected as ${this.type} (Correct count: ${correctCount})`);

        if (!this.hasComponentLoaded) {
          this.hasComponentLoaded = true;
          this.syncOptionsWithSelections();
          this.quizQuestionComponentLoaded.emit();
        }
        this.cdRef.markForCheck();
      });

    // Displays the unique options to the UI
    this.quizQuestionLoaderService.optionsStream$
      .pipe(takeUntil(this.destroy$))
      .subscribe((opts: Option[]) => {
        // ⚡ FIX: Skip empty arrays to prevent BehaviorSubject initial emission
        // from clearing valid options that may have arrived via @Input
        if (!opts?.length) {
          console.log('[AC] ⏭️ Skipping empty optionsStream$ emission');
          return;
        }

        this.incomingOptions = this.normalizeOptions(structuredClone(opts));

        //  Clear prior icons and bindings (clean slate)
        this.optionBindings = [];
        this.renderReady = false;

        // Apply options synchronously (removed Promise.resolve to fix StackBlitz timing)
        this.applyIncomingOptions(this.incomingOptions, {
          resetSelection: false
        });
      });
  }

  override async ngOnChanges(changes: SimpleChanges): Promise<void> {
    let shouldMark = false;

    // Reset only when question changes
    if (changes['questionData']) {
      const q = changes['questionData'].currentValue;
      console.log(`[AC] 🔄 Input 'questionData' changed:`,
        q ? `ID=${q.questionId} Text="${q.questionText?.substring(0, 20)}..."` : 'NULL');

      if (q) {
        // Calculate synchronously from INPUT, not async service
        const correctCount = q.options?.filter((o: Option) => o.correct).length ?? 0;
        this.type = correctCount > 1 ? 'multiple' : 'single';
      }

      this._wasComplete = false;
      shouldMark = true;
    }

    if (changes['optionsToDisplay']) {
      const change = changes['optionsToDisplay'];
      const next = change.currentValue as Option[] | null | undefined;
      const refChanged = change.previousValue !== change.currentValue;

      if (refChanged) {
        if (Array.isArray(next) && next.length) {
          this.optionBindingsSource = next.map((o: Option) => ({ ...o }));
          this.optionBindings = this.rebuildOptionBindings(
            this.optionBindingsSource
          );
          this.applyIncomingOptions(next);
          this.syncOptionsWithSelections();
          this.cdRef.markForCheck();
        } else {
          this.optionBindingsSource = [];
          this.optionBindings = [];
          this.applyIncomingOptions?.([]);
        }
      } else {
        shouldMark = true;
      }
    }

    if (shouldMark) this.cdRef.markForCheck();
  }

  ngAfterViewInit(): void {
    if (this.viewContainerRefs) {
      this.viewContainerRefs?.changes.subscribe((refs) => {
        console.log('viewContainerRefs changed:', refs.toArray());
        this.handleViewContainerRef();
      });
    } else {
      console.error('viewContainerRefs is undefined or not initialized.');
    }

    this.cdRef.detectChanges();  // ensure change detection runs
  }

  override ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private resetSelectionState(): void {
    this.selectedOption = null;
    this.selectedOptions = [];
    this.selectedOptionIndex = -1;
    this.showFeedbackForOption = {};
  }

  private normalizeOptions(options: Option[]): Option[] {
    return (options ?? []).map((option, index) => ({
      ...option,
      optionId: option.optionId ?? index
    }));
  }

  private applyIncomingOptions(
    options: Option[],
    config: { resetSelection?: boolean } = {}
  ): void {
    const normalized = this.normalizeOptions(options);
    const nextOptions = normalized.map((option: Option) => ({ ...option }));

    if (config.resetSelection ?? true) this.resetSelectionState();

    // Recalculate type from the incoming options' correct flags.
    // Without this, navigating from a multi-answer question (e.g. Q4) to a
    // single-answer question (e.g. Q5) would leave type='multiple', causing
    // SOC to render checkboxes and use multi-answer interaction logic.
    const correctCount = nextOptions.filter(o =>
      o.correct === true || (o as any).correct === 'true' || (o as any).correct === 1
    ).length;
    this.type = correctCount > 1 ? 'multiple' : 'single';

    this.optionsToDisplay = nextOptions;
    this.optionBindingsSource = nextOptions.map((option) => ({ ...option }));

    if (this.sharedOptionConfig) {
      this.sharedOptionConfig = {
        ...this.sharedOptionConfig,
        type: this.type,
        optionsToDisplay: nextOptions.map((option: Option) => ({ ...option }))
      };
    }

    this.optionBindings = this.rebuildOptionBindings(this.optionBindingsSource);
    this.renderReady = true;
    this.syncOptionsWithSelections();
    this.cdRef.markForCheck();
  }

  /**
   * Hydrates the local 'optionsToDisplay' or Input options with state 
   * from the SelectedOptionService.
   */
  private syncOptionsWithSelections(): void {
    const idx = typeof this.currentQuestionIndex === 'number' ? this.currentQuestionIndex : this.questionIndex;
    if (idx === null || idx === undefined || idx < 0) {
      console.warn('[AC] ⏭️ Cannot sync options: valid question index not found');
      return;
    }

    const savedSelections = this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
    if (!savedSelections.length || !this.optionsToDisplay?.length) {
      console.log(`[AC] 🧬 No saved selections or options to display for Q${idx + 1}. Skipping sync.`);
      return;
    }

    console.log(`[AC] 🧬 Synchronizing ${this.optionsToDisplay.length} options with ${savedSelections.length} saved selections for Q${idx + 1}`);

    const savedIds = new Set(savedSelections.map(s => String(s.optionId)));
    const savedTexts = new Set(savedSelections.map(s => (s.text || '').trim().toLowerCase()));

    // For multi-answer: do NOT pre-select/highlight all saved options.
    // Each option should highlight individually on click, not all at once.
    const isMulti = this.type === 'multiple';

    for (const opt of this.optionsToDisplay) {
      if (isMulti) {
        opt.selected = false;
      } else {
        const idMatch = opt.optionId != null && savedIds.has(String(opt.optionId));
        const textMatch = !!(opt.text && savedTexts.has(opt.text.trim().toLowerCase()));
        opt.selected = !!(idMatch || textMatch);
      }
    }

    // Also update bindings
    if (this.optionBindings?.length) {
      for (const b of this.optionBindings) {
        if (isMulti) {
          b.isSelected = false;
        } else {
          const id = b.option?.optionId;
          const text = b.option?.text;
          const idMatch = id != null && savedIds.has(String(id));
          const textMatch = !!(text && savedTexts.has(text.trim().toLowerCase()));
          b.isSelected = !!(idMatch || textMatch);
        }
      }
    }

    // CRITICAL: Update FormGroup for single-answer (radio group sync)
    if (this.type === 'single' && this.form) {
      const selectedId = savedSelections[0]?.optionId;
      if (selectedId != null) {
        console.log(`[AC] 📻 Patching form for single-answer Q${idx + 1} with ID=${selectedId}`);
        this.form.patchValue({ selectedOptionId: selectedId }, { emitEvent: false });
      }
    }
  }

  private handleViewContainerRef(): void {
    if (this.hasComponentLoaded) {
      console.log('Component already loaded, skipping handleViewContainerRef.');
      return;
    }

    if (this.viewContainerRefs && this.viewContainerRefs.length > 0) {
      console.log(
        'viewContainerRefs available in handleViewContainerRef:',
        this.viewContainerRefs
      );
      this.viewContainerRef = this.viewContainerRefs.first;  // assign the first available ViewContainerRef
      this.loadQuizQuestionComponent();
      this.hasComponentLoaded = true;  // prevent further attempts to load
    } else {
      console.warn('No viewContainerRef available in handleViewContainerRef');
    }
  }

  private loadQuizQuestionComponent(): void {
    if (this.hasComponentLoaded) {
      console.log('QuizQuestionComponent already loaded, skipping load.');
      return;
    }

    // Ensure that the current component conainer is cleared before loading a new one
    if (this.viewContainerRef) {
      console.log('Clearing viewContainerRef before loading new component.');
      this.viewContainerRef.clear();
    } else {
      console.error('viewContainerRef is not available.');
      return;
    }

    // Get the current question and determine the component to load
    this.quizService.getCurrentQuestion(this.quizService.currentQuestionIndex)
      .subscribe((currentQuestion: QuizQuestion | null) => {
        if (!currentQuestion) return;
        const isMultipleAnswer =
          this.quizQuestionManagerService.isMultipleAnswerQuestion(currentQuestion);

        if (isMultipleAnswer) {
          this.type = isMultipleAnswer ? 'multiple' : 'single';
          this.hasComponentLoaded = true;  // prevent further attempts to load
          this.quizQuestionComponentLoaded.emit();  // notify listeners that component is loaded
          this.cdRef.markForCheck();
        } else {
          console.error('Could not determine whether question is multiple answer.');
        }
      });
  }

  private async initializeAnswerConfig(): Promise<void> {
    if (!this.sharedOptionConfig) {
      await this.initializeSharedOptionConfig();
    }

    if (this.sharedOptionConfig) {
      this.sharedOptionConfig.type = this.type;
    } else {
      console.error('Failed to initialize sharedOptionConfig in AnswerComponent');
    }
  }

  public override async initializeSharedOptionConfig(): Promise<void> {
    await super.initializeSharedOptionConfig();
    if (this.sharedOptionConfig) {
      this.sharedOptionConfig.type = this.type;
    }
  }

  public override async onOptionClicked(
    payload: OptionClickedPayload,
  ): Promise<void> {
    if (!payload || !payload.option) {
      console.error(
        '[AnswerComponent] INVALID payload passed into onOptionClicked:', payload
      );
      return;
    }

    const rawOption = payload.option;
    const wasChecked = payload.checked ?? true;

    // Always get the QUESTION INDEX from QQC input
    const activeQuestionIndex =
      typeof this.currentQuestionIndex === 'number'
        ? this.currentQuestionIndex
        : 0;

    const getEffectiveId = (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const targetKey = getEffectiveId(rawOption, payload.index);

    const canonical =
      this.optionsToDisplay?.find(
        (opt: Option, i: number) => getEffectiveId(opt, i) === targetKey
      ) ?? rawOption;

    // Robust correctness check (matches SelectedOptionService)
    const isCorrectValue = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');

    const enrichedOption: SelectedOption = {
      ...canonical,
      optionId: targetKey,
      text: canonical.text,
      correct: isCorrectValue(canonical),
      questionIndex: activeQuestionIndex,
      displayIndex: payload.index,
      selected: wasChecked === true,
      highlight: wasChecked === true,
      showIcon: wasChecked === true
    } as any;

    // INTERNAL STATE UPDATE
    if (this.type === 'single') {
      this.selectedOption = enrichedOption;
      this.selectedOptions = [enrichedOption];
    } else {
      this.selectedOptions ??= [];

      const i = this.selectedOptions.findIndex(
        (o: any) => getEffectiveId(o, (o as any).displayIndex ?? (o as any).index) === targetKey
      );

      if (enrichedOption.selected) {
        if (i === -1) {
          this.selectedOptions.push(enrichedOption);
        } else {
          this.selectedOptions[i] = enrichedOption;
        }
      } else {
        if (i !== -1) this.selectedOptions.splice(i, 1);
      }
    }

    // Resolve canonical question by INDEX (prefer service, fallback to @Input)
    const serviceQuestion = this.quizService.questions?.[activeQuestionIndex];
    const question = serviceQuestion ?? this.questionData;

    if (!question) {
      console.error(
        '[AC][INVARIANT] Missing question for index', activeQuestionIndex,
        'ServiceQuestionsLength:', this.quizService.questions?.length
      );
      return;
    }

    if (!serviceQuestion) {
      console.warn(`[AC] ⚠️ Service question missing for Q${activeQuestionIndex + 1}. Using @Input fallback.`);
    }

    const optionsSource = this.optionsToDisplay?.length ? this.optionsToDisplay : question.options;
    const correctCount = optionsSource?.filter((o: any) => o.correct === true || String(o.correct) === 'true').length ?? 0;
    const isMultiAnswer = this.type === 'multiple' || question.type === QuestionType.MultipleAnswer || correctCount > 1;

    // Push to SelectedOptionService (merge, not replace)
    this.selectedOptionService.currentQuestionType =
      !isMultiAnswer ? QuestionType.SingleAnswer : QuestionType.MultipleAnswer;

    if (!isMultiAnswer) {
      // Single-answer: REPLACE selection
      this.selectedOptionService.setSelectedOptionsForQuestion(
        activeQuestionIndex,
        [enrichedOption]
      );
    } else {
      // Multiple-answer: MERGE selection
      // (High-level exclusive highlighting logic is now handled in SelectedOptionService.addOption)
      this.selectedOptionService.addOption(activeQuestionIndex, enrichedOption);
    }

    // AUTHORITATIVE COMPLETE CHECK (AFTER SOS UPDATE)
    const selectedNow =
      this.selectedOptionService.getSelectedOptionsForQuestion(
        activeQuestionIndex,
      ) ?? [];

    if (this.questionIndex == null) {
      console.warn('[onOptionClicked] questionIndex is null — skipping completion check');
      return;
    }

    const allSelected =
      this.selectedOptionService.getSelectedOptionsForQuestion(this.questionIndex);

    const complete =
      this.selectedOptionService.isQuestionComplete(question, allSelected);

    this._wasComplete = complete;

    // Mark answered ONLY when invariant is satisfied
    this.quizStateService.setAnswerSelected(complete);

    // FORWARD CLEAN PAYLOAD UPWARD
    const cleanPayload: OptionClickedPayload = {
      option: enrichedOption,
      index: payload.index,
      checked: enrichedOption.selected === true,
      wasReselected: payload.wasReselected ?? false
    };

    this.optionClicked.emit(cleanPayload);
  }

  // Rebuild optionBindings from the latest optionsToDisplay.
  private rebuildOptionBindings(opt: Option[]): OptionBindings[] {
    console.time('[⏱️ Rebuild OptionBindings]');

    if (!opt?.length) {
      this.optionBindings = [];
      return [];
    }

    // Deep clone options to avoid mutation
    const cloned: Option[] =
      typeof structuredClone === 'function'
        ? structuredClone(opt)
        : JSON.parse(JSON.stringify(opt));

    // Build fresh bindings
    const rebuilt = cloned.map((opt, idx) =>
      this.buildFallbackBinding(opt, idx),
    );

    // Patch shared references
    for (const b of rebuilt) {
      b.allOptions = cloned;
      b.optionsToDisplay = cloned;
    }

    // ⚡ FIX: Set renderReady synchronously instead of in microtask
    // to avoid race condition where template checks renderReady before Promise resolves
    this.optionBindings = rebuilt;
    this.renderReady = true;

    // Use requestAnimationFrame for change detection to ensure paint-synchronized update
    requestAnimationFrame(() => {
      this.cdRef.markForCheck();
    });

    return rebuilt;
  }

  // Builds a minimal but type-complete binding when no helper exists
  private buildFallbackBinding(opt: Option, idx: number): OptionBindings {
    return {
      // core data
      option: opt,
      index: idx,
      isSelected: !!opt.selected,
      isCorrect: opt.correct ?? false,

      // feedback always starts visible so every row shows text
      showFeedback: true,
      feedback:
        opt.feedback?.trim() ||
        (opt.correct
          ? 'Great job — that answer is correct.'
          : 'Not quite — see the explanation above.'),
      highlight: !!opt.highlight,

      // required interface props
      showFeedbackForOption: {},
      appHighlightOption: false,
      highlightCorrectAfterIncorrect: false,
      highlightIncorrect: false,
      highlightCorrect: false,
      styleClass: '',
      disabled: false,
      type: 'single',
      appHighlightInputType: 'radio', // satisfies the union type
      allOptions: [], // will be replaced below
      appHighlightReset: false,
      ariaLabel: `Option ${idx + 1}`,
      appResetBackground: false,
      optionsToDisplay: [], // will be replaced below
      checked: !!opt.selected,
      change: () => { },
      active: true
    } as OptionBindings;
  }

  override async loadDynamicComponent(
    _question: QuizQuestion,
    _options: Option[],
    _questionIndex: number,
  ): Promise<void> {
    // AnswerComponent doesn't load dynamic children, so we
    // simply fulfill the contract and return a resolved promise.
    return;
    // If the base implementation does something essential, call:
    // return super.loadDynamicComponent(_question, _options, _questionIndex);
  }
}