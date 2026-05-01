import { Injectable } from '@angular/core';
import { take } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { Utils } from '../../../utils/utils';
import { QqcOrchLifecycleService } from './qqc-orch-lifecycle.service';
import { QqcOrchClickService } from './qqc-orch-click.service';
import { QqcOrchQuestionLoadService } from './qqc-orch-question-load.service';
import { QqcOrchTimerService } from './qqc-orch-timer.service';
import { QqcOrchExplanationService } from './qqc-orch-explanation.service';
import { QqcOrchSelectionService } from './qqc-orch-selection.service';

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
    private orchExplanation: QqcOrchExplanationService,
    private orchSelection: QqcOrchSelectionService,
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
    return this.orchExplanation.runOnVisibilityChange(host);
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
    return this.orchExplanation.runUpdateExplanationDisplay(host, shouldDisplay);
  }

  // ═══════════════════════════════════════════════════════════════
  // fetchAndSetExplanationText body
  // ═══════════════════════════════════════════════════════════════
  async runFetchAndSetExplanationText(host: Host, questionIndex: number): Promise<void> {
    return this.orchExplanation.runFetchAndSetExplanationText(host, questionIndex);
  }

  // ═══════════════════════════════════════════════════════════════
  // updateExplanationUI body
  // ═══════════════════════════════════════════════════════════════
  runUpdateExplanationUI(host: Host, questionIndex: number, explanationText: string): void {
    this.orchExplanation.runUpdateExplanationUI(host, questionIndex, explanationText);
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
    return this.orchSelection.runHandleOptionSelection(host, option, optionIndex, currentQuestion);
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
    return this.orchExplanation.runUpdateExplanationIfAnswered(host, index, question);
  }

  // ═══════════════════════════════════════════════════════════════
  // handlePageVisibilityChange body
  // ═══════════════════════════════════════════════════════════════
  runHandlePageVisibilityChange(host: Host, isHidden: boolean): void {
    this.orchExplanation.runHandlePageVisibilityChange(host, isHidden);
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
    return this.orchSelection.runIsAnyOptionSelected(host, questionIndex);
  }

  // ═══════════════════════════════════════════════════════════════
  // onSubmitMultiple body
  // ═══════════════════════════════════════════════════════════════
  async runOnSubmitMultiple(host: Host): Promise<void> {
    return this.orchSelection.runOnSubmitMultiple(host);
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
    return this.orchSelection.runPostClickTasks(host, opt, idx, checked, wasPreviouslySelected, questionIndex);
  }

  // ═══════════════════════════════════════════════════════════════
  // performInitialSelectionFlow body
  // ═══════════════════════════════════════════════════════════════
  async runPerformInitialSelectionFlow(host: Host, event: any, option: SelectedOption): Promise<void> {
    return this.orchSelection.runPerformInitialSelectionFlow(host, event, option);
  }

  // ═══════════════════════════════════════════════════════════════
  // applyFeedbackIfNeeded body
  // ═══════════════════════════════════════════════════════════════
  async runApplyFeedbackIfNeeded(host: Host, option: SelectedOption): Promise<void> {
    return this.orchSelection.runApplyFeedbackIfNeeded(host, option);
  }

  // ═══════════════════════════════════════════════════════════════
  // applyOptionFeedback body
  // ═══════════════════════════════════════════════════════════════
  async runApplyOptionFeedback(host: Host, selectedOption: Option): Promise<void> {
    return this.orchSelection.runApplyOptionFeedback(host, selectedOption);
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
    return this.orchSelection.runFinalizeSelection(host, option, index, wasPreviouslySelected);
  }

  // ═══════════════════════════════════════════════════════════════
  // fetchAndProcessCurrentQuestion body
  // ═══════════════════════════════════════════════════════════════
  async runFetchAndProcessCurrentQuestion(host: Host): Promise<QuizQuestion | null> {
    return this.orchSelection.runFetchAndProcessCurrentQuestion(host);
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
    return this.orchSelection.runSelectOption(host, currentQuestion, option, optionIndex);
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
    this.orchExplanation.runApplyExplanationTextInZone(host, text);
  }

  runApplyExplanationFlags(host: Host, flags: any): void {
    this.orchExplanation.runApplyExplanationFlags(host, flags);
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
    this.orchSelection.runUnselectOption(host);
  }

  runResetExplanation(host: Host, force = false): void {
    this.orchExplanation.runResetExplanation(host, force);
  }

  async runPrepareAndSetExplanationText(host: Host, questionIndex: number): Promise<string> {
    return this.orchExplanation.runPrepareAndSetExplanationText(host, questionIndex);
  }

  async runUpdateExplanationText(host: Host, index: number): Promise<string> {
    return this.orchExplanation.runUpdateExplanationText(host, index);
  }

  async runOnSubmit(host: Host): Promise<void> {
    return this.orchSelection.runOnSubmit(host);
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
    this.orchSelection.runEmitPassiveNow(host, index);
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
