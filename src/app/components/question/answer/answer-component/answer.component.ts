import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component,
  EventEmitter, Input, OnChanges, OnInit, Output, QueryList, SimpleChanges,
  ViewChild, ViewContainerRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { Option } from '../../../../shared/models/Option.model';
import { OptionBindings } from '../../../../shared/models/OptionBindings.model';
import { OptionClickedPayload } from '../../../../shared/models/OptionClickedPayload.model';
import { QuestionType } from '../../../../shared/models/question-type.enum';
import { QuizQuestion } from '../../../../shared/models/QuizQuestion.model';
import { SelectedOption } from '../../../../shared/models/SelectedOption.model';
import { SharedOptionConfig } from '../../../../shared/models/SharedOptionConfig.model';
import { DynamicComponentService } from '../../../../shared/services/dynamic-component.service';
import { FeedbackService } from '../../../../shared/services/feedback.service';
import { QuizService } from '../../../../shared/services/quiz.service';
import { QuizQuestionLoaderService } from '../../../../shared/services/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../../shared/services/quizquestionmgr.service';
import { QuizStateService } from '../../../../shared/services/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/selectedoption.service';
import { TimerService } from '../../../../shared/services/timer.service';
import { BaseQuestion } from '../../base/base-question';
import { SharedOptionComponent } from '../shared-option-component/shared-option.component';

@Component({
  selector: 'codelab-question-answer',
  standalone: true,
  imports: [CommonModule, SharedOptionComponent],
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
      .subscribe((currentQuestion: QuizQuestion | null) => {
        if (!currentQuestion) return;
        const correctCount = currentQuestion.options?.filter(o => o.correct).length ?? 0;
        const isMultipleAnswer = correctCount > 1;
        this.type = isMultipleAnswer ? 'multiple' : 'single';
      });

    // Displays the unique options to the UI
    this.quizQuestionLoaderService.optionsStream$
      .pipe(takeUntil(this.destroy$))
      .subscribe((opts: Option[]) => {
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

    this.optionsToDisplay = nextOptions;
    this.optionBindingsSource = nextOptions.map((option) => ({ ...option }));

    if (this.sharedOptionConfig) {
      this.sharedOptionConfig = {
        ...this.sharedOptionConfig,
        optionsToDisplay: nextOptions.map((option: Option) => ({ ...option }))
      };
    }

    this.optionBindings = this.rebuildOptionBindings(this.optionBindingsSource);
    this.renderReady = true;
    this.cdRef.markForCheck();
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
    event: OptionClickedPayload,
  ): Promise<void> {
    if (!event || !event.option) {
      console.error(
        '[AnswerComponent] INVALID event passed into onOptionClicked:', event
      );
      return;
    }

    const rawOption = event.option;
    const wasChecked = event.checked ?? true;

    // Always get the QUESTION INDEX from QQC input
    const activeQuestionIndex =
      typeof this.currentQuestionIndex === 'number'
        ? this.currentQuestionIndex
        : 0;

    const canonical =
      this.optionsToDisplay?.find(
        (opt: Option) => String(opt.optionId) === String(rawOption.optionId),
      ) ?? rawOption;

    const enrichedOption: SelectedOption = {
      optionId: canonical.optionId,
      text: canonical.text,
      correct: canonical.correct === true,
      questionIndex: activeQuestionIndex,
      selected: wasChecked === true,
      highlight: true,
      showIcon: true
    };

    // INTERNAL STATE UPDATE
    if (this.type === 'single') {
      this.selectedOption = enrichedOption;
      this.selectedOptions = [enrichedOption];
    } else {
      this.selectedOptions ??= [];

      const i = this.selectedOptions.findIndex(
        (o: Option) => o.optionId === enrichedOption.optionId
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

    // Push to SelectedOptionService (merge, not replace)
    this.selectedOptionService.currentQuestionType =
      this.type === 'single' ? QuestionType.SingleAnswer : QuestionType.MultipleAnswer;

    if (this.type === 'single') {
      // Single-answer: REPLACE selection
      this.selectedOptionService.setSelectedOptionsForQuestion(
        activeQuestionIndex,
        [enrichedOption]
      );
    } else {
      // Multiple-answer: MERGE selection
      this.selectedOptionService.addOption(activeQuestionIndex, enrichedOption);
    }

    // Resolve canonical question by INDEX (never trust @Input here)
    const question = this.quizService.questions?.[activeQuestionIndex];

    if (!question) {
      console.error(
        '[AC][INVARIANT] Missing question for index', activeQuestionIndex
      );
      return;
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
      index: event.index,
      checked: enrichedOption.selected === true,
      wasReselected: event.wasReselected ?? false
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