import { ApplicationRef, Injectable, NgZone } from '@angular/core';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { QuestionType } from '../../../models/question-type.enum';
import { FeedbackProps } from '../../../models/FeedbackProps.model';

import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { TimerService } from '../../features/timer.service';
import { FeedbackService } from '../../features/feedback.service';
import { SelectionMessageService } from '../../features/selection-message.service';
import { NextButtonStateService } from '../../state/next-button-state.service';

export interface OptionInteractionState {
  optionBindings: OptionBindings[];
  optionsToDisplay: Option[];
  currentQuestionIndex: number;
  selectedOptionHistory: (number | string)[];
  selectedOptionMap: Map<number | string, boolean>;
  disabledOptionsPerQuestion: Map<number, Set<number>>;
  correctClicksPerQuestion: Map<number, Set<number>>;
  feedbackConfigs: { [key: string]: FeedbackProps };
  showFeedbackForOption: { [key: string]: boolean };
  lastFeedbackOptionId: number | string;
  lastFeedbackQuestionIndex: number;
  lastClickedOptionId: number | string | null;
  lastClickTimestamp: number | null;
  hasUserClicked: boolean;
  freezeOptionBindings: boolean;
  showFeedback: boolean;
  disableRenderTrigger: number;
  type: 'single' | 'multiple';
  currentQuestion: QuizQuestion | null;
  showExplanationChange: any;
  explanationToDisplayChange: any;
}

@Injectable({
  providedIn: 'root'
})
export class OptionInteractionService {
  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private timerService: TimerService,
    private feedbackService: FeedbackService,
    private selectionMessageService: SelectionMessageService,
    private nextButtonStateService: NextButtonStateService,
    private ngZone: NgZone,
    private appRef: ApplicationRef
  ) { }

  /**
   * Main handler for option content clicks
   */
  handleOptionClick(
    binding: OptionBindings,
    index: number,
    event: any,
    state: OptionInteractionState,
    getQuestionAtDisplayIndex: (idx: number) => QuizQuestion | null,
    emitExplanation: (idx: number) => void,
    updateOptionAndUI: (b: OptionBindings, i: number, ev: any, ctx?: any) => void
  ): void {
    const qIdx = state.currentQuestionIndex;
    const isCorrectHelper = (o: any): boolean => {
      if (!o) return false;
      const c = o.correct ?? o.isCorrect ?? (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    };

    // Mark interaction immediately
    this.quizStateService.markUserInteracted(qIdx);

    // Prevent propagation
    if (event && event.stopPropagation) {
      event.stopPropagation();
    }

    const getEffectiveId = (o: any, i: number) => (o?.optionId != null && o.optionId !== -1) ? o.optionId : i;
    const targetKey = getEffectiveId(binding.option, index);

    console.log(`[OIS.handleOptionClick] Q${qIdx + 1} Index=${index} TargetKey=${targetKey} isCurrentlySelected=${binding.isSelected}`);

    // Guard: disabled
    if (binding.disabled) return;

    const bindingsForScore = state.optionBindings ?? [];
    const correctCountInBindings = bindingsForScore.filter(b => isCorrectHelper(b.option)).length;
    
    // Authoritative Type Resolution
    const qText = state.currentQuestion?.questionText?.toLowerCase() || '';
    const isExplicitMulti = qText.includes('select all') || qText.includes('multiple') || qText.includes('apply');
    const isMultipleMode = state.type === 'multiple' || (state as any).isMultiMode === true || 
                          isExplicitMulti || correctCountInBindings > 1;
    const isTrulyMulti = isMultipleMode;

    console.log(`[OIS] Q${qIdx + 1}: correctCount=${correctCountInBindings} stateType=${state.type} isMultipleMode=${isMultipleMode}`);

    // Guard: prevent deselection of correct answers in multiple
    if (isMultipleMode && binding.isSelected && isCorrectHelper(binding.option)) {
      if (event && event.preventDefault) event.preventDefault();
      console.log(`[OIS] Q${qIdx + 1}: Ignoring deselection of correct answer in multiple mode`);
      return;
    }

    // STATE SETUP
    const question = getQuestionAtDisplayIndex(qIdx);
    const questionOptions = Array.isArray(question?.options) ? question.options : [];

    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) ?? [];
    let simulatedSelection = [...storedSelection];

    console.log(`[OIS] Q${qIdx + 1} clicked text="${binding.option?.text}" storedSelection.length=${storedSelection.length}`, storedSelection.map((s: any) => ({ id: s.optionId, idx: s.displayIndex, text: s.text?.slice(0, 30) })));

    // Check if ALREADY selected using robust ID matching
    const existingIdx = simulatedSelection.findIndex(o => {
      const sIdx = (o as any).displayIndex ?? (o as any).index ?? (o as any).idx;
      return getEffectiveId(o, sIdx) === targetKey;
    });
    const isCurrentlySelected = (existingIdx !== -1);

    let futureSelection: SelectedOption[] = [];
    if (isCurrentlySelected) {
      console.log(`[OIS] Deselecting already-selected option ${targetKey}`);
      futureSelection = simulatedSelection.filter((_, i) => i !== existingIdx);
    } else {
      console.log(`[OIS] Selecting new option ${targetKey}`);
      const newOpt: SelectedOption = {
        ...binding.option,
        optionId: targetKey,
        selected: true,
        questionIndex: qIdx,
        index: index,
        displayIndex: index
      } as SelectedOption;
      
      if (!isMultipleMode) {
        console.log(`[OIS] Q${qIdx + 1}: HARD SINGULAR RESET - Clearing all before selecting ${targetKey}`);
        this.selectedOptionService.clearAllSelectionsForQuestion(qIdx);
        futureSelection = [newOpt];
      } else {
        futureSelection = [...simulatedSelection, newOpt];
      }
    }

    console.log(`[OIS] Q${qIdx + 1}: Resulting futureSelection.length=${futureSelection.length}`);
    const futureKeys = new Set<number>();
    futureSelection.forEach(s => {
      const sId = (s as any).optionId;
      const sText = (s as any).text?.trim().toLowerCase();
      let idx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;

      if (idx === undefined || idx === null || idx === -1 || isNaN(Number(idx))) {
        const foundIdx = state.optionBindings.findIndex(b => {
          if (b.option === s) return true;
          const bId = b.option?.optionId;
          if (sId != null && sId !== -1 && bId != null && bId !== -1 && String(sId) === String(bId)) return true;
          if (sText && b.option?.text?.trim().toLowerCase() === sText) return true;
          return false;
        });
        if (foundIdx !== -1) idx = foundIdx;
        else {
          const oIdx = state.optionsToDisplay.findIndex(o => {
            if (o === s) return true;
            if (sId != null && sId !== -1 && o.optionId != null && o.optionId !== -1 && String(sId) === String(o.optionId)) return true;
            if (sText && o.text?.trim().toLowerCase() === sText) return true;
            return false;
          });
          if (oIdx !== -1) idx = oIdx;
        }
      }
      if (idx !== undefined && idx !== null && idx !== -1 && !isNaN(Number(idx))) {
        futureKeys.add(Number(idx));
      }
    });

    state.selectedOptionMap.clear();
    futureKeys.forEach(k => state.selectedOptionMap.set(k, true));

    // UPDATE UI STATE BASICS
    const newState = !isCurrentlySelected;
    const mockEvent = isMultipleMode ? { source: null, checked: newState } : { source: null, value: binding.option.optionId ?? index };

    if (newState && !state.selectedOptionHistory.includes(index)) {
      state.selectedOptionHistory.push(index);
    } else if (!newState) {
      const hIdx = state.selectedOptionHistory.indexOf(index);
      if (hIdx !== -1) {
        state.selectedOptionHistory.splice(hIdx, 1);
      }
    }

    const correctIndicesSet = new Set<number>();
    questionOptions.forEach((o, i) => {
      if (isCorrectHelper(o)) correctIndicesSet.add(i);
    });

    // Fallback: if questionOptions had no correct flags, cross-reference raw _questions
    if (correctIndicesSet.size === 0 && question?.questionText) {
      const rawQs: any[] = (this.quizService as any)._questions ?? [];
      const qText = (question.questionText ?? '').trim().toLowerCase();
      for (const rq of rawQs) {
        if ((rq.questionText ?? '').trim().toLowerCase() === qText) {
          const rawCorrectTexts = new Set<string>(
            (rq.options ?? []).filter((o: any) => isCorrectHelper(o)).map((o: any) => (o.text ?? '').trim().toLowerCase())
          );
          questionOptions.forEach((o: any, i: number) => {
            if (rawCorrectTexts.has((o.text ?? '').trim().toLowerCase())) {
              correctIndicesSet.add(i);
            }
          });
          console.log(`[OIS] Fallback correct indices from raw _questions: [${[...correctIndicesSet]}]`);
          break;
        }
      }
    }

    // Also try bindings as a source of correct info
    if (correctIndicesSet.size === 0) {
      state.optionBindings.forEach((b, i) => {
        if (b.isCorrect || isCorrectHelper(b.option)) correctIndicesSet.add(i);
      });
      if (correctIndicesSet.size > 0) {
        console.log(`[OIS] Fallback correct indices from bindings: [${[...correctIndicesSet]}]`);
      }
    }

    console.log(`[OIS] Q${qIdx + 1}: correctIndicesSet=[${[...correctIndicesSet]}] futureKeys=[${[...futureKeys]}]`);

    const allCorrectFound = correctIndicesSet.size > 0 && [...correctIndicesSet].every(i => futureKeys.has(i));
    const numIncorrectInFuture = futureSelection.filter(o => !isCorrectHelper(o)).length;
    const isPerfect = allCorrectFound && numIncorrectInFuture === 0;

    // COMMIT STATE
    simulatedSelection = [...futureSelection];
    this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);
    this.quizService.updateUserAnswer(
      qIdx,
      Array.from(futureKeys).map(idx => {
        const o = state.optionsToDisplay[idx] || state.optionBindings[idx]?.option;
        const eid = getEffectiveId(o, idx);
        return typeof eid === 'number' ? eid : -1;
      }).filter(id => id !== -1)
    );

    // UPDATE UI

    // AUTHORITATIVE HIGHLIGHT SYNC for single-answer mode:
    // - isSelected (radio state): ONLY the current click
    // - highlight/showIcon: current click + all previously clicked options
    // - feedback: ONLY the current click (handled by _feedbackDisplay)
    if (!isMultipleMode) {
      console.log(`[OIS] Authoritative Visual Reset for Q${qIdx + 1}`);
      // Accumulate history (don't reset it)
      if (!state.selectedOptionHistory.includes(index)) {
        state.selectedOptionHistory.push(index);
      }
      const historySet = new Set<number | string>(state.selectedOptionHistory);

      state.optionBindings.forEach((b, i) => {
        const isCurrent = (i === index);
        const wasPreviouslyClicked = historySet.has(i);
        // Radio state: only current
        b.isSelected = isCurrent;
        if (b.option) {
          b.option.selected = isCurrent;
          // Highlight: current + previously clicked
          b.option.highlight = isCurrent || wasPreviouslyClicked;
          b.option.showIcon = isCurrent || wasPreviouslyClicked;
        }
        b.highlightCorrect = false;
        b.highlightIncorrect = false;
        b.showFeedback = isCurrent;
      });
      state.selectedOptionMap.clear();
      state.selectedOptionMap.set(targetKey, true);
      state.feedbackConfigs = {};
    } else { // Multiple mode: two-pass update to ensure correct results regardless of binding order
      // Pass 1: Sync 'selected' state for all bindings AND optionsToDisplay based on futureKeys.
      // Binding options are structuredClone'd copies of optionsToDisplay, so both must be updated.
      state.optionBindings.forEach((b, i) => {
        const isCurrentlySelected = futureKeys.has(i);
        b.isSelected = isCurrentlySelected;
        if (b.option) {
          b.option.selected = isCurrentlySelected;
        }
        if (state.optionsToDisplay?.[i]) {
          state.optionsToDisplay[i].selected = isCurrentlySelected;
        }
      });

      // Pass 2: Calculate 'highlight' and 'showIcon' based on the updated state
      state.optionBindings.forEach((b, i) => {
        if (!b.option) return;
        const isCurrentlySelected = b.isSelected;
        b.option.highlight = isCurrentlySelected;
        b.option.showIcon = isCurrentlySelected;
        if (state.optionsToDisplay?.[i]) {
          state.optionsToDisplay[i].highlight = isCurrentlySelected;
          state.optionsToDisplay[i].showIcon = isCurrentlySelected;
        }
      });
    }

    // FET & Explanation & Scoring
    if (allCorrectFound) {
      if (!(this.quizService as any)._multiAnswerPerfect) {
        (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
      }
      (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);

      // Score when all correct answers are found, regardless of whether incorrect
      // options were also clicked (they get disabled, user can't undo them).
      // incrementScore handles deduplication internally via scoringKey.
      this.quizService.scoreDirectly(qIdx, true, isMultipleMode);

      // Trigger FET when all correct found or single correct interaction
      if (allCorrectFound || (!isMultipleMode && isCorrectHelper(binding.option))) {
        // Emit for the parent (QuizQuestionComponent)
        if ((state as any).showExplanationChange) {
          (state as any).showExplanationChange.emit(true);
        }
        // Also fire the local explanation emission logic
        setTimeout(() => emitExplanation(qIdx), 0);
      }
    }

    // UPDATE ANCHOR: If we just selected something, that's the new anchor.
    // If we unselected, find the most recently selected option that's still selected.
    if (!isCurrentlySelected) {
      state.lastFeedbackOptionId = index;
    } else {
      // Robustly find the most recent in history that is STILL selected
      const stillSelectedId = [...(state.selectedOptionHistory || [])]
        .reverse()
        .find(histId => {
          // Find the option in optionsToDisplay that corresponds to this history entry
          const oIdx = state.optionsToDisplay.findIndex((_, i) => i === histId || String(i) === String(histId));
          const opt = oIdx !== -1 ? state.optionsToDisplay[oIdx] : state.optionsToDisplay.find(o => o.optionId != null && o.optionId !== -1 && o.optionId == histId);
          return opt && futureKeys.has(getEffectiveId(opt, state.optionsToDisplay.indexOf(opt)));
        });

      if (stillSelectedId !== undefined) {
        // Find its reliable index to use as the lastFeedbackOptionId
        const finalIdx = state.optionsToDisplay.findIndex((_, i) => i === stillSelectedId || String(i) === String(stillSelectedId));
        state.lastFeedbackOptionId = finalIdx !== -1 ? finalIdx : stillSelectedId;
      } else {
        state.lastFeedbackOptionId = -1;
      }
    }

    // AUTHORITATIVE FEEDBACK ANCHORING
    // Reset completely for both single and multi-answer questions so feedback only shows under the LAST selection.
    state.showFeedbackForOption = {}; 

    state.showFeedbackForOption = {
      [targetKey]: true,
      [index]: true,
      [`idx:${index}`]: true
    };
    if (binding.option.optionId != null) {
      state.showFeedbackForOption[binding.option.optionId] = true;
    }
    state.lastFeedbackOptionId = targetKey;
    state.showFeedback = true;

    state.lastClickedOptionId = index;
    state.hasUserClicked = true;
    state.disableRenderTrigger++;

    // CALL UPDATE with THE AUTHORITATIVE CONTEXT (state)
    (updateOptionAndUI as any)(binding, index, mockEvent, state);

    // MESSAGE UPDATE
    try {
      const message = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions,
        qType: isMultipleMode ? QuestionType.MultipleAnswer : QuestionType.SingleAnswer,
        opts: state.optionBindings.map((b, i) => ({
          ...b.option,
          selected: futureKeys.has(i)
        })) as Option[]
      });
      this.selectionMessageService.pushMessage(message, qIdx);
    } catch (e) {
      console.error('[OIS] Message sync failed', e);
    }
  }
}
