import { Injectable } from '@angular/core';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioChange } from '@angular/material/radio';
import { FormGroup } from '@angular/forms';

import { QuestionType } from '../../../models/question-type.enum';
import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';

import { SelectedOptionService } from '../../state/selectedoption.service';
import { NextButtonStateService } from '../../state/next-button-state.service';
import { FeedbackService } from '../../features/feedback/feedback.service';
import { OptionVisualEffectsService } from '../view/option-visual-effects.service';
import { SelectionMessageService } from '../../features/selection-message/selection-message.service';
import { QuizService } from '../../data/quiz.service';
import { OptionSelectionPolicyService } from '../policy/option-selection-policy.service';
import { OptionLockPolicyService } from '../policy/option-lock-policy.service';
import { OptionLockRulesService } from '../policy/option-lock-rules.service';

export interface OptionUiSyncContext {
  form: any;
  type: 'single' | 'multiple';
  optionBindings: OptionBindings[];
  optionsToDisplay: Option[];
  currentQuestionIndex: number;

  forceDisableAll: boolean;

  feedbackConfigs: Record<string, any>;
  showFeedbackForOption: Record<number | string, boolean>;
  lastFeedbackOptionId: number | string;
  lastFeedbackQuestionIndex: number;

  lastClickedOptionId: number | string | null;
  lastClickTimestamp: number | null;

  freezeOptionBindings: boolean;
  hasUserClicked: boolean;

  showFeedback: boolean;
  selectedOptionHistory: (number | string)[];
  selectedOptionMap: Map<number | string, boolean>;
  perQuestionHistory: Set<number | string>;

  keyOf: (opt: Option, i: number) => string;
  getActiveQuestionIndex: () => number;
  getQuestionAtDisplayIndex: (idx: number) => QuizQuestion | null;
  emitExplanation: (idx: number, skipGuard?: boolean) => void;

  enforceSingleSelection: (b: OptionBindings) => void;
  syncSelectedFlags: () => void;
  toggleSelectedOption: (opt: Option) => void;
  onSelect?: (binding: OptionBindings, checked: boolean, questionIndex: number) => void;
}

@Injectable({ providedIn: 'root' })
export class OptionUiSyncService {
  constructor(
    private selectedOptionService: SelectedOptionService,
    private nextButtonStateService: NextButtonStateService,
    private feedbackService: FeedbackService,
    private selectionMessageService: SelectionMessageService,
    private quizService: QuizService,
    private optionVisualEffectsService: OptionVisualEffectsService,
    private optionSelectionPolicyService: OptionSelectionPolicyService,
    private optionLockPolicyService: OptionLockPolicyService,
    private optionLockRulesService: OptionLockRulesService
  ) { }

