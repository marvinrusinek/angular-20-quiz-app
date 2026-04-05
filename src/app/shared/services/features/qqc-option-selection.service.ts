import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

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
import { SoundService } from '../ui/sound.service';

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
    private feedbackService: FeedbackService,
    private soundService: SoundService
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
   * Handles correctness outcome after all correct check: timer stop, sound, selection, explanation, next button.
   * Returns state values for the component to apply.
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
    shouldEmitAnswerSelected: boolean;
    shouldEnableNext: boolean;
  }> {
    if (!params.currentQuestion) {
      console.error('[handleCorrectnessOutcome] currentQuestion is null');
      return {
        explanationToDisplay: params.explanationToDisplay,
        shouldEmitAnswerSelected: false,
        shouldEnableNext: false,
      };
    }

    // Handle multi-answer timer logic
    if (params.currentQuestion.type === QuestionType.MultipleAnswer) {
      this.timerService.allowAuthoritativeStop();
      await this.timerService.attemptStopTimerForQuestion({
        questionIndex: params.currentQuestionIndex,
      });
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

    // Play sound based on correctness (only for new selections)
    if (!params.wasPreviouslySelected) {
      const enrichedOption: SelectedOption = {
        ...params.option,
        questionIndex: params.currentQuestionIndex,
      };
      this.soundService.playOnceForOption(enrichedOption);
    }

    // Ensure explanation text is preserved if not already set
    let explanationToDisplay = params.explanationToDisplay;
    if (!explanationToDisplay || !explanationToDisplay.trim()) {
      const explanationText = this.explanationTextService
        .explanationsInitialized
        ? await (async () => {
            return firstValueFrom(
              this.explanationTextService.getFormattedExplanationTextForQuestion(
                params.currentQuestionIndex
              )
            );
          })()
        : 'No explanation available';

      explanationToDisplay = explanationText || 'No explanation available';
    }

    // Compute next button state
    const shouldEnableNext =
      params.allCorrectSelected ||
      this.selectedOptionService.isAnsweredSubject.getValue();

    return {
      explanationToDisplay,
      shouldEmitAnswerSelected: params.allCorrectSelected,
      shouldEnableNext,
    };
  }

  /**
   * Handles option click toggle logic: assigns option IDs, adds/removes
   * selected options, updates answered state, and attempts timer stop.
   * Returns the updated selection state.
   * Extracted from handleOptionClicked().
   */
  handleOptionClicked(params: {
    currentQuestion: QuizQuestion;
    optionIndex: number;
    currentQuestionIndex: number;
  }): {
    selectedOptions: Option[];
    isOptionSelected: boolean;
    timerStopped: boolean;
  } | null {
    const { currentQuestion, optionIndex, currentQuestionIndex } = params;

    try {
      if (!currentQuestion || !Array.isArray(currentQuestion.options)) {
        console.warn(
          '[❌ handleOptionClicked] currentQuestion or options is null/invalid',
          currentQuestion
        );
        return null;
      }

      // Ensure optionId is assigned to all options in the current question
      currentQuestion.options = this.quizService.assignOptionIds(
        currentQuestion.options, currentQuestionIndex
      );

      // Get selected options, but only include those with a valid optionId
      const selectedOptions: Option[] = this.selectedOptionService
        .getSelectedOptionIndices(currentQuestionIndex)
        .map((index: number) => currentQuestion.options[index])
        .filter((option) => option && option.optionId !== undefined);

      // Check if the option is already selected
      const isOptionSelected = selectedOptions.some(
        (option: Option) => option.optionId === optionIndex
      );

      // Add or remove the option based on its current state
      if (!isOptionSelected) {
        this.selectedOptionService.addSelectedOptionIndex(
          currentQuestionIndex,
          optionIndex
        );
      } else {
        this.selectedOptionService.removeSelectedOptionIndex(
          currentQuestionIndex,
          optionIndex
        );
      }

      // Check if all correct answers are selected
      // Update answered state
      this.selectedOptionService.updateAnsweredState(
        currentQuestion.options,
        currentQuestionIndex
      );

      // Handle multiple-answer logic
      const timerStopped = this.timerService.attemptStopTimerForQuestion({
        questionIndex: currentQuestionIndex,
      });

      if (timerStopped) {
        console.log(
          '[handleOptionClicked] All correct options selected. Timer stopped successfully.'
        );
      }

      return {
        selectedOptions,
        isOptionSelected: !isOptionSelected, // toggled
        timerStopped: !!timerStopped,
      };
    } catch (error) {
      console.error('[handleOptionClicked] Unhandled error:', error);
      return null;
    }
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

  /**
   * Performs the full selectOption flow: resolves IDs, persists selection,
   * builds snapshot, fetches explanation, and returns state for the component.
   */
  async performSelectOption(params: {
    currentQuestion: QuizQuestion;
    option: SelectedOption;
    optionIndex: number;
    currentQuestionIndex: number;
    isMultipleAnswer: boolean;
    optionsToDisplay: Option[];
    selectedOptionsCount: number;
    getExplanationText: (idx: number) => Promise<string>;
  }): Promise<{
    selectedOption: SelectedOption;
    resolvedOptionId: number;
    showFeedbackForOption: Record<number, boolean>;
    isOptionSelected: boolean;
    isAnswered: boolean;
    explanationText: string;
    correctMessage: string;
  } | null> {
    const {
      currentQuestion, option, optionIndex, currentQuestionIndex,
      isMultipleAnswer, optionsToDisplay, selectedOptionsCount, getExplanationText
    } = params;

    if (optionIndex < 0) {
      console.error(`Invalid optionIndex ${optionIndex}.`);
      return null;
    }

    const resolvedOptionId = this.resolveStableOptionId(option, optionIndex);

    const selectedOption: SelectedOption = {
      ...option,
      optionId: resolvedOptionId,
      questionIndex: currentQuestionIndex
    };

    const showFeedbackForOption: Record<number, boolean> = { [resolvedOptionId]: true };
    this.selectedOptionService.setSelectedOption(
      selectedOption, currentQuestionIndex, undefined, isMultipleAnswer
    );

    // Build a snapshot that mirrors what the user sees (UI order + flags)
    const qIdx = this.quizService.getCurrentQuestionIndex();
    const canonical = (this.quizService.questions?.[qIdx]?.options ?? []).map((o: Option) => ({ ...o }));
    const ui = (optionsToDisplay ?? []).map((o: Option) => ({ ...o }));
    const snapshot: Option[] =
      this.selectedOptionService.overlaySelectedByIdentity?.(canonical, ui) ?? ui ?? canonical;

    await this.selectedOptionService.selectOption(
      resolvedOptionId,
      selectedOption.questionIndex!,
      selectedOption.text ?? (selectedOption as any).value ?? '',
      isMultipleAnswer,
      snapshot
    );

    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.quizService.setCurrentQuestion(currentQuestion);

    this.selectedOptionService.updateSelectedOptions(
      currentQuestionIndex,
      resolvedOptionId,
      'add'
    );

    // Get explanation text
    const explanationText =
      (await getExplanationText(currentQuestionIndex)) ||
      'No explanation available';
    this.explanationTextService.setExplanationText(explanationText);

    if (currentQuestion) {
      this.explanationTextService.updateExplanationText(currentQuestion);
    }

    // Correct message
    const correctMessage = this.setCorrectMessage(optionsToDisplay, currentQuestion);

    return {
      selectedOption,
      resolvedOptionId,
      showFeedbackForOption,
      isOptionSelected: true,
      isAnswered: selectedOptionsCount > 0,
      explanationText,
      correctMessage,
    };
  }

  /**
   * Handles the full option selection flow: resolves option ID, toggles selection,
   * processes selection, updates state, applies feedback, regenerates FET,
   * and updates quiz state.
   * Returns the updated state for the component to apply.
   * Extracted from handleOptionSelection().
   */
  async handleFullOptionSelection(params: {
    option: SelectedOption;
    optionIndex: number;
    currentQuestion: QuizQuestion;
    currentQuestionIndex: number;
    quizId: string;
    lastAllCorrect: boolean;
    optionsToDisplay: Option[];
    handleOptionClickedFn: (question: QuizQuestion, index: number) => Promise<void>;
    updateExplanationTextFn: (index: number) => Promise<string>;
  }): Promise<{
    selectedOption: SelectedOption;
    showFeedback: boolean;
    showFeedbackForOption: { [optionId: number]: boolean };
    selectedOptionIndex: number;
    explanationText: string;
    isFeedbackApplied: boolean;
  } | null> {
    const { option, optionIndex, currentQuestion, currentQuestionIndex, quizId } = params;

    // Ensure that the option and optionIndex are valid
    if (!option || optionIndex < 0) {
      console.error(
        `Invalid option or optionIndex: ${JSON.stringify(
          option
        )}, index: ${optionIndex}`
      );
      return null;
    }

    // Ensure the question index is valid
    if (typeof currentQuestionIndex !== 'number' || currentQuestionIndex < 0) {
      console.error(`Invalid question index: ${currentQuestionIndex}`);
      return null;
    }

    try {
      const resolvedOptionId = this.resolveStableOptionId(option, optionIndex);
      option.optionId = resolvedOptionId;

      // Toggle option selection state
      option.selected = !option.selected;

      // Process the selected option and update states (trigger selection logic)
      await params.handleOptionClickedFn(currentQuestion, optionIndex);

      // Check if this specific option is now selected
      const isOptionSelected = this.selectedOptionService.isSelectedOption(option);

      // Only update explanation display flag if not locked
      if (!(this.explanationTextService as any).isExplanationLocked?.()) {
        // Only trigger explanation if selected and correct, otherwise ensure it's hidden
        this.explanationTextService.setShouldDisplayExplanation(isOptionSelected && params.lastAllCorrect);
      } else {
        console.warn('[handleFullOptionSelection] 🛡️ Explanation is locked. Skipping display update.');
      }

      // Update selected option service
      this.selectedOptionService.setAnsweredState(true);
      this.selectedOptionService.updateSelectedOptions(currentQuestionIndex, resolvedOptionId, 'add');

      // Immediate state synchronization
      const selectedOption: SelectedOption = { ...option, correct: option.correct };
      const showFeedbackForOption: { [optionId: number]: boolean } = {};
      showFeedbackForOption[option.optionId!] = true;

      const selectedOptionIndex = params.optionsToDisplay.findIndex(
        (opt) => opt.optionId === option.optionId
      );

      // ⚡ RE-GENERATE FET immediately on every click to ensure cache is fresh and prefix is correct
      const explanationText = await params.updateExplanationTextFn(currentQuestionIndex);
      console.log(
        `[📢 Fresh FET for Q${currentQuestionIndex + 1}]: "${explanationText.slice(0, 50)}..."`
      );

      // Update the answers and check if the selection is correct
      this.quizService.updateAnswersForOption(option);
      await this.checkAndHandleCorrectAnswer(currentQuestionIndex);

      const totalCorrectAnswers = this.quizService.getTotalCorrectAnswers(currentQuestion);

      // Update the question state in the QuizStateService
      this.quizStateService.updateQuestionState(
        quizId,
        currentQuestionIndex,
        {
          selectedOptions: [option],
          isCorrect: option.correct ?? false,
        },
        totalCorrectAnswers
      );

      // Trigger explanation evaluation immediately
      this.explanationTextService.triggerExplanationEvaluation();

      return {
        selectedOption,
        showFeedback: true,
        showFeedbackForOption,
        selectedOptionIndex,
        explanationText,
        isFeedbackApplied: true,
      };
    } catch (error) {
      console.error('Error during option selection:', error);
      return null;
    }
  }

  /**
   * Fetches and processes the current question: resets state, loads question data,
   * builds display data, and checks answered state.
   * Extracted from fetchAndProcessCurrentQuestion().
   */
  async fetchAndProcessCurrentQuestion(params: {
    currentQuestionIndex: number;
    isAnyOptionSelectedFn: (index: number) => Promise<boolean>;
    shouldUpdateMessageOnAnswerFn: (isAnswered: boolean) => Promise<boolean>;
  }): Promise<{
    currentQuestion: QuizQuestion;
    optionsToDisplay: Option[];
    data: {
      questionText: string;
      explanationText?: string;
      correctAnswersText: string;
      options: Option[];
    };
  } | null> {
    try {
      // Reset state before fetching new question
      this.resetStateForNewQuestion();

      const currentQuestion = this.quizService.questions[params.currentQuestionIndex];

      if (!currentQuestion) return null;

      const optionsToDisplay = [...(currentQuestion.options || [])];

      // Set display data
      const data = {
        questionText: currentQuestion.questionText,
        explanationText: currentQuestion.explanation,
        correctAnswersText: this.quizService.getCorrectAnswersAsString(),
        options: optionsToDisplay
      };

      // Determine if the current question is answered
      const isAnswered = await params.isAnyOptionSelectedFn(params.currentQuestionIndex);

      // Update the selection message based on the current state
      if (await params.shouldUpdateMessageOnAnswerFn(isAnswered)) {
        // Selection message update would go here
      } else {
        console.log('No update required for the selection message.');
      }

      return { currentQuestion, optionsToDisplay, data };
    } catch (error) {
      console.error('[fetchAndProcessCurrentQuestion] An error occurred while fetching the current question:', error);
      return null;
    }
  }
}
