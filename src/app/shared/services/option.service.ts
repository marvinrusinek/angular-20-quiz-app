import { Injectable } from '@angular/core';
import { Option } from '../models/Option.model';
import { OptionBindings } from '../models/OptionBindings.model';
import { QuestionType } from '../models/question-type.enum';
import { SharedOptionConfig } from '../models/SharedOptionConfig.model';
import { SelectedOption } from '../models/SelectedOption.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { FeedbackProps } from '../models/FeedbackProps.model';

@Injectable({
  providedIn: 'root'
})
export class OptionService {
  /**
   * Use the same key shape everywhere (STRING so we don't lose non-numeric ids)
   * Stable per-row key: prefer numeric optionId; fallback to stableKey + index
   */
  keyOf(o: Option, i: number): string {
    return (o && o.optionId != null) ? String(o.optionId) : `opt-${i}`;
  }

  /**
   * Returns display text for an option, allowing for custom formatting if needed
   */
  getOptionDisplayText(option: Option, idx: number): string {
    return `${idx + 1}. ${option.text || ''}`;
  }

  /**
   * Returns the icon to display for an option based on its state
   */
  getOptionIcon(option: Option, i: number): string {
    if (option.showIcon === false) { return ''; }
    
    if (option.correct) {
      return 'check';
    }
    if (option.selected && !option.correct) {
      return 'close';
    }
    return '';
  }

  /**
   * Returns CSS classes for an option based on its bindings and state
   */
  getOptionClasses(
    binding: OptionBindings, 
    highlightedOptionIds: Set<number>,
    flashDisabledSet: Set<number>,
    isLocked: boolean = false,
    timerExpiredForQuestion: boolean = false
  ): { [key: string]: boolean } {
    const option = binding.option;
    const optId = option.optionId ?? -1;
    const isSelected = binding.isSelected || option.selected;
    // const isCorrect = option.correct; // Logic in original was more complex for correct-option

    // Replicate logic for showing correct status (e.g. timeout)
    // Note: timeoutCorrectOptionKeys logic was in component, need to approximate or pass it in?
    // For now, assume if timerExpiredForQuestion is true, we might show correct.
    // Original: 
    // const showCorrectOnTimeout = this.timerExpiredForQuestion && (this.timeoutCorrectOptionKeys.has(optionKey) || !!option.correct);
    
    // We will assume simpler logic or that option.correct is trustworthy here if timer expired
    const showCorrectOnTimeout = timerExpiredForQuestion && !!option.correct;

    const showAsSelected = isSelected; // Simplified for service, caller handles syncing

    return {
      'selected': !!isSelected, // Kept for compatibility if used
      'selected-option': !!isSelected, // RESTORED: Needed for SCSS styling
      'correct-option': (showAsSelected && !!option.correct) || showCorrectOnTimeout,
      'incorrect-option': !!(showAsSelected && !option.correct),
      'highlighted': highlightedOptionIds.has(optId),
      'flash-red': flashDisabledSet.has(optId), // Match original 'flash-red'
      'disabled-option': !!binding.disabled,     // Match original 'disabled-option'
      'locked-option': isLocked && !binding.disabled // Match original 'locked-option'
    };
  }

  /**
   * Returns cursor style for option - 'not-allowed' for disabled/incorrect
   * options or when timer expired
   */
  getOptionCursor(
    binding: OptionBindings, 
    index: number,
    isDisabled: boolean,
    timerExpiredForQuestion: boolean
  ): string {
    if (isDisabled || timerExpiredForQuestion) {
      return 'not-allowed';
    }
    return 'pointer';
  }

  /**
   * Decide if an option should be disabled based on various rules
   */
  isDisabled(
    binding: OptionBindings, 
    idx: number,
    disabledOptionsPerQuestion: Map<number, Set<number>>,
    currentQuestionIndex: number,
    forceDisableAll: boolean,
    timerExpiredForQuestion: boolean,
    isLocked: boolean
  ): boolean {
    if (forceDisableAll || timerExpiredForQuestion || isLocked) {
      return true;
    }

    const disabledSet = disabledOptionsPerQuestion.get(currentQuestionIndex);
    if (disabledSet && binding.option.optionId != null && disabledSet.has(binding.option.optionId)) {
      return true;
    }

    return !!binding.disabled;
  }

  /**
   * Determines if an option is locked (e.g., after a correct selection in single mode)
   */
  isLocked(
    binding: OptionBindings, 
    index: number,
    shouldLockIncorrectOptions: boolean,
    lockedIncorrectOptionIds: Set<number>
  ): boolean {
    if (!shouldLockIncorrectOptions) {
      return false;
    }

    // If it's incorrect and we're locking incorrect options, it's locked
    if (binding.option.correct === false) {
      return true;
    }

    // Also check if this specific ID was explicitly locked
    if (binding.option.optionId != null && lockedIncorrectOptionIds.has(binding.option.optionId)) {
      return true;
    }

    return false;
  }
}
