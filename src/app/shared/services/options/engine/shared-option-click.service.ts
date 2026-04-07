import { Injectable } from '@angular/core';

import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { FeedbackService } from '../../features/feedback/feedback.service';
import { SelectionMessageService } from '../../features/selection-message/selection-message.service';
import { TimerService } from '../../features/timer/timer.service';
import { ExplanationTextService } from '../../features/explanation/explanation-text.service';
import { OptionInteractionService, OptionInteractionState } from './option-interaction.service';
import { OptionClickHandlerService } from './option-click-handler.service';
import { OptionUiSyncService } from './option-ui-sync.service';
import { OptionSelectionPolicyService } from '../policy/option-selection-policy.service';
import { OptionService } from '../view/option.service';
import { OptionLockService } from '../policy/option-lock.service';
import { NextButtonStateService } from '../../state/next-button-state.service';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { QuestionType } from '../../../models/question-type.enum';

@Injectable({ providedIn: 'root' })
export class SharedOptionClickService {
  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private feedbackService: FeedbackService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private optionInteractionService: OptionInteractionService,
    private optionUiSyncService: OptionUiSyncService,
    private optionSelectionPolicyService: OptionSelectionPolicyService,
    private optionService: OptionService,
    private optionLockService: OptionLockService,
    private clickHandler: OptionClickHandlerService,
    private nextButtonStateService: NextButtonStateService
  ) {}

  onOptionUI(comp: any, ev: any): void {
    if (ev == null || ev.optionId == null) return;

    const index = ev.displayIndex ?? comp.findBindingByOptionId(ev.optionId)?.i;
    if (index === undefined || index < 0) return;
    const binding = comp.optionBindings[index];
    if (!binding) return;

    if (!comp.isDisabled(binding, index)) {
      comp.cdRef.markForCheck();
      comp.soundService.playOnceForOption({
        ...binding.option,
        selected: true,
        questionIndex: comp.currentQuestionIndex
      });
    }

    const now = Date.now();
    const isRapidDuplicate = comp._lastHandledIndex === index &&
      comp._lastHandledTime &&
      (now - comp._lastHandledTime < 100);

    if (ev.kind === 'change') {
      const native = ev.nativeEvent;

      if (isRapidDuplicate) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping 'change' for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Already handled)`);
        return;
      }

      comp._lastHandledIndex = index;
      comp._lastHandledTime = now;
      console.log(`[SOC.onOptionUI] 🟢 Processing 'change' for Q${comp.getActiveQuestionIndex() + 1} option ${index}`);

      this.quizStateService.markUserInteracted(comp.getActiveQuestionIndex());

      this.runOptionContentClick(comp, binding, index, native as any);
      return;
    }

    if (ev.kind === 'interaction' || ev.kind === 'contentClick') {
      const event = ev.nativeEvent as MouseEvent;

      if (comp.isDisabled(binding, index)) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const target = event?.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.closest('.mat-mdc-radio-button') ||
        target?.closest('.mat-mdc-checkbox')
      ) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' on input for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Delegating to 'change')`);
        return;
      }

      if (isRapidDuplicate) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Rapid duplicate)`);
        return;
      }

      if (comp.type === 'single' && !comp.isMultiMode && binding.option.selected && comp.showFeedback) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' for ALREADY selected single option ${index}`);
        return;
      }

      comp._lastHandledIndex = index;
      comp._lastHandledTime = now;
      console.log(`[SOC.onOptionUI] 🟢 Processing '${ev.kind}' for Q${comp.getActiveQuestionIndex() + 1} option ${index}`);

      if (comp.type === 'single') {
        const optionId = binding.option?.optionId ?? index;
        if (comp.form.get('selectedOptionId')?.value !== optionId) {
          comp.form.get('selectedOptionId')?.setValue(optionId, { emitEvent: false });
        }
      } else {
        const ctrl = comp.form.get(String(index));
        if (ctrl) {
          ctrl.setValue(!binding.option.selected, { emitEvent: false });
        }
      }

      this.runOptionContentClick(comp, binding, index, event);
      return;
    }
  }

  runOptionContentClick(comp: any, binding: any, index: number, event: any): void {
    const now = Date.now();
    if (comp._lastRunClickIndex === index && comp._lastRunClickTime && (now - comp._lastRunClickTime) < 200) {
      console.log(`[SOC.runOptionContentClick] Skipping rapid duplicate for index=${index}`);
      return;
    }
    comp._lastRunClickIndex = index;
    comp._lastRunClickTime = now;

    this.quizStateService.markUserInteracted(comp.getActiveQuestionIndex());

    const baseCtx = comp.buildOptionUiSyncContext();
    const state: any = {
      ...baseCtx,
      disabledOptionsPerQuestion: comp.disabledOptionsPerQuestion,
      correctClicksPerQuestion: comp.correctClicksPerQuestion,
      freezeOptionBindings: comp.freezeOptionBindings,
      disableRenderTrigger: comp.disableRenderTrigger,
      currentQuestion: comp.currentQuestion,
      currentQuestionIndex: baseCtx.getActiveQuestionIndex(),
      showExplanationChange: comp.showExplanationChange,
      explanationToDisplayChange: comp.explanationToDisplayChange
    };

    comp.freezeOptionBindings = true;
    state.freezeOptionBindings = true;

    try {
      this.optionInteractionService.handleOptionClick(
        binding,
        index,
        event,
        state,
        (idx: number) => comp.getQuestionAtDisplayIndex(idx),
        (idx: number) => comp.emitExplanation(idx),
        (b: any, i: number, ev: any, existingCtx: any) => {
          this.updateOptionAndUI(comp, b, i, ev, existingCtx || state);
          state.showFeedback = comp.showFeedback;
          state.showFeedbackForOption = comp.showFeedbackForOption;
          state.feedbackConfigs = comp.feedbackConfigs;
          state.lastFeedbackOptionId = comp.lastFeedbackOptionId;
          state.disableRenderTrigger = comp.disableRenderTrigger;
        }
      );
    } finally {
      comp.freezeOptionBindings = false;
      state.freezeOptionBindings = false;
    }

    comp.disableRenderTrigger = state.disableRenderTrigger;
    comp.lastClickedOptionId = state.lastClickedOptionId;
    comp.lastClickTimestamp = state.lastClickTimestamp;
    comp.hasUserClicked = state.hasUserClicked;
    comp.freezeOptionBindings = state.freezeOptionBindings;
    comp.showFeedback = state.showFeedback;
    comp.showFeedbackForOption = state.showFeedbackForOption;
    comp.feedbackConfigs = state.feedbackConfigs;
    comp.lastFeedbackOptionId = state.lastFeedbackOptionId;

    for (const b of state.optionBindings) {
      if (b) {
        b.showFeedbackForOption = { ...comp.showFeedbackForOption };
      }
    }
    comp.optionBindings = state.optionBindings;

    const qIdx = comp.getActiveQuestionIndex();
    if (!comp._multiSelectByQuestion.has(qIdx)) {
      comp._multiSelectByQuestion.set(qIdx, new Set<number>());
    }
    const durableSet = comp._multiSelectByQuestion.get(qIdx)!;
    durableSet.add(index);
    console.log(`[SOC] DURABLE tracker Q${qIdx + 1}: clicked=${index}, all selected=[${[...durableSet]}]`);

    if (!comp._correctIndicesByQuestion.has(qIdx)) {
      const question = comp.currentQuestion ?? comp.getQuestionAtDisplayIndex(qIdx);
      const result = this.clickHandler.resolveCorrectIndices(
        question, qIdx, comp.isMultiMode, comp.type
      );
      comp._correctIndicesByQuestion.set(qIdx, result.correctIndices);
    }
    const correctIndicesFromQ = comp._correctIndicesByQuestion.get(qIdx)!;
    const correctCountFromQ = correctIndicesFromQ.length;
    const isMultiFromQ = comp.isMultiMode || comp.type === 'multiple' || correctCountFromQ > 1;

    console.log(`[SOC.runOptionContentClick] DEBUG: Q${qIdx + 1} index=${index} isMultiFromQ=${isMultiFromQ} correctIndicesFromQ=[${correctIndicesFromQ}]`);

    if (isMultiFromQ && correctCountFromQ > 0) {
      const clickState = this.clickHandler.computeMultiAnswerClickState(
        index, durableSet, correctIndicesFromQ
      );

      console.log(`[SOC] MULTI-ANSWER STATE Q${qIdx + 1}: correctSel=${clickState.correctSelected}, incorrectSel=${clickState.incorrectSelected}, remaining=${clickState.remaining}, durableSet=[${[...durableSet]}]`);

      if (!comp.disabledOptionsPerQuestion.has(qIdx)) {
        comp.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
      }
      const disabledSetRef = comp.disabledOptionsPerQuestion.get(qIdx)!;
      this.clickHandler.updateDisabledSet(
        disabledSetRef, index, clickState.isClickedCorrect,
        clickState.remaining, comp.optionBindings.length, correctIndicesFromQ
      );

      const bindingUpdates = this.clickHandler.computeMultiAnswerBindingUpdates(
        comp.optionBindings.length, durableSet, correctIndicesFromQ, disabledSetRef
      );
      comp.optionBindings = comp.optionBindings.map((ob: any, bi: number) => ({
        ...ob,
        isSelected: bindingUpdates[bi].isSelected,
        isCorrect: bindingUpdates[bi].isCorrect,
        disabled: bindingUpdates[bi].disabled,
        option: ob.option ? {
          ...ob.option,
          ...bindingUpdates[bi].optionOverrides
        } : ob.option
      }));

      const feedbackText = this.clickHandler.generateMultiAnswerFeedbackText(clickState);

      const correctMessage = this.feedbackService.setCorrectMessage(
        (comp.optionsToDisplay ?? []).filter((o: any) => o && typeof o === 'object'),
        comp.currentQuestion!
      );
      comp._feedbackDisplay = {
        idx: index,
        config: {
          feedback: feedbackText,
          showFeedback: true,
          correctMessage,
          selectedOption: binding.option,
          options: comp.optionsToDisplay ?? [],
          question: comp.currentQuestion ?? null,
          idx: index
        } as FeedbackProps
      };
      console.log(`[SOC] FORCED _feedbackDisplay: idx=${index} text="${feedbackText}"`);

      const optsForMsg: Option[] = comp.optionBindings.map((ob: any, bi: number) => ({
        ...ob.option,
        correct: new Set(correctIndicesFromQ).has(bi),
        selected: durableSet.has(bi),
      })) as Option[];
      const selMsg = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions ?? 0,
        qType: QuestionType.MultipleAnswer,
        opts: optsForMsg
      });
      this.selectionMessageService.pushMessage(selMsg, qIdx);
      queueMicrotask(() => this.selectionMessageService.pushMessage(selMsg, qIdx));
      setTimeout(() => this.selectionMessageService.pushMessage(selMsg, qIdx), 0);

      if (clickState.remaining === 0) {
        try { this.timerService.stopTimer?.(undefined, { force: true }); } catch {}
        this.nextButtonStateService.setNextButtonState(true);

        this.quizService.scoreDirectly(qIdx, true, true);
        console.log(`[SOC] Scored multi-answer Q${qIdx + 1} as correct (incorrectSel=${clickState.incorrectSelected})`);

        if (!(this.quizService as any)._multiAnswerPerfect) {
          (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
        }
        (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);

        (this.explanationTextService as any)._fetLocked = false;
        this.explanationTextService.unlockExplanation();

        comp.showExplanationChange.emit(true);
        setTimeout(() => comp.emitExplanation(qIdx, true), 0);
      }

      const savedFeedback = comp._feedbackDisplay;
      queueMicrotask(() => {
        comp._feedbackDisplay = savedFeedback;
        comp.cdRef.detectChanges();
      });

      comp.showFeedback = true;
      comp.cdRef.detectChanges();
      return;
    }

    comp._feedbackDisplay = null;
    if (comp.showFeedback) {
      const clickedBinding = comp.optionBindings[index];
      if (clickedBinding) {
        const key = comp.keyOf(clickedBinding.option, index);
        const byKey = comp.feedbackConfigs[key];
        const byIdx = (Object.values(comp.feedbackConfigs) as FeedbackProps[]).find(
          (c: any) => c?.idx === index && c.showFeedback
        );
        let cfg: FeedbackProps | undefined =
          (byKey?.showFeedback ? byKey : undefined) ??
          byIdx ??
          (comp.activeFeedbackConfig?.showFeedback ? comp.activeFeedbackConfig : undefined);

        if (cfg?.showFeedback) {
          cfg = this.clickHandler.overrideMultiAnswerFeedback(
            cfg, clickedBinding, comp.optionBindings
          );
        }

        if (cfg?.showFeedback) {
          comp._feedbackDisplay = { idx: index, config: cfg };
          console.log(`[SOC] _feedbackDisplay SET: idx=${index} text="${cfg.feedback}"`);
        } else {
          console.warn(`[SOC] No feedback config found for idx=${index}`, {
            key,
            feedbackConfigKeys: Object.keys(comp.feedbackConfigs),
            activeFeedbackConfig: comp.activeFeedbackConfig
          });
        }
      }
    }

    comp.cdRef.detectChanges();
  }

  handleSelection(comp: any, option: SelectedOption, index: number, optionId: number): void {
    const normalizedId = (optionId != null && !isNaN(Number(optionId))) ? Number(optionId) : null;
    const effectiveId = (normalizedId !== null && normalizedId > -1) ? normalizedId : index;

    const correctCount = (comp.currentQuestion?.options?.filter((o: any) => {
      const c = (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }).length ?? 0);
    const isMultiMode = comp.type === 'multiple' ||
      comp.config.type === 'multiple' ||
      correctCount > 1;

    if (!isMultiMode) {
      for (const opt of comp.optionsToDisplay || []) {
        opt.selected = false;
      }
      for (const b of comp.optionBindings || []) {
        b.isSelected = false;
        b.option.selected = false;
      }

      option.selected = true;
      if (comp.optionsToDisplay?.[index]) {
        comp.optionsToDisplay[index].selected = true;
      }
      comp.config.selectedOptionIndex = index;
      comp.selectedOption = option;

      comp.selectedOptions.clear();
      comp.selectedOptions.add(effectiveId);
      this.selectedOptionService.setSelectedOption(option);
    } else {
      const qIdx = comp.getActiveQuestionIndex() ?? 0;

      option.selected = !option.selected;
      if (comp.optionsToDisplay?.[index]) {
        comp.optionsToDisplay[index].selected = option.selected;
      }

      option.selected
        ? comp.selectedOptions.add(effectiveId)
        : comp.selectedOptions.delete(effectiveId);

      const selOpt: SelectedOption = {
        ...option,
        optionId: (option.optionId != null && option.optionId !== -1) ? option.optionId : effectiveId,
        questionIndex: qIdx,
        selected: option.selected
      };
      this.selectedOptionService.addOption(qIdx, selOpt);
    }

    const optionBinding = comp.optionBindings[index];
    if (optionBinding) {
      optionBinding.isSelected = option.selected;
    }
  }

  updateOptionAndUI(comp: any, optionBinding: any, index: number, event: any, existingCtx?: any): void {
    const ctx = existingCtx ?? comp.buildOptionUiSyncContext();

    this.optionUiSyncService.updateOptionAndUI(optionBinding, index, event, ctx);

    comp.feedbackConfigs = { ...ctx.feedbackConfigs };
    comp.showFeedbackForOption = { ...ctx.showFeedbackForOption };
    comp.showFeedback = ctx.showFeedback;
    comp.lastFeedbackOptionId = Number(ctx.lastFeedbackOptionId);
    comp.lastFeedbackQuestionIndex = ctx.lastFeedbackQuestionIndex;
    const isChecked = 'checked' in event ? event.checked : true;
    comp.lastSelectedOptionIndex = isChecked ? index : -1;
    comp.lastSelectedOptionId = ctx.lastFeedbackOptionId;

    const feedbackKey = comp.keyOf(optionBinding.option, index);
    const syncedConfig = comp.feedbackConfigs[feedbackKey] as FeedbackProps | undefined;
    if (syncedConfig?.showFeedback) {
      comp.activeFeedbackConfig = syncedConfig;
      comp.currentFeedbackConfig = syncedConfig;
      comp._lastClickFeedback = {
        index,
        config: syncedConfig,
        questionIdx: comp.resolveCurrentQuestionIndex()
      };
    }

    comp.selectedOptions.clear();
    for (const id of ctx.selectedOptionMap.keys()) {
      comp.selectedOptions.add(Number(id));
    }

    if (ctx.optionBindings) {
      comp.optionBindings = [...ctx.optionBindings];
    } else {
      comp.optionBindings = comp.optionBindings.map((b: any) => ({
        ...b,
        showFeedbackForOption: { ...comp.showFeedbackForOption },
        showFeedback: comp.showFeedback,
        disabled: comp.computeDisabledState(b.option, b.index)
      }));
    }

    this.updateBindingSnapshots(comp);
    comp.cdRef.detectChanges();
  }

  handleBackwardNavigationOptionClick(comp: any, option: any, index: number): void {
    const optionBinding = comp.optionBindings[index];

    if (comp.type === 'single') {
      for (const binding of comp.optionBindings) {
        const isThis = binding === optionBinding;
        binding.isSelected = isThis;
        binding.option.showIcon = isThis;
      }
      comp.selectedOption = option;
      comp.selectedOptions.clear();
      const optId = option.optionId ?? -1;
      comp.selectedOptions.add(optId);
    } else {
      optionBinding.isSelected = !optionBinding.isSelected;
      optionBinding.option.showIcon = optionBinding.isSelected;
      const id = option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : index;
      if (optionBinding.isSelected) {
        comp.selectedOptions.add(Number(effectiveId));
      } else {
        comp.selectedOptions.delete(Number(effectiveId));
      }
    }

    comp.showFeedback = true;
    comp.updateHighlighting();
    comp.emitExplanation(comp.resolvedQuestionIndex ?? 0);
    comp.cdRef.markForCheck();
    comp.isNavigatingBackwards = false;
  }

  applySelectionsUI(comp: any, selectedOptions: any[]): void {
    if (!comp.optionsToDisplay?.length) return;
    if (comp.hasUserClicked || comp.freezeOptionBindings) return;

    const selIndices = new Set<number>();
    for (const s of selectedOptions) {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      if (sIdx != null && Number.isFinite(Number(sIdx))) {
        selIndices.add(Number(sIdx));
      }
    }

    const isCorrect = (o: any) => {
      if (!o) return false;
      return o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1';
    };

    let lastCorrectIdx: number | null = null;
    for (let i = selectedOptions.length - 1; i >= 0; i--) {
      const s = selectedOptions[i];
      if (isCorrect(s)) {
        const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
        if (sIdx != null && Number.isFinite(Number(sIdx))) {
          lastCorrectIdx = Number(sIdx);
          break;
        }
      }
    }

    for (let i = 0; i < comp.optionsToDisplay.length; i++) {
      const opt = comp.optionsToDisplay[i];
      const isSelected = selIndices.has(i);
      opt.selected = isSelected;
      opt.showIcon = isSelected;
      opt.highlight = isSelected;
    }

    comp.generateOptionBindings();
    comp.cdRef.markForCheck();
  }

  updateBindingSnapshots(comp: any): void {
    if (!comp.optionBindings?.length) return;

    for (const binding of comp.optionBindings) {
      if (binding && binding.option) {
        binding.disabled = comp.computeDisabledState(binding.option, binding.index);

        const qIndex = comp.currentQuestionIndex;
        const isLocked = this.optionLockService.isLocked(binding, binding.index, qIndex);

        binding.cssClasses = this.optionService.getOptionClasses(
          binding,
          binding.index,
          comp.highlightedOptionIds,
          comp.flashDisabledSet,
          isLocked,
          comp.timerExpiredForQuestion
        );

        binding.optionIcon = this.optionService.getOptionIcon(binding, binding.index);

        binding.optionCursor = this.optionService.getOptionCursor(
          binding,
          binding.index,
          binding.disabled,
          comp.timerExpiredForQuestion
        );
      }
    }
    comp.cdRef.markForCheck();
  }

  preserveOptionHighlighting(comp: any): void {
    const isMulti = comp.isMultiMode;

    for (const option of comp.optionsToDisplay) {
      if (!option.selected) {
        option.highlight = false;
        option.showIcon = false;
        continue;
      }

      const isCorrect = this._isCorrect(option);
      if (isMulti) {
        if (isCorrect) {
          let lastCorrectIdx = -1;
          if (comp.selectedOptionHistory?.length > 0) {
            for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
              const histId = comp.selectedOptionHistory[j];
              let hIdx = comp.optionsToDisplay.findIndex((_: any, oIdx: number) => oIdx === histId || String(oIdx) === String(histId));
              if (hIdx === -1) {
                hIdx = comp.optionsToDisplay.findIndex((o: any) => (o.optionId != null && o.optionId !== -1 && o.optionId == histId));
              }

              if (hIdx !== -1) {
                const oH = comp.optionsToDisplay[hIdx];
                if (oH?.selected && this._isCorrect(oH)) {
                  lastCorrectIdx = hIdx;
                  break;
                }
              }
            }
          }
          option.highlight = (comp.optionsToDisplay.indexOf(option) === lastCorrectIdx);
        } else {
          option.highlight = true;
        }
      } else {
        option.highlight = true;
      }
      option.showIcon = true;
    }
  }

  ensureOptionsToDisplay(comp: any): void {
    const activeIdx = comp.getActiveQuestionIndex();
    const displayQuestion = comp.getQuestionAtDisplayIndex(activeIdx);
    const fallbackOptions =
      displayQuestion?.options?.length
        ? displayQuestion.options
        : comp.currentQuestion?.options;

    if (
      Array.isArray(comp.optionsToDisplay) &&
      comp.optionsToDisplay.length > 0
    ) {
      return;
    }

    if (Array.isArray(fallbackOptions) && fallbackOptions.length > 0) {
      comp.optionsToDisplay = fallbackOptions.map((option: any) => ({
        ...option,
        active: option.active ?? true,
        feedback: option.feedback ?? undefined,
        showIcon: option.showIcon ?? false
      }));
      console.info(
        '[SharedOptionComponent] Restored optionsToDisplay from display-order question/options fallback'
      );
    } else {
      console.warn(
        '[SharedOptionComponent] No valid options available to restore.'
      );
      comp.optionsToDisplay = [];
    }

    comp.ensureOptionIds();
  }

  enforceSingleSelection(comp: any, selectedBinding: OptionBindings): void {
    this.optionSelectionPolicyService.enforceSingleSelection({
      optionBindings: comp.optionBindings,
      selectedBinding,
      showFeedbackForOption: comp.showFeedbackForOption,
      updateFeedbackState: (id: number) => {
        if (!comp.showFeedbackForOption) {
          comp.showFeedbackForOption = {};
        }
        comp.showFeedback = true;
        comp.showFeedbackForOption[id] = true;
      },
    });
  }

  private _isCorrect(o: any): boolean {
    if (o === true || o === 'true' || o === 1 || o === '1') return true;
    if (o && typeof o === 'object') {
      const c = o.correct ?? o.isCorrect ?? (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }
    return false;
  }
}
