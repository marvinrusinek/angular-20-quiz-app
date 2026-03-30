import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionType } from '../../models/question-type.enum';
import { SelectedOption } from '../../models/SelectedOption.model';
import { OptionBindings } from '../../models/OptionBindings.model';
import { FeedbackProps } from '../../models/FeedbackProps.model';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from './selection-message.service';
import { FeedbackConfig } from '../../../components/question/quiz-question/quiz-question.component';

/**
 * Manages feedback display, option highlighting, and disable logic for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcFeedbackManagerService {

  constructor(
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) {}

  /**
   * Restores feedback state for all options based on correctness.
   */
  restoreFeedbackState(
    currentQuestion: QuizQuestion | null,
    optionsToDisplay: Option[],
    correctMessage: string
  ): Option[] {
    if (!currentQuestion || !optionsToDisplay.length) {
      console.warn(
        '[restoreFeedbackState] Missing current question or options to display.'
      );
      return optionsToDisplay;
    }

    try {
      return optionsToDisplay.map((option) => ({
        ...option,
        active: true,
        feedback: option.feedback || this.generateFeedbackForOption(option, correctMessage),
        showIcon: option.correct || option.showIcon,
        selected: option.selected ?? false,
      }));
    } catch (error) {
      console.error(
        '[restoreFeedbackState] Error restoring feedback state:',
        error
      );
      return optionsToDisplay;
    }
  }

  /**
   * Generates feedback text for a single option.
   */
  generateFeedbackForOption(option: Option, correctMessage: string): string {
    if (option.correct) {
      return correctMessage || 'Correct answer!';
    } else {
      return option.feedback || 'No feedback available.';
    }
  }

  /**
   * Updates highlight state for all options based on whether all correct answers are selected.
   */
  async updateOptionHighlightState(
    currentQuestion: QuizQuestion | null,
    selectedIndices: Set<number>
  ): Promise<void> {
    if (
      !currentQuestion ||
      !Array.isArray(currentQuestion.options)
    ) {
      console.warn('[updateOptionHighlightState] No valid question or options available.');
      return;
    }

    const allCorrectSelected = this.selectedOptionService.areAllCorrectAnswersSelected(
      currentQuestion,
      selectedIndices
    );

    for (const opt of currentQuestion.options) {
      opt.highlight = !opt.correct && allCorrectSelected;
    }
  }

  /**
   * Deactivates incorrect options after all correct answers are selected.
   */
  deactivateIncorrectOptions(
    allCorrectSelected: boolean,
    currentQuestion: QuizQuestion | null,
    selectedIndices: Set<number>
  ): Option[] | null {
    if (!allCorrectSelected) {
      console.log('No action taken. Not all correct answers selected yet.');
      return null;
    }

    if (currentQuestion?.options?.length) {
      for (const opt of currentQuestion.options) {
        if (!opt.correct) {
          opt.selected = false;
          opt.highlight = true;
          opt.active = false;
        } else {
          opt.active = true;
        }
      }

      const updatedOptions = [...currentQuestion.options];
      this.updateOptionHighlightState(currentQuestion, selectedIndices);
      return updatedOptions;
    } else {
      console.warn(
        '[deactivateIncorrectOptions] No options available to deactivate.'
      );
      return null;
    }
  }

  /**
   * Disables incorrect options by marking them inactive.
   */
  disableIncorrectOptions(optionsToDisplay: Option[]): Option[] {
    if (!optionsToDisplay || optionsToDisplay.length === 0) {
      console.warn('No options available to disable.');
      return optionsToDisplay;
    }

    return optionsToDisplay.map((option) => ({
      ...option,
      active: option.correct,
      feedback: option.correct ? undefined : 'x',
      showIcon: true
    }));
  }

  /**
   * Updates highlighting, selected state, and feedback icons for options after a click.
   */
  updateOptionHighlighting(
    optionsToDisplay: Option[],
    selectedKeys: Set<string | number>,
    currentQuestionIndex: number,
    questionType: QuestionType | undefined
  ): Option[] {
    if (!optionsToDisplay) return optionsToDisplay;

    for (let idx = 0; idx < optionsToDisplay.length; idx++) {
      const opt = optionsToDisplay[idx];
      const stableId = this.selectionMessageService.stableKey(opt, idx);
      const isSelected = selectedKeys.has(stableId);

      opt.selected = isSelected;

      const qIdx = currentQuestionIndex ?? 0;
      const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];
      const isMulti = questionType === QuestionType.MultipleAnswer;
      const isLastSelection = isSelected && selections.length > 0 &&
        (selections[selections.length - 1].optionId === opt.optionId || (selections[selections.length - 1] as any).index === idx);

      let shouldHighlight = isSelected;
      if (isMulti && opt.correct) {
        shouldHighlight = isLastSelection;
      }

      if (opt.correct) {
        opt.styleClass = shouldHighlight ? 'highlight-correct' : '';
        opt.showIcon = isSelected;
      } else {
        opt.styleClass = shouldHighlight ? 'highlight-incorrect' : '';
        opt.showIcon = isSelected;
      }
    }

    return optionsToDisplay;
  }

  /**
   * Reveals feedback for all options (used on timeout/completion).
   */
  revealFeedbackForAllOptions(
    canonicalOpts: Option[],
    feedbackConfigs: Record<number | string, FeedbackConfig>,
    showFeedbackForOption: { [optionId: number]: boolean }
  ): {
    feedbackConfigs: Record<number | string, FeedbackConfig>;
    showFeedbackForOption: { [optionId: number]: boolean };
  } {
    for (let i = 0; i < canonicalOpts.length; i++) {
      const o = canonicalOpts[i];

      const rawKey = o.optionId ?? this.selectionMessageService.stableKey(o, i);
      const key = Number(rawKey);

      if (!Number.isFinite(key)) {
        const sk = String(rawKey);
        feedbackConfigs[sk] = {
          ...(feedbackConfigs[sk] ?? {}),
          showFeedback: true,
          icon: o.correct ? 'check_circle' : 'cancel',
          isCorrect: !!o.correct
        };
        (showFeedbackForOption as any)[sk] = true;
        continue;
      }

      feedbackConfigs[key] = {
        ...(feedbackConfigs[key] ?? {}),
        showFeedback: true,
        icon: o.correct ? 'check_circle' : 'cancel',
        isCorrect: !!o.correct
      };
      showFeedbackForOption[key] = true;
    }

    return { feedbackConfigs, showFeedbackForOption };
  }

  /**
   * Marks the binding as selected and rebuilds selectedKeys from the service map.
   */
  markBindingSelected(
    opt: Option,
    currentQuestionIndex: number,
    optionBindings: OptionBindings[]
  ): OptionBindings | null {
    const currentSelected =
      this.selectedOptionService.selectedOptionsMap.get(currentQuestionIndex) ?? [];
    const selectedKeys = new Set(currentSelected.map(o => o.optionId));

    const b = optionBindings.find(x => x.option.optionId === opt.optionId);
    if (!b) return null;

    b.isSelected = selectedKeys.has(opt.optionId!);
    b.showFeedback = true;

    return b;
  }

  /**
   * Builds feedback config for a specific option row.
   */
  buildFeedbackConfigForOption(
    opt: Option,
    optionBindings: OptionBindings[],
    currentQuestion: QuizQuestion,
    existingConfigs: Record<number | string, FeedbackConfig>
  ): FeedbackProps {
    return {
      ...existingConfigs[opt.optionId!],
      showFeedback: true,
      selectedOption: opt,
      options: optionBindings.map((b) => b.option),
      question: currentQuestion,
      feedback: opt.feedback ?? '',
      idx:
        optionBindings.find((b) => b.option.optionId === opt.optionId)
          ?.index ?? 0,
      correctMessage: '',
    } as FeedbackProps;
  }

  /**
   * Resets the feedback-related state for a new question.
   */
  resetFeedbackForOption(optionId: number): { [optionId: number]: boolean } {
    return { [optionId]: true };
  }
}
