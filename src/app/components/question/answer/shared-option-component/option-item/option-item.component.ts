import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, ViewEncapsulation } from '@angular/core';
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
  animations: [correctAnswerAnim]
})
export class OptionItemComponent implements OnChanges {
  @Input() b!: OptionBindings;
  @Input() i!: number;
  @Input() type: 'single' | 'multiple' = 'single';
  @Input() form!: FormGroup;
  @Input() shouldResetBackground = false;
  @Input() feedbackConfig?: FeedbackProps;
  @Input() sharedOptionConfig!: SharedOptionConfig;
  @Input() currentQuestionIndex = 0;
  @Input() timerExpired = false;

  private _wasSelected = false;
  private _lastQuestionIndex = -1;

  // inputs removed in favor of OptionBindings snapshot


  // ✅ ONE output
  @Output() optionUI = new EventEmitter<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        this._wasSelected = false; // Full reset for new question
        this._lastQuestionIndex = nextQuestionIndex;
      }
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground) {
      this._wasSelected = false;
    }

    // Sticky: once selected, stays highlighted for the rest of the question.
    // Only goes true when the BINDING says selected (set by click handler).
    if (this.b?.isSelected) {
      this._wasSelected = true;
    }
  }

  get optionId(): number {
    return (this.b?.option?.optionId != null && this.b.option.optionId !== -1)
      ? Number(this.b.option.optionId)
      : this.i;
  }

  private get inputType(): 'radio' | 'checkbox' {
    return this.type === 'multiple' ? 'checkbox' : 'radio';
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

    if (this.timerExpired) {
      if (this.shouldShowCorrectOnTimeout()) {
        classes['correct-option'] = true;
      }
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
    }

    return classes;
  }

  getOptionCursor(): string {
    return this.b.optionCursor || 'default';
  }

  isDisabled(): boolean {
    return !!this.b.disabled;
  }

  shouldShowIcon(option?: any, i?: number): boolean {
    if (this.timerExpired) {
      return this.shouldShowCorrectOnTimeout();
    }

    // Always show icon if the option should be highlighted
    return this.shouldHighlightOption();
  }

  shouldShowCorrectOnTimeout(): boolean {
    if (!this.timerExpired) {
      return false;
    }

    // When the timer expires, we want to reveal ALL correct answers
    // regardless of whether they were flagged for icons or highlighted before.
    return this.isOptionCorrect();
  }

  isPreviousSelection(): boolean {
    // Show feedback for ANY option that was selected (correct or incorrect)
    return this._wasSelected;
  }

  getOptionBackgroundColor(): string | null {
    if (this.timerExpired) {
      return this.shouldShowCorrectOnTimeout() ? '#43e756' : null;
    }

    if (!this.shouldHighlightOption()) {
      return null;
    }

    return this.isOptionCorrect() ? '#43e756' : '#ff0000'; // Green if correct, Red if incorrect
  }

  private getSelectionsForCurrentBinding(): any[] {
    const qIndex = this.currentQuestionIndex ?? this.quizService.currentQuestionIndex;
    return this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
  }

  private matchesBindingSelection(sel: any): boolean {
    const qIndex = this.currentQuestionIndex ?? this.quizService.currentQuestionIndex;
    const selQIdx = sel.questionIndex ?? (sel as any).qIdx ?? (sel as any).questionIdx;

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

  private hasAnsweredCurrentQuestion(selections: any[]): boolean {
    const fromSelectionService = (selections?.length ?? 0) > 0;
    const fromFeedbackMap = Object.values(this.b?.showFeedbackForOption ?? {}).some(Boolean);
    const fromBindingFlags =
      this.b?.showFeedback === true ||
      this.b?.isSelected === true ||
      this.b?.checked === true ||
      this.b?.highlightCorrect === true ||
      this.b?.highlightIncorrect === true ||
      this.b?.option?.selected === true ||
      this.b?.option?.highlight === true ||
      this._wasSelected;
    const fromAllOptions = (this.b?.allOptions ?? []).some(o => o?.selected === true || o?.highlight === true);

    return fromSelectionService || fromFeedbackMap || fromBindingFlags || fromAllOptions;
  }

  shouldShowFeedback(): boolean {
    return this.shouldHighlightOption() || this.shouldShowCorrectOnTimeout();
  }

  onChanged(event: any): void {
    // console.warn(`[OptionItem] onChanged fired! optionId: ${this.optionId}, isSelected: ${this.b.isSelected}`);
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'change',
      inputType: this.inputType,
      nativeEvent: event
    });
  }

  onInteraction(event: MouseEvent): void {
    this.optionUI.emit({
      optionId: this.optionId,
      displayIndex: this.i,
      kind: 'interaction',
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
    // For multi-answer: strictly trust ONLY the live isSelected binding.
    // The click handler (handleOptionClick) maintains b.isSelected = true for
    // ALL currently selected options via futureKeys, so _wasSelected is not
    // needed and would cause false positives when service rehydration briefly
    // marks all saved selections as selected before the user clicks.
    if (this.type === 'multiple') {
      return this.b.isSelected;
    }
    // Single-answer: isSelected (current) + option.highlight (history from click handler)
    return this.b.isSelected || !!this.b.option?.highlight;
  }

  private isOptionIndividuallySelected(): boolean {
    return (
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.isSelectedForCurrentQuestion()
    );
  }

  private isSelectedForCurrentQuestion(): boolean {
    /* const qIndex = this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    return selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    ); */
    const selections = this.getSelectionsForCurrentBinding();
    return selections.some((s: any) => this.matchesBindingSelection(s));
  }
}