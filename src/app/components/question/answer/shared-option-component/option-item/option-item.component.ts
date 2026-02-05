import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';

import { OptionBindings } from '../../../../../shared/models/OptionBindings.model';
import { FeedbackProps } from '../../../../../shared/models/FeedbackProps.model';
import { HighlightOptionDirective } from '../../../../../directives/highlight-option.directive';
import { SharedOptionConfigDirective } from '../../../../../directives/shared-option-config.directive';
import { FeedbackComponent } from '../../feedback/feedback.component';
import { correctAnswerAnim } from '../../../../../animations/animations';
import { OptionService } from '../../../../../shared/services/option.service';
import { SharedOptionConfig } from '../../../../../shared/models/SharedOptionConfig.model';

@Component({
  selector: 'app-option-item',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCheckboxModule,
    MatRadioModule,
    MatIconModule,
    FeedbackComponent,
    HighlightOptionDirective,
    SharedOptionConfigDirective
  ],
  templateUrl: './option-item.component.html',
  styleUrls: ['./option-item.component.scss', '../shared-option.component.scss'],
  encapsulation: ViewEncapsulation.None,
  animations: [correctAnswerAnim]
})
export class OptionItemComponent {
  @Input() b!: OptionBindings;
  @Input() i!: number;
  @Input() type: 'single' | 'multiple' = 'single';
  @Input() form!: FormGroup;
  @Input() shouldResetBackground = false;
  @Input() feedbackConfig?: FeedbackProps;
  @Input() sharedOptionConfig!: SharedOptionConfig;
  @Input() highlightedOptionIds: Set<number> = new Set();
  @Input() flashDisabledSet: Set<number> = new Set();
  @Input() forceDisableAll = false;
  @Input() timerExpiredForQuestion = false;
  @Input() isLocked = false;
  @Input() currentQuestionIndex = -1;
  @Input() disabledOptionsPerQuestion: Map<number, Set<number>> = new Map();

  @Output() optionChanged = new EventEmitter<{ b: OptionBindings; i: number; event: any }>();
  @Output() optionInteraction = new EventEmitter<{ b: OptionBindings; i: number; event: MouseEvent }>();
  @Output() contentClick = new EventEmitter<{ b: OptionBindings; i: number; event: MouseEvent }>();

  constructor(private optionService: OptionService) {}

  getOptionDisplayText(): string {
    return this.optionService.getOptionDisplayText(this.b.option, this.i);
  }

  getOptionIcon(): string {
    return this.optionService.getOptionIcon(this.b.option, this.i);
  }

  getOptionClasses(): { [key: string]: boolean } {
    return this.optionService.getOptionClasses(
      this.b, 
      this.highlightedOptionIds, 
      this.flashDisabledSet,
      this.isLocked,
      this.timerExpiredForQuestion
    );
  }

  getOptionCursor(): string {
    return this.optionService.getOptionCursor(this.b, this.i, this.isDisabled(), this.timerExpiredForQuestion);
  }

  isDisabled(): boolean {
    return this.optionService.isDisabled(
      this.b, 
      this.i, 
      this.disabledOptionsPerQuestion, 
      this.currentQuestionIndex, 
      this.forceDisableAll, 
      this.timerExpiredForQuestion,
      this.isLocked
    );
  }

  shouldShowIcon(): boolean {
    return !!this.b.option.showIcon;
  }

  shouldShowFeedback(): boolean {
    const fromConfig = !!this.feedbackConfig?.showFeedback;
    const fromBinding = !!(this.b.showFeedback || (this.b.showFeedbackForOption && this.b.showFeedbackForOption[this.b.option.optionId!]));
    return fromConfig || fromBinding;
  }

  onChanged(event: any): void {
    this.optionChanged.emit({ b: this.b, i: this.i, event });
  }

  onInteraction(event: MouseEvent): void {
    this.optionInteraction.emit({ b: this.b, i: this.i, event });
  }

  onContentClick(event: MouseEvent): void {
    this.contentClick.emit({ b: this.b, i: this.i, event });
  }
}
