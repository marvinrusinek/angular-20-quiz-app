import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, effect,
  input, model, OnChanges, OnInit, output, QueryList, SimpleChanges, ViewChild,
  ViewContainerRef } from '@angular/core';
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
import { FeedbackService } from '../../../../shared/services/features/feedback/feedback.service';
import { QuizService } from '../../../../shared/services/data/quiz.service';
import { QuizQuestionLoaderService } from '../../../../shared/services/flow/quizquestionloader.service';
import { QuizQuestionManagerService } from '../../../../shared/services/flow/quizquestionmgr.service';
import { QuizStateService } from '../../../../shared/services/state/quizstate.service';
import { SelectedOptionService } from '../../../../shared/services/state/selectedoption.service';
import { TimerService } from '../../../../shared/services/features/timer/timer.service';
import { SharedOptionComponent } from '../shared-option-component/shared-option.component';
import { BaseQuestion } from '../../base/base-question';

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

  readonly componentLoaded = output<any>();
  readonly optionSelected = output<{
    option: SelectedOption,
    index: number,
    checked: boolean
  }>();
  readonly questionData = model<QuizQuestion>(undefined as unknown as QuizQuestion);
  readonly isNavigatingBackwards = input<boolean>(false);
  readonly currentQuestionIndex = input<number>(undefined as unknown as number);
  readonly quizId = input<string>(undefined as unknown as string);
  readonly form = input<FormGroup>(undefined as unknown as FormGroup);
  private optionBindingsSource: Option[] = [];
  override showFeedbackForOption: { [optionId: number]: boolean } = {};
  override selectedOption: SelectedOption | null = null;
  selectedOptions: SelectedOption[] = [];
  incomingOptions: Option[] = [];
  override sharedOptionConfig!: SharedOptionConfig;
  hasComponentLoaded = false;

  override selectedOptionIndex = -1;
  renderReady = false;

  readonly quizQuestionComponentLoaded = output<void>();

  private _wasComplete = false;

  private destroy$ = new Subject<void>();

  readonly questionIndex = input<number | null>(null);

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

    // React to signal-input updates from the dynamic loader (replaces ngOnChanges)
    effect(() => {
      const q = this.questionData();
      if (q) {
        const correctCount = q.options?.filter((o: Option) => o.correct).length ?? 0;
        this.type.set(correctCount > 1 ? 'multiple' : 'single');
      }
      this._wasComplete = false;
      this.cdRef.markForCheck();
    });

    effect(() => {
      const next = this.optionsToDisplay();
      if (Array.isArray(next) && next.length) {
        // Skip rebuild if the option set is the same as the current bindings
        // (e.g. parent re-emit after a click). Rebuilding here would wipe
        // the highlight state we just set in onOptionClicked.
        const currentBindings = this.optionBindings();
        const sameSet =
          currentBindings?.length === next.length &&
          currentBindings.every((b, i) => {
            const a = b.option;
            const n = next[i];
            return (a?.optionId != null && a.optionId === n?.optionId) ||
              (a?.text && a.text === n?.text);
          });
        if (sameSet) {
          this.cdRef.markForCheck();
          return;
        }
        this.optionBindingsSource = next.map((o: Option) => ({ ...o }));
        this.optionBindings.set(this.rebuildOptionBindings(this.optionBindingsSource));
        this.renderReady = true;
        this.syncOptionsWithSelections();
        this.cdRef.markForCheck();
      } else {
        this.optionBindingsSource = [];
        this.optionBindings.set([]);
      }
    });
  }

  override async ngOnInit(): Promise<void> {
    await this.initializeAnswerConfig();
    await this.initializeSharedOptionConfig();

    // Guard against the first render missing its options because the
    // options stream may not have emitted yet when the template binds.
    if (this.optionsToDisplay()?.length) {
      this.applyIncomingOptions(this.optionsToDisplay());
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

        this.type.set(correctCount > 1 ? 'multiple' : 'single');

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
        // Skip empty arrays to prevent BehaviorSubject initial emission
        // from clearing valid options that may have arrived via @Input
        if (!opts?.length) {
          return;
        }

        this.incomingOptions = this.normalizeOptions(structuredClone(opts));

        //  Clear prior icons and bindings (clean slate)
        this.optionBindings.set([]);
        this.renderReady = false;

        // Apply options synchronously (removed Promise.resolve to fix StackBlitz timing)
        this.applyIncomingOptions(this.incomingOptions, {
          resetSelection: false
        });
      });
  }

  override async ngOnChanges(_changes: SimpleChanges): Promise<void> {
    // Signal-input reactions are handled via effect() in the constructor.
  }

  ngAfterViewInit(): void {
    if (this.viewContainerRefs) {
      this.viewContainerRefs?.changes.subscribe((refs) => {
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
    const nextOptions =
      normalized.map((option: Option) => ({ ...option }));

    if (config.resetSelection ?? true) this.resetSelectionState();

    // Recalculate type from the incoming options' correct flags.
    // Without this, navigating from a multi-answer question (e.g. Q4) to a
    // single-answer question (e.g. Q5) would leave type='multiple', causing
    // SOC to render checkboxes and use multi-answer interaction logic.
    const correctCount =
      nextOptions.filter(o =>
        o.correct === true || (o as any).correct === 'true' || (o as any).correct === 1
    ).length;
    this.type.set(correctCount > 1 ? 'multiple' : 'single');

    this.optionsToDisplay.set(nextOptions);
    this.optionBindingsSource =
      nextOptions.map((option) => ({ ...option }));

    if (this.sharedOptionConfig) {
      this.sharedOptionConfig = {
        ...this.sharedOptionConfig,
        type: this.type(),
        optionsToDisplay: nextOptions.map((option: Option) => ({ ...option }))
      };
    }

    this.optionBindings.set(this.rebuildOptionBindings(this.optionBindingsSource));
    this.renderReady = true;
    this.syncOptionsWithSelections();
    this.cdRef.markForCheck();
  }

  /**
   * Hydrates the local 'optionsToDisplay' or Input options with state 
   * from the SelectedOptionService.
   */
  private syncOptionsWithSelections(): void {
    const idx = this.currentQuestionIndex();
    if (idx === null || idx === undefined || idx < 0) {
      return;
    }

    const savedSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
    if (!savedSelections.length || !this.optionsToDisplay()?.length) {
      return;
    }

    const savedIds = new Set(savedSelections.map(s => String(s.optionId)));
    const savedTexts = new Set(savedSelections.map(s => (s.text || '').trim().toLowerCase()));

    // For multi-answer: do NOT pre-select/highlight all saved options.
    // Each option should highlight individually on click, not all at once.
    const isMulti = this.type() === 'multiple';

    for (const opt of this.optionsToDisplay()) {
      if (isMulti) {
        opt.selected = false;
      } else {
        const idMatch = opt.optionId != null && savedIds.has(String(opt.optionId));
        const textMatch =
          !!(opt.text && savedTexts.has(opt.text.trim().toLowerCase()));
        opt.selected = idMatch || textMatch;
      }
    }

    // Also update bindings — mutate ALL visual fields and re-emit so the
    // signal consumers (option-item) re-render the highlight state.
    const currentBindings = this.optionBindings();
    if (currentBindings?.length) {
      const updated = currentBindings.map(b => {
        const id = b.option?.optionId;
        const text = b.option?.text;
        const idMatch = id != null && savedIds.has(String(id));
        const textMatch = !!(text && savedTexts.has((text || '').trim().toLowerCase()));
        const isSel = isMulti ? false : (idMatch || textMatch);
        const newOpt = {
          ...b.option,
          selected: isSel,
          highlight: isSel,
          showIcon: isSel
        };
        return {
          ...b,
          option: newOpt,
          isSelected: isSel,
          highlight: isSel,
          checked: isSel,
          showFeedback: true
        } as OptionBindings;
      });
      this.optionBindings.set(updated);
    }

    // Update FormGroup for single-answer (radio group sync)
    if (this.type() === 'single' && this.form()) {
      const selectedId = savedSelections[0]?.optionId;
      if (selectedId != null) {
        this.form().patchValue({ selectedOptionId: selectedId }, { emitEvent: false });
      }
    }
  }

  private handleViewContainerRef(): void {
    if (this.hasComponentLoaded) {
      return;
    }

    if (this.viewContainerRefs && this.viewContainerRefs.length > 0) {
      // Assign the first available ViewContainerRef
      this.viewContainerRef = this.viewContainerRefs.first;
      this.loadQuizQuestionComponent();
      this.hasComponentLoaded = true;  // prevent further attempts to load
    } else {
    }
  }

  private loadQuizQuestionComponent(): void {
    if (this.hasComponentLoaded) {
      return;
    }

    // Ensure that the current component container is cleared before loading a new one
    if (this.viewContainerRef) {
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
          this.type.set(isMultipleAnswer ? 'multiple' : 'single');
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
      this.sharedOptionConfig.type = this.type();
    } else {
      console.error('Failed to initialize sharedOptionConfig in AnswerComponent');
    }
  }

  public override async initializeSharedOptionConfig(): Promise<void> {
    await super.initializeSharedOptionConfig();
    if (this.sharedOptionConfig) {
      this.sharedOptionConfig.type = this.type();
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
      typeof this.currentQuestionIndex() === 'number'
        ? this.currentQuestionIndex()
        : 0;

    const getEffectiveId =
      (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const targetKey = getEffectiveId(rawOption, payload.index);

    const canonical =
      this.optionsToDisplay()?.find(
        (opt: Option, i: number) => getEffectiveId(opt, i) === targetKey
      ) ?? rawOption;

    // Robust correctness check (matches SelectedOptionService)
    const isCorrectValue =
      (o: any) => o && (o.correct === true || String(o.correct) === 'true' ||
        o.correct === 1 || o.correct === '1');

    const enrichedOption: SelectedOption = {
      ...canonical,
      optionId: targetKey,
      text: canonical.text,
      correct: isCorrectValue(canonical),
      questionIndex: activeQuestionIndex,
      displayIndex: payload.index,
      selected: wasChecked,
      highlight: wasChecked,
      showIcon: wasChecked
    } as any;

    // INTERNAL STATE UPDATE
    if (this.type() === 'single') {
      this.selectedOption = enrichedOption;
      this.selectedOptions = [enrichedOption];
    } else {
      this.selectedOptions ??= [];

      const i = this.selectedOptions.findIndex(
        (o: any) => getEffectiveId(o, (o as any).displayIndex ??
        (o as any).index) === targetKey
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
    const question = serviceQuestion ?? this.questionData();

    if (!question) {
      console.error(
        '[AC][INVARIANT] Missing question for index', activeQuestionIndex,
        'ServiceQuestionsLength:', this.quizService.questions?.length
      );
      return;
    }

    if (!serviceQuestion) {
    }

    const optionsSource =
      this.optionsToDisplay()?.length ? this.optionsToDisplay() : question.options;
    const correctCount =
      optionsSource?.filter((o: any) => o.correct === true || String(o.correct) === 'true').length ?? 0;
    const isMultiAnswer =
      this.type() === 'multiple' || question.type === QuestionType.MultipleAnswer || correctCount > 1;

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
    if (this.questionIndex == null) {
      return;
    }

    const allSelected =
      this.selectedOptionService.getSelectedOptionsForQuestion(this.questionIndex()!);

    const complete =
      this.selectedOptionService.isQuestionComplete(question, allSelected);

    this._wasComplete = complete;

    // MULTI-ANSWER SCORING: Score when ALL correct answers have been selected
    // Uses this.selectedOptions (local state with correct flags) — NOT the service map,
    // which may lose the correct flag during canonicalization or use a different index key.
    if (isMultiAnswer && this.selectedOptions?.length > 0) {
      const isCorrect = (o: any) => {
        const c = o?.correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      };

      const totalCorrectInQuestion = optionsSource.filter(isCorrect).length;
      const correctSelectedCount = this.selectedOptions.filter(isCorrect).length;

      if (correctSelectedCount === totalCorrectInQuestion && totalCorrectInQuestion > 0) {
        this.quizService.scoreDirectly(activeQuestionIndex, true, true);
        this.quizStateService.setAnswerSelected(true);
      } else {
        this.quizStateService.setAnswerSelected(complete);
      }
    } else {
      // Mark answered ONLY when invariant is satisfied
      this.quizStateService.setAnswerSelected(complete);
    }

    // VISUAL HIGHLIGHTING UPDATE: mutate bindings so the clicked option
    // (and previously selected ones in multi-mode) reflect selection state.
    const currentBindings = this.optionBindings();
    if (currentBindings?.length) {
      const isSingle = this.type() === 'single';
      // Single-answer questions only allow one selection — once any option
      // is clicked, disable all other options so they grey out.
      const disableOthers = isSingle && enrichedOption.selected === true;
      const updated = currentBindings.map((b, i) => {
        const bId = getEffectiveId(b.option, i);
        const matches = bId === targetKey;
        if (matches) {
          const newOpt = {
            ...b.option,
            selected: enrichedOption.selected,
            highlight: enrichedOption.selected,
            showIcon: enrichedOption.selected
          };
          return {
            ...b,
            option: newOpt,
            isSelected: enrichedOption.selected === true,
            highlight: enrichedOption.selected === true,
            checked: enrichedOption.selected === true,
            showFeedback: true,
            disabled: false
          } as OptionBindings;
        }
        if (isSingle) {
          // Deselect all others in single mode; grey them if an option was selected.
          // Keep correct options enabled so the user can still click the right answer.
          const isThisOptCorrect = b.option?.correct === true || String(b.option?.correct) === 'true';
          const newOpt = { ...b.option, selected: false, highlight: false, showIcon: false };
          return {
            ...b,
            option: newOpt,
            isSelected: false,
            highlight: false,
            checked: false,
            disabled: (disableOthers && !isThisOptCorrect) ? true : b.disabled
          } as OptionBindings;
        }
        return b;
      });
      this.optionBindings.set(updated);
      this.cdRef.markForCheck();
    }

    // SET DOT STATUS EARLY — before emitting, so updateDotStatus sees the correct value
    if (enrichedOption.selected === true && activeQuestionIndex != null) {
      const dotStatus = enrichedOption.correct ? 'correct' : 'wrong';
      this.selectedOptionService.clickConfirmedDotStatus.set(activeQuestionIndex, dotStatus);
      this.selectedOptionService.lastClickedCorrectByQuestion.set(activeQuestionIndex, !!enrichedOption.correct);
      try {
        sessionStorage.setItem('dot_confirmed_' + activeQuestionIndex, dotStatus);
      } catch {}
    }

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
    if (!opt?.length) {
      this.optionBindings.set([]);
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

    // Set renderReady synchronously instead of in microtask to avoid race
    // condition where template checks renderReady before Promise resolves
    this.optionBindings.set(rebuilt);
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
      appHighlightInputType: 'radio',  // satisfies the union type
      allOptions: [],  // will be replaced below
      appHighlightReset: false,
      ariaLabel: `Option ${idx + 1}`,
      appResetBackground: false,
      optionsToDisplay: [],  // will be replaced below
      checked: !!opt.selected,
      change: () => { },
      active: true
    } as OptionBindings;
  }

  override async loadDynamicComponent(
    _question: QuizQuestion,
    _options: Option[],
    _questionIndex: number
  ): Promise<void> {
    // AnswerComponent doesn't load dynamic children, so we
    // simply fulfill the contract and return a resolved promise.
    return;
    // If the base implementation does something essential, call:
    // return super.loadDynamicComponent(_question, _options, _questionIndex);
  }
}