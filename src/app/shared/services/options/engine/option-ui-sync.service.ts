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
import { FeedbackService } from '../../features/feedback.service';
import { OptionVisualEffectsService } from '../view/option-visual-effects.service';
import { SelectionMessageService } from '../../features/selection-message.service';
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
  emitExplanation: (idx: number) => void;

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
    const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');

    this.resetFeedbackAnchorIfQuestionChanged(currentIndex, ctx);

    const optionId = optionBinding?.option?.optionId;
    const now = Date.now();
    const checked = 'checked' in event ? (event as MatCheckboxChange).checked : true;

    const alreadySelected = !!optionBinding.option.selected && checked;

    // Always set selection state first
    optionBinding.option.selected = checked;

    // KEEP CANONICAL SELECTED FLAGS IN SYNC
    for (const b of ctx.optionBindings) {
      b.isSelected = b.option.selected ?? false;
    }

    if (alreadySelected) {
      // Even when the option is already selected, this still came from a user click.
      // Emit onSelect so caller-side side effects (like sound feedback) are not skipped.
      if (ctx.onSelect) {
        ctx.onSelect(optionBinding, checked, currentIndex);
      }

      this.preservePreviousFeedbackAnchor(index, ctx);
      ctx.emitExplanation(currentIndex);
      return;
    }

    if (this.isRapidDuplicateUnselect(optionId, checked, now, ctx)) {
      return;
    }

    // Apply selection state + history

    // Force service update call moved down to ensure map is updated first

    const getEffectiveId = (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const effectiveId = getEffectiveId(optionBinding.option, index);

    console.log(`[OUS.updateOptionAndUI] Q${currentIndex + 1} Id=${effectiveId} Index=${index} checked=${checked}`);

    // Update individual option state
    optionBinding.option.selected = checked;
    optionBinding.isSelected = checked;

    // Maintain global history for anchor fallback
    if (checked) {
      if (!ctx.selectedOptionHistory.includes(index)) {
        ctx.selectedOptionHistory.push(index);
      }
    }

    // AUTHORITATIVE ANCHOR RESET: Clear all existing markers 
    // (Removed start-of-method clear to allow additive transitions if needed, 
    // now handled inside checked/else blocks)

    if (ctx.type === 'single') {
      ctx.selectedOptionMap.clear();
      this.applySingleSelectionPainting(index, ctx);
    }

    if (checked) {
      // AUTHORITATIVE ANCHOR RESET: Clear previous anchors so only the newest one stays
      for (const k of Object.keys(ctx.showFeedbackForOption)) {
        delete ctx.showFeedbackForOption[k];
      }

      ctx.selectedOptionMap.set(index, true);
      // Set anchor at both index and effectiveId for robust matching in SOC
      ctx.showFeedbackForOption[index] = true;
      ctx.showFeedbackForOption[String(index)] = true;
      if (effectiveId != null) {
        ctx.showFeedbackForOption[effectiveId as any] = true;
      }
      ctx.lastFeedbackOptionId = index;
    } else {
      ctx.selectedOptionMap.delete(index);
      // Remove from anchor map too
      delete ctx.showFeedbackForOption[index];
      delete ctx.showFeedbackForOption[String(index)];
      if (effectiveId != null) {
        delete ctx.showFeedbackForOption[effectiveId as any];
        delete ctx.showFeedbackForOption[String(effectiveId)];
      }

      // FALLBACK ANCHOR: If unselecting, find the last remaining selection
      const stillSelectedIdx = [...(ctx.selectedOptionHistory || [])]
        .reverse()
        .find(idx => ctx.selectedOptionMap.has(idx));

      if (stillSelectedIdx !== undefined) {
        const sIdx = Number(stillSelectedIdx);
        ctx.showFeedbackForOption[sIdx] = true;
        ctx.showFeedbackForOption[String(sIdx)] = true;
        ctx.lastFeedbackOptionId = sIdx;
        console.log(`[OUS] Q${currentIndex + 1}: Anchor moved back to index ${sIdx}`);
      } else {
        ctx.lastFeedbackOptionId = -1;
      }
    }

    ctx.showFeedback = true; // Always show pane if any interaction occurred

    // Sync to services (Single call here)
    this.forceSelectIntoServices(optionBinding, effectiveId, index, currentIndex, checked, ctx);

    this.toggleSelectedOption(optionBinding.option, index, checked, ctx);
    this.refreshFeedbackConfigForClicked(optionBinding, index, effectiveId, ctx);

    // Scoring and FET triggering for Multi-answer
    if (ctx.type === 'multiple') {
      this.checkAndScoreMultiAnswer(ctx, currentIndex);
    }

    // Notify component (sound, etc.)
    if (ctx.onSelect) {
      ctx.onSelect(optionBinding, checked, currentIndex);
    }

    this.trackVisited(index, ctx);

    // FINAL FEEDBACK PASS: Ensure the anchor has its content built
    const finalAnchorIdx = ctx.lastFeedbackOptionId !== -1 ? Number(ctx.lastFeedbackOptionId) : -1;
    if (finalAnchorIdx !== -1) {
      const anchorBinding = ctx.optionBindings[finalAnchorIdx];
      if (anchorBinding) {
        this.applyFeedback(anchorBinding, finalAnchorIdx, ctx);
      }
    }

    // Ensure all bindings reflect the service-backed selection state so
    // multi-answer questions keep highlighting on every selected option.
    this.syncHighlightStateFromService(ctx);

    // optional: refresh directive highlighting after state changes
    this.optionVisualEffectsService.refreshHighlights(ctx.optionBindings);

    // Apply styles to ALL bindings (not just the clicked one) so that
    // previously selected options in multi-answer mode keep their green/red.
    for (const b of ctx.optionBindings) {
      this.applyHighlighting(b);
    }

    // AUTHORITATIVE TYPE INFERENCE: Rely on data, not just metadata
    const correctCountInBindings = ctx.optionBindings.filter(b => isCorrectHelper(b.option)).length;
    const resolvedType = (correctCountInBindings > 1 || ctx.type === 'multiple')
      ? QuestionType.MultipleAnswer
      : QuestionType.SingleAnswer;

    const lockResult = this.optionLockPolicyService.updateLockedIncorrectOptions({
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
      for (const hIdx of ctx.selectedOptionHistory || []) {
        const numIdx = Number(hIdx);
        if (ctx.selectedOptionMap.has(hIdx) && !seenIndices.has(numIdx)) {
          const b = ctx.optionBindings[numIdx];
          if (b) {
            fullSelections.push({
              ...b.option,
              optionId: b.option.optionId,
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
      ctx.optionBindings.forEach((b, idx) => {
        if (ctx.selectedOptionMap.has(idx) && !seenIndices.has(idx)) {
          fullSelections.push({
            ...b.option,
            optionId: b.option.optionId,
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

    // Only set answered=true immediately for single-answer questions.
    // For multi-answer, checkAndScoreMultiAnswer will handle it when perfect.
    if (ctx.type === 'single') {
      this.selectedOptionService.setAnswered(true, true);
    }

    // Ensure explanation is emitted for ALL types (including multiple), 
    // not just single (which handled it in applySingleSelectionPainting).
    ctx.emitExplanation(currentIndex);

    // Update Next Button State based on ACTUAL selection count
    const hasSelection = ctx.selectedOptionMap.size > 0;
    this.nextButtonStateService.setNextButtonState(hasSelection);
  }

  private syncHighlightStateFromService(ctx: OptionUiSyncContext): void {
    const qIdx = ctx.getActiveQuestionIndex() ?? 0;
    const selections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];

    const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const isMultiLimit = ctx.type === 'multiple' || (ctx as any).isMultiMode;

    // Identify last correct selected by finding most recent in HISTORY
    let lastCorrectIdx: number | null = null;
    if (isMultiLimit && ctx.selectedOptionHistory?.length > 0) {
      for (let j = ctx.selectedOptionHistory.length - 1; j >= 0; j--) {
        const hIdx = ctx.selectedOptionHistory[j];
        const numIdx = Number(hIdx);
        const b = ctx.optionBindings[numIdx];
        if (ctx.selectedOptionMap.has(hIdx) && b && (b.isSelected || b.option.selected) && isCorrectHelper(b.option)) {
          lastCorrectIdx = numIdx;
          break;
        }
      }
    }

    // Fallback to highest index if history is empty
    if (isMultiLimit && lastCorrectIdx === null) {
      for (let j = selections.length - 1; j >= 0; j--) {
        const s = selections[j];
        if (isCorrectHelper(s)) {
          const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
          if (sIdx != null && Number.isFinite(Number(sIdx))) {
            lastCorrectIdx = Number(sIdx);
            break;
          }
        }
      }
    }

    for (const b of ctx.optionBindings) {
      const match = selections.find((sel: any) => {
        const sIdx = sel.displayIndex ?? sel.index ?? sel.idx;
        return sIdx != null && Number(sIdx) === b.index;
      });

      const isSelected = !!match;
      b.isSelected = isSelected;
      b.option.selected = isSelected;

      if (isMultiLimit) {
        // The `isSelected` variable is already correctly determined above.
        // The user's snippet re-calculates it, which is redundant.
        // We will use the existing `isSelected` variable.
        // The `if (isCorrect)` condition in the snippet is also incorrect, should be `isCorrectHelper(b.option)`.

        if (isCorrectHelper(b.option)) {
          // Rule: Only last correct highlighted
          b.option.highlight = (lastCorrectIdx !== null && b.index === lastCorrectIdx);
          b.option.showIcon = isSelected; // Changed from b.option.highlight
        } else {
          // Rule: All selected incorrect highlighted
          b.option.highlight = isSelected;
          b.option.showIcon = isSelected;
        }
      } else {
        b.option.highlight = isSelected;
        b.option.showIcon = isSelected;
      }
    }
  }

  private applySingleSelectionPainting(
    selectedIndex: number,
    ctx: OptionUiSyncContext
  ): void {
    ctx.optionBindings.forEach((b, idx) => {
      const isSelected = (idx === selectedIndex);
      b.isSelected = isSelected;
      b.option.selected = isSelected;
      b.option.highlight = isSelected;
      b.option.showIcon = isSelected;

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

    const isCorrectHelper = (o: any) => {
      if (o === true || o === 'true' || o === 1 || o === '1') return true;
      if (o && typeof o === 'object' && ('correct' in o)) {
        const c = o.correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };

    // SYNC selectedOptionMap from service state before evaluating
    const serviceSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];
    ctx.selectedOptionMap.clear();
    for (const sel of serviceSelections) {
      const dIdx = (sel as any).displayIndex ?? (sel as any).index ?? (sel as any).idx;
      if (dIdx != null && Number.isFinite(Number(dIdx))) {
        ctx.selectedOptionMap.set(Number(dIdx), true);
      }
    }

    // MANDATORY: Factor in the current interaction state immediately
    const isCurrentlySelected = optionBinding.isSelected || optionBinding.option.selected;
    if (isCurrentlySelected) {
      ctx.selectedOptionMap.set(index, true);
    } else {
      ctx.selectedOptionMap.delete(index);
    }

    // Sync BINDINGS from map for accurate evaluation below
    for (let i = 0; i < ctx.optionBindings.length; i++) {
      const b = ctx.optionBindings[i];
      const selected = ctx.selectedOptionMap.has(i);
      b.isSelected = selected;
      if (b.option) b.option.selected = selected;
    }

    const selectedOptions: Option[] = ctx.optionBindings
      .filter(b => b.isSelected)
      .map(b => b.option);

    const dynamicFeedback = currentQuestion
      ? this.feedbackService.buildFeedbackMessage(currentQuestion, selectedOptions, false, false, qIdx, freshOptions, optionBinding.option)
      : '';

    const correctMessage = this.feedbackService.setCorrectMessage(freshOptions, currentQuestion!);

    // Evaluate resolution
    // EVALUATE RESOLUTION
    const correctKeys = new Set<string>();
    freshOptions.forEach((o, i) => {
      if (isCorrectHelper(o)) {
        const id = o.optionId ?? (o as any).id;
        correctKeys.add(id != null && id !== -1 ? `id:${id}` : `idx:${i}`);
      }
    });

    const getKey = (o: any, idx: number) => {
      const id = o.optionId ?? (o as any).id;
      if (id != null && id !== -1) return `id:${id}`;
      return `idx:${idx}`;
    };

    const futureKeys = new Set<string>();
    ctx.optionBindings.forEach((b, i) => {
      if (b.isSelected) futureKeys.add(getKey(b.option, i));
    });

    const allCorrectFound = correctKeys.size > 0 && [...correctKeys].every(k => futureKeys.has(k));
    const numIncorrectInFuture = [...futureKeys].filter(k => !correctKeys.has(k)).length;
    const isPerfect = allCorrectFound && numIncorrectInFuture === 0;

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
    if (allCorrectFound) {
      if (isPerfect) {
        if (ctx.feedbackConfigs[key]) {
          ctx.feedbackConfigs[key].feedback = `You're right! ${correctMessage}`;
        }
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
    for (let i = 0; i < (ctx.optionBindings?.length ?? 0); i++) {
      const b = ctx.optionBindings[i];
      const chosen = ctx.selectedOptionMap.get(i) === true;

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  private checkAndScoreMultiAnswer(ctx: OptionUiSyncContext, questionIndex: number): void {
    const isCorrectHelper = (o: any): boolean =>
      o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const normalize = (s: unknown): string => String(s ?? '').trim().toLowerCase();

    // Get the authoritative question data
    const question = ctx.getQuestionAtDisplayIndex(questionIndex);
    const freshOptions = ctx.optionsToDisplay?.length > 0
      ? ctx.optionsToDisplay
      : (question?.options ?? []);

    const correctOptions = freshOptions.filter(isCorrectHelper);
    if (correctOptions.length === 0) return;

    const isSingleAnswer = correctOptions.length === 1;

    // Build a set of correct answer texts for text-based matching
    const correctTextSet = new Set(
      correctOptions.map(o => normalize(o.text)).filter(Boolean)
    );

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
    const mapSelected = ctx.optionBindings
      .filter(b => {
        // Correctly check if THIS specific binding's index is in the selection set
        return mapSelectedIds.has(b.index) ||
          mapSelectedIds.has(String(b.index)) ||
          mapSelectedIds.has(Number(b.index));
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
      const selCorrect = isCorrectHelper(sel);

      // Check if this selection matches any correct option (by text or explicit flag)
      if (selCorrect || (selText && correctTextSet.has(selText))) {
        correctSelectedCount++;
      } else if (selText) {
        // Only count as incorrect if it's a known option with text
        const matchedInFresh = freshOptions.find(o => normalize(o.text) === selText);
        if (matchedInFresh && !isCorrectHelper(matchedInFresh)) {
          hasIncorrect = true;
        }
      }
    }

    if (isSingleAnswer) {
      if (correctSelectedCount >= 1 && !hasIncorrect) {
        const alreadyScored =
          this.quizService.questionCorrectness.get(questionIndex) === true;
        if (!alreadyScored) {
          console.log(`[OptionUiSyncService] Scoring single-answer Q${questionIndex + 1} via change path`);
          this.quizService.scoreDirectly(questionIndex, true, false);
        }
      }
    } else {
      if (correctSelectedCount >= correctOptions.length) {
        if (!hasIncorrect) {
          console.log(`[OptionUiSyncService] Scoring multi-answer Q${questionIndex + 1}: ALL ${correctOptions.length} correct answers found`);
          const alreadyCorrect = this.quizService.questionCorrectness.get(questionIndex) === true;
          if (!alreadyCorrect) {
            this.quizService.scoreDirectly(questionIndex, true, true);
          }
          // Force FET readiness even if already scored correct (to be safe)
          this.selectedOptionService.setAnswered(true, true);
        }
      }
    }
  }

  private toggleSelectedOption(clicked: Option, clickedIndex: number, checked: boolean, ctx: OptionUiSyncContext): void {
    const isMultiple = ctx.type === 'multiple';

    const isCorrectHelper = (o: any) => {
      if (o === true || o === 'true' || o === 1 || o === '1') return true;
      if (o && typeof o === 'object' && ('correct' in o)) {
        const c = o.correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
    };

    for (let i = 0; i < (ctx.optionsToDisplay ?? []).length; i++) {
      const o = ctx.optionsToDisplay[i];
      const isClicked = (i === clickedIndex);

      if (isMultiple) {
        if (isClicked) {
          o.selected = checked;
          // Always highlight if checked
          o.highlight = checked;
          o.showIcon = checked;
        }

        // Apply "Only Most Recent Correct" Rule for multi-answer
        // If this click was CORRECT and SELECTED, turn off other correct highlights
        if (checked && isClicked && isCorrectHelper(o)) {
          ctx.optionsToDisplay.forEach((other, idx) => {
            if (idx !== clickedIndex && isCorrectHelper(other)) {
              other.highlight = false;
              other.showIcon = false;
            }
          });
        }
      } else {
        // Single
        o.selected = isClicked ? checked : false;
        o.showIcon = isClicked ? checked : false;
        o.highlight = isClicked ? checked : false;
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

    const isCorrect = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const selectedOptions: Option[] = ctx.optionBindings
      .filter((_, idx) => ctx.selectedOptionMap.has(idx))
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
      visualOptions.filter(isCorrect),
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