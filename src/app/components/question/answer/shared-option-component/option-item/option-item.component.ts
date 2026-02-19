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

  constructor(private optionService: OptionService) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['b'] && this.b?.isSelected) {
      this._wasSelected = true;
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
    if (this._wasSelected) {
      if (this.b.option.correct) {
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
