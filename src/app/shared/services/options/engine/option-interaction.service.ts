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
  ) {}

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
    updateOptionAndUI: (b: OptionBindings, i: number, ev: any) => void
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
    const effectiveId = (binding.option.optionId != null && binding.option.optionId !== -1) ? binding.option.optionId : index;
      
    // Mark interaction immediately
    this.quizStateService.markUserInteracted(qIdx);
    console.log(`[OIS] 🖱️ Marked user interaction for Q${qIdx + 1}`);

    // Prevent the click from bubbling up
    if (event && event.stopPropagation) {
      event.stopPropagation();
    }

    // Guard: Skip if this option is disabled
    const disabledSet = state.disabledOptionsPerQuestion.get(qIdx);
    if (disabledSet && effectiveId != null && disabledSet.has(effectiveId as any)) {
      console.log('[OIS] Option is disabled, blocking click:', effectiveId);
      return;
    }
    if (binding.disabled) {
      console.log('[OIS] Binding is disabled, blocking click:', effectiveId);
      return;
    }

    // USEFUL DERIVED VALUES
    const bindingsForScore = state.optionBindings ?? [];
    const correctCountInBindings = bindingsForScore.filter(b => isCorrectHelper(b.option)).length;
    const isMultipleMode = correctCountInBindings > 1 || state.type === 'multiple';

    // Guard: prevent deselection of correct answers in multiple-answer questions
    if (isMultipleMode && binding.isSelected && isCorrectHelper(binding.option)) {
      console.log('[OIS] Blocking deselection of correct answer:', effectiveId);
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      return;
    }

    // USE SELECTED OPTION SERVICE AS SOURCE OF TRUTH
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) || [];
    let simulatedSelection = [...storedSelection];

    const existingIdx = simulatedSelection.findIndex(o => {
        const oIdx = (o as any).index ?? o.displayIndex ?? (o as any).idx;
        return oIdx === index;
    });

    // Authoritative check for resolution status
    const question = getQuestionAtDisplayIndex(qIdx);
    const questionOptions = Array.isArray(question?.options) ? question.options : [];
    
    // BUILD CORRECT KEYS SET
    const correctKeys = new Set<string>();
    questionOptions.forEach((o, i) => {
      if (isCorrectHelper(o)) {
        const key = (o?.optionId != null && o.optionId !== -1) ? `id:${String(o.optionId).trim()}` : `idx:${i}`;
        correctKeys.add(key);
      }
    });

    const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const questionIds = new Set(
      questionOptions
        .map((o) => (o?.optionId != null && o.optionId !== -1) ? String(o.optionId).trim() : '')
        .filter(Boolean)
    );

    const getKey = (o: any, idx: number) => {
      const id = (o?.optionId != null && o.optionId !== -1) ? String(o.optionId).trim() : '';
      if (id && questionIds.has(id)) return `id:${id}`;
      const text = normalizeText(o?.text);
      if (text) {
        const qMatch = questionOptions.find(qo => normalizeText(qo.text) === text);
        if (qMatch) return (qMatch.optionId != null && qMatch.optionId !== -1) ? `id:${String(qMatch.optionId).trim()}` : `idx:${questionOptions.indexOf(qMatch)}`;
      }
      return `idx:${idx}`;
    };

    // CALCULATE FUTURE STATE
    let futureSelection: SelectedOption[];
    if (existingIdx > -1) {
      futureSelection = [...simulatedSelection];
      futureSelection.splice(existingIdx, 1);
    } else {
      const newOpt = { ...binding.option, selected: true, questionIndex: qIdx, index: index } as SelectedOption;
      futureSelection = isMultipleMode ? [...simulatedSelection, newOpt] : [newOpt];
    }

    const futureSet = new Set(futureSelection.map((s, i) => getKey(s, (s as any).index ?? i)));
    const allCorrectSelected = correctKeys.size > 0 && [...correctKeys].every(k => futureSet.has(k));
    const noIncorrectSelected = [...futureSet].every(k => correctKeys.has(k));
    const isPerfect = allCorrectSelected && noIncorrectSelected;

    // ACTUAL STATE UPDATE
    if (existingIdx > -1) {
       simulatedSelection.splice(existingIdx, 1);
    } else if (isMultipleMode) {
       simulatedSelection.push({ ...binding.option, selected: true, questionIndex: qIdx, index: index } as SelectedOption);
    } else {
       simulatedSelection = [{ ...binding.option, selected: true, questionIndex: qIdx, index: index } as SelectedOption];
    }

    // SYNC SERVICES
    const validIds = simulatedSelection.map((o: any) => {
      if (typeof o.optionId === 'number' && o.optionId !== -1) return o.optionId;
      const idxToUse = o.displayIndex ?? o.index ?? o.idx ?? 0;
      return Number(`${qIdx + 1}${(idxToUse + 1).toString().padStart(2, '0')}`);
    }).filter((id): id is number => Number.isFinite(id));

    this.quizService.updateUserAnswer(qIdx, validIds);
    this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);

    // FINISH LOGIC
    if (!state.disabledOptionsPerQuestion.has(qIdx)) {
      state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
    }
    const dSet = state.disabledOptionsPerQuestion.get(qIdx)!;

    if (isPerfect) {
      this.timerService.allowAuthoritativeStop();
      this.timerService.stopTimer(undefined, { force: true });
      this.quizService.scoreDirectly(qIdx, true, isMultipleMode);
      
      // USER REQUEST: Disable ALL once question is correctly resolved
      state.optionBindings.forEach((b, i) => {
        b.disabled = true;
        dSet.add(i);
        this.selectedOptionService.lockOption(qIdx, i);
      });
      state.disableRenderTrigger++;
    } else {
      // Not resolved: Ensure correct options are ENABLED
      state.optionBindings.forEach((b, i) => {
        if (isCorrectHelper(b.option)) {
          b.disabled = false;
          dSet.delete(i);
          this.selectedOptionService.unlockOption(qIdx, i);
        }
      });
    }

    // RE-SYNC FET SIGNAL if multi-answer satisfied
    if (isMultipleMode && allCorrectSelected) {
      if (!(this.quizService as any)._multiAnswerPerfect) {
        (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
      }
      (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);
      this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);
    }

    // UI SYNC
    const newState = isMultipleMode ? !binding.isSelected : true;
    const mockEvent = isMultipleMode ? { source: null, checked: newState } : { source: null, value: binding.option.optionId };
    updateOptionAndUI(binding, index, mockEvent);

    if (isPerfect || (!isMultipleMode && isCorrectHelper(binding.option))) {
      setTimeout(() => emitExplanation(qIdx), 0);
    }

    // MESSAGE UPDATE
    try {
      const message = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions,
        qType: isMultipleMode ? QuestionType.MultipleAnswer : QuestionType.SingleAnswer,
        opts: state.optionBindings.map((b, i) => ({
          ...b.option,
          selected: isMultipleMode ? futureSet.has(getKey(b.option, i)) : (i === index)
        })) as Option[]
      });
      this.selectionMessageService.selectionMessageSubject.next(message);
    } catch (e) {
      console.error('[OIS] Message sync failed', e);
    }
  }
}
