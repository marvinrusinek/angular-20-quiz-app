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

  private _wasSelected = false;

  // inputs removed in favor of OptionBindings snapshot


  // ✅ ONE output
  @Output() optionUI = new EventEmitter<OptionUIEvent>();

  constructor(
    private optionService: OptionService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['b']) {
      // Keep this flag in sync with the current binding.
      // Using a sticky value here leaks a previous question's state into
      // reused option-item instances (trackBy reuses components by optionId),
      // which can incorrectly style later questions.
      this._wasSelected = !!this.b?.isSelected;
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground) {
      this._wasSelected = false;
    }
  }

  private get optionId(): number {
    return Number(this.b?.option?.optionId ?? -1);
  }

  private get inputType(): 'radio' | 'checkbox' {
    return this.type === 'multiple' ? 'checkbox' : 'radio';
  }

  getOptionDisplayText(): string {
    return this.optionService.getOptionDisplayText(this.b.option, this.i);
  }

  getOptionIcon(option?: any, i?: number): string {
    if (this.shouldShowFeedback()) {
      return this.b.option.correct ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };

    const qIndex = this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    // Authoritative check matches OptionUiSyncService logic: id or index
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      s.optionId === effectiveId ||
      (s as any).index === this.i ||
      s.text === this.b.option.text
    );

    const showSelectionState =
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      isActuallySelectedFromService ||
      this._wasSelected;

    if (showSelectionState) {
      const isCorrect =
        this.b.option?.correct === true ||
        String(this.b.option?.correct) === 'true' ||
        this.b.isCorrect === true;
      if (isCorrect) {
        classes['correct-option'] = true;
      } else {
        classes['incorrect-option'] = true;
      }
    }

    return classes;
  }

  /**
   * Directly compute the background color for this option.
   * Returns green for correct selected, red for incorrect selected, null otherwise.
   * This is the most reliable highlighting mechanism as it uses Angular's
   * native style binding, bypassing CSS class specificity and directive timing issues.
   */
  getOptionBackgroundColor(): string | null {
    const qIndex = this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    // Authoritative check matches OptionUiSyncService logic: id or index
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      s.optionId === effectiveId ||
      (s as any).index === this.i ||
      s.text === this.b.option.text
    );

    const showSelectionState =
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      isActuallySelectedFromService ||
      this._wasSelected;

    if (!showSelectionState) {
      return null;  // let the default CSS handle it
    }

    const isCorrect =
      this.b.option?.correct === true ||
      String(this.b.option?.correct) === 'true' ||
      this.b.isCorrect === true;

    // Use same colors as SCSS for consistency
    const color = isCorrect ? '#43e756' : '#ff0000';
    return color;
  }

  getOptionCursor(): string {
    return this.b.optionCursor || 'default';
  }

  isDisabled(): boolean {
    return !!this.b.disabled;
  }

  shouldShowIcon(option?: any, i?: number): boolean {
    const showStandard = !!(option?.showIcon ?? this.b.option.showIcon);
    const showFeedback = this.shouldShowFeedback();
    return showStandard || showFeedback;
  }

  isPreviousSelection(): boolean {
    // Show feedback for ANY option that was selected (correct or incorrect)
    return this._wasSelected;
  }

  shouldShowFeedback(): boolean {
    const fromConfig = !!this.feedbackConfig?.showFeedback;
    const fromBinding = !!(
      this.b.showFeedback ||
      (this.b.showFeedbackForOption && this.b.showFeedbackForOption[this.optionId])
    );
    const fromHighlight = this.b.highlightCorrect || this.b.highlightIncorrect;
    const fromLocked = this.b.disabled && this.b.isSelected;
    return fromConfig || fromBinding || fromHighlight || fromLocked || this.isPreviousSelection();
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
}
