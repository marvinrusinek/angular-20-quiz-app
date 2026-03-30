import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionType } from '../../models/question-type.enum';
import { QuestionState } from '../../models/QuestionState.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { QuizService } from '../data/quiz.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { TimerService } from './timer.service';
import { ExplanationTextService } from './explanation-text.service';
import { FeedbackService } from './feedback.service';

/**
 * Manages option selection logic, state transitions, and correctness evaluation for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcOptionSelectionService {

  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private feedbackService: FeedbackService
  ) {}

  /**
   * Handles single-answer lock logic.
   * Returns true if the click should be blocked (already selected).
   */
  handleSingleAnswerLock(isMultipleAnswer: boolean, isOptionSelected: boolean): boolean {
    if (!isMultipleAnswer && isOptionSelected) {
      console.log('Single-answer question: Option already selected. Skipping.');
      return true;
    }
    return false;
  }

  /**
   * Handles option add/remove based on checked state.
   */
  updateOptionSelection(
    event: { option: SelectedOption; checked: boolean; index?: number },
    option: SelectedOption,
    currentQuestionIndex: number
  ): void {
    if (!option) {
      console.error('Option is undefined, cannot update.');
      return;
    }

    if (option.optionId === undefined) {
      console.error('option.optionId is undefined:', option);
      option.optionId = event.index ?? -1;
    }

    if (event.checked) {
      this.selectedOptionService.addOption(currentQuestionIndex, option);
    } else {
      this.selectedOptionService.removeOption(
        currentQuestionIndex,
        option.optionId
      );
    }
  }

  /**
   * Resolves a stable option ID from the option or fallback index.
   */
  resolveStableOptionId(option: Option | null | undefined, fallbackIndex: number): number {
    if (option == null) return fallbackIndex;

    if (typeof option.optionId === 'number' && Number.isFinite(option.optionId)) {
      return option.optionId;
    }

    if (option.optionId != null) {
      const parsed = Number(option.optionId);
      if (Number.isFinite(parsed)) return parsed;
    }

    if (typeof (option as any).value === 'number' && Number.isFinite((option as any).value)) {
      return (option as any).value;
    }

    return fallbackIndex;
  }

  /**
   * Initializes or retrieves the question state for a given index.
   */
  initializeQuestionState(quizId: string, questionIndex: number): QuestionState {
    let questionState = this.quizStateService.getQuestionState(
      quizId,
      questionIndex
    );

    if (!questionState) {
      questionState = {
        isAnswered: false,
        numberOfCorrectAnswers: 0,
        selectedOptions: [],
        explanationDisplayed: false,
      };

      this.quizStateService.setQuestionState(quizId, questionIndex, questionState);
    } else {
      questionState.isAnswered = false;
    }

    return questionState;
  }

  /**
   * Marks a question as answered in the quiz state.
   */
  markQuestionAsAnswered(
    quizId: string,
    questionIndex: number,
    lastAllCorrect: boolean
  ): void {
    const questionState = this.quizStateService.getQuestionState(quizId, questionIndex);

    if (questionState) {
      questionState.isAnswered = true;
      questionState.explanationDisplayed = lastAllCorrect;

      this.quizStateService.setQuestionState(quizId, questionIndex, questionState);
    } else {
      console.error(
        `[markQuestionAsAnswered] Question state not found for Q${questionIndex}`
      );
    }

    if (!this.quizStateService.answeredSubject.value) {
      this.quizStateService.setAnswerSelected(true);
    }
  }

  /**
   * Builds a SelectedOption from a question's options array at the given index.
   */
  buildSelectedOption(
    question: QuizQuestion,
    index: number,
    currentQuestionIndex: number
  ): SelectedOption {
    const option = question.options[index];
    return {
      optionId: option.optionId,
      questionIndex: currentQuestionIndex,
      text: option.text,
      correct: option.correct ?? false,
      selected: true,
      highlight: true,
      showIcon: true
    };
  }

  /**
   * Updates selection state in the service and emits answered state.
   */
  processOptionSelectionAndUpdateState(
    question: QuizQuestion,
    index: number,
    currentQuestionIndex: number,
    isMultipleAnswer: boolean,
    isUserClickInProgress: boolean
  ): SelectedOption | null {
    if (!isUserClickInProgress) {
      console.warn('[processOptionSelectionAndUpdateState] skipped — no user click in progress');
      return null;
    }

    const selectedOption = this.buildSelectedOption(question, index, currentQuestionIndex);

    this.selectedOptionService.updateSelectionState(
      currentQuestionIndex,
      selectedOption,
      isMultipleAnswer
    );
    this.selectedOptionService.setOptionSelected(true);
    this.selectedOptionService.setAnsweredState(true);

    return selectedOption;
  }

  /**
   * Handles timer stop logic based on whether the answer is correct.
   */
  async stopTimerIfApplicable(
    isMultipleAnswer: boolean,
    option: SelectedOption,
    currentQuestion: QuizQuestion | null,
    currentQuestionIndex: number,
    selectedIndices: Set<number>
  ): Promise<void> {
    let stopTimer = false;

    try {
      if (isMultipleAnswer) {
        if (!currentQuestion || !Array.isArray(currentQuestion.options)) {
          console.warn(
            '[stopTimerIfApplicable] Invalid question or options for multiple-answer question.'
          );
          return;
        }

        const allCorrectSelected = this.selectedOptionService.areAllCorrectAnswersSelected(
          currentQuestion,
          selectedIndices
        );
        stopTimer = allCorrectSelected;
      } else {
        stopTimer = option.correct ?? false;
      }

      this.timerService.allowAuthoritativeStop();
      if (stopTimer) {
        const stopped = await this.timerService.attemptStopTimerForQuestion({
          questionIndex: currentQuestionIndex,
        });

        if (stopped) {
          this.timerService.isTimerRunning = false;
        } else {
          console.log('[stopTimerIfApplicable] Timer stop attempt rejected.');
        }
      } else {
        console.log('[stopTimerIfApplicable] Timer not stopped: Condition not met.');
      }
    } catch (error) {
      console.error('[stopTimerIfApplicable] Error in timer logic:', error);
    }
  }

  /**
   * Checks if the answer is correct and stops the timer if so.
   */
  async checkAndHandleCorrectAnswer(currentQuestionIndex: number): Promise<void> {
    const isCorrect = await this.quizService.checkIfAnsweredCorrectly();
    if (isCorrect) {
      this.timerService.attemptStopTimerForQuestion({
        questionIndex: currentQuestionIndex,
        onStop: () => {
          console.log('Correct answer selected!');
        },
      });
    }
  }

  /**
   * Resets state for transitioning to a new question.
   */
  resetStateForNewQuestion(): {
    showFeedbackForOption: { [optionId: number]: boolean };
    showFeedback: boolean;
    correctMessage: string;
    selectedOption: null;
    isOptionSelected: boolean;
  } {
    this.selectedOptionService.clearOptions();
    this.selectedOptionService.clearSelectedOption();
    this.selectedOptionService.setOptionSelected(false);

    return {
      showFeedbackForOption: {},
      showFeedback: false,
      correctMessage: '',
      selectedOption: null,
      isOptionSelected: false,
    };
  }

  /**
   * Handles correctness outcome after all correct check: timer stop, sound, next button.
   */
  async handleCorrectnessOutcome(params: {
    allCorrectSelected: boolean;
    option: SelectedOption;
    wasPreviouslySelected: boolean;
    currentQuestion: QuizQuestion | null;
    currentQuestionIndex: number;
    isMultipleAnswer: boolean;
    explanationToDisplay: string;
  }): Promise<{
    explanationToDisplay: string;
  }> {
    if (!params.currentQuestion) {
      console.error('[handleCorrectnessOutcome] currentQuestion is null');
      return { explanationToDisplay: params.explanationToDisplay };
    }

    if (params.allCorrectSelected) {
      this.timerService.allowAuthoritativeStop();
      const stopped = await this.timerService.attemptStopTimerForQuestion({
        questionIndex: params.currentQuestionIndex,
      });

      if (stopped) {
        this.timerService.isTimerRunning = false;
      } else if (!this.timerService.isTimerRunning) {
        console.log(
          '[handleCorrectnessOutcome] Timer was already stopped. No action taken.'
        );
      }

      this.selectedOptionService.isAnsweredSubject.next(true);
    }

    // Update selection state
    this.selectedOptionService.setSelectedOption(
      params.option,
      params.currentQuestionIndex,
      undefined,
      params.isMultipleAnswer
    );

    // Ensure explanation text is preserved if not already set
    let explanationToDisplay = params.explanationToDisplay;
    if (!explanationToDisplay || !explanationToDisplay.trim()) {
      const explanationText = this.explanationTextService
        .explanationsInitialized
        ? await (async () => {
            const { firstValueFrom } = await import('../../utils/rxjs-compat');
            return firstValueFrom(
              this.explanationTextService.getFormattedExplanationTextForQuestion(
                params.currentQuestionIndex
              )
            );
          })()
        : 'No explanation available';

      explanationToDisplay = explanationText || 'No explanation available';
    }

    return { explanationToDisplay };
  }

  /**
   * Sets correct message via the feedback service.
   */
  setCorrectMessage(optionsToDisplay: Option[], question: QuizQuestion): string {
    const correctAnswers = optionsToDisplay.filter((opt) => opt.correct);
    return this.feedbackService.setCorrectMessage(
      correctAnswers,
      { options: optionsToDisplay } as any as QuizQuestion
    );
  }
}