  updateOptionAndUI(
    optionBinding: OptionBindings,
    index: number,
    event: MatCheckboxChange | MatRadioChange,
    ctx: OptionUiSyncContext
  ): void {
    const currentIndex = ctx.getActiveQuestionIndex() ?? 0;
    const isCorrectHelper = (o: any): boolean => {
      if (!o) return false;
      const c = o.correct ?? o.isCorrect ?? (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    };

    this.resetFeedbackAnchorIfQuestionChanged(currentIndex, ctx);

    const checked = 'checked' in event ? (event as MatCheckboxChange).checked : true;
    const correctCountInBindings = ctx.optionBindings.filter(b => isCorrectHelper(b.option)).length;
    
    // Authoritative Type Resolution
    const qText = (ctx as any).currentQuestion?.questionText?.toLowerCase() || '';
    const isExplicitMulti = qText.includes('select all') || qText.includes('multiple') || qText.includes('apply');
    const isTrulyMulti = ctx.type === 'multiple' || (ctx as any).isMultiMode === true || 
                        isExplicitMulti || correctCountInBindings > 1;

    // UI-LEVEL RESET for single-answer mode (Visuals only, OIS handles service state)
    // ONLY run if it's definitely NOT a multi-answer scenario.
    if (!isTrulyMulti && checked) {
      console.log(`[OUS] Authoritative Visual Reset for Q${currentIndex + 1}`);
      // Accumulate history for previous-selection highlighting
      if (!ctx.selectedOptionHistory.includes(index)) {
        ctx.selectedOptionHistory.push(index);
      }
      // Seed history from durable sel_Q* on first post-refresh click.
      // ctx.selectedOptionHistory is component-local and empty after refresh,
      // but sel_Q* holds every prior click. Without seeding, prev-clicked
      // bindings unhighlight to white on the next click.
      try {
        const saved = this.selectedOptionService.getSelectedOptionsForQuestion(currentIndex) ?? [];
        for (const s of saved) {
          const sText = ((s as any)?.text ?? '').trim().toLowerCase();
          const sId = (s as any)?.optionId;
          let pos = -1;
          if (sText) {
            pos = ctx.optionBindings.findIndex((b: any) =>
              (b?.option?.text ?? '').trim().toLowerCase() === sText
            );
          }
          if (pos === -1 && sId != null && sId !== -1) {
            pos = ctx.optionBindings.findIndex((b: any) =>
              b?.option?.optionId != null && String(b.option.optionId) === String(sId)
            );
          }
          if (pos === -1) {
            const sIdx = (s as any)?.displayIndex ?? (s as any)?.index;
            if (sIdx != null && Number.isFinite(Number(sIdx))) pos = Number(sIdx);
          }
          if (pos !== -1 && !ctx.selectedOptionHistory.includes(pos)) {
            ctx.selectedOptionHistory.push(pos);
          }
        }
      } catch { /* ignore */ }
      const historySet = new Set(ctx.selectedOptionHistory);

      ctx.optionBindings.forEach((b, i) => {
        const isCurrent = (i === index);
        const inHistory = historySet.has(i);
        b.isSelected = isCurrent;
        if (b.option) {
          b.option.selected = isCurrent;
          b.option.highlight = isCurrent || inHistory;
          b.option.showIcon = isCurrent || inHistory;
        }
        b.highlightCorrect = false;
        b.highlightIncorrect = false;
        b.showFeedback = isCurrent;
      });
      ctx.selectedOptionMap.clear();
      ctx.feedbackConfigs = {};
    }

    if (this.isRapidDuplicateUnselect(optionBinding?.option?.optionId, checked, Date.now(), ctx)) {
      return;
    }

    const effectiveId = (optionBinding?.option?.optionId != null && optionBinding.option.optionId !== -1)
      ? optionBinding.option.optionId
      : index;

    console.log(`[OUS.updateOptionAndUI] Q${currentIndex + 1} Id=${effectiveId} Index=${index} checked=${checked}`);

    // Maintain global history for anchor fallback
    if (checked) {
      if (!ctx.selectedOptionHistory.includes(index)) {
        ctx.selectedOptionHistory.push(index);
      }
    }

    // Apply the selection to the current option (single-answer only)
    // For multi-answer, handleOptionClick already set the correct selection state
    if (!isTrulyMulti) {
      this.applySingleSelectionPainting(index, ctx);
    }

    if (checked) {
      ctx.selectedOptionMap.set(effectiveId, true);
      const anchorKey = `idx:${index}`;
      ctx.showFeedbackForOption[anchorKey] = true;
      ctx.lastFeedbackOptionId = index;
    } else {
      ctx.lastFeedbackOptionId = -1;
    }

    ctx.showFeedback = true;

    // authoritatively sync context flags to bindings before service calls
    this.syncSelectedFlags(ctx);

    // For multi-answer: set per-click correctness BEFORE the service call
    // (which triggers the subscription and dot re-render in quiz component)
    if (isTrulyMulti) {
      const clickedIsCorrect = isCorrectHelper(optionBinding.option);
      this.selectedOptionService.lastClickedCorrectByQuestion.set(currentIndex, clickedIsCorrect);
      console.log(`[OUS] lastClickedCorrectByQuestion Q${currentIndex + 1} = ${clickedIsCorrect} (checked=${checked}, option=`, optionBinding.option, ')');
    }

    // Sync to services (Single call here)
    this.forceSelectIntoServices(optionBinding, effectiveId, index, currentIndex, checked, ctx);

    this.toggleSelectedOption(optionBinding.option, index, checked, ctx);
    this.refreshFeedbackConfigForClicked(optionBinding, index, effectiveId, ctx);

    // Scoring and FET triggering for Multi-answer
    if (isTrulyMulti) {
      this.checkAndScoreMultiAnswer(ctx, currentIndex);
    }

    // Notify component (sound, etc.)
    if (ctx.onSelect) {
      ctx.onSelect(optionBinding, checked, currentIndex);
    }

    this.trackVisited(index, ctx);

    // FINAL FEEDBACK PASS: Only apply if refreshFeedbackConfigForClicked didn't
    // already set authoritative feedback (it handles resolution logic correctly).
    // Running applyFeedback after would overwrite with stale buildFeedbackMessage.


    // optional: refresh directive highlighting after state changes
    this.optionVisualEffectsService.refreshHighlights(ctx.optionBindings);

    // AUTHORITATIVE TYPE INFERENCE: Rely on data, not just metadata
    const resolvedType = (isTrulyMulti)
      ? QuestionType.MultipleAnswer
      : QuestionType.SingleAnswer;

    this.optionLockPolicyService.updateLockedIncorrectOptions({
      bindings: ctx.optionBindings ?? [],
      forceDisableAll: ctx.forceDisableAll,
      resolvedType,
      computeShouldLockIncorrectOptions: (t, has, all) =>
        this.optionLockRulesService.computeShouldLockIncorrectOptions(t, has, all)
    });

    // AUTHORITATIVE SYNC: Update SelectedOptionService with the locking results
    const qIdx = ctx.getActiveQuestionIndex();
    ctx.optionBindings.forEach((b, i) => {
      const lockId = (b.option?.optionId != null && String(b.option.optionId) !== '-1') ? b.option.optionId : i;
      if (b.disabled) {
        this.selectedOptionService.lockOption(qIdx, lockId);
      } else {
        this.selectedOptionService.unlockOption(qIdx, lockId);
      }
    });

    if (ctx.type === 'single') {
      this.optionSelectionPolicyService.enforceSingleSelection({
        optionBindings: ctx.optionBindings,
        selectedBinding: optionBinding,
        showFeedbackForOption: ctx.showFeedbackForOption,
        updateFeedbackState: (id) => {
          ctx.showFeedback = true;
          ctx.showFeedbackForOption[id] = true;
        }
      });
    }

    this.syncSelectedFlags(ctx);

    // SCORING: The checkbox `change` event path bypasses OIS and onOptionSelected,
    // so scoring must happen here for multi-answer questions. Check if ALL correct
    // answers are now selected and score accordingly.
    this.checkAndScoreMultiAnswer(ctx, currentIndex);

    this.selectionMessageService.notifySelectionMutated(ctx.optionsToDisplay);
    this.selectionMessageService.setSelectionMessage(false);
  }

  private resetFeedbackAnchorIfQuestionChanged(currentIndex: number, ctx: OptionUiSyncContext): void {
    if (ctx.lastFeedbackQuestionIndex !== currentIndex) {
      ctx.feedbackConfigs = {};
      // Mutate to clear instead of reassigning
      for (const k of Object.keys(ctx.showFeedbackForOption)) {
        delete ctx.showFeedbackForOption[k];
      }
      ctx.lastFeedbackOptionId = -1;
      ctx.lastFeedbackQuestionIndex = currentIndex;
      ctx.selectedOptionHistory.length = 0;
      ctx.selectedOptionMap.clear();
      ctx.perQuestionHistory.clear();
    }
  }

  private preservePreviousFeedbackAnchor(index: number, ctx: OptionUiSyncContext): void {
    if (
      ctx.lastFeedbackOptionId !== -1 &&
      ctx.lastFeedbackOptionId !== index
    ) {
      for (const k of Object.keys(ctx.showFeedbackForOption)) {
        ctx.showFeedbackForOption[k] = false;
      }

      ctx.showFeedbackForOption[ctx.lastFeedbackOptionId] = true;

      const cfg = ctx.feedbackConfigs[ctx.lastFeedbackOptionId];
      if (cfg) cfg.showFeedback = true;
    }
  }

  private isRapidDuplicateUnselect(
    optionId: number | string | undefined,
    checked: boolean,
    now: number,
    ctx: OptionUiSyncContext
  ): boolean {
    if (
      ctx.lastClickedOptionId === optionId &&
      ctx.lastClickTimestamp &&
      now - ctx.lastClickTimestamp < 150 &&
      !checked
    ) {
      console.warn('[Duplicate false event]', optionId);
      return true;
    }
    return false;
  }

  private forceSelectIntoServices(
    optionBinding: OptionBindings,
    optionId: number | string | undefined,
    index: number,
    currentIndex: number,
    checked: boolean,
    ctx: OptionUiSyncContext
  ): void {
    const getEffectiveId = (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const effectiveId = getEffectiveId(optionBinding.option, index);

    if (checked) {
      // Build the FULL list of selections PRESERVING TIME ORDER via history
      const fullSelections: any[] = [];
      const seenIndices = new Set<number>();

      // 1. Process history (known order)
      // selectedOptionMap is keyed by effectiveId (optionId when real,
      // else position index). selectedOptionHistory stores position
      // indices. Resolve each history entry to its binding's effectiveId
      // before checking the map, so a 1-based optionId that collides
      // with another option's position index doesn't cause a false match.
      for (const hIdx of ctx.selectedOptionHistory || []) {
        const numIdx = Number(hIdx);
        const hBinding = ctx.optionBindings[numIdx];
        const hEffId = hBinding ? getEffectiveId(hBinding.option, numIdx) : numIdx;
        if (ctx.selectedOptionMap.has(hEffId) && !seenIndices.has(numIdx)) {
          if (hBinding) {
            fullSelections.push({
              ...hBinding.option,
              optionId: hEffId,
              index: numIdx,
              displayIndex: numIdx,
              questionIndex: currentIndex,
              selected: true
            });
            seenIndices.add(numIdx);
          }
        }
      }

      // 2. Catch any selected options not in history (redundancy)
      // Use the binding's effectiveId for the map lookup — the map
      // key is effectiveId (optionId), not position index. Using the
      // raw position idx would false-positive when a 1-based optionId
      // from another option collides with this binding's array index.
      // Collision guard: when a binding has no real optionId, getEffectiveId
      // falls back to the array index, which can collide with another
      // binding's real optionId. Build a set of real IDs to detect this.
      const realIdOwnerForSelect = new Map<number | string, number>();
      ctx.optionBindings.forEach((b, idx) => {
        const id = b.option?.optionId;
        if (id != null && id !== -1) {
          realIdOwnerForSelect.set(id, idx);
        }
      });
      ctx.optionBindings.forEach((b, idx) => {
        const bEffId = getEffectiveId(b.option, idx);
        if (ctx.selectedOptionMap.has(bEffId) && !seenIndices.has(idx)) {
          // Reject false-positive: fallback index collides with another binding's real optionId
          const hasRealId = b.option?.optionId != null && b.option.optionId !== -1;
          if (!hasRealId) {
            const owner = realIdOwnerForSelect.get(bEffId);
            if (owner !== undefined && owner !== idx) {
              return; // skip — this binding doesn't actually match the map entry
            }
          }
          fullSelections.push({
            ...b.option,
            optionId: bEffId,
            index: idx,
            displayIndex: idx,
            questionIndex: currentIndex,
            selected: true
          });
          seenIndices.add(idx);
        }
      });

      // Selection: Store the COMPLETE set in service
      this.selectedOptionService.setSelectedOptionsForQuestion(currentIndex, fullSelections);
    } else {
      // Unselection: Remove from service using the unique array index
      this.selectedOptionService.removeOption(currentIndex, index as any, index);
    }

    // Only set answered=true and emit FET for single-answer when the
    // clicked option is actually correct (pristine check). After Restart Quiz,
    // binding correct flags can be stale, so resolve from quizInitialState.
    if (ctx.type === 'single') {
      let clickedIsCorrect = false;
      try {
        const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
        const clickedText = nrm(optionBinding?.option?.text);
        const bundle: any[] = (this.quizService as any)?.quizInitialState ?? [];
        const quizId = (this.quizService as any)?.quizId;
        if (clickedText && bundle.length > 0 && quizId) {
          const pristineQuiz = bundle.find((qz: any) => qz?.quizId === quizId);
          const pristineQ = pristineQuiz?.questions?.[currentIndex];
          if (pristineQ) {
            const matchedOpt = (pristineQ.options ?? []).find((o: any) => nrm(o?.text) === clickedText);
            if (matchedOpt) {
              clickedIsCorrect = matchedOpt?.correct === true || String(matchedOpt?.correct) === 'true';
            }
          }
        }
      } catch { /* ignore */ }

      if (clickedIsCorrect) {
        this.selectedOptionService.setAnswered(true, true);
        ctx.emitExplanation(currentIndex);
      }
    }

    // Update Next Button State based on ACTUAL selection count
    const hasSelection = ctx.selectedOptionMap.size > 0;
    this.nextButtonStateService.setNextButtonState(hasSelection);
  }

  private syncHighlightStateFromService(ctx: OptionUiSyncContext): void {
    const qIdx = ctx.getActiveQuestionIndex() ?? 0;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];

    const isCorrectHelper = (o: any): boolean => {
      if (!o) return false;
      const c = o.correct ?? o.isCorrect ?? (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    };
    const correctCount = ctx.optionBindings.filter(b => isCorrectHelper(b.option)).length;
    const isTrulyMulti = ctx.type === 'multiple' || (ctx as any).isMultiMode || correctCount > 1;

    for (const b of ctx.optionBindings) {
      const isSelected = selections.some((sel: any) => {
        const sIdx = sel.displayIndex ?? sel.index ?? sel.idx;
        const sId = sel.optionId;
        
        // Priority 1: Match by index (most reliable for unique options)
        if (sIdx != null && Number(sIdx) === b.index) return true;
        
        // Priority 2: Match by ID - ONLY if ID is valid and unique (not -1, not null)
        const bId = b.option?.optionId;
        if (sId != null && sId !== -1 && bId != null && bId !== -1 && String(sId) === String(bId)) {
          // Additional check: if another binding already claimed this index, don't double-match
          return true;
        }
        
        return false;
      });
      
      b.isSelected = isSelected;
      if (b.option) {
        b.option.selected = isSelected;
        // In Multi-answer, all selected are highlighted (Incorrect=Red, Correct=Green)
        // In Single-answer, all selected are also highlighted.
        b.option.highlight = isSelected;
        b.option.showIcon = isSelected;
      }
    }
  }

  private applySingleSelectionPainting(
    selectedIndex: number,
    ctx: OptionUiSyncContext
  ): void {
    const history = new Set(ctx.selectedOptionHistory || []);

    ctx.optionBindings.forEach((b, idx) => {
      const isSelected = (idx === selectedIndex);
      const inHistory = history.has(idx);

      b.isSelected = isSelected;
      b.option.selected = isSelected;
      
      b.option.highlight = isSelected || inHistory;
      b.option.showIcon = isSelected || inHistory;

      // Force directive update
      b.directiveInstance?.updateHighlight();
    });
  }

  private trackVisited(effectiveId: number | undefined, ctx: OptionUiSyncContext): boolean {
    let isAlreadyVisited = false;
    if (effectiveId !== undefined) {
      isAlreadyVisited = ctx.selectedOptionHistory.includes(effectiveId);
      if (!isAlreadyVisited) ctx.selectedOptionHistory.push(effectiveId);
    }
    return isAlreadyVisited;
  }

  private refreshFeedbackConfigForClicked(
    optionBinding: OptionBindings,
    index: number,
    optionId: number | string | undefined,
    ctx: OptionUiSyncContext
  ): void {
    const qIdx = ctx.getActiveQuestionIndex() ?? 0;
    const currentQuestion = ctx.getQuestionAtDisplayIndex(qIdx);
    const freshOptions = (ctx.optionsToDisplay?.length ?? 0) > 0
      ? ctx.optionsToDisplay
      : currentQuestion?.options ?? [];

    const isCorrectHelper = (val: any) => {
      if (!val) return false;
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (typeof val === 'object') {
        const c = val.correct ?? val.isCorrect ?? (val as any).correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };

    // Use existing binding state (set by handleOptionClick) as the source of truth.
    // Do NOT overwrite bindings from service — handleOptionClick already set the
    // correct isSelected state for each binding, and overwriting from the service
    // can restore stale/accumulated selections.
    const selectedOptions: Option[] = ctx.optionBindings
      .filter(b => b.isSelected)
      .map(b => b.option);

    const dynamicFeedback = currentQuestion
      ? this.feedbackService.buildFeedbackMessage(currentQuestion, selectedOptions, false, false, qIdx, freshOptions, optionBinding.option)
      : '';


    const correctMessage = this.feedbackService.setCorrectMessage(freshOptions, currentQuestion!);

    // EVALUATE RESOLUTION — use bindings as single source of truth for both
    // correct indices and selected indices to guarantee index consistency.
    const correctIndicesSet = new Set<number>();
    const futureIndices = new Set<number>();
    ctx.optionBindings.forEach((b, i) => {
      if (isCorrectHelper(b.option)) correctIndicesSet.add(i);
      if (b.isSelected) futureIndices.add(i);
    });

    const allCorrectFound = correctIndicesSet.size > 0 && [...correctIndicesSet].every(i => futureIndices.has(i));
    const numIncorrectInFuture = [...futureIndices].filter(i => !correctIndicesSet.has(i)).length;
    const isPerfect = allCorrectFound && numIncorrectInFuture === 0;

    // Determine if we are really in multi-mode for the sake of the feedback message
    const correctCountInBindings = correctIndicesSet.size;
    const isTrulyMulti = ctx.type === 'multiple' || (ctx as any).isMultiMode === true || correctCountInBindings > 1;

    const key = ctx.keyOf(optionBinding.option, index);
    for (const configKey of Object.keys(ctx.feedbackConfigs)) {
      ctx.feedbackConfigs[configKey].showFeedback = false;
    }

    ctx.feedbackConfigs[key] = {
      feedback: dynamicFeedback,
      showFeedback: true,
      options: freshOptions,
      question: currentQuestion ?? null,
      selectedOption: optionBinding.option,
      correctMessage: correctMessage,
      idx: index,
      questionIndex: qIdx
    } as any;

    // Simplified: update the feedback configuration only.
    // Locking is handled authoritatively by OptionLockPolicyService inside updateOptionAndUI.
    const isCorrectTarget = isCorrectHelper(optionBinding.option);
    
    if (allCorrectFound && isCorrectTarget) {
      if (ctx.feedbackConfigs[key]) {
        ctx.feedbackConfigs[key].feedback = `You're right! ${correctMessage}`;
      }
    } else if (isTrulyMulti && isCorrectTarget) {
       // intermediate multi-answer correct feedback
       const numCorrectSelected = [...futureIndices].filter(i => correctIndicesSet.has(i)).length;
       const remaining = Math.max(correctIndicesSet.size - numCorrectSelected, 0);
       if (remaining > 0) {
          const remText = remaining === 1 ? '1 more correct answer' : `${remaining} more correct answers`;
          if (ctx.feedbackConfigs[key]) {
            ctx.feedbackConfigs[key].feedback = `That's correct! Please select ${remText}.`;
          }
       }
    } else {
       // It's either an incorrect click, or it was wrong somehow
       if (ctx.feedbackConfigs[key]) {
         ctx.feedbackConfigs[key].feedback = dynamicFeedback; 
       }
    }


    // Anchor feedback using dual keys for robust lookup in template
    for (const k of Object.keys(ctx.showFeedbackForOption)) {
      delete ctx.showFeedbackForOption[k];
    }
    ctx.showFeedbackForOption[index] = true;
    ctx.showFeedbackForOption[String(index)] = true;
    if (optionId != null && optionId !== -1) {
      ctx.showFeedbackForOption[optionId as any] = true;
      ctx.showFeedbackForOption[String(optionId)] = true;
    }

    ctx.lastFeedbackOptionId = index;
    ctx.showFeedback = true;
    ctx.hasUserClicked = true;
  }

  /**
   * Check if all correct answers are selected for multi-answer questions and
   * trigger scoring via quizService.scoreDirectly(). This handles the checkbox
   * `change` event path which bypasses OIS and QuizComponent.onOptionSelected.
   */
  private syncSelectedFlags(ctx: OptionUiSyncContext): void {
    const getEffId = (o: any, idx: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : idx;

    // Collision guard: when a binding has no real optionId, getEffId falls back
    // to the array index.  That index can collide with another binding's real
    // optionId (e.g. binding[0].optionId=1 vs binding[1] fallback index=1).
    // Map real optionIds → their owning binding index so we can reject false matches.
    const realIdOwner = new Map<number | string, number>();
    for (let i = 0; i < (ctx.optionBindings?.length ?? 0); i++) {
      const id = ctx.optionBindings[i].option?.optionId;
      if (id != null && id !== -1) {
        realIdOwner.set(id, i);
      }
    }

    // DIAGNOSTIC: dump map keys and binding optionIds
    const _mapKeys = [...ctx.selectedOptionMap.entries()].filter(([,v]) => v).map(([k]) => k);
    const _ids = (ctx.optionBindings ?? []).map((b: any, i: number) => `${i}:id=${b.option?.optionId}`);
    console.error(`🔍 syncSelectedFlags mapKeys=[${_mapKeys}] ids=[${_ids.join(',')}]`);

    for (let i = 0; i < (ctx.optionBindings?.length ?? 0); i++) {
      const b = ctx.optionBindings[i];
      const eid = getEffId(b.option, i);
      let chosen = ctx.selectedOptionMap.get(eid) === true;

      // Reject false-positive: this binding has no real optionId and its
      // fallback index collides with another binding's real optionId.
      if (chosen) {
        const hasRealId = b.option?.optionId != null && b.option.optionId !== -1;
        if (!hasRealId) {
          const owner = realIdOwner.get(eid);
          if (owner !== undefined && owner !== i) {
            chosen = false;
          }
        }
      }

      if (chosen && i !== 0) {
        console.error(`🔍 syncSelectedFlags b[${i}] chosen=true eid=${eid} optionId=${b.option?.optionId} hasRealId=${b.option?.optionId != null && b.option.optionId !== -1}`);
      }

      b.option.selected = chosen;
      b.isSelected = chosen;

      // Sync optionsToDisplay selected flag (binding options are structuredClone'd copies)
      if (ctx.optionsToDisplay?.[i]) {
        ctx.optionsToDisplay[i].selected = chosen;
      }
    }
  }

  private checkAndScoreMultiAnswer(ctx: OptionUiSyncContext, questionIndex: number): void {
    const isCorrectHelper = (val: any) => {
      if (!val) return false;
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (typeof val === 'object') {
        const c = val.correct ?? val.isCorrect ?? (val as any).correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };
    const normalize = (s: unknown): string => String(s ?? '').trim().toLowerCase();

    // Get the authoritative question data
    const question = ctx.getQuestionAtDisplayIndex(questionIndex);
    const freshOptions = ctx.optionsToDisplay?.length > 0
      ? ctx.optionsToDisplay
      : (question?.options ?? []);

    // PRISTINE-FIRST: Resolve correct options from quizInitialState to avoid
    // stale/mutated correct flags on freshOptions (e.g. after Restart Quiz).
    let correctOptions = freshOptions.filter(o => isCorrectHelper(o));
    let correctTextSet = new Set(
      correctOptions.map(o => normalize(o.text)).filter(Boolean)
    );

    try {
      const bundle: any[] = (this.quizService as any)?.quizInitialState ?? [];
      const quizId = (this.quizService as any)?.quizId;
      if (bundle.length > 0 && quizId) {
        const pristineQuiz = bundle.find((qz: any) => qz?.quizId === quizId);
        const pristineQ = pristineQuiz?.questions?.[questionIndex];
        if (pristineQ) {
          const pristineCorrect = (pristineQ.options ?? [])
            .filter((o: any) => o?.correct === true || String(o?.correct) === 'true');
          if (pristineCorrect.length > 0) {
            correctOptions = pristineCorrect;
            correctTextSet = new Set(
              pristineCorrect.map((o: any) => normalize(o.text)).filter(Boolean)
            );
          }
        }
      }
    } catch { /* ignore */ }

    console.log(`[checkAndScoreMultiAnswer] Q${questionIndex + 1} ENTRY: freshOptions=${freshOptions.length}, correctOptions=${correctOptions.length}, options=`,
      freshOptions.map((o: any) => ({ id: o.optionId, text: o.text?.substring(0, 30), correct: o.correct, selected: o.selected }))
    );

    if (correctOptions.length === 0) {
      console.log(`[checkAndScoreMultiAnswer] Q${questionIndex + 1} EXIT EARLY: no correct options found`);
      return;
    }

    const isTrulyMulti = correctOptions.length > 1 || ctx.type === 'multiple';
    const isActuallySingle = !isTrulyMulti;

    // Gather selected options from MULTIPLE sources for robustness:
    // 1. Bindings (most immediate UI state)
    const bindingSelected = ctx.optionBindings
      .filter(b => b.isSelected || b.option.selected)
      .map(b => b.option);

    // 2. Context selectedOptionMap
    const mapSelectedIds = new Set<number | string>();
    if (ctx.selectedOptionMap) {
      for (const [key, val] of ctx.selectedOptionMap.entries()) {
        if (val) mapSelectedIds.add(key);
      }
    }
    const getEffIdMap = (o: any, idx: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : idx;
    const mapSelected = ctx.optionBindings
      .filter((b, idx) => {
        const eid = getEffIdMap(b.option, idx);
        return mapSelectedIds.has(eid) ||
          mapSelectedIds.has(String(eid)) ||
          mapSelectedIds.has(Number(eid));
      })
      .map(b => b.option);

    // 3. SelectedOptionService (source of truth)
    const serviceSelected = this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex) ?? [];

    // Use the source with the most entries (most complete state)
    let selectedOptions: any[] = bindingSelected;
    if (mapSelected.length > selectedOptions.length) selectedOptions = mapSelected;
    if (serviceSelected.length > selectedOptions.length) selectedOptions = serviceSelected;

    // Count how many correct options are among the selected, using text matching
    let correctSelectedCount = 0;
    let hasIncorrect = false;

    for (const sel of selectedOptions) {
      const selText = normalize(sel?.text);
      // Use pristine correctTextSet for matching, not stale binding flags
      if (selText && correctTextSet.has(selText)) {
        correctSelectedCount++;
      } else if (selText) {
        // If the selected text is not in the pristine correct set, it's incorrect
        hasIncorrect = true;
      }
    }

    console.log(`[checkAndScoreMultiAnswer] Q${questionIndex + 1} RESULT: correctSelectedCount=${correctSelectedCount}, correctOptions.length=${correctOptions.length}, hasIncorrect=${hasIncorrect}, isActuallySingle=${isActuallySingle}, selectedOptions=`,
      selectedOptions.map((s: any) => ({ id: s?.optionId, text: s?.text?.substring(0, 30), correct: s?.correct }))
    );

    if (isActuallySingle) {
      if (correctSelectedCount >= 1 && !hasIncorrect) {
        console.log(`[OptionUiSyncService] Scoring single-answer Q${questionIndex + 1} via change path`);
        this.quizService.scoreDirectly(questionIndex, true, false);
      }
    } else {
      // Also sanity-check the selection count directly against the durable
       // correct-index tracker via bindings. hasIncorrect text-matching can
       // false-negative when freshOptions has had correct flags mutated by
       // an earlier flow, which would otherwise let this branch fire after
       // only a partial set of correct answers plus incorrects.
      const selectedTexts = new Set(selectedOptions.map(s => normalize(s?.text)).filter(Boolean));
      const allCorrectTextsSelected =
        correctTextSet.size > 0 &&
        [...correctTextSet].every(t => selectedTexts.has(t));
      const anyIncorrectTextSelected = selectedTexts.size > 0 &&
        [...selectedTexts].some(t => !correctTextSet.has(t));
      if (
        correctSelectedCount >= correctOptions.length &&
        correctOptions.length >= 2 &&
        allCorrectTextsSelected &&
        !hasIncorrect &&
        !anyIncorrectTextSelected
      ) {
        console.log(`[OptionUiSyncService] ✅ Scoring multi-answer Q${questionIndex + 1}: ALL ${correctOptions.length} correct answers found`);
        this.quizService.scoreDirectly(questionIndex, true, true);
        // Force FET readiness even if already scored correct (to be safe)
        this.selectedOptionService.setAnswered(true, true);
        // Persist FET-ready state to sessionStorage. quiz-option-processing's
        // persistOptionSelection gates these writes on isQuestionComplete from
        // evaluateMultiAnswer, which can disagree for some questions (e.g.
        // non-contiguous correct indices). Writing here is a safety net so
        // FET actually renders when all correct answers are selected.
        try {
          sessionStorage.setItem('isAnswered', 'true');
          sessionStorage.setItem(`displayMode_${questionIndex}`, 'explanation');
        } catch { /* ignore */ }
        this.nextButtonStateService.setNextButtonState(true);
        // Emit FET — the shared-option-click path handles this when
        // clickState.remaining === 0, but when that path doesn't fire,
        // the explanation never renders. Emit here as a safety net.
        // skipGuard=true bypasses the lock that otherwise suppresses FET.
        if (ctx.emitExplanation) {
          setTimeout(() => ctx.emitExplanation(questionIndex, true), 0);
        }
      }
    }
  }

  private toggleSelectedOption(clicked: Option, clickedIndex: number, checked: boolean, ctx: OptionUiSyncContext): void {
    const isCorrectHelper = (val: any) => {
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (val && typeof val === 'object') {
        const c = val.correct ?? val.isCorrect;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };
    const correctCount = (ctx.optionsToDisplay ?? []).filter(o => isCorrectHelper(o)).length;
    const isMultiple = ctx.type === 'multiple' || correctCount > 1;

    const historySet = new Set(ctx.selectedOptionHistory || []);
    for (let i = 0; i < (ctx.optionsToDisplay ?? []).length; i++) {
      const o = ctx.optionsToDisplay[i];
      const isClicked = (i === clickedIndex);
      const inHistory = historySet.has(i);

      if (isMultiple) {
        // Multi-answer: toggle only the clicked option, preserve others
        if (isClicked) {
          o.selected = checked;
        }
        
        const isCorrect = isCorrectHelper(o);
        const isSelected = !!o.selected;

        o.highlight = isSelected;
        o.showIcon = isSelected;
      } else {
        o.selected = isClicked ? checked : false;
        o.showIcon = (isClicked && checked) || inHistory;
        o.highlight = (isClicked && checked) || inHistory;
      }
    }

    // keep array ref refresh if your UI depends on it
    ctx.optionsToDisplay = [...ctx.optionsToDisplay];
  }

  /* private isCorrectHelper(o: any): boolean {
    return o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
  } */

  private applyHighlighting(optionBinding: OptionBindings): void {
    const isHighlighted = !!optionBinding.option?.highlight;
    const isCorrect = (optionBinding.option as any)?.correct === true ||
      String((optionBinding.option as any)?.correct) === 'true' ||
      (optionBinding.option as any)?.correct === 1 ||
      (optionBinding.option as any)?.correct === '1';

    // Set binding-level highlight flags for component template consumption
    optionBinding.highlightCorrect = isHighlighted && isCorrect;
    optionBinding.highlightIncorrect = isHighlighted && !isCorrect;

    // Use binding-level cssClasses for robust [ngClass] updates
    optionBinding.cssClasses = {
      ...(optionBinding.cssClasses || {}),
      'correct-option': optionBinding.highlightCorrect,
      'incorrect-option': optionBinding.highlightIncorrect
    };

    // Ensure styleClass matches for backward compatibility with older templates
    optionBinding.styleClass = isHighlighted
      ? (isCorrect ? 'correct-option' : 'incorrect-option')
      : '';
  }

  private applyFeedback(
    optionBinding: OptionBindings,
    displayIndex: number,
    ctx: OptionUiSyncContext
  ): void {
    const qIdx = ctx.getActiveQuestionIndex() ?? 0;
    const question =
      ctx.getQuestionAtDisplayIndex(qIdx) ??
      ctx.getQuestionAtDisplayIndex(ctx.currentQuestionIndex ?? qIdx) ??
      null;

    if (!question) {
      console.warn('[applyFeedback] No question found. Feedback generation skipped.');
      return;
    }

    const visualOptions =
      (ctx.optionsToDisplay?.length ?? 0) > 0
        ? ctx.optionsToDisplay
        : (question.options ?? []);

    const isCorrectHelper = (val: any) => {
      if (!val) return false;
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (typeof val === 'object') {
        const c = val.correct ?? val.isCorrect ?? (val as any).correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };
    const correctCountInBindings = ctx.optionBindings.filter(b => isCorrectHelper(b.option)).length;
    const isMultipleMode = ctx.type === 'multiple' || (ctx as any).isMultiMode === true || correctCountInBindings > 1;
    const isTrulyMulti = isMultipleMode;
    const getEffId = (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const selectedOptions: Option[] = ctx.optionBindings
      .filter((b, idx) => {
        const eid = getEffId(b.option, idx);
        return ctx.selectedOptionMap.has(eid);
      })
      .map(b => b.option);

    // Build dynamic feedback
    const freshFeedback = this.feedbackService.buildFeedbackMessage(
      question,
      selectedOptions,
      false,
      false,
      qIdx,
      visualOptions,
      optionBinding.option
    );

    // Reveal message for correctMessage
    const correctMessage = this.feedbackService.generateFeedbackForOptions(
      visualOptions.filter(o => isCorrectHelper(o)),
      visualOptions
    );

    const key = ctx.keyOf(optionBinding.option, displayIndex);

    ctx.feedbackConfigs[key] = {
      feedback: freshFeedback,
      showFeedback: true,
      options: visualOptions,
      question,
      selectedOption: optionBinding.option,
      correctMessage: correctMessage,
      idx: displayIndex,
      questionIndex: qIdx
    } as any;

    if (ctx.feedbackConfigs[key]) {
      ctx.feedbackConfigs[key].showFeedback = true;
    }

    ctx.showFeedbackForOption[displayIndex] = true;
    ctx.showFeedbackForOption[String(displayIndex)] = true;

    const optionId = optionBinding.option?.optionId;
    if (optionId != null && optionId !== -1) {
      ctx.showFeedbackForOption[optionId as any] = true;
      ctx.showFeedbackForOption[String(optionId)] = true;
    }

    ctx.lastFeedbackOptionId = displayIndex;
    ctx.showFeedback = true;
  }
}