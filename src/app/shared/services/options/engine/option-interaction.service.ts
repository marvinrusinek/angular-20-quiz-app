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

    // Guard: disabled
    if (binding.disabled) return;

    // USEFUL DERIVED VALUES
    const bindingsForScore = state.optionBindings ?? [];
    const correctCountInBindings = bindingsForScore.filter(b => isCorrectHelper(b.option)).length;
    // Determine if we are in multi-answer behavior
    const isMultipleMode = correctCountInBindings > 1 || state.type === 'multiple';

    // Guard: prevent deselection of correct answers in multiple
    if (isMultipleMode && binding.isSelected && isCorrectHelper(binding.option)) {
      if (event && event.preventDefault) event.preventDefault();
      return;
    }

    // STATE SETUP
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) || [];
    let simulatedSelection = [...storedSelection];
    const existingIdx = simulatedSelection.findIndex(o => {
      const oIdx = (o as any).index ?? o.displayIndex ?? (o as any).idx;
      return oIdx === index;
    });

    const question = getQuestionAtDisplayIndex(qIdx);
    const questionOptions = Array.isArray(question?.options) ? question.options : [];

    const getKey = (o: any, idx: number) => {
      const id = o.optionId ?? (o as any).id;
      if (id != null && id !== -1) return `id:${id}`;
      return `idx:${idx}`;
    };

    const correctKeys = new Set<string>();
    questionOptions.forEach((o, i) => {
      if (isCorrectHelper(o)) correctKeys.add(getKey(o, i));
    });

    const isCurrentlySelected = existingIdx > -1;
    let futureSelection: SelectedOption[];

    if (isCurrentlySelected) {
      // Unselect
      futureSelection = simulatedSelection.filter((_, i) => i !== existingIdx);
    } else {
      // Select
      const newOpt = {
        ...binding.option,
        selected: true,
        questionIndex: qIdx,
        index: index
      } as SelectedOption;
      futureSelection = isMultipleMode ? [...simulatedSelection, newOpt] : [newOpt];
    }

    const futureKeys = new Set(futureSelection.map(s => getKey(s, (s as any).index ?? (s as any).displayIndex)));
    const allCorrectFound = correctKeys.size > 0 && [...correctKeys].every(k => futureKeys.has(k));
    const numIncorrectInFuture = futureSelection.filter(o => !isCorrectHelper(o)).length;
    const isPerfect = allCorrectFound && numIncorrectInFuture === 0;

    // COMMIT STATE
    simulatedSelection = [...futureSelection];
    this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);
    // No more ID generation here - trust SelectedOptionService and QuizService
    this.quizService.updateUserAnswer(
      qIdx,
      simulatedSelection.map(o => o.optionId).filter((id): id is number => id != null && id !== -1)
    );

    const getLockId = (b: OptionBindings, i: number) => {
      const explicitId = b.option?.optionId;
      return (explicitId != null && Number(explicitId) !== -1) ? Number(explicitId) : i;
    };

    // OPTIMIZATION: Removed redundant locking logic here. 
    // updateOptionAndUI (called below) triggers OptionUiSyncService which 
    // uses OptionLockPolicyService for authoritative locking.


    // UPDATE UI
    const newState = !isCurrentlySelected;
    const mockEvent = isMultipleMode ? { source: null, checked: newState } : { source: null, value: binding.option.optionId };
    updateOptionAndUI(binding, index, mockEvent);

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
      const lastCorrKey = lastCorrect ? getKey(lastCorrect, (lastCorrect as any).index ?? (lastCorrect as any).displayIndex) : null;

      state.optionBindings.forEach((b, i) => {
        const bKey = getKey(b.option, i);
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
        .find(id => futureKeys.has(getKey(state.optionsToDisplay[id], id)));

      if (stillSelectedId !== undefined) {
        state.lastFeedbackOptionId = Number(stillSelectedId);
      } else {
        state.lastFeedbackOptionId = -1;
      }
    }

    state.lastClickedOptionId = index;
    state.hasUserClicked = true;
    state.disableRenderTrigger++;

    // CALL UPDATE with the existing context so that feedback anchors are preserved
    (updateOptionAndUI as any)(binding, index, mockEvent, state);

    // MESSAGE UPDATE - MOVED INSIDE handleOptionClick
    try {
      const message = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions,
        qType: isMultipleMode ? QuestionType.MultipleAnswer : QuestionType.SingleAnswer,
        opts: state.optionBindings.map((b, i) => ({
          ...b.option,
          selected: futureKeys.has(getKey(b.option, i))
        })) as Option[]
      });
      this.selectionMessageService.selectionMessageSubject.next(message);
    } catch (e) {
      console.error('[OIS] Message sync failed', e);
    }
  }
}
