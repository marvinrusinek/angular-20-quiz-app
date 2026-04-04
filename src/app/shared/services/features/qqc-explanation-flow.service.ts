import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionState } from '../../models/QuestionState.model';
import { FormattedExplanation } from '../../models/FormattedExplanation.model';
import { ExplanationTextService } from '../features/explanation-text.service';
import { QuizService } from '../data/quiz.service';
import { QuizStateService } from '../state/quizstate.service';
import { QuizQuestionManagerService } from '../flow/quizquestionmgr.service';
import { QqcExplanationManagerService } from './qqc-explanation-manager.service';
import { QqcExplanationDisplayService } from './qqc-explanation-display.service';

/**
 * Orchestrates explanation flow lifecycle for QQC.
 * Consolidates scattered explanation orchestration methods from QuizQuestionComponent.
 *
 * This service handles async pipelines, reset sequences, and state restoration
 * for explanation text. The component retains EventEmitter emissions, cdRef calls,
 * and subject mutations.
 */
@Injectable({ providedIn: 'root' })
export class QqcExplanationFlowService {

  constructor(
    private explanationTextService: ExplanationTextService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private quizQuestionManagerService: QuizQuestionManagerService,
    private explanationManager: QqcExplanationManagerService,
    private explanationDisplay: QqcExplanationDisplayService
  ) {}

  /**
   * Full async pipeline: fetches question data, resolves formatted
   * explanation, returns the text to display.
   * Extracted from prepareAndSetExplanationText().
   */
  async prepareExplanationText(questionIndex: number): Promise<string> {
    if (typeof document !== 'undefined' && document.hidden) {
      return 'Explanation text not available when document is hidden.';
    }

    try {
      const questionData = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );

      if (this.quizQuestionManagerService.isValidQuestionData(questionData!)) {
        const formattedExplanationObservable =
          this.explanationTextService.getFormattedExplanation(questionIndex);

        try {
          const formattedExplanation = await Promise.race([
            firstValueFrom(formattedExplanationObservable),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            ),
          ]);

          if (formattedExplanation) {
            return formattedExplanation;
          } else {
            const processedExplanation = await this.explanationManager.processExplanationText(
              questionData!,
              questionIndex
            );

            if (processedExplanation) {
              this.explanationTextService.updateFormattedExplanation(
                processedExplanation.explanation
              );
              return processedExplanation.explanation;
            } else {
              return 'No explanation available...';
            }
          }
        } catch (timeoutError) {
          console.error(
            'Timeout while fetching formatted explanation:',
            timeoutError
          );
          return 'Explanation text unavailable at the moment.';
        }
      } else {
        console.error('Error: questionData is invalid');
        return 'No explanation available.';
      }
    } catch (error) {
      console.error('Error in fetching explanation text:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      return 'Error fetching explanation.';
    }
  }

  /**
   * Computes the reset sequence for explanation state.
   * Returns the values to apply, or blocked: true if lock prevents reset.
   * The component applies the result to its own state and emits events.
   * Extracted from resetExplanation().
   */
  computeResetExplanation(params: {
    force: boolean;
    questionIndex: number;
  }): {
    blocked: boolean;
    displayExplanation?: false;
    explanationToDisplay?: '';
    displayState?: { mode: 'question'; answered: false };
  } {
    const locked =
      this.explanationTextService.isExplanationLocked?.() ?? false;

    if (!params.force && locked) {
      console.log('[🛡️ resetExplanation] Blocked — lock is active.', {
        qIndex: params.questionIndex,
      });
      return { blocked: true };
    }

    return {
      blocked: false,
      displayExplanation: false,
      explanationToDisplay: '',
      displayState: { mode: 'question', answered: false },
    };
  }

  /**
   * Computes the restore state for explanation after a reset
   * (e.g., returning to an already-answered question).
   * Returns the values the component should apply.
   * Extracted from restoreExplanationAfterReset().
   */
  computeRestoreAfterReset(args: {
    questionIndex: number;
    explanationText: string;
    questionState?: QuestionState;
    quizId: string | null | undefined;
    quizServiceQuizId: string | null;
    currentQuizId: string | null;
  }): {
    shouldSkip: false;
    explanationText: string;
    displayMode: 'explanation';
    displayState: { mode: 'explanation'; answered: true };
    forceQuestionDisplay: false;
    readyForExplanationDisplay: true;
    isExplanationReady: true;
    isExplanationLocked: false;
    explanationLocked: true;
    explanationVisible: true;
    displayExplanation: true;
    shouldDisplayExplanation: true;
    isExplanationTextDisplayed: true;
    resolvedQuizId: string | null;
  } | { shouldSkip: true } {
    const normalized = (args.explanationText ?? '').trim();
    if (!normalized) {
      return { shouldSkip: true };
    }

    // Apply service-level state
    this.explanationTextService.setExplanationText(normalized);
    this.explanationTextService.setShouldDisplayExplanation(true);
    this.explanationTextService.setIsExplanationTextDisplayed(true);
    this.explanationTextService.setResetComplete(true);
    this.explanationTextService.lockExplanation();

    const resolvedQuizId =
      [args.quizId, args.currentQuizId, args.quizServiceQuizId]
        .find((id) => typeof id === 'string' && id.trim().length > 0) ?? null;

    if (resolvedQuizId && args.questionState) {
      args.questionState.isAnswered = true;
      args.questionState.explanationDisplayed = true;
      this.quizStateService.setQuestionState(resolvedQuizId, args.questionIndex, args.questionState);
    }

    return {
      shouldSkip: false,
      explanationText: normalized,
      displayMode: 'explanation',
      displayState: { mode: 'explanation', answered: true },
      forceQuestionDisplay: false,
      readyForExplanationDisplay: true,
      isExplanationReady: true,
      isExplanationLocked: false,
      explanationLocked: true,
      explanationVisible: true,
      displayExplanation: true,
      shouldDisplayExplanation: true,
      isExplanationTextDisplayed: true,
      resolvedQuizId,
    };
  }

  /**
   * Validates and adjusts question index for explanation UI update.
   * Returns null if update should be skipped.
   * Extracted from updateExplanationUI().
   */
  validateForExplanationUI(params: {
    questionsArray: QuizQuestion[];
    questionIndex: number;
  }): {
    adjustedIndex: number;
    currentQuestion: QuizQuestion;
  } | null {
    if (!params.questionsArray || params.questionsArray.length === 0) {
      console.warn('Questions not loaded yet. Skipping explanation update.');
      return null;
    }

    const adjustedIndex = Math.max(
      0,
      Math.min(params.questionIndex, params.questionsArray.length - 1)
    );
    const currentQuestion = params.questionsArray[adjustedIndex];

    if (!currentQuestion) {
      console.error(`Question not found at index: ${adjustedIndex}`);
      return null;
    }

    return { adjustedIndex, currentQuestion };
  }

  /**
   * Returns the error message for explanation fetch failure.
   * Extracted from handleExplanationError().
   */
  getExplanationErrorText(): string {
    return 'Error fetching explanation. Please try again.';
  }

  /**
   * Processes a formatted explanation result and determines whether
   * to update the display.
   * Extracted from handleFormattedExplanation().
   */
  processFormattedExplanation(
    formattedExplanation: FormattedExplanation,
    isAnswered: boolean,
    shouldDisplayExplanation: boolean
  ): {
    explanationToDisplay: string;
    shouldEmit: boolean;
  } {
    return this.explanationDisplay.handleFormattedExplanation(
      formattedExplanation,
      isAnswered,
      shouldDisplayExplanation
    );
  }
}
