import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { ExplanationTextService } from './explanation-text.service';
import { TimerService } from './timer.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { FeedbackConfig } from '../../models/FeedbackConfig.model';

/**
 * Manages per-question reset, state clearing, and click guard resets for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcResetManagerService {

  constructor(
    private explanationTextService: ExplanationTextService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService
  ) {}

  /**
   * Resets all per-question state for a given index.
   * Returns the state values the component should apply.
   */
  resetPerQuestionState(params: {
    index: number;
    normalizeIndex: (idx: number) => number;
    formattedByIndex: Map<number, string>;
    clearSharedOptionForceDisable: () => void;
    resolveFormatted: (idx: number, opts: any) => void;
  }): {
    hasSelections: boolean;
    i0: number;
    feedbackConfigs: Record<number | string, FeedbackConfig>;
    lastFeedbackOptionId: number;
    showFeedbackForOption: { [optionId: number]: boolean };
    questionFresh: boolean;
    timedOut: boolean;
    timerStoppedForQuestion: boolean;
    lastAllCorrect: boolean;
    lastLoggedIndex: number;
    lastLoggedQuestionIndex: number;
    displayMode: 'question' | 'explanation';
    displayExplanation: boolean;
    explanationToDisplay: string;
    explanationOwnerIdx: number;
  } {
    const i0 = params.normalizeIndex(params.index);
    const existingSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(i0) ?? [];
    const hasSelections = existingSelections.length > 0;

    // Clear stale FET cache
    params.formattedByIndex.delete(i0);

    // Unlock & clear per-question selection/locks
    this.selectedOptionService.resetLocksForQuestion(i0);
    if (!hasSelections) {
      this.selectedOptionService.clearSelectionsForQuestion(i0);
    } else {
      this.selectedOptionService.republishFeedbackForQuestion(i0);
    }
    params.clearSharedOptionForceDisable();

    // Clear expiry guards
    this.timerService.resetTimerFlagsFor?.(i0);

    // Explanation & display mode
    if (hasSelections) {
      this.explanationTextService.setShouldDisplayExplanation(true);
      this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
      this.quizStateService.setAnswered(true);
      this.quizStateService.setAnswerSelected(true);
    } else {
      this.explanationTextService.unlockExplanation?.();
      this.explanationTextService.resetExplanationText();
      this.explanationTextService.setShouldDisplayExplanation(false);
      this.quizStateService.setDisplayState({ mode: 'question', answered: false });
      this.quizStateService.setAnswered(false);
      this.quizStateService.setAnswerSelected(false);
    }

    // Form state
    // (component handles this since it owns the FormGroup)

    // Prewarm explanation cache
    params.resolveFormatted(i0, { useCache: true, setCache: true });

    // Timer reset/restart
    this.timerService.stopTimer?.(undefined, { force: true });
    this.timerService.resetTimer();
    requestAnimationFrame(() =>
      this.timerService.startTimer(this.timerService.timePerQuestion, true)
    );

    // Build showFeedbackForOption from existing selections
    let showFeedbackForOption: { [optionId: number]: boolean } = {};
    if (hasSelections) {
      const feedbackMap = this.selectedOptionService.getFeedbackForQuestion(i0);
      showFeedbackForOption = { ...feedbackMap };
    }

    return {
      hasSelections,
      i0,
      feedbackConfigs: {},
      lastFeedbackOptionId: -1,
      showFeedbackForOption,
      questionFresh: true,
      timedOut: false,
      timerStoppedForQuestion: false,
      lastAllCorrect: false,
      lastLoggedIndex: -1,
      lastLoggedQuestionIndex: -1,
      displayMode: hasSelections ? 'explanation' : 'question',
      displayExplanation: hasSelections,
      explanationToDisplay: hasSelections ? '' : '', // component keeps or clears
      explanationOwnerIdx: hasSelections ? -1 : -1,
    };
  }

  /**
   * Resets feedback-related component state.
   */
  resetFeedback(): {
    correctMessage: string;
    showFeedback: boolean;
    selectedOption: null;
    showFeedbackForOption: { [optionId: number]: boolean };
  } {
    return {
      correctMessage: '',
      showFeedback: false,
      selectedOption: null,
      showFeedbackForOption: {},
    };
  }

  /**
   * Resets full component state including options and feedback.
   */
  resetState(): {
    selectedOption: null;
    options: Option[];
    areOptionsReadyToRender: boolean;
  } {
    this.selectedOptionService.clearOptions();

    return {
      selectedOption: null,
      options: [],
      areOptionsReadyToRender: false,
    };
  }

  /**
   * Clears selection state for all options in a question.
   */
  clearSelection(
    correctAnswers: number[] | undefined,
    currentQuestion: QuizQuestion | null
  ): void {
    if (correctAnswers && correctAnswers.length === 1) {
      if (currentQuestion && currentQuestion.options) {
        for (const option of currentQuestion.options) {
          option.selected = false;
          option.styleClass = '';
        }
      }
    }
  }

  /**
   * Clears option state (selections, icons) for a specific question index.
   */
  clearOptionStateForQuestion(
    index: number,
    optionsToDisplay: Option[]
  ): Option[] {
    this.selectedOptionService.clearSelectionsForQuestion(index);

    return optionsToDisplay?.map(opt => ({
      ...opt,
      selected: false,
      showIcon: false,
    })) ?? [];
  }

  /**
   * Restores selections and icons for a question from the service state.
   */
  restoreSelectionsAndIcons(
    index: number,
    optionsToDisplay: Option[]
  ): Option[] {
    const selectedOptions =
      this.selectedOptionService.getSelectedOptionsForQuestion(index);

    return optionsToDisplay?.map(opt => {
      const match = selectedOptions.find(
        (sel) => sel.optionId === opt.optionId
      );
      return {
        ...opt,
        selected: !!match,
        showIcon: !!match?.showIcon,
      };
    }) ?? [];
  }

  /**
   * Returns reset values for click guard state.
   */
  hardResetClickGuards(): {
    clickGate: boolean;
    waitingForReady: boolean;
    deferredClick: undefined;
    lastLoggedQuestionIndex: number;
    lastLoggedIndex: number;
  } {
    return {
      clickGate: false,
      waitingForReady: false,
      deferredClick: undefined,
      lastLoggedQuestionIndex: -1,
      lastLoggedIndex: -1,
    };
  }
}
