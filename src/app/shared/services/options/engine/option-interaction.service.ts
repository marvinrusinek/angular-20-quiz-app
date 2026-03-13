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
  selectedOptionHistory: number[];
  disabledOptionsPerQuestion: Map<number, Set<number>>;
  correctClicksPerQuestion: Map<number, Set<number>>;
  feedbackConfigs: { [key: string]: FeedbackProps };
  showFeedbackForOption: { [optionId: number]: boolean };
  lastFeedbackOptionId: number;
  lastFeedbackQuestionIndex: number;
  lastClickedOptionId: number | null;
  lastClickTimestamp: number | null;
  hasUserClicked: boolean;
  freezeOptionBindings: boolean;
  showFeedback: boolean;
  disableRenderTrigger: number;
  type: 'single' | 'multiple';
  currentQuestion: QuizQuestion | null;
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
    event: MouseEvent,
    state: OptionInteractionState,
    getQuestionAtDisplayIndex: (idx: number) => QuizQuestion | null,
    emitExplanation: (idx: number) => void,
    updateOptionAndUI: (b: OptionBindings, i: number, ev: any, ctx?: any) => void
  ): void {
    const qIdx = state.currentQuestionIndex;
    const isCorrectHelper = (val: any) => {
      if (val === true || val === 'true' || val === 1 || val === '1') return true;
      if (val && typeof val === 'object' && ('correct' in val)) {
        const c = val.correct;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }
      return false;
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

    // USEFUL DERIVED VALUES
    const bindingsForScore = state.optionBindings ?? [];
    const correctCountInBindings = bindingsForScore.filter(b => isCorrectHelper(b.option)).length;
    // Determine if we are in multi-answer behavior
    const isMultipleMode = correctCountInBindings > 1 || state.type === 'multiple';

    console.log(`[OIS] Q${qIdx + 1}: correctCount=${correctCountInBindings} Type=${state.type} isMultipleMode=${isMultipleMode}`);

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

    console.log(`[OIS] Q${qIdx + 1} clicked text="${binding.option?.text}"`);

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
      futureSelection = isMultipleMode ? [...simulatedSelection, newOpt] : [newOpt];
    }

    console.log(`[OIS] Q${qIdx + 1}: Resulting futureSelection.length=${futureSelection.length}`);
    const futureKeys = new Set(futureSelection.map(s => {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      return getEffectiveId(s, sIdx);
    }));

    const correctKeys = new Set<number | string>(); 
    questionOptions.forEach((o, i) => {
      if (isCorrectHelper(o)) correctKeys.add(getEffectiveId(o, i));
    });

    const allCorrectFound = correctKeys.size > 0 && [...correctKeys].every(k => futureKeys.has(k));
    const numIncorrectInFuture = futureSelection.filter(o => !isCorrectHelper(o)).length;
    const isPerfect = allCorrectFound && numIncorrectInFuture === 0;

    // COMMIT STATE
    simulatedSelection = [...futureSelection];
    this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);
    // No more ID generation here - trust SelectedOptionService and QuizService
    this.quizService.updateUserAnswer(
      qIdx,
      simulatedSelection.map(o => {
        const sIdx = (o as any).displayIndex ?? (o as any).index ?? (o as any).idx;
        const eid = getEffectiveId(o, sIdx);
        return typeof eid === 'number' ? eid : -1;
      }).filter(id => id !== -1)
    );

    // UPDATE UI
    const newState = !isCurrentlySelected;
    const mockEvent = isMultipleMode ? { source: null, checked: newState } : { source: null, value: binding.option.optionId ?? index };
    
    // Synchronize highlight flags according to the rules
    if (isMultipleMode) {
      // Identify last correct selected
      let lastCorrect: any = null;
      for (let j = futureSelection.length - 1; j >= 0; j--) {
        if (isCorrectHelper(futureSelection[j])) {
          lastCorrect = futureSelection[j];
          break;
        }
      }
      const lastCorrKey = lastCorrect ? getEffectiveId(lastCorrect, (lastCorrect as any).index ?? (lastCorrect as any).displayIndex) : null;

      state.optionBindings.forEach((b, i) => {
        const bKey = getEffectiveId(b.option, i);
        const isSelected = futureKeys.has(bKey);
        const isCorrect = isCorrectHelper(b.option);

        if (isCorrect) {
          // Rule: Only last correct highlighted
          b.option.highlight = (lastCorrKey === bKey);
          b.option.showIcon = b.option.highlight;
        } else {
          // Rule: All selected incorrect highlighted
          b.option.highlight = isSelected;
          b.option.showIcon = isSelected;
        }
      });
    }

    // FET & Explanation
    if (allCorrectFound) {
      if (!(this.quizService as any)._multiAnswerPerfect) {
        (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
      }
      (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);

      if (isPerfect || (!isMultipleMode && isCorrectHelper(binding.option))) {
        setTimeout(() => emitExplanation(qIdx), 0);
      }
    }

    // UPDATE ANCHOR: If we just selected something, that's the new anchor.
    // If we unselected, find the most recently selected option that's still selected.
    if (!isCurrentlySelected) {
      state.lastFeedbackOptionId = index;
    } else {
      const stillSelectedId = [...(state.selectedOptionHistory || [])]
        .reverse()
        .find(id => futureKeys.has(getEffectiveId(state.optionsToDisplay[id], id)));

      if (stillSelectedId !== undefined) {
        state.lastFeedbackOptionId = Number(stillSelectedId);
      } else {
        state.lastFeedbackOptionId = -1;
      }
    }

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
          selected: futureKeys.has(getEffectiveId(b.option, i))
        })) as Option[]
      });
      this.selectionMessageService.selectionMessageSubject.next(message);
    } catch (e) {
      console.error('[OIS] Message sync failed', e);
    }
  }
}
