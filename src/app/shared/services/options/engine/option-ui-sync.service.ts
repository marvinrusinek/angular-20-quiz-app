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

      this.preservePreviousFeedbackAnchor(optionId, ctx);
      ctx.emitExplanation(currentIndex);
      return;
    }

    if (this.isRapidDuplicateUnselect(optionId, checked, now, ctx)) {
      return;
    }

    ctx.lastClickedOptionId = optionId ?? null;
    ctx.lastClickTimestamp = now;
    ctx.freezeOptionBindings ??= true;
    ctx.hasUserClicked = true;

    const effectiveId = (optionId != null && optionId !== -1) ? optionId : index;

    // Apply selection state + history
    optionBinding.option.selected = checked;
    ctx.perQuestionHistory.add(effectiveId);

    // Force service update to keep Next button snappy
    // Force service update call moved down to ensure map is updated first

    if (ctx.type === 'single') {
      this.applySingleSelectionPainting(optionId, optionBinding, ctx);
    }

    // mark selected/highlight/icon for current binding
    optionBinding.isSelected = checked;
    optionBinding.option.highlight = checked;
    optionBinding.option.showIcon = checked;

    if (checked) {
      ctx.selectedOptionMap.set(effectiveId, true);
    } else {
      ctx.selectedOptionMap.delete(effectiveId);
    }

    // Force service update to keep Next button snappy (now that map is updated)
    this.forceSelectIntoServices(optionBinding, optionId, currentIndex, checked, ctx);

    ctx.showFeedback = true;

    // Apply strict state (checked/unchecked) instead of toggle
    this.toggleSelectedOption(optionBinding.option, checked, ctx);

    // RESTORE: Let the component know a selection occurred (for sounds/events)
    if (ctx.onSelect) {
      ctx.onSelect(optionBinding, checked, currentIndex);
    }

    this.trackVisited(optionId, ctx);

    // updated anchor logic: if unselecting, move back to last still-selected option
    if (checked) {
      ctx.showFeedback = true;
      ctx.lastFeedbackOptionId = effectiveId;
      this.refreshFeedbackConfigForClicked(optionBinding, index, effectiveId as any, ctx);
    } else {
      const stillSelectedId = [...(ctx.selectedOptionHistory || [])]
        .reverse()
        .find(id => ctx.selectedOptionMap.has(id));

      if (stillSelectedId !== undefined) {
        ctx.lastFeedbackOptionId = stillSelectedId;

        const prevBindingIdx = ctx.optionBindings.findIndex(b => b.option.optionId === stillSelectedId);
        if (prevBindingIdx !== -1) {
          this.refreshFeedbackConfigForClicked(
            ctx.optionBindings[prevBindingIdx],
            prevBindingIdx,
            stillSelectedId as any,
            ctx
          );
        }
      } else {
        ctx.showFeedbackForOption = {};
        ctx.lastFeedbackOptionId = -1;
      }
    }


    // optional: refresh directive highlighting after state changes
    this.optionVisualEffectsService.refreshHighlights(ctx.optionBindings);

    // Apply styles to current binding
    this.applyHighlighting(optionBinding);

    // Only apply generic feedback if we haven't already anchored to a specific selection
    // in the checked/unchecked blocks above.
    if (ctx.lastFeedbackOptionId === -1 || ctx.lastFeedbackOptionId === effectiveId) {
      this.applyFeedback(optionBinding, index, ctx);
    }

    const resolvedType =
      ctx.type === 'multiple' ? QuestionType.MultipleAnswer : QuestionType.SingleAnswer;

    this.optionLockPolicyService.updateLockedIncorrectOptions({
      bindings: ctx.optionBindings ?? [],
      forceDisableAll: ctx.forceDisableAll, // see ctx note below
      resolvedType,
      computeShouldLockIncorrectOptions: (t, has, all) =>
        this.optionLockRulesService.computeShouldLockIncorrectOptions(t, has, all)
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

    // Ensure previously visited are still marked selected
    for (const id of ctx.selectedOptionHistory) {
      const b = ctx.optionBindings.find(x => x.option.optionId === id);
      if (b?.option) b.option.selected = true;
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
    }
  }

  private preservePreviousFeedbackAnchor(optionId: number | string | undefined, ctx: OptionUiSyncContext): void {
    if (
      ctx.lastFeedbackOptionId !== -1 &&
      optionId != null &&
      ctx.lastFeedbackOptionId !== optionId
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
    currentIndex: number,
    checked: boolean,
    ctx: OptionUiSyncContext
  ): void {
    if (optionId == null) return;

    if (checked) {
      // Use synchronous setSelectedOption to update service state IMMEDIATELY.
      try {
        const selOpt: any = {
          ...optionBinding.option,
          questionIndex: currentIndex,
          selected: true
        };
        this.selectedOptionService.setSelectedOption(
          selOpt,
          currentIndex,
          ctx.optionsToDisplay,
          ctx.type === 'multiple'
        );
      } catch (err) {
        console.error('[OptionUiSyncService] Error in setSelectedOption:', err);
      }

      this.selectedOptionService.setAnswered(true, true);
      // Ensure explanation is emitted for ALL types (including multiple), 
      // not just single (which handled it in applySingleSelectionPainting).
      ctx.emitExplanation(currentIndex);
    } else {
      // Unselection: Remove from service
      this.selectedOptionService.removeOption(currentIndex, optionId as any);
    }

    // Update Next Button State based on ACTUAL selection count
    const hasSelection = ctx.selectedOptionMap.size > 0;
    this.nextButtonStateService.setNextButtonState(hasSelection);
  }

  private applySingleSelectionPainting(
    optionId: number | string | undefined,
    optionBinding: OptionBindings,
    ctx: OptionUiSyncContext
  ): void {
    ctx.selectedOptionMap.clear();

    for (const b of ctx.optionBindings) {
      const id = b.option.optionId;
      if (id === undefined) continue;

      const shouldPaint = ctx.perQuestionHistory.has(id);

      // Also check string/number versions to be absolutely safe
      const shouldPaintRobust = shouldPaint ||
        (typeof id === 'string' && ctx.perQuestionHistory.has(Number(id))) ||
        (typeof id === 'number' && ctx.perQuestionHistory.has(String(id)));

      b.isSelected = shouldPaintRobust;
      b.option.selected = shouldPaintRobust;
      b.option.highlight = shouldPaintRobust;
      b.option.showIcon = shouldPaintRobust;

      if (b.showFeedbackForOption && b.option.optionId !== undefined) {
        b.showFeedbackForOption[b.option.optionId] = false;
        if (typeof b.option.optionId === 'string') {
          const n = Number(b.option.optionId);
          if (!isNaN(n)) (b.showFeedbackForOption as any)[n] = false;
        }
      }

      ctx.showFeedbackForOption[id] = id === optionId;

      b.directiveInstance?.updateHighlight();
    }
  }

  private trackVisited(optionId: number | undefined, ctx: OptionUiSyncContext): boolean {
    let isAlreadyVisited = false;
    if (optionId !== undefined) {
      isAlreadyVisited = ctx.selectedOptionHistory.includes(optionId);
      if (!isAlreadyVisited) ctx.selectedOptionHistory.push(optionId);
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

    // AUTHORITATIVE FIX: Sync selectedOptionMap from SelectedOptionService.
    const serviceSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];

    // Clear and rebuild the map up to the service's last known state
    ctx.selectedOptionMap.clear();
    for (const sel of serviceSelections) {
      const selId = (sel as any).optionId ?? (sel as any).index;
      if (selId != null && selId !== -1) {
        ctx.selectedOptionMap.set(selId, true);
        ctx.selectedOptionMap.set(Number(selId), true);
        ctx.selectedOptionMap.set(String(selId), true);
      }
    }

    // MANDATORY: Force current interaction state into the map to avoid race conditions.
    // This ensures that even if the service hasn't fully updated yet, we calculate 
    // feedback based on what the user just did.
    const currentEffectiveId = (optionBinding.option.optionId != null && optionBinding.option.optionId !== -1) ? optionBinding.option.optionId : index;
    const isCurrentlyChecked = optionBinding.isSelected || optionBinding.option.selected;

    if (isCurrentlyChecked) {
      ctx.selectedOptionMap.set(currentEffectiveId, true);
      ctx.selectedOptionMap.set(Number(currentEffectiveId), true);
      ctx.selectedOptionMap.set(String(currentEffectiveId), true);
    } else {
      ctx.selectedOptionMap.delete(currentEffectiveId);
      ctx.selectedOptionMap.delete(Number(currentEffectiveId));
      ctx.selectedOptionMap.delete(String(currentEffectiveId));
    }

    // Sync selected flags on all bindings from the (now-complete) map
    for (const k of Object.keys(ctx.feedbackConfigs)) {
      ctx.feedbackConfigs[k].showFeedback = false;
    }
    for (const k of Object.keys(ctx.showFeedbackForOption)) {
      delete ctx.showFeedbackForOption[k];
    }

    // Sync selected flags on all bindings from the (now-complete) map
    const effectiveTargetId = (optionId != null && optionId !== -1) ? optionId : index;

    for (const binding of ctx.optionBindings) {
      const id = binding.option.optionId ?? binding.index;
      const inMap = ctx.selectedOptionMap.has(id) ||
        ctx.selectedOptionMap.has(Number(id)) ||
        ctx.selectedOptionMap.has(String(id));
      binding.isSelected = inMap;
      binding.option.selected = inMap;

      if (binding.isSelected || !binding.option.correct) {
        binding.disabled = false;
      }
    }

    // Gather ALL currently selected options for accurate feedback calculation
    const isCorrectHelper = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const selectedOptions: Option[] = ctx.optionBindings
      .filter(b => b.isSelected || b.option.selected)
      .map(b => b.option);

    const correctSelectedCount = selectedOptions.filter(isCorrectHelper).length;
    const totalCorrect = freshOptions.filter(isCorrectHelper).length;
    const numIncorrect = selectedOptions.filter(o => !isCorrectHelper(o)).length;

    // Build dynamic feedback via FeedbackService
    const dynamicFeedback = currentQuestion
      ? this.feedbackService.buildFeedbackMessage(
        currentQuestion,
        selectedOptions,
        false,
        false,
        qIdx,
        freshOptions,
        optionBinding.option
      )
      : '';

    // Generate the static reveal message
    const correctMessage = this.feedbackService.generateFeedbackForOptions(
      freshOptions.filter(isCorrectHelper),
      freshOptions
    );

    const key = ctx.keyOf(optionBinding.option, index);
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

    if (effectiveTargetId != null) {
      ctx.showFeedbackForOption[effectiveTargetId] = true;
      ctx.showFeedbackForOption[String(effectiveTargetId)] = true;
      if (typeof effectiveTargetId === 'number') {
        ctx.showFeedbackForOption[Number(effectiveTargetId)] = true;
      }
    }

    // Final-answer handling: If all correct answers are selected AND no incorrect ones, show "You're right!"
    if (totalCorrect > 0 && correctSelectedCount === totalCorrect && numIncorrect === 0) {
      ctx.feedbackConfigs[key].feedback = `You're right! ${correctMessage}`;
      // Disable any still‑unselected options (only incorrect ones)
      ctx.optionBindings.forEach(b => {
        const id = b.option.optionId ?? -1;
        if (!ctx.selectedOptionMap.has(id)) {
          b.disabled = true;
          this.selectedOptionService.lockOption(qIdx, id);
        }
      });
    }

    if (effectiveTargetId != null) {
      for (const k of Object.keys(ctx.showFeedbackForOption)) {
        delete ctx.showFeedbackForOption[k];
      }

      ctx.showFeedbackForOption[effectiveTargetId] = true;
      ctx.showFeedbackForOption[String(effectiveTargetId)] = true;
      if (typeof effectiveTargetId === 'number') {
        ctx.showFeedbackForOption[Number(effectiveTargetId)] = true;
      }
    }
    ctx.lastFeedbackOptionId = effectiveTargetId ?? -1;
    ctx.showFeedback = true;
    ctx.hasUserClicked = true;
  }

  /**
   * Check if all correct answers are selected for multi-answer questions and
   * trigger scoring via quizService.scoreDirectly(). This handles the checkbox
   * `change` event path which bypasses OIS and QuizComponent.onOptionSelected.
   */
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
        const id = b.option?.optionId ?? b.index;
        return mapSelectedIds.has(id) ||
          mapSelectedIds.has(Number(id)) ||
          mapSelectedIds.has(String(id));
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
      if (correctSelectedCount >= correctOptions.length && !hasIncorrect) {
        const alreadyScored =
          this.quizService.questionCorrectness.get(questionIndex) === true;
        if (!alreadyScored) {
          console.log(`[OptionUiSyncService] Scoring multi-answer Q${questionIndex + 1} via change path: ALL ${correctOptions.length} correct answers selected`);
          this.quizService.scoreDirectly(questionIndex, true, true);
        }
      }
    }
  }

  private syncSelectedFlags(ctx: OptionUiSyncContext): void {
    for (const b of ctx.optionBindings ?? []) {
      const id = b?.option?.optionId;
      if (id == null) continue;

      const history = ctx.selectedOptionHistory || [];
      const chosen =
        (ctx.selectedOptionMap as any).get(id) === true ||
        ctx.selectedOptionMap.get(Number(id)) === true ||
        (history as any[]).includes(id) ||
        (history as any[]).includes(String(id)) ||
        (history as any[]).includes(Number(id));

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  private toggleSelectedOption(clicked: Option, checked: boolean, ctx: OptionUiSyncContext): void {
    const isMultiple = ctx.type === 'multiple';

    for (const o of ctx.optionsToDisplay ?? []) {
      const isClicked = o.optionId === clicked.optionId;

      if (isMultiple) {
        // Multi: Set specific option to 'checked' value
        if (isClicked) {
          o.selected = checked;
          o.showIcon = checked;
          o.highlight = checked;
        }
      } else {
        // Single: The clicked one becomes true, others false (if checked is true)
        // If checked is false (unselect), then it becomes false.
        o.selected = isClicked ? checked : false;
        o.showIcon = isClicked ? checked : false;
        o.highlight = isClicked ? checked : false;
      }
    }

    // keep array ref refresh if your UI depends on it
    ctx.optionsToDisplay = [...ctx.optionsToDisplay];
  }

  private applyHighlighting(optionBinding: OptionBindings): void {
    const optionId = optionBinding.option.optionId;
    const isSelected = optionBinding.isSelected;
    //const isCorrect = optionBinding.isCorrect;
    const isCorrect = optionBinding.option?.correct === true;

    // Set highlight flags (can be used by directive or other logic)
    optionBinding.highlightCorrect = isSelected && isCorrect;
    optionBinding.highlightIncorrect = isSelected && !isCorrect;

    // Apply style class used in [ngClass] binding
    if (isSelected) {
      optionBinding.styleClass = isCorrect
        ? 'highlight-correct' : 'highlight-incorrect';
    } else {
      optionBinding.styleClass = '';
    }

    // Direct DOM fallback (for defensive rendering, optional)
    const optionElement = document.querySelector(
      `[data-option-id="${optionId}"]`
    );
    if (optionElement) {
      optionElement.classList.remove(
        'highlight-correct',
        'highlight-incorrect'
      );
      if (isSelected) {
        optionElement.classList.add(
          isCorrect ? 'highlight-correct' : 'highlight-incorrect'
        );
      }
      console.log(`[DOM class applied for Option ${optionId}]`);
    } else {
      console.warn(`[DOM element not found for Option ${optionId}]`);
    }
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

    // Gather ALL currently selected options for accurate feedback
    const isCorrect = (o: any) => o && (o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1');
    const selectedOptions: Option[] = ctx.optionBindings
      .filter(b => {
        const id = (b.option.optionId != null && b.option.optionId !== -1) ? b.option.optionId : b.index;
        return ctx.selectedOptionMap.has(id) ||
          ctx.selectedOptionMap.has(Number(id)) ||
          ctx.selectedOptionMap.has(String(id));
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

    // Final-answer handling: If all correct answers are selected, override feedback and disable others
    const totalCorrect = visualOptions.filter(isCorrect).length;
    const correctSelectedCount = selectedOptions.filter(isCorrect).length;
    const numIncorrect = selectedOptions.filter(o => !isCorrect(o)).length;

    if (totalCorrect > 0 && correctSelectedCount === totalCorrect && numIncorrect === 0) {
      console.log(`[SyncService.apply] Question resolved! Overriding feedback for key: ${key}`);
      ctx.feedbackConfigs[key].feedback = `You're right! ${correctMessage}`;
      // Disable any still‑unselected options
      ctx.optionBindings.forEach(b => {
        const id = (b.option.optionId != null && b.option.optionId !== -1) ? b.option.optionId : b.index;
        const isSel = ctx.selectedOptionMap.has(id) ||
          ctx.selectedOptionMap.has(Number(id)) ||
          ctx.selectedOptionMap.has(String(id));
        if (!isSel) {
          b.disabled = true;
          console.log(`[SyncService.apply] Disabling unselected option: ${id}`);
        }
      });
    }

    const effectiveId = (optionBinding.option?.optionId != null && optionBinding.option?.optionId !== -1) ? optionBinding.option.optionId : displayIndex;
    if (effectiveId != null) {
      ctx.showFeedbackForOption[Number(effectiveId)] = true;
      (ctx.showFeedbackForOption as any)[String(effectiveId)] = true;
      ctx.lastFeedbackOptionId = Number(effectiveId);
      ctx.showFeedback = true;
    }
  }
}