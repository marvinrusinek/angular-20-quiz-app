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
    if (changes['b']) {
      // Keep this flag in sync with the current binding.
      // Using a sticky value here leaks a previous question's state into
      // reused option-item instances (trackBy reuses components by optionId),
      // which can incorrectly style later questions.
      this._wasSelected = !!this.b?.isSelected;
    }

    if (changes['currentQuestionIndex']) {
      const nextQuestionIndex = Number(this.currentQuestionIndex ?? -1);
      if (Number.isFinite(nextQuestionIndex) && nextQuestionIndex !== this._lastQuestionIndex) {
        this._wasSelected = !!this.b?.isSelected;
        this._lastQuestionIndex = nextQuestionIndex;
      }
    }

    if (changes['shouldResetBackground'] && this.shouldResetBackground) {
      this._wasSelected = false;
    }

    if (this.isSelectedForCurrentQuestion()) {
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

  getOptionIcon(option?: any, i?: number): string {
    if (this.shouldShowFeedback()) {
      return this.b.option.correct ? 'check' : 'close';
    }
    return this.b.optionIcon || '';
  }

  getOptionClasses(): { [key: string]: boolean } {
    const classes = { ...this.b.cssClasses };
    const qIndex = this.currentQuestionIndex ?? this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    // Authoritative check matches OptionUiSyncService logic: id or index
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
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

  getOptionBackgroundColor(): string | null {
    const qIndex = this.currentQuestionIndex ?? this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    const isActuallySelectedFromService = selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    );

    const isActivelySelected =
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      this._wasSelected ||
      !!this.b.showFeedbackForOption?.[this.optionId] ||
      isActuallySelectedFromService;

    // DEBUG HIGHLIGHT TRACE:
    /* if (this.b.isSelected) {
      console.warn(`[OptionItem] getOptionBackgroundColor isActivelySelected: ID ${this.optionId} correct? ${this.b.option.correct} isActivelySelected eval: ${isActivelySelected}`); */
    if (!isActivelySelected) {
      return null;
    }
    
    const isCorrect =
      this.b.option?.correct === true ||
      String(this.b.option?.correct) === 'true' ||
      this.b.isCorrect === true;

    return isCorrect ? '#43e756' : '#ff0000'; // Green if correct, Red if incorrect
  }

  shouldShowFeedback(): boolean {
    const fromBindingMap = !!(this.b.showFeedbackForOption && this.b.showFeedbackForOption[this.optionId]);
    const fromHighlight = this.b.highlightCorrect || this.b.highlightIncorrect;
    const fromLocked = !!(this.b.disabled && this.b.isSelected);
    
    return fromBindingMap || fromHighlight || fromLocked || this.isPreviousSelection();
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

  private shouldHighlightOption(): boolean {
    return (
      this.b.isSelected ||
      this.b.checked === true ||
      this.b.option?.selected === true ||
      this.b.option?.highlight === true ||
      this.b.highlightCorrect ||
      this.b.highlightIncorrect ||
      this.isSelectedForCurrentQuestion() ||
      this._wasSelected ||
      !!this.b.showFeedbackForOption?.[this.optionId]
    );
  }

  private isSelectedForCurrentQuestion(): boolean {
    const qIndex = this.quizService.currentQuestionIndex;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    const effectiveId = (this.b.option.optionId != null && this.b.option.optionId !== -1)
      ? this.b.option.optionId
      : this.i;

    return selections.some(s =>
      (s.optionId != null && effectiveId != null && (s.optionId == effectiveId || String(s.optionId) === String(effectiveId))) ||
      ((s as any).index != null && (s as any).index === this.i) ||
      (s.text && s.text === this.b.option.text)
    );
  }
}
