import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { Utils } from '../../../utils/utils';
import { QqcOrchLifecycleService } from './qqc-orch-lifecycle.service';
import { QqcOrchClickService } from './qqc-orch-click.service';
import { QqcOrchQuestionLoadService } from './qqc-orch-question-load.service';
import { QqcOrchTimerService } from './qqc-orch-timer.service';

type Host = any;

/**
 * Orchestrates QuizQuestionComponent lifecycle/event method bodies.
 * Methods accept the component instance and mutate it via the host
 * reference, mirroring the QuizSetupService pattern used by QuizComponent.
 */
@Injectable({ providedIn: 'root' })
export class QqcComponentOrchestratorService {

  constructor(
    private orchLifecycle: QqcOrchLifecycleService,
    private orchClick: QqcOrchClickService,
    private orchQuestionLoad: QqcOrchQuestionLoadService,
    private orchTimer: QqcOrchTimerService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // ngOnInit body
  // ═══════════════════════════════════════════════════════════════
  async runOnInit(host: Host): Promise<void> {
    return this.orchLifecycle.runOnInit(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // ngAfterViewInit body
  // ═══════════════════════════════════════════════════════════════
  async runAfterViewInit(host: Host): Promise<void> {
    return this.orchLifecycle.runAfterViewInit(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // ngOnChanges body
  // ═══════════════════════════════════════════════════════════════
  async runOnChanges(host: Host, changes: any): Promise<void> {
    return this.orchLifecycle.runOnChanges(host, changes);
  }

  // ═══════════════════════════════════════════════════════════════
  // ngOnDestroy body (besides super)
  // ═══════════════════════════════════════════════════════════════
  runOnDestroy(host: Host): void {
    this.orchLifecycle.runOnDestroy(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // onVisibilityChange body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // onOptionClicked body
  // ═══════════════════════════════════════════════════════════════
  async runOnOptionClicked(
    host: Host,
    event: { option: any; index: number; checked: boolean; wasReselected?: boolean }
  ): Promise<void> {
    return this.orchClick.runOnOptionClicked(host, event);
  }

  // ═══════════════════════════════════════════════════════════════
  // loadDynamicComponent body
  // ═══════════════════════════════════════════════════════════════
  async runLoadDynamicComponent(host: Host, question: QuizQuestion, options: Option[]): Promise<void> {
    return this.orchQuestionLoad.runLoadDynamicComponent(host, question, options);
  }

  // ═══════════════════════════════════════════════════════════════
  // loadQuestion body
  // ═══════════════════════════════════════════════════════════════
  async runLoadQuestion(host: Host, signal?: AbortSignal): Promise<boolean> {
    return this.orchQuestionLoad.runLoadQuestion(host, signal);
  }

  // ═══════════════════════════════════════════════════════════════
  // setupRouteChangeHandler body
  // ═══════════════════════════════════════════════════════════════
  runSetupRouteChangeHandler(host: Host): void {
    this.orchQuestionLoad.runSetupRouteChangeHandler(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // onQuestionTimedOut body
  // ═══════════════════════════════════════════════════════════════
  runOnQuestionTimedOut(host: Host, targetIndex?: number): void {
    this.orchTimer.runOnQuestionTimedOut(host, targetIndex);
  }

  // ═══════════════════════════════════════════════════════════════
  // handleTimerStoppedForActiveQuestion body
  // ═══════════════════════════════════════════════════════════════
  runHandleTimerStoppedForActiveQuestion(host: Host, reason: 'timeout' | 'stopped'): void {
    this.orchTimer.runHandleTimerStoppedForActiveQuestion(host, reason);
  }

  // ═══════════════════════════════════════════════════════════════
  // onTimerExpiredFor body
  // ═══════════════════════════════════════════════════════════════
  async runOnTimerExpiredFor(host: Host, index: number): Promise<void> {
    return this.orchTimer.runOnTimerExpiredFor(host, index);
  }

  // ═══════════════════════════════════════════════════════════════
  // resetQuestionStateBeforeNavigation body
  // ═══════════════════════════════════════════════════════════════
  async runResetQuestionStateBeforeNavigation(
    host: Host,
    options?: { preserveVisualState?: boolean; preserveExplanation?: boolean }
  ): Promise<void> {
    const result = host.resetManager.computeResetQuestionStateBeforeNavigation(options);
    host.currentQuestion.set(result.currentQuestion);
    host.selectedOption = result.selectedOption;
    host.options.set(result.resetOptions);

    if (!result.preserveExplanation) {
      host.feedbackText = result.feedbackText;
      host.applyDisplayState(result.displayState);
      host.quizStateService.setDisplayState(host.displayState);
      host.updateDisplayMode(result.displayMode);
      host.applyExplanationFlags(result);
      host.explanationToDisplay.set(result.explanationToDisplay);
      host.emitExplanationChange('', false);
    }
    if (!result.preserveVisualState) {
      host.questionToDisplay = '';
      host.updateShouldRenderOptions([]);
      host.shouldRenderOptions.set(false);
    }

    host.finalRenderReadySubject.next(false);
    host.renderReadySubject.next(false);
    setTimeout(() => {
      if (host.sharedOptionComponent) {
        host.sharedOptionComponent.freezeOptionBindings = false;
        host.sharedOptionComponent.showFeedbackForOption = {};
      }
    }, 0);

    const resetDelay = host.resetManager.computeResetDelay(result.preserveVisualState);
    if (resetDelay > 0) await new Promise((resolve) => setTimeout(resolve, resetDelay));
  }

  // ═══════════════════════════════════════════════════════════════
  // resetPerQuestionState body
  // ═══════════════════════════════════════════════════════════════
  runResetPerQuestionState(host: Host, index: number): void {
    if (host._pendingRAF != null) {
      cancelAnimationFrame(host._pendingRAF);
      host._pendingRAF = null;
    }
    host._skipNextAsyncUpdates = false;

    const result = host.resetManager.resetPerQuestionState({
      index,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      formattedByIndex: host._formattedByIndex,
      clearSharedOptionForceDisable: () => host.sharedOptionComponent?.clearForceDisableAllOptions?.(),
      resolveFormatted: (idx: number, opts: any) => host.resolveFormatted(idx, opts),
    });

    host.handledOnExpiry.delete(result.i0);
    host.feedbackConfigs = result.feedbackConfigs;
    host.lastFeedbackOptionId = result.lastFeedbackOptionId;
    host.showFeedbackForOption = result.showFeedbackForOption;

    if (result.hasSelections) {
      host.optionsToDisplay.set(host.resetManager.restoreSelectionsAndIcons(result.i0, host.optionsToDisplay()));
      host.cdRef.detectChanges();
    }

    host.displayExplanation = result.displayExplanation;
    host.updateDisplayMode(result.displayMode);
    if (result.hasSelections) {
      host.showExplanationChange?.emit(true);
    } else {
      host.explanationToDisplay.set('');
      host.emitExplanationChange('', false);
    }

    host.questionFresh = result.questionFresh;
    host.timedOut = result.timedOut;
    host._timerStoppedForQuestion = result.timerStoppedForQuestion;
    host._lastAllCorrect = result.lastAllCorrect;
    host.lastLoggedIndex = result.lastLoggedIndex;
    host.lastLoggedQuestionIndex = result.lastLoggedQuestionIndex;

    try {
      host.questionForm?.enable({ emitEvent: false });
    } catch {}
    queueMicrotask(() => host.emitPassiveNow(index));
    host.cdRef.markForCheck();
    host.cdRef.detectChanges();
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationDisplay body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // fetchAndSetExplanationText body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationUI body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // handleOptionSelection body
  // ═══════════════════════════════════════════════════════════════
  async runHandleOptionSelection(
    host: Host,
    option: SelectedOption,
    optionIndex: number,
    currentQuestion: QuizQuestion
  ): Promise<void> {
    const result = await host.optionSelection.handleFullOptionSelection({
      option,
      optionIndex,
      currentQuestion,
      currentQuestionIndex: host.currentQuestionIndex(),
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      optionsToDisplay: host.optionsToDisplay(),
      handleOptionClickedFn: async (q: QuizQuestion, idx: number) => {
        const r = host.optionSelection.handleOptionClicked({
          currentQuestion: q,
          optionIndex: idx,
          currentQuestionIndex: host.currentQuestionIndex(),
        });
        if (r) host.cdRef.markForCheck();
      },
      updateExplanationTextFn: (idx: number) => host.updateExplanationText(idx),
    });
    if (!result) return;
    host.selectedOption = result.selectedOption;
    host.showFeedback.set(result.showFeedback);
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    host.explanationText.set(result.explanationText);
    host.applyFeedbackIfNeeded(option);
    host.optionSelection.setAnsweredAndDisplayState(host._lastAllCorrect);
  }

  // ═══════════════════════════════════════════════════════════════
  // updateOptionsSafely body
  // ═══════════════════════════════════════════════════════════════
  runUpdateOptionsSafely(host: Host, newOptions: Option[]): void {
    const result = host.displayStateManager.prepareOptionSwap({
      newOptions,
      currentOptionsJson: JSON.stringify(host.optionsToDisplay()),
    });

    if (result.needsSwap) {
      host.renderReadySubject.next(false);
      host.finalRenderReady = false;
      host.questionForm = result.formGroup;
      if (result.serialized !== host.lastSerializedOptions) {
        host.lastSerializedOptions = result.serialized;
      }
      host.optionsToDisplay.set(result.cleanedOptions);
      if (host.sharedOptionComponent) {
        host.sharedOptionComponent.initializeOptionBindings();
      }
      setTimeout(() => {
        if (host.displayStateManager.computeRenderReadiness(host.optionsToDisplay())) {
          host.markRenderReady();
        }
      }, 0);
    } else if (
      host.displayStateManager.computeRenderReadiness(host.optionsToDisplay()) &&
      !host.finalRenderReady
    ) {
      host.markRenderReady();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // hydrateFromPayload body
  // ═══════════════════════════════════════════════════════════════
  runHydrateFromPayload(host: Host, payload: any): void {
    const result = host.displayStateManager.hydrateFromPayload({
      payload,
      currentQuestionText: host.currentQuestion()?.questionText?.trim(),
      isAlreadyRendered: host.finalRenderReady,
    });
    if (!result) return;

    host.renderReady = false;
    host.finalRenderReady = false;
    host.renderReadySubject.next(false);
    host.finalRenderReadySubject.next(false);
    host.cdRef.detectChanges();

    host.currentQuestion.set(result.currentQuestion);
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.updateShouldRenderOptions(host.optionsToDisplay());
    host.explanationToDisplay.set(result.explanationToDisplay);

    if (!host.containerInitialized && host.dynamicAnswerContainer) {
      host.loadDynamicComponent(host.currentQuestion(), host.optionsToDisplay());
      host.containerInitialized = true;
    }
    host.sharedOptionComponent?.initializeOptionBindings();

    setTimeout(() => {
      const bindingsReady =
        Array.isArray(host.sharedOptionComponent?.optionBindings) &&
        host.sharedOptionComponent.optionBindings.length > 0 &&
        host.sharedOptionComponent.optionBindings.every((b: any) => !!b.option);
      if (
        host.displayStateManager.computeRenderReadiness(host.optionsToDisplay()) &&
        bindingsReady
      ) {
        host.sharedOptionComponent?.markRenderReady('✅ Hydrated from new payload');
      }
    }, 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationIfAnswered body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // handlePageVisibilityChange body
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // initializeQuiz body
  // ═══════════════════════════════════════════════════════════════
  async runInitializeQuiz(host: Host): Promise<void> {
    return this.orchQuestionLoad.runInitializeQuiz(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // isAnyOptionSelected body
  // ═══════════════════════════════════════════════════════════════
  async runIsAnyOptionSelected(host: Host, questionIndex: number): Promise<boolean> {
    const rs = host.optionSelection.resetStateForNewQuestion();
    host.showFeedbackForOption = rs.showFeedbackForOption;
    host.showFeedback.set(rs.showFeedback);
    host.correctMessage.set(rs.correctMessage);
    host.selectedOption = rs.selectedOption;
    host.isOptionSelected.set(rs.isOptionSelected);
    host.emitExplanationChange('', false);
    try {
      return await firstValueFrom(host.quizService.isAnswered(questionIndex));
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // onSubmitMultiple body
  // ═══════════════════════════════════════════════════════════════
  async runOnSubmitMultiple(host: Host): Promise<void> {
    const idx = host.currentQuestionIndex() ?? host.quizService.getCurrentQuestionIndex() ?? 0;
    const computed = host.explanationFlow.computeSubmitMultipleExplanation({ currentQuestionIndex: idx });
    if (!computed) return;
    await host.explanationFlow.applySubmitMultipleExplanation({
      currentQuestionIndex: idx,
      formatted: computed.formatted,
      correctAnswersText: computed.correctAnswersText,
      questionType: computed.questionType,
    });
    host.displayStateSubject?.next({ mode: 'explanation', answered: true });
    host.displayExplanation = true;
    host.explanationToDisplay.set(computed.formatted);
    host.explanationToDisplayChange?.emit(computed.formatted);
  }

  // ═══════════════════════════════════════════════════════════════
  // postClickTasks body
  // ═══════════════════════════════════════════════════════════════
  async runPostClickTasks(
    host: Host,
    opt: SelectedOption,
    idx: number,
    checked: boolean,
    wasPreviouslySelected: boolean,
    questionIndex?: number
  ): Promise<void> {
    const lockedIndex = questionIndex ?? host.currentQuestionIndex();
    const { sel, shouldUpdateGlobalState } = host.optionSelection.performPostClickTasks({
      opt,
      idx,
      questionIndex: lockedIndex,
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    await host.finalizeSelection(opt, idx, wasPreviouslySelected);
    host.optionSelected.emit(sel);
    host.events.emit({ type: 'optionSelected', payload: sel });
    if (shouldUpdateGlobalState) host.nextButtonStateService.setNextButtonState(true);
    host.cdRef.markForCheck();
  }

  // ═══════════════════════════════════════════════════════════════
  // performInitialSelectionFlow body
  // ═══════════════════════════════════════════════════════════════
  async runPerformInitialSelectionFlow(host: Host, event: any, option: SelectedOption): Promise<void> {
    const prevSelected = !!option.selected;
    host.optionSelection.updateOptionSelection(event, option, host.currentQuestionIndex());
    await host.handleOptionSelection(option, event.index, host.currentQuestion()!);
    host.applyFeedbackIfNeeded(option);
    const nowSelected = !!option.selected;
    const transition = host.feedbackManager.computeSelectionTransition({
      prevSelected,
      nowSelected,
      option,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    host.optionSelection.handleSelectionTransitionAndMessage({
      prevSelected,
      nowSelected,
      transition,
      currentQuestionIndex: host.currentQuestionIndex(),
      optionsToDisplay: host.optionsToDisplay(),
      currentQuestionOptions: host.currentQuestion()?.options,
      isAnswered: host.isAnswered as boolean,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // applyFeedbackIfNeeded body
  // ═══════════════════════════════════════════════════════════════
  async runApplyFeedbackIfNeeded(host: Host, option: SelectedOption): Promise<void> {
    if (!host.optionsToDisplay()?.length) host.populateOptionsToDisplay();
    const result = host.feedbackManager.applyFeedbackIfNeeded({
      option,
      optionsToDisplay: host.optionsToDisplay(),
      showFeedbackForOption: host.showFeedbackForOption,
    });
    if (!result) return;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    if (result.shouldTriggerExplanation) {
      host.explanationTextService.triggerExplanationEvaluation();
    }
    host.cdRef.detectChanges();
  }

  // ═══════════════════════════════════════════════════════════════
  // applyOptionFeedback body
  // ═══════════════════════════════════════════════════════════════
  async runApplyOptionFeedback(host: Host, selectedOption: Option): Promise<void> {
    if (!host.optionsToDisplay()?.length) host.populateOptionsToDisplay();
    const result = host.feedbackManager.applyOptionFeedback(
      selectedOption,
      host.optionsToDisplay(),
      host.showFeedbackForOption
    );
    if (!result) return;
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOptionIndex = result.selectedOptionIndex;
    host.feedbackApplied.emit(selectedOption.optionId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    host.cdRef.markForCheck();
  }

  // ═══════════════════════════════════════════════════════════════
  // finalizeSelection body
  // ═══════════════════════════════════════════════════════════════
  async runFinalizeSelection(
    host: Host,
    option: SelectedOption,
    index: number,
    wasPreviouslySelected: boolean
  ): Promise<void> {
    const result = await host.optionSelection.performFinalizeSelection({
      option,
      index,
      wasPreviouslySelected,
      currentQuestionIndex: host.currentQuestionIndex(),
      quizId: host.quizId()!,
      lastAllCorrect: host._lastAllCorrect,
      fetchAndProcessCurrentQuestion: () => host.fetchAndProcessCurrentQuestion(),
      selectOption: (q: QuizQuestion, opt: SelectedOption, idx: number) => host.selectOption(q, opt, idx),
      processCurrentQuestion: (q: QuizQuestion) =>
        host.explanationFlow.processCurrentQuestion({
          currentQuestion: q,
          currentQuestionIndex: host.currentQuestionIndex(),
          quizId: host.quizId()!,
          lastAllCorrect: host._lastAllCorrect,
          getExplanationText: (idx: number) => host.explanationManager.getExplanationText(idx),
        }),
      handleOptionSelection: (opt: SelectedOption, idx: number, q: QuizQuestion) =>
        host.handleOptionSelection(opt, idx, q),
    });
    if (!result) return;
    host.updateExplanationDisplay(result.shouldDisplay);
    host.questionAnswered.emit();
    host.timerEffect.stopTimerIfAllCorrectSelected({
      currentQuestionIndex: host.currentQuestionIndex(),
      questions: host.questions,
      optionsToDisplay: host.optionsToDisplay(),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // fetchAndProcessCurrentQuestion body
  // ═══════════════════════════════════════════════════════════════
  async runFetchAndProcessCurrentQuestion(host: Host): Promise<QuizQuestion | null> {
    const result = await host.optionSelection.fetchAndProcessCurrentQuestion({
      currentQuestionIndex: host.currentQuestionIndex(),
      isAnyOptionSelectedFn: (idx: number) => host.isAnyOptionSelected(idx),
      shouldUpdateMessageOnAnswerFn: async (isAnswered: boolean) =>
        host.selectionMessage() !==
        host.selectionMessageService.determineSelectionMessage(
          host.currentQuestionIndex(),
          host.totalQuestions,
          isAnswered
        ),
    });
    if (!result) return null;
    host.currentQuestion.set(result.currentQuestion);
    host.optionsToDisplay.set(result.optionsToDisplay);
    host.data.set(result.data);
    return result.currentQuestion;
  }

  // ═══════════════════════════════════════════════════════════════
  // selectOption body
  // ═══════════════════════════════════════════════════════════════
  async runSelectOption(
    host: Host,
    currentQuestion: QuizQuestion,
    option: SelectedOption,
    optionIndex: number
  ): Promise<void> {
    const result = await host.optionSelection.performSelectOption({
      currentQuestion,
      option,
      optionIndex,
      currentQuestionIndex: host.currentQuestionIndex(),
      isMultipleAnswer: host.isMultipleAnswer,
      optionsToDisplay: host.optionsToDisplay(),
      selectedOptionsCount: host.selectedOptions.length,
      getExplanationText: (idx: number) => host.explanationManager.getExplanationText(idx),
    });
    if (!result) return;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.selectedOption = result.selectedOption;
    host.isOptionSelected.set(result.isOptionSelected);
    host.isAnswered = result.isAnswered;
    host.quizQuestionManagerService.setExplanationText(currentQuestion.explanation || '');
    host.isAnswerSelectedChange.emit(host.isAnswered);
    host.optionSelected.emit(result.selectedOption);
    host.events.emit({ type: 'optionSelected', payload: result.selectedOption });
    host.selectionChanged.emit({ question: currentQuestion, selectedOptions: host.selectedOptions });
  }

  // ═══════════════════════════════════════════════════════════════
  // handleQuestionAndOptionsChange body
  // ═══════════════════════════════════════════════════════════════
  runHandleQuestionAndOptionsChange(host: Host, currentQuestionChange: any, optionsChange: any): void {
    const { nextQuestion, effectiveQuestion, incomingOptions } =
      host.displayStateManager.handleQuestionAndOptionsChange({
        currentQuestionChange,
        optionsChange,
        currentQuestion: host.currentQuestion(),
      });
    if (nextQuestion) host.currentQuestion.set(nextQuestion);
    const normalizedOptions = host.refreshOptionsForQuestion(effectiveQuestion, incomingOptions);
    const selectedOptionValues = host.displayStateManager.extractSelectedOptionValues(effectiveQuestion);
    if (effectiveQuestion) {
      host.quizService.handleQuestionChange(effectiveQuestion, selectedOptionValues, normalizedOptions);
    } else if (optionsChange) {
      host.quizService.handleQuestionChange(null, selectedOptionValues, normalizedOptions);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // refreshOptionsForQuestion body
  // ═══════════════════════════════════════════════════════════════
  runRefreshOptionsForQuestion(
    host: Host,
    question: QuizQuestion | null,
    providedOptions?: Option[] | null
  ): Option[] {
    const result = host.displayStateManager.refreshOptionsForQuestion({
      question,
      providedOptions,
      currentQuestionIndex: host.currentQuestionIndex(),
    });
    host.options.set(result.options);
    host.optionsToDisplay.set(result.optionsToDisplay);
    if (host.optionsToDisplay().length > 0) {
      host.quizService.setOptions(host.optionsToDisplay().map((option: Option) => ({ ...option })));
    }
    host.cdRef.markForCheck();
    return result.normalizedOptions;
  }

  // ═══════════════════════════════════════════════════════════════
  // initializeQuizDataAndRouting body
  // ═══════════════════════════════════════════════════════════════
  async runInitializeQuizDataAndRouting(host: Host): Promise<void> {
    return this.orchQuestionLoad.runInitializeQuizDataAndRouting(host);
  }

  // ─── Misc thin wrappers (extracted from QuizQuestionComponent) ───

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

  runSetQuestionOptions(host: Host): void {
    host.quizService.getQuestionByIndex(host.currentQuestionIndex()).pipe(take(1)).subscribe((currentQuestion: QuizQuestion | null) => {
      if (!currentQuestion) return;
      host.currentQuestion.set(currentQuestion);
      host.currentOptions = host.displayStateManager.buildOptionsWithCorrectness(currentQuestion);
      if (host.currentOptions.length === 0) return;
      if (host.shuffleOptions) Utils.shuffleArray(host.currentOptions);
      host.currentOptions = host.displayStateManager.applyDisplayOrder(host.currentOptions);
      host.optionsToDisplay.set(host.currentOptions.map((o: any) => ({ ...o })));
      host.updateShouldRenderOptions(host.optionsToDisplay());
      host.quizService.nextOptionsSubject.next(host.optionsToDisplay().map((o: any) => ({ ...o })));
      host.cdRef.markForCheck();
    });
  }

  runResetState(host: Host): void {
    const result = host.resetManager.resetState();
    host.selectedOption = result.selectedOption;
    host.options.set(result.options);
    host.resetFeedback();
  }

  runResetFeedback(host: Host): void {
    const result = host.resetManager.resetFeedback();
    host.correctMessage.set(result.correctMessage);
    host.showFeedback.set(result.showFeedback);
    host.selectedOption = result.selectedOption;
    host.showFeedbackForOption = result.showFeedbackForOption;
  }

  runUpdateOptionHighlighting(host: Host, selectedKeys: Set<string | number>): void {
    host.optionsToDisplay.set(host.feedbackManager.updateOptionHighlighting(host.optionsToDisplay(), selectedKeys, host.currentQuestionIndex(), host.question()?.type));
    host.cdRef.markForCheck();
    host.cdRef.detectChanges();
  }

  runRefreshFeedbackFor(host: Host, opt: Option): void {
    if (!host.sharedOptionComponent) return;
    if (opt.optionId !== undefined) host.sharedOptionComponent.lastFeedbackOptionId = opt.optionId;
    const cfg = host.feedbackManager.buildFeedbackConfigForOption(opt, host.optionBindings(), host.currentQuestion()!, host.sharedOptionComponent.feedbackConfigs);
    host.sharedOptionComponent.feedbackConfigs = { ...host.sharedOptionComponent.feedbackConfigs, [opt.optionId!]: cfg };
    host.cdRef.markForCheck();
  }

  runPopulateOptionsToDisplay(host: Host): Option[] {
    const result = host.questionLoader.populateOptionsToDisplay(host.currentQuestion(), host.optionsToDisplay(), host.lastOptionsQuestionSignature);
    host.optionsToDisplay.set(result.options);
    host.lastOptionsQuestionSignature = result.signature;
    return host.optionsToDisplay();
  }

  runInitializeForm(host: Host): void {
    const form = host.initializer.buildFormFromOptions(host.currentQuestion(), host.fb);
    if (form) {
      host.questionForm = form;
    }
  }

  runUnselectOption(host: Host): void {
    const result = host.optionSelection.unselectOption(host.currentQuestionIndex());
    host.selectedOptions = result.selectedOptions;
    host.optionChecked = result.optionChecked;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.showFeedback.set(result.showFeedback);
    host.selectedOption = result.selectedOption;
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

  async runOnSubmit(host: Host): Promise<void> {
    if (!host.initializer.validateFormForSubmission(host.questionForm)) return;
    const selectedOption = host.questionForm.get('selectedOption')?.value;
    await host.initializer.processAnswer({ selectedOption, currentQuestion: host.currentQuestion()!, currentQuestionIndex: host.currentQuestionIndex(), answers: host.answers });
    host.questionAnswered.emit();
  }

  runRestoreSelectionsAndIconsForQuestion(host: Host, index: number): void {
    host.optionsToDisplay.set(host.resetManager.restoreSelectionsAndIcons(index, host.optionsToDisplay()));
    host.cdRef.detectChanges();
  }

  runResetForQuestion(host: Host, index: number): void {
    const guards = host.resetManager.hardResetClickGuards();
    host._clickGate = guards.clickGate;
    host.waitingForReady = guards.waitingForReady;
    host.deferredClick = guards.deferredClick;
    host.lastLoggedQuestionIndex = guards.lastLoggedQuestionIndex;
    host.lastLoggedIndex = guards.lastLoggedIndex;
    host.resetExplanation(true);
    host.resetPerQuestionState(index);
  }

  async runResolveFormatted(host: Host, index: number, opts: { useCache?: boolean; setCache?: boolean; timeoutMs?: number } = {}): Promise<string> {
    return host.timerEffect.resolveFormatted({ index, normalizeIndex: (idx: number) => host.normalizeIndex(idx), formattedByIndex: host._formattedByIndex, useCache: opts.useCache, setCache: opts.setCache, timeoutMs: opts.timeoutMs, updateExplanationText: (idx: number) => host.updateExplanationText(idx) });
  }

  runEmitPassiveNow(host: Host, index: number): void {
    host.optionSelection.emitPassiveNow({
      index,
      normalizeIndex: (idx: number) => host.normalizeIndex(idx),
      optionsToDisplay: host.optionsToDisplay(),
      currentQuestionType: host.currentQuestion()?.type,
    });
  }

  runDisableAllBindingsAndOptions(host: Host): { optionBindings: any[]; optionsToDisplay: Option[] } {
    const result = host.displayStateManager.disableAllBindingsAndOptions(host.optionBindings(), host.optionsToDisplay());
    host.optionBindings.set(result.optionBindings);
    host.optionsToDisplay.set(result.optionsToDisplay);
    return result;
  }

  runRevealFeedbackForAllOptions(host: Host, canonicalOpts: Option[]): void {
    const result = host.feedbackManager.revealFeedbackForAllOptions(canonicalOpts, host.feedbackConfigs, host.showFeedbackForOption);
    host.feedbackConfigs = result.feedbackConfigs;
    host.showFeedbackForOption = result.showFeedbackForOption;
    host.cdRef.markForCheck();
  }

  runUpdateShouldRenderOptions(host: Host, options: Option[] | null | undefined): void {
    const v = host.displayStateManager.computeRenderReadiness(options);
    if (host.shouldRenderOptions() !== v) {
      host.shouldRenderOptions.set(v);
      host.cdRef.markForCheck();
    }
  }

  runSafeSetDisplayState(host: Host, state: { mode: 'question' | 'explanation'; answered: boolean }): void {
    if (host.displayStateManager.shouldSuppressDisplayState({
      visibilityRestoreInProgress: host._visibilityRestoreInProgress,
      suppressDisplayStateUntil: host._suppressDisplayStateUntil,
    })) {
      return;
    }
    host.displayStateSubject?.next(state);
  }
}
