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
    optionBinding.option.selected = checked;
    if (!ctx.selectedOptionHistory.includes(index)) {
      ctx.selectedOptionHistory.push(index);
    }

    // Force service update call moved down to ensure map is updated first

    if (ctx.type === 'single') {
      ctx.selectedOptionMap.clear();
    }

    if (checked) {
      ctx.selectedOptionMap.set(index, true);
    } else {
      ctx.selectedOptionMap.delete(index);
    }

    if (ctx.type === 'single') {
      this.applySingleSelectionPainting(index, ctx);
    }

    // Force service update to keep Next button snappy (now that map is updated)
    this.forceSelectIntoServices(optionBinding, optionId, index, currentIndex, checked, ctx);

    ctx.showFeedback = true;

    this.toggleSelectedOption(optionBinding.option, index, checked, ctx);

    // RESTORE: Let the component know a selection occurred (for sounds/events)
    if (ctx.onSelect) {
      ctx.onSelect(optionBinding, checked, currentIndex);
    }

    this.trackVisited(index, ctx);

    // updated anchor logic: if unselecting, move back to last still-selected option
    if (checked) {
      ctx.showFeedback = true;
      ctx.lastFeedbackOptionId = index;
      this.refreshFeedbackConfigForClicked(optionBinding, index, optionId, ctx);
    } else {
      const stillSelectedId = [...(ctx.selectedOptionHistory || [])]
        .reverse()
        .find(id => ctx.selectedOptionMap.has(id));

      if (stillSelectedId !== undefined) {
        ctx.lastFeedbackOptionId = stillSelectedId;

        const prevBindingIdx = stillSelectedId as number;
        if (ctx.optionBindings[prevBindingIdx]) {
          const prevBinding = ctx.optionBindings[prevBindingIdx];
          const prevOptionId = prevBinding.option?.optionId;
          this.refreshFeedbackConfigForClicked(
            prevBinding,
            prevBindingIdx,
            prevOptionId,
            ctx
          );
        }
      } else {
        ctx.showFeedbackForOption = {};
        ctx.lastFeedbackOptionId = -1;
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

    // Only apply generic feedback if we haven't already anchored to a specific selection
    // in the checked/unchecked blocks above.
    if (ctx.lastFeedbackOptionId === -1 || ctx.lastFeedbackOptionId === index) {
      this.applyFeedback(optionBinding, index, ctx);
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
    const effectiveId = (optionId != null && optionId !== -1) ? optionId : optionBinding.index;

    if (checked) {
      // Build the FULL list of selections to keep service state accurate
      const fullSelections: any[] = [];
      ctx.optionBindings.forEach((b, idx) => {
        // Use the map as the single source of truth for "active" selections
        if (ctx.selectedOptionMap.has(idx)) {
          fullSelections.push({
            ...b.option,
            optionId: b.option.optionId,
            index: idx,
            displayIndex: idx,
            questionIndex: currentIndex,
            selected: true
          });
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

    // Identify last correct selected by finding highest index among selections
    let lastCorrectIdx: number | null = null;
    if (isMultiLimit) {
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
        if (isCorrectHelper(b.option)) {
          // Rule: Only last correct highlighted
          b.option.highlight = (lastCorrectIdx !== null && b.index === lastCorrectIdx);
          b.option.showIcon = b.option.highlight;
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

    // SYNC LOCKING (Should match OptionInteractionService)
    const getLockId = (b: OptionBindings, idx: number) => {
      const explicitId = b.option?.optionId;
      return (explicitId != null && Number(explicitId) !== -1) ? Number(explicitId) : idx;
    };

    if (allCorrectFound) {
      if (isPerfect) {
        ctx.optionBindings.forEach((b, idx) => {
          const lId = getLockId(b, idx);
          b.disabled = true;
          this.selectedOptionService.lockOption(qIdx, lId);
        });
        if (ctx.feedbackConfigs[key]) {
          ctx.feedbackConfigs[key].feedback = `You're right! ${correctMessage}`;
        }
      } else {
        // Partial Resolution: lock unselected
        ctx.optionBindings.forEach((b, idx) => {
          const lId = getLockId(b, idx);
          const isSelected = futureKeys.has(getKey(b.option, idx));
          if (!isSelected) {
            b.disabled = true;
            this.selectedOptionService.lockOption(qIdx, lId);
          } else {
            b.disabled = false;
            this.selectedOptionService.unlockOption(qIdx, lId);
          }
        });
      }
    } else {
      // Not resolved
      ctx.optionBindings.forEach((b, idx) => {
        const lId = getLockId(b, idx);
        b.disabled = false;
        this.selectedOptionService.unlockOption(qIdx, lId);
      });
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
        const alreadyScored =
          this.quizService.questionCorrectness.get(questionIndex) === true;
        if (!alreadyScored) {
          console.log(`[OptionUiSyncService] Scoring multi-answer Q${questionIndex + 1} via change path: ALL ${correctOptions.length} correct answers found`);
          // Score as correct ONLY if no incorrect options are selected
          this.quizService.scoreDirectly(questionIndex, !hasIncorrect, true);
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

    // Anchor feedback using dual keys (index AND optionId) for robust template lookup
    for (const k of Object.keys(ctx.showFeedbackForOption)) {
      delete ctx.showFeedbackForOption[k];
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