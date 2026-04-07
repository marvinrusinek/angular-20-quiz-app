import { Injectable } from '@angular/core';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { SharedOptionConfig } from '../../../models/SharedOptionConfig.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { OptionClickHandlerService } from './option-click-handler.service';
import { OptionService } from '../view/option.service';
import { QuizService } from '../../data/quiz.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { FeedbackService } from '../../features/feedback/feedback.service';
import { OptionHydrationService } from './option-hydration.service';
import { OptionBindingFactoryService } from './option-binding-factory.service';
import { ExplanationTextService } from '../../features/explanation/explanation-text.service';

@Injectable({ providedIn: 'root' })
export class SharedOptionBindingService {
  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private feedbackService: FeedbackService,
    private optionHydrationService: OptionHydrationService,
    private optionBindingFactory: OptionBindingFactoryService,
    private explanationTextService: ExplanationTextService,
    private clickHandler: OptionClickHandlerService,
    private optionService: OptionService
  ) {}

  synchronizeOptionBindings(comp: any): void {
    if (!Array.isArray(comp.optionsToDisplay) || comp.optionsToDisplay.length === 0) {
      console.warn('[SOC] synchronizeOptionBindings() aborted — optionsToDisplay EMPTY');
      const hasSelection = comp.optionBindings?.some((opt: any) => opt.isSelected);
      if (!hasSelection && !comp.freezeOptionBindings) {
        comp.optionBindings = [];
      }
      return;
    }

    if (comp.freezeOptionBindings || comp.hasUserClicked) {
      console.warn('[SOC] freezeOptionBindings/hasUserClicked active — ABORTING reassignment');
      return;
    }

    const bindings = comp.optionsToDisplay.map((option: any, idx: number) => {
      const isSelected = option.selected ?? false;
      const isCorrect = option.correct ?? false;
      return {
        option,
        index: idx,
        isSelected,
        isCorrect,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: { [idx]: false },
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: isSelected && !isCorrect,
        highlightCorrect: isSelected && isCorrect,
        disabled: comp.computeDisabledState(option, idx),
        type: comp.resolveInteractionType(),
        appHighlightOption: isSelected,
        appHighlightInputType: (comp.type === 'multiple' ? 'checkbox' : 'radio') as 'checkbox' | 'radio',
        allOptions: [...comp.optionsToDisplay],
        appHighlightReset: false,
        ariaLabel: `Option ${idx + 1}`,
        appResetBackground: false,
        optionsToDisplay: [...comp.optionsToDisplay],
        checked: isSelected,
        change: () => { },
        active: true
      };
    });

    queueMicrotask(() => {
      comp.optionBindings = bindings;
      comp.showOptions = true;
      comp.renderReady = true;
      comp.cdRef.detectChanges();
      console.warn('[SOC] optionBindings REASSIGNED', bindings);
    });

    comp.updateHighlighting();
  }

  setOptionBindingsIfChanged(comp: any, newOptions: Option[]): void {
    if (!newOptions?.length) return;

    const incomingIds = newOptions.map((o: any) => o.optionId).join(',');
    const existingIds = comp.optionBindings?.map((b: any) => b.option.optionId).join(',');

    if (incomingIds !== existingIds || !comp.optionBindings?.length) {
      comp.optionBindings = newOptions.map((option: any, idx: number) => ({
        option: { ...option },
        index: idx,
        isSelected: !!option.selected,
        isCorrect: option.correct ?? false,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: false,
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        disabled: comp.computeDisabledState(option, idx),
        type: comp.resolveInteractionType(),
        appHighlightOption: false,
        appHighlightInputType: '',
        allOptions: comp.optionsToDisplay ?? []
      })) as unknown as OptionBindings[];
    } else {
      let idx = 0;
      for (const binding of comp.optionBindings ?? []) {
        const updated = newOptions[idx];
        if (updated) {
          binding.option = { ...updated };
          binding.isSelected = !!updated.selected;
          binding.isCorrect = updated.correct ?? false;
        }
        idx++;
      }
    }

    comp.optionsReady = true;
    comp.showOptions = true;

    if (this.explanationTextService.latestExplanation) {
      const currentIdx = comp.resolveDisplayIndex(comp.currentQuestionIndex);
      if (this.explanationTextService.latestExplanationIndex === currentIdx) {
        comp.deferHighlightUpdate(() => comp.emitExplanation(currentIdx));
      }
    }
  }

  generateOptionBindings(comp: any): void {
    if (comp.hasUserClicked && comp.optionBindings?.length > 0) {
      console.log('[generateOptionBindings] SKIPPED — user has already clicked, preserving binding state');
      return;
    }

    const currentIndex = comp.getActiveQuestionIndex() ?? 0;

    const localOpts = Array.isArray(comp.optionsToDisplay)
      ? comp.optionsToDisplay.map((o: any) => structuredClone(o))
      : [];

    const correctTexts = new Set<string>();
    const correctIds = new Set<number>();
    if (comp.currentQuestion && Array.isArray(comp.currentQuestion.answer)) {
      comp.currentQuestion.answer.forEach((a: any) => {
        if (!a) return;
        if (a.text) correctTexts.add(a.text.trim().toLowerCase());
        const id = Number(a.optionId);
        if (!isNaN(id)) correctIds.add(id);
      });
    }

    comp.optionsToDisplay = localOpts.map((opt: any, i: number) => {
      const oIdNum = Number(opt.optionId);
      const oId = !isNaN(oIdNum) ? oIdNum : (currentIndex + 1) * 100 + (i + 1);
      const oText = (opt.text ?? '').trim().toLowerCase();

      const isCorrect = opt.correct === true ||
        (opt as any).correct === "true" ||
        (!isNaN(oIdNum) && correctIds.has(oIdNum)) ||
        !!(oText && correctTexts.has(oText));

      return {
        ...opt,
        optionId: oId,
        correct: isCorrect,
        highlight: false,
        showIcon: false,
        active: opt.active ?? true,
        disabled: comp.computeDisabledState(opt, i)
      };
    });

    comp.optionBindings = this.optionBindingFactory.createBindings({
      optionsToDisplay: comp.optionsToDisplay,
      type: comp.resolveInteractionType(),
      showFeedback: comp.showFeedback,
      showFeedbackForOption: {},
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect,
      shouldResetBackground: comp.shouldResetBackground,
      ariaLabelPrefix: 'Option',
      onChange: (opt: any, idx: number) => comp.handleOptionClick(opt, idx),
      isSelected: () => false,
      isDisabled: (opt: any, idx: number) => comp.computeDisabledState(opt, idx)
    });

    comp.rehydrateUiFromState('generateOptionBindings');

    const hasFreshFeedback = Object.keys(comp.feedbackConfigs).length > 0;
    if (!hasFreshFeedback) {
      comp.rebuildShowFeedbackMapFromBindings();
    }

    comp.showOptions = true;
    comp.optionsReady = true;
    comp.renderReady = true;

    comp.markRenderReady('Bindings refreshed');
    comp.cdRef.markForCheck();
  }

  processOptionBindings(comp: any): void {
    const options = comp.optionsToDisplay ?? [];

    if (!options.length) {
      comp.optionBindingsInitialized = false;
      return;
    }
    if (comp.freezeOptionBindings) return;
    if (!comp.currentQuestion) return;

    const currentIdx = comp.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex();

    const savedSelections = this.selectedOptionService.getSelectedOptionsForQuestion(currentIdx) || [];
    const savedIds = this.optionHydrationService.toIdSet(savedSelections);

    const getBindings = comp.getOptionBindings.bind(comp);
    const highlightSet = comp.highlightedOptionIds;

    const feedbackSentence = this.feedbackService.buildFeedbackMessage(
      comp.currentQuestion,
      savedSelections,
      false,
      false,
      currentIdx,
      comp.optionsToDisplay
    ) || '';

    comp.optionBindings = options.map((opt: any, idx: number) => {
      const oIdNum = Number(opt.optionId);
      const effectiveId = (!isNaN(oIdNum) && oIdNum > -1) ? oIdNum : idx;

      if (opt.optionId == null) {
        opt.optionId = effectiveId;
      }

      opt.feedback = feedbackSentence;

      const isSelected = savedIds.has(effectiveId) || savedIds.has(String(effectiveId));

      const isMulti = comp.isMultiMode;
      if (!isMulti && (isSelected || highlightSet.has(effectiveId))) {
        opt.highlight = true;
      } else if (isMulti) {
        opt.highlight = false;
      }

      return getBindings(opt, idx, isSelected);
    });

    comp.rebuildShowFeedbackMapFromBindings();

    comp.updateSelections(-1);
    comp.updateHighlighting();

    comp.optionsReady = true;
    comp.renderReady = true;
    comp.viewReady = true;
    comp.cdRef.detectChanges();
  }

  hydrateOptionsFromSelectionState(comp: any): void {
    if (!Array.isArray(comp.optionsToDisplay) || comp.optionsToDisplay.length === 0) {
      return;
    }

    const currentIndex =
      comp.getActiveQuestionIndex() ??
      comp.currentQuestionIndex ??
      comp.questionIndex ??
      0;

    const storedSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(currentIndex) ?? [];

    comp.optionsToDisplay = comp.optionsToDisplay.map((opt: any, i: number) => {
      const match = storedSelections.find(
        (s: any) =>
          Number(s.optionId) === Number(opt.optionId) &&
          Number(s.questionIndex) === Number(currentIndex)
      );

      return {
        ...opt,
        optionId:
          typeof opt.optionId === 'number' && Number.isFinite(opt.optionId)
            ? opt.optionId
            : (currentIndex + 1) * 100 + (i + 1),
        selected: !!match?.selected,
        highlight: !!match?.highlight,
        showIcon: !!match?.showIcon,
        active: opt.active ?? true,
        disabled: comp.computeDisabledState(opt, i)
      };
    });

    comp.cdRef.markForCheck();
  }

  rehydrateUiFromState(comp: any, reason: string): void {
    if (comp.hasUserClicked || comp.freezeOptionBindings) return;

    const qIndex = comp.resolveCurrentQuestionIndex();
    const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    if (!saved.length) return;

    const savedByIndex = new Map<number, any>();
    for (const s of saved) {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      if (sIdx != null && Number.isFinite(Number(sIdx))) {
        savedByIndex.set(Number(sIdx), s);
      }
    }

    if (comp.optionBindings?.length) {
      comp.optionBindings.forEach((b: any, idx: number) => {
        const match = savedByIndex.get(idx);
        if (match) {
          b.isSelected = !!match.selected;
          b.option.selected = !!match.selected;

          if (comp.isMultiMode) {
            const isCorrect = comp.isCorrect(b.option);
            if (isCorrect) {
              let lastCorrectIdx: number | null = null;
              if (comp.selectedOptionHistory?.length > 0) {
                for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
                  const histId = comp.selectedOptionHistory[j];
                  let hIdx = comp.optionBindings.findIndex((_: any, bIdx: number) => bIdx === histId || String(bIdx) === String(histId));
                  if (hIdx === -1) {
                    hIdx = comp.optionBindings.findIndex((b2: any) => (b2.option?.optionId != null && b2.option.optionId !== -1 && b2.option.optionId == histId));
                  }
                  if (hIdx !== -1) {
                    const optAtH = comp.optionBindings[hIdx]?.option;
                    if (optAtH?.selected && comp.isCorrect(optAtH)) {
                      lastCorrectIdx = hIdx;
                      break;
                    }
                  }
                }
              }
              b.option.highlight = (lastCorrectIdx !== null && idx === lastCorrectIdx);
            } else {
              b.option.highlight = !!match.selected;
            }
          } else {
            b.option.highlight = !!match.selected;
          }
          b.option.showIcon = !!match.showIcon;
        } else {
          b.isSelected = false;
          b.option.selected = false;
          b.option.highlight = false;
          b.option.showIcon = false;
        }
        b.disabled = comp.computeDisabledState(b.option, idx);
        b.showFeedback = true;
      });
    }

    if (comp.optionsToDisplay?.length) {
      comp.optionsToDisplay.forEach((opt: any, idx: number) => {
        const match = savedByIndex.get(idx);
        if (match) {
          opt.selected = !!match.selected;
          if (comp.isMultiMode) {
            const isCorrect = comp.isCorrect(opt);
            if (isCorrect) {
              let lastCorrectIdx: number | null = null;
              if (comp.selectedOptionHistory?.length > 0) {
                for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
                  const hIdx = Number(comp.selectedOptionHistory[j]);
                  const optAtH = comp.optionsToDisplay[hIdx];
                  if (optAtH?.selected && comp.isCorrect(optAtH)) {
                    lastCorrectIdx = hIdx;
                    break;
                  }
                }
              }
              opt.highlight = (lastCorrectIdx !== null && idx === lastCorrectIdx);
            } else {
              opt.highlight = !!match.selected;
            }
          } else {
            opt.highlight = !!match.selected;
          }
          opt.showIcon = !!match.showIcon;
        } else {
          opt.selected = false;
          opt.highlight = false;
          opt.showIcon = false;
        }
      });
    }

    if (saved.length > 0) {
      const last = saved[saved.length - 1];
      const lastIdx = (last as any).displayIndex ?? (last as any).index ?? (last as any).idx;
      if (lastIdx != null && Number.isFinite(Number(lastIdx))) {
        comp.lastFeedbackOptionId = Number(lastIdx);
        comp.showFeedback = true;
      }
    }

    comp.rebuildShowFeedbackMapFromBindings();
    comp.updateHighlighting();
    comp.cdRef.markForCheck();
  }

  buildSharedOptionConfig(comp: any, b: OptionBindings, i: number): SharedOptionConfig {
    const qIndex = comp.resolveCurrentQuestionIndex();
    const isMulti = comp.isMultiMode;

    const isActuallySelected = isMulti
      ? b.isSelected
      : (() => {
          const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
          return currentSelections.some((s: any) => {
            const selIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
            return selIdx != null && Number(selIdx) === i;
          });
        })();

    const optionKey = this.optionService.keyOf(b.option, i);
    const showCorrectOnTimeout = comp.timerExpiredForQuestion
      && (comp.timeoutCorrectOptionKeys?.has(optionKey) || !!b.option.correct);

    let shouldHighlight = isMulti
      ? (!!b.option.highlight || showCorrectOnTimeout)
      : (!!b.option.highlight || isActuallySelected || showCorrectOnTimeout);

    const isOnCorrectQuestion = comp.lastProcessedQuestionIndex === qIndex;
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    const verifiedOption = {
      ...b.option,
      selected: isActuallySelected,
      highlight: shouldHighlight,
      showIcon: shouldHighlight
    };

    return {
      option: verifiedOption,
      idx: i,
      type: comp.resolveInteractionType(),
      isOptionSelected: isActuallySelected,
      isAnswerCorrect: b.isCorrect,
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect,
      shouldResetBackground:
        comp.shouldResetBackground || (!isOnCorrectQuestion && currentSelections.length === 0),
      feedback: b.feedback ?? '',
      showFeedbackForOption: comp.showFeedbackForOption,
      optionsToDisplay: comp.optionsToDisplay,
      selectedOption: comp.selectedOption,
      currentQuestion: comp.currentQuestion,
      showFeedback: comp.showFeedback,
      correctMessage: comp.correctMessage,
      showCorrectMessage: !!comp.correctMessage,
      explanationText: '',
      showExplanation: false,
      selectedOptionIndex: comp.selectedOptionIndex,
      highlight: shouldHighlight
    };
  }

  getOptionBindings(comp: any, option: Option, idx: number, isSelected: boolean = false): OptionBindings {
    const correctOptionsCount =
      comp.optionsToDisplay?.filter((opt: any) => opt.correct).length ?? 0;
    const inferredType = correctOptionsCount > 1 ? 'multiple' : 'single';
    const selected = isSelected;

    return {
      option: {
        ...structuredClone(option),
        feedback: option.feedback ?? 'No feedback available',
      },
      index: idx,
      feedback: option.feedback ?? 'No feedback available',
      isCorrect: option.correct ?? false,
      showFeedback: comp.showFeedback,
      showFeedbackForOption: comp.showFeedbackForOption,
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect,
      highlightIncorrect: selected && !option.correct,
      highlightCorrect: selected && !!option.correct,
      allOptions: comp.optionsToDisplay,
      type: comp.resolveInteractionType(),
      appHighlightOption: false,
      appHighlightInputType: inferredType === 'multiple' ? 'checkbox' : 'radio',
      appHighlightReset: comp.shouldResetBackground,
      appResetBackground: comp.shouldResetBackground,
      optionsToDisplay: comp.optionsToDisplay,
      isSelected: selected,
      active: option.active ?? true,
      change: () => comp.handleOptionClick(option as SelectedOption, idx),
      disabled: comp.computeDisabledState(option, idx),
      ariaLabel: 'Option ' + (idx + 1),
      checked: selected
    };
  }

  getInlineFeedbackConfig(comp: any, b: OptionBindings, i: number): FeedbackProps | null {
    if (comp._feedbackDisplay?.idx === i && comp._feedbackDisplay.config?.showFeedback) {
      let config = comp._feedbackDisplay.config;

      const qIdx = comp.getActiveQuestionIndex();

      let correctIndicesArr: number[] = comp._correctIndicesByQuestion?.get(qIdx) ?? [];
      if (correctIndicesArr.length === 0) {
        const feedbackQ = comp.currentQuestion ?? comp.getQuestionAtDisplayIndex(qIdx);
        const result = this.clickHandler.resolveCorrectIndices(
          feedbackQ, qIdx, comp.isMultiMode, comp.type
        );
        correctIndicesArr = result.correctIndices;
      }

      const effectiveMultiMode = comp.isMultiMode || comp.type === 'multiple' || correctIndicesArr.length > 1;
      const durableSelected = comp._multiSelectByQuestion?.get(qIdx);

      if (effectiveMultiMode && durableSelected && durableSelected.size > 0 && correctIndicesArr.length > 0) {
        const clickState = this.clickHandler.computeMultiAnswerClickState(
          i, durableSelected, correctIndicesArr
        );
        const newFeedback = this.clickHandler.generateMultiAnswerFeedbackText(clickState);

        if (newFeedback !== config.feedback) {
          config = { ...config, feedback: newFeedback };
        }
      }

      return config;
    }
    return null;
  }

  fullyResetRows(comp: any): void {
    for (let i = 0; i < (comp.optionBindings?.length ?? 0); i++) {
      const b = comp.optionBindings[i];
      b.isSelected = false;
      b.option.selected = false;
      b.option.highlight = false;
      b.option.showIcon = false;
      b.disabled = false;

      const id = b.option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : i;
      b.showFeedbackForOption[effectiveId as any] = false;
    }

    comp.lockedIncorrectOptionIds?.clear();
  }

  syncSelectedFlags(comp: any): void {
    for (let i = 0; i < (comp.optionBindings?.length ?? 0); i++) {
      const b = comp.optionBindings[i];
      const id = b.option.optionId;
      const numericId = (id != null && id !== -1) ? Number(id) : i;

      let chosen = comp.selectedOptionMap.has(i) ||
        (Number.isFinite(numericId) && comp.selectedOptionMap.has(numericId));

      if (!chosen) {
        chosen = comp.selectedOptionHistory.some((h: any) => Number(h) === numericId || Number(h) === i);
      }

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  forceDisableAllOptions(comp: any): void {
    comp.forceDisableAll = true;
    for (const binding of comp.optionBindings ?? []) {
      if (binding.option) {
        binding.option.active = false;
      }
    }
    comp.clickService?.updateBindingSnapshots(comp);
    for (const opt of comp.optionsToDisplay ?? []) {
      if (opt) {
        opt.active = false;
      }
    }
    comp.cdRef.markForCheck();
  }

  clearForceDisableAllOptions(comp: any): void {
    comp.forceDisableAll = false;
    for (const binding of comp.optionBindings ?? []) {
      if (binding.option) {
        binding.option.active = true;
      }
    }

    for (const opt of comp.optionsToDisplay ?? []) {
      if (opt) opt.active = true;
    }

    try {
      const qIndex = comp.currentQuestionIndex;
      this.selectedOptionService.unlockQuestion(qIndex);
    } catch { }

    comp.clickService?.updateBindingSnapshots(comp);
  }

  markRenderReady(comp: any, reason: string = ''): void {
    const bindingsReady =
      Array.isArray(comp.optionBindings) && comp.optionBindings.length > 0;

    const optionsReady =
      Array.isArray(comp.optionsToDisplay) && comp.optionsToDisplay.length > 0;

    if (bindingsReady && optionsReady) {
      comp.ngZone.run(() => {
        if (reason) {
          console.log('[renderReady]: ' + reason);
        }

        comp.renderReady = true;
        comp.renderReadyChange.emit(true);
        comp.renderReadySubject?.next(true);
      });
    } else {
      console.warn('[markRenderReady skipped] Incomplete state:', {
        bindingsReady,
        optionsReady,
        reason
      });
    }
  }
}
