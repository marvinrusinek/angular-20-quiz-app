import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, ViewEncapsulation, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';

import { OptionBindings } from '../../../../../shared/models/OptionBindings.model';
import { FeedbackProps } from '../../../../../shared/models/FeedbackProps.model';
import { HighlightOptionDirective } from '../../../../../directives/highlight-option.directive';
import { SharedOptionConfigDirective } from '../../../../../directives/shared-option-config.directive';

import { correctAnswerAnim } from '../../../../../animations/animations';
import { OptionService } from '../../../../../shared/services/options/view/option.service';
import { SharedOptionConfig } from '../../../../../shared/models/SharedOptionConfig.model';
import { QuizService } from '../../../../../shared/services/data/quiz.service';
import { SelectedOptionService } from '../../../../../shared/services/state/selectedoption.service';
import { SelectionMessageService } from '../../../../../shared/services/features/selection-message/selection-message.service';

export type OptionUIEventKind = 'change' | 'interaction' | 'contentClick';

export interface OptionUIEvent {
  optionId: number;
  displayIndex: number;
  kind: OptionUIEventKind;
  inputType: 'radio' | 'checkbox';
  nativeEvent: any;
}

@Component({
  selector: 'app-option-item',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule,
    MatIconModule,
    HighlightOptionDirective,
    SharedOptionConfigDirective
  ],
  templateUrl: './option-item.component.html',
  styleUrls: ['./option-item.component.scss'],
  encapsulation: ViewEncapsulation.None,
  animations: [correctAnswerAnim],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OptionItemComponent implements OnChanges {
  @Input() b!: OptionBindings;
  @Input() i!: number;
  readonly type = input<'single' | 'multiple'>('single');
  readonly form = input.required<FormGroup>();
  readonly shouldResetBackground = input(false);
  readonly feedbackConfig = input<FeedbackProps>();
  readonly sharedOptionConfig = input.required<SharedOptionConfig>();
  readonly currentQuestionIndex = input(0);
  readonly timerExpired = input(false);

  private _wasSelected = false;
  private _lastQuestionIndex = -1;

  // ONE output
  readonly optionUI = output<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex() ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        this._wasSelected = false;  // full reset for new question
        this._lastQuestionIndex = nextQuestionIndex;
      }
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground()) {
      this._wasSelected = false;
    }

    // Sticky: once selected, stays highlighted for the rest of the question.
    // Only goes true when the BINDING says selected (set by click handler).
    if (this.b?.isSelected) this._wasSelected = true;
  }

  get optionId(): number {
    return (this.b?.option?.optionId != null && this.b.option.optionId !== -1)
      ? Number(this.b.option.optionId)
      : this.i;
  }

  private get inputType(): 'radio' | 'checkbox' {
    return this.type() === 'multiple' ? 'checkbox' : 'radio';
  }

  getOptionDisplayText(): string {
    return this.optionService.getOptionDisplayText(this.b.option, this.i);
  }

  private isOptionCorrect(): boolean {
    const opt = this.b?.option as any;
    return (
      opt?.correct === true ||
      String(opt?.correct) === 'true' ||
      opt?.correct === 1 ||
      opt?.correct === '1' ||
      this.b?.isCorrect === true
    );
  }

  getOptionIcon(option?: any, i?: number): string {
    if (this.shouldShowFeedback() || this.shouldShowCorrectOnTimeout()) {
      return this.isOptionCorrect() ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };

    if (this.timerExpired()) {
      classes['correct-option'] = this.shouldShowCorrectOnTimeout();
      classes['incorrect-option'] = false;
      return classes;
    }

    const isCorrect = this.isOptionCorrect();
    const shouldHighlight = this.shouldHighlightOption();

    if (shouldHighlight) {
      if (isCorrect) {
        classes['correct-option'] = true;
        classes['incorrect-option'] = false;
      } else {
        classes['incorrect-option'] = true;
        classes['correct-option'] = false;
      }
    } else {
      // Explicitly clear all highlight classes to prevent stale cssClasses from leaking
      classes['correct-option'] = false;
      classes['incorrect-option'] = false;
      classes['highlighted'] = false;
      classes['selected'] = false;
      classes['selected-option'] = false;
    }

    return classes;
  }

  getOptionCursor(): string {
    return this.b.optionCursor || 'default';
  }

  isDisabled(): boolean {
    if (this.b?.disabled) return true;
    try {
      const qIdx = Number(this.currentQuestionIndex() ?? -1);
      const id = this.optionId;
      if (Number.isFinite(qIdx) && qIdx >= 0 && Number.isFinite(id)) {
        if (this.selectedOptionService.isOptionLocked(qIdx, id)) {
          return true;
        }
      }

      // SINGLE-ANSWER auto-lock via shared correct-lock set: when the user
      // has clicked the correct option, the orchestrator adds this index to
      // _singleAnswerCorrectLock. Disable any non-correct binding.
      if (this.selectionMessageService._singleAnswerCorrectLock?.has(qIdx)) {
        const myCorrect = this.b?.option?.correct === true ||
          String(this.b?.option?.correct) === 'true';
        if (!myCorrect) return true;
      }

    } catch {}
    return false;
  }

  shouldShowIcon(option?: any, i?: number): boolean {
    if (this.timerExpired()) {
      return this.shouldShowCorrectOnTimeout();
    }

    // Always show icon if the option should be highlighted
    return this.shouldHighlightOption();
  }

  shouldShowCorrectOnTimeout(): boolean {
    if (!this.timerExpired()) {
      return false;
    }

    // When the timer expires, reveal ALL correct answers regardless of whether
    // they were flagged for icons or highlighted before.
    return this.isOptionCorrect();
  }

  getOptionBackgroundColor(): string | null {
    if (this.timerExpired()) {
      return this.shouldShowCorrectOnTimeout() ? '#43e756' : null;
    }

    if (!this.shouldHighlightOption()) {
      return null;
    }

    // Green if correct, red if incorrect
    return this.isOptionCorrect() ? '#43e756' : '#ff0000';
  }

  private getSelectionsForCurrentBinding(): any[] {
    const qIndex = this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
    return this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
  }

  private matchesBindingSelection(sel: any): boolean {
    const qIndex =
      this.currentQuestionIndex() ?? this.quizService.currentQuestionIndex;
    const selQIdx =
      sel.questionIndex ?? (sel as any).qIdx ?? (sel as any).questionIdx;

    // Strict Question Context Check
    if (selQIdx !== undefined && selQIdx !== null && selQIdx !== -1) {
      if (Number(selQIdx) !== qIndex) {
        return false;
      }
    }

    const selectedIndexFallback = (sel as any)?.index ?? sel?.displayIndex ?? (sel as any)?.idx;
    const normalizedSelectedIndex =
      selectedIndexFallback != null && Number.isFinite(Number(selectedIndexFallback))
        ? Number(selectedIndexFallback)
        : null;

    return (normalizedSelectedIndex != null && normalizedSelectedIndex === this.i);
  }

  shouldShowFeedback(): boolean {
    return this.shouldHighlightOption() || this.shouldShowCorrectOnTimeout();
  }

  onChanged(event: any): void {
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'change',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  onContentClick(event: MouseEvent): void {
    event.stopPropagation();  // prevents double firing with parent (click)
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'contentClick',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  shouldHighlightOption(): boolean {
    // Multi-answer selections should immediately show their success/error state
    // on the first click, even before the full question is resolved.
    // _wasSelected keeps previously selected incorrect options highlighted (red)
    // even after forceDisableAll fires.
    if (this.type() === 'multiple') {
      return this.isOptionIndividuallySelected() || !!this.b.option?.highlight ||
        this._wasSelected;
    }
    // Single-answer: current selection + sticky history (previously clicked,
    // incorrect options stay highlighted red across subsequent clicks)
    return this.b.isSelected || !!this.b.option?.highlight || this._wasSelected;
  }

  private isOptionIndividuallySelected(): boolean {
    return (
      this.b.isSelected ||
      this.b.checked ||
      this.b.option?.selected === true ||
      this.isSelectedForCurrentQuestion()
    );
  }

  private isSelectedForCurrentQuestion(): boolean {
    const selections = this.getSelectionsForCurrentBinding();
    return selections.some((s: any) => this.matchesBindingSelection(s));
  }
}