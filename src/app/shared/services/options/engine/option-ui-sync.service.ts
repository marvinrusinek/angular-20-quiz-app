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
  showFeedbackForOption: Record<number, boolean>;
  lastFeedbackOptionId: number;
  lastFeedbackQuestionIndex: number;

  lastClickedOptionId: number | null;
  lastClickTimestamp: number | null;

  freezeOptionBindings: boolean;
  hasUserClicked: boolean;

  showFeedback: boolean;
  selectedOptionHistory: number[];
  selectedOptionMap: Map<number, boolean>;
  perQuestionHistory: Set<number>;

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

    // Apply selection state + history
    optionBinding.option.selected = checked;
    ctx.perQuestionHistory.add(optionId ?? -1);

    // Force service update to keep Next button snappy
    // Force service update call moved down to ensure map is updated first

    if (ctx.type === 'single') {
      this.applySingleSelectionPainting(optionId, optionBinding, ctx);
    }

    // mark selected/highlight/icon for current binding
    optionBinding.isSelected = checked;
    optionBinding.option.highlight = checked;
    optionBinding.option.showIcon = checked;

    if (optionId != null) {
      if (checked) {
        ctx.selectedOptionMap.set(optionId, true);
      } else {
        ctx.selectedOptionMap.delete(optionId);
      }
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

    // new anchor (always update feedback anchor to current click)
    ctx.showFeedbackForOption = { [optionId ?? -1]: true };
    ctx.lastFeedbackOptionId = optionId ?? -1;

    // Build feedback config for clicked option
    this.refreshFeedbackConfigForClicked(optionBinding, index, optionId, ctx);

    // optional: refresh directive highlighting after state changes
    this.optionVisualEffectsService.refreshHighlights(ctx.optionBindings);

    // highlight flags (if you add my applyHighlighting method inside OptionUiSyncService)
    this.applyHighlighting(optionBinding);

    // feedback generation (if you add my applyFeedback method inside OptionUiSyncService)
    this.applyFeedback(optionBinding, index, ctx);

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

    this.selectionMessageService.notifySelectionMutated(ctx.optionsToDisplay);
    this.selectionMessageService.setSelectionMessage(false);
  }

  private resetFeedbackAnchorIfQuestionChanged(currentIndex: number, ctx: OptionUiSyncContext): void {
    if (ctx.lastFeedbackQuestionIndex !== currentIndex) {
      ctx.feedbackConfigs = {};
      ctx.showFeedbackForOption = {};
      ctx.lastFeedbackOptionId = -1;
      ctx.lastFeedbackQuestionIndex = currentIndex;
    }
  }

  private preservePreviousFeedbackAnchor(optionId: number | undefined, ctx: OptionUiSyncContext): void {
    if (
      ctx.lastFeedbackOptionId !== -1 &&
      optionId != null &&
      ctx.lastFeedbackOptionId !== optionId
    ) {
      for (const k of Object.keys(ctx.showFeedbackForOption)) {
        ctx.showFeedbackForOption[+k] = false;
      }

      ctx.showFeedbackForOption[ctx.lastFeedbackOptionId] = true;

      const cfg = ctx.feedbackConfigs[ctx.lastFeedbackOptionId];
      if (cfg) cfg.showFeedback = true;
    }
  }

  private isRapidDuplicateUnselect(
    optionId: number | undefined,
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
    optionId: number | undefined,
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
      this.selectedOptionService.removeOption(currentIndex, optionId);
    }

    // Update Next Button State based on ACTUAL selection count
    const hasSelection = ctx.selectedOptionMap.size > 0;
    this.nextButtonStateService.setNextButtonState(hasSelection);
  }

  private applySingleSelectionPainting(
    optionId: number | undefined,
    optionBinding: OptionBindings,
    ctx: OptionUiSyncContext
  ): void {
    ctx.selectedOptionMap.clear();

    for (const b of ctx.optionBindings) {
      const id = b.option.optionId;
      if (id === undefined) continue;

      const shouldPaint = ctx.perQuestionHistory.has(id);

      b.isSelected = shouldPaint;
      b.option.selected = shouldPaint;
      b.option.highlight = shouldPaint;
      b.option.showIcon = shouldPaint;

      if (b.showFeedbackForOption && b.option.optionId !== undefined) {
        b.showFeedbackForOption[b.option.optionId] = false;
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
    optionId: number | undefined,
    ctx: OptionUiSyncContext
  ): void {
    for (const binding of ctx.optionBindings) {
      const id = binding.option.optionId ?? -1;
      const isSelected = ctx.selectedOptionMap.get(id) === true;

      binding.isSelected = isSelected;
      binding.option.selected = isSelected;

      if (id !== optionId) continue;

      const currentIdx =
        ctx.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex();

      const currentQuestion = ctx.getQuestionAtDisplayIndex(currentIdx);

      const freshOptions =
        (ctx.optionsToDisplay?.length ?? 0) > 0
          ? ctx.optionsToDisplay
          : currentQuestion?.options ?? [];

      const correctOptions = freshOptions.filter((opt: Option) => opt.correct);

      const dynamicFeedback = this.feedbackService.generateFeedbackForOptions(
        correctOptions,
        freshOptions
      );

      const key = ctx.keyOf(optionBinding.option, index);

      ctx.feedbackConfigs[key] = {
        feedback: dynamicFeedback,
        showFeedback: true,
        options: freshOptions,
        question: currentQuestion ?? null,
        selectedOption: optionBinding.option,
        correctMessage: dynamicFeedback,
        idx: index
      } as any;

      if (optionId != null) ctx.showFeedbackForOption[optionId] = true;
      ctx.lastFeedbackOptionId = optionId ?? -1;
    }
  }

  private syncSelectedFlags(ctx: OptionUiSyncContext): void {
    for (const b of ctx.optionBindings ?? []) {
      const id = b?.option?.optionId;
      if (typeof id !== 'number') continue;

      const chosen =
        ctx.selectedOptionMap.get(id) === true ||
        (ctx.selectedOptionHistory ?? []).includes(id);

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

    const correctOptions = visualOptions.filter(o => o.correct === true);

    const freshFeedback = this.feedbackService.generateFeedbackForOptions(
      correctOptions,
      visualOptions
    );

    const key = ctx.keyOf(optionBinding.option, displayIndex);

    ctx.feedbackConfigs[key] = {
      feedback: freshFeedback,
      showFeedback: true,
      options: visualOptions,              // ✅ use visual order
      question,
      selectedOption: optionBinding.option,
      correctMessage: freshFeedback,
      idx: displayIndex
    } as any;

    const optId = optionBinding.option?.optionId;
    if (typeof optId === 'number') {
      ctx.showFeedbackForOption[optId] = true;
      ctx.lastFeedbackOptionId = optId;
    }
  }
}