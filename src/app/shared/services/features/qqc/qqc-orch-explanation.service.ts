import { Injectable } from '@angular/core';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';

type Host = any;

/**
 * Orchestrates QQC explanation display, visibility restore, and explanation state management.
 * Extracted from QqcComponentOrchestratorService.
 */
@Injectable({ providedIn: 'root' })
export class QqcOrchExplanationService {

  async runOnVisibilityChange(host: Host): Promise<void> {
    if (document.visibilityState === 'hidden') {
      host.navigationHandler.persistStateOnHide({
        quizId: host.quizId()!,
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        displayExplanation: host.displayExplanation,
      });
      host.navigationHandler.resetExplanationStateOnHide();
      await host.navigationHandler.captureElapsedOnHide();
      return;
    }

    try {
      const { shouldExpire, expiredIndex } = await host.navigationHandler.handleFastPathExpiry({
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        displayExplanation: host.displayExplanation,
        normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      });
      if (shouldExpire) {
        host.timerService.stopTimer?.(undefined, { force: true });
        host.onTimerExpiredFor(expiredIndex);
        return;
      }
    } catch {}

    try {
      if (document.visibilityState !== 'visible') return;
      host._visibilityRestoreInProgress = true;
      (host.explanationTextService as any)._visibilityLocked = true;
      host._suppressDisplayStateUntil = performance.now() + 300;

      const restoreResult = await host.navigationHandler.performFullVisibilityRestore({
        quizId: host.quizId()!,
        currentQuestionIndex: host.currentQuestionIndex() ?? 0,
        optionsToDisplay: host.optionsToDisplay(),
        currentQuestion: host.currentQuestion(),
        generateFeedbackText: (q: QuizQuestion) => host.generateFeedbackText(q),
        applyOptionFeedback: (opt: Option) => host.applyOptionFeedback(opt),
        restoreFeedbackState: () => {
          host.optionsToDisplay.set(host.feedbackManager.restoreFeedbackState(
            host.currentQuestion(),
            host.optionsToDisplay(),
            host.correctMessage()
          ));
        },
      });

      host.displayState.mode = restoreResult.displayMode as 'question' | 'explanation';
      host.optionsToDisplay.set(restoreResult.optionsToDisplay);
      host.feedbackText = restoreResult.feedbackText;
      host.displayExplanation = restoreResult.shouldShowExplanation;
      host.safeSetDisplayState(
        restoreResult.shouldShowExplanation
          ? { mode: 'explanation', answered: true }
          : { mode: 'question', answered: false }
      );

      setTimeout(() => {
        (host.explanationTextService as any)._visibilityLocked = false;
        host._visibilityRestoreInProgress = false;
        setTimeout(
          () => host.navigationHandler.refreshExplanationStatePostRestore(host.currentQuestionIndex() ?? 0),
          400
        );
      }, 350);
    } catch {}
  }

  async runUpdateExplanationDisplay(host: Host, shouldDisplay: boolean): Promise<void> {
    host.showExplanationChange.emit(shouldDisplay);
    host.displayExplanation = shouldDisplay;
    if (shouldDisplay) {
      setTimeout(async () => {
        const result = await host.explanationDisplay.performUpdateExplanationDisplay({
          shouldDisplay: true,
          currentQuestionIndex: host.currentQuestionIndex(),
        });
        host.explanationToDisplay.set(result.explanationToDisplay);
        host.explanationToDisplayChange.emit(result.explanationToDisplay);
        host.cdRef.markForCheck();
      }, 50);
    } else {
      const result = await host.explanationDisplay.performUpdateExplanationDisplay({
        shouldDisplay: false,
        currentQuestionIndex: host.currentQuestionIndex(),
      });
      if (result.explanationToDisplay !== undefined) {
        host.explanationToDisplay.set(result.explanationToDisplay);
        host.explanationToDisplayChange.emit(result.explanationToDisplay);
      }
      if (result.shouldResetQuestionState) host.resetQuestionStateBeforeNavigation();
    }
  }

  async runFetchAndSetExplanationText(host: Host, questionIndex: number): Promise<void> {
    host.resetExplanation();

    const ensureLoaded = async () => {
      const r = await host.questionLoader.ensureQuestionsLoaded(host.questionsArray, host.quizId());
      if (r.loaded && r.questions) {
        host.questions = r.questions;
        host.questionsArray = r.questions;
      }
      return r.loaded;
    };

    const result = await host.explanationFlow.performFetchAndSetExplanation({
      questionIndex,
      questionsArray: host.questionsArray,
      quizId: host.quizId(),
      isAnswered: host.isAnswered as boolean,
      shouldDisplayExplanation: host.shouldDisplayExplanation,
      ensureQuestionsLoaded: ensureLoaded,
      ensureQuestionIsFullyLoaded: (idx: number) =>
        host.questionLoader.ensureQuestionIsFullyLoaded(idx, host.questionsArray, host.quizId()),
      prepareExplanationText: (idx: number) => host.prepareAndSetExplanationText(idx),
      isAnyOptionSelected: (idx: number) => host.isAnyOptionSelected(idx),
    });

    if (result.success) {
      host.currentQuestionIndex.set(questionIndex);
      host.explanationToDisplay.set(result.explanationToDisplay);
      host.explanationTextService.updateFormattedExplanation(host.explanationToDisplay());
      host.explanationToDisplayChange.emit(host.explanationToDisplay());
    } else if (result.explanationToDisplay) {
      host.explanationToDisplay.set(host.explanationFlow.getExplanationErrorText());
      if (host.isAnswered && host.shouldDisplayExplanation) {
        host.emitExplanationChange(host.explanationToDisplay(), true);
      }
    }
  }

  runUpdateExplanationUI(host: Host, questionIndex: number, explanationText: string): void {
    const validated = host.explanationFlow.performUpdateExplanationUI({
      questionsArray: host.questionsArray,
      questionIndex,
    });
    if (!validated) return;

    try {
      host.quizService.setCurrentQuestion(validated.currentQuestion);
      new Promise<void>((resolve) => setTimeout(resolve, 100))
        .then(async () => {
          if (host.shouldDisplayExplanation && (await host.isAnyOptionSelected(validated.adjustedIndex))) {
            host.emitExplanationChange('', false);
            host.explanationToDisplay.set(explanationText);
            host.emitExplanationChange(host.explanationToDisplay(), true);
            host.isAnswerSelectedChange.emit(true);
          }
        })
        .catch(() => {});
    } catch {}
  }

  async runUpdateExplanationIfAnswered(host: Host, index: number, question: QuizQuestion): Promise<void> {
    const result = await host.explanationFlow.updateExplanationIfAnswered({
      index,
      question,
      shouldDisplayExplanation: host.shouldDisplayExplanation,
      isAnyOptionSelected: (idx: number) => host.isAnyOptionSelected(idx),
      getFormattedExplanation: (q: QuizQuestion, idx: number) =>
        host.explanationManager.getFormattedExplanation(q, idx),
    });
    if (result.shouldUpdate) {
      host.explanationToDisplay.set(result.explanationText);
      host.emitExplanationChange(host.explanationToDisplay(), true);
      host.isAnswerSelectedChange.emit(true);
    }
  }

  runHandlePageVisibilityChange(host: Host, isHidden: boolean): void {
    const action = host.navigationHandler.computeVisibilityAction(isHidden);
    if (action.shouldClearSubscriptions) {
      for (const sub of (host.displaySubscriptions ?? [])) {
        sub.unsubscribe();
      }
      host.displaySubscriptions = [];
      const cleanup = host.navigationHandler.computeDisplaySubscriptionCleanup();
      host.explanationToDisplay.set(cleanup.explanationToDisplay);
      host.emitExplanationChange('', cleanup.showExplanation);
    }
    if (action.shouldRefreshExplanation) {
      host.prepareAndSetExplanationText(host.currentQuestionIndex());
    }
  }

  runApplyExplanationTextInZone(host: Host, text: string): void {
    host.explanationToDisplay.set(text);
    host.explanationToDisplayChange.emit(text);
    host.cdRef.markForCheck();
    host.cdRef.detectChanges();
  }

  runApplyExplanationFlags(host: Host, flags: any): void {
    host.forceQuestionDisplay = flags.forceQuestionDisplay;
    host.readyForExplanationDisplay = flags.readyForExplanationDisplay;
    host.isExplanationReady = flags.isExplanationReady;
    host.isExplanationLocked = flags.isExplanationLocked;
    host.explanationLocked = flags.explanationLocked;
    host.explanationVisible = flags.explanationVisible;
    host.displayExplanation = flags.displayExplanation;
    host.shouldDisplayExplanation = flags.shouldDisplayExplanation;
  }

  runResetExplanation(host: Host, force = false): void {
    const result = host.explanationFlow.performResetExplanation({ force, questionIndex: host.fixedQuestionIndex ?? host.currentQuestionIndex() ?? 0 });
    host.displayExplanation = result.displayExplanation;
    host.explanationToDisplay.set(result.explanationToDisplay);
    if (!result.blocked) {
      host.emitExplanationChange('', false);
      host.cdRef?.markForCheck?.();
    }
  }

  async runPrepareAndSetExplanationText(host: Host, questionIndex: number): Promise<string> {
    host.explanationToDisplay.set(await host.explanationFlow.prepareExplanationText(questionIndex));
    return host.explanationToDisplay();
  }

  async runUpdateExplanationText(host: Host, index: number): Promise<string> {
    return host.explanationDisplay.updateExplanationText({ index, normalizeIndex: (idx: number) => host.normalizeIndex(idx), questionsArray: host.questionsArray, currentQuestionIndex: host.currentQuestionIndex(), currentQuestion: host.currentQuestion(), optionsToDisplay: host.optionsToDisplay(), options: host.options });
  }
}
