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
      
    // Mark interaction immediately
    this.quizStateService.markUserInteracted(qIdx);
    console.log(`[OIS] 🖱️ Marked user interaction for Q${qIdx + 1}`);

    // Prevent the click from bubbling up
    event.stopPropagation();

    // Guard: Skip if this option is disabled
    const disabledSet = state.disabledOptionsPerQuestion.get(qIdx);
    if (disabledSet && binding.option.optionId != null && disabledSet.has(binding.option.optionId)) {
      console.log('[OIS] Option is disabled, blocking click:', binding.option?.optionId);
      return;
    }
    if (binding.disabled) {
      console.log('[OIS] Binding is disabled, blocking click:', binding.option?.optionId);
      return;
    }

    // OPTIONAL: Skip if you prefer to allow re-clicking the same option
    /*
    const optionIdToDisable = binding.option?.optionId;
    if (typeof optionIdToDisable === 'number') {
      if (!state.disabledOptionsPerQuestion.has(qIdx)) {
        state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
      }
      state.disabledOptionsPerQuestion.get(qIdx)!.add(optionIdToDisable);
      console.log(`[OIS] Disabled option ${optionIdToDisable} for Q${qIdx + 1}`);
    }
    */

    // Determine type for scoring
    const bindingsForScore = state.optionBindings ?? [];
    // Relaxed check for 'correct' (truthy)
    const correctCountForScore = bindingsForScore.filter(b => b.option?.correct).length;
    const isMultipleForScore = correctCountForScore > 1;

    // Guard: prevent deselection of correct answers in multiple-answer questions
    if (isMultipleForScore && binding.isSelected && binding.option?.correct) {
      console.log('[OIS] Blocking deselection of correct answer:', binding.option?.optionId);
      event.preventDefault();
      return;
    }

    // Calculate Current Selected Set
    let currentSelectedOptions = bindingsForScore
      .filter(b => b.isSelected)
      .map(b => b.option);

    const willBeSelected = isMultipleForScore ? !binding.isSelected : true;

    // Use SelectedOptionService as source of truth
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) || [];
    let simulatedSelection = [...storedSelection];

    // NORMALIZE IDs for reliable lookups
    const targetId = Number(binding.option.optionId);
    const existingIdx = simulatedSelection.findIndex(o => Number(o.optionId) === targetId);

    if (existingIdx > -1) {
      simulatedSelection.splice(existingIdx, 1);
    } else {
      simulatedSelection.push({
        ...binding.option,
        selected: true,
        questionIndex: qIdx
      } as SelectedOption);
    }

    // Update service
    const allBindings = state.optionBindings ?? [];
    const validIds = simulatedSelection.map((o) => {
      if (typeof o.optionId === 'number') return o.optionId;
      const trueIndex = allBindings.findIndex(b => b.option === o || (b.option?.text === o.text));
      const idxToUse = trueIndex >= 0 ? trueIndex : 0;
      return Number(`${qIdx + 1}${(idxToUse + 1).toString().padStart(2, '0')}`);
    }).filter((id): id is number => Number.isFinite(id));

    this.quizService.updateUserAnswer(qIdx, validIds);
    this.selectedOptionService.syncSelectionState(qIdx, simulatedSelection);

    const isShuffledForScoring = this.quizService?.isShuffleEnabled?.();
    if (!isShuffledForScoring) {
      this.quizService.checkIfAnsweredCorrectly(qIdx).then((isCorrect) => {
        console.log(`[OIS] Score Verified for Q${qIdx + 1}: ${isCorrect}`);
      });
    }

    // TIMER STOP LOGIC
    const question = getQuestionAtDisplayIndex(qIdx);
    let clickedIsCorrect = !!binding.option.correct; // Relaxed bool check

    // Fallbacks for correctness detection
    if (!clickedIsCorrect) {
      const match = (o: Option) => Number(o.optionId) === targetId || 
        (o.text && o.text.trim().toLowerCase() === (binding.option.text ?? '').trim().toLowerCase());
      
      const matchingOpt = (question?.options?.find(match)) || 
                          (state.optionBindings?.find(b => match(b.option))?.option) ||
                          (state.optionsToDisplay?.find(match));
      
      if (matchingOpt?.correct) {
        clickedIsCorrect = true;
      }
    }

    let isMultipleAnswer = state.type === 'multiple';
    if (!isMultipleAnswer && state.optionsToDisplay?.length > 0) {
      const correctCount = state.optionsToDisplay.filter(o => !!o.correct).length;
      if (correctCount > 1) {
        isMultipleAnswer = true;
      }
    }

    console.log(`[OIS] Q${qIdx + 1} Logic Mode: ${isMultipleAnswer ? 'MULTIPLE' : 'SINGLE'} | TargetID: ${targetId} | ClickCorrect: ${clickedIsCorrect}`);

    const isSingle = !isMultipleAnswer;
    let isPerfect = false;

    if (isSingle) {
      if (clickedIsCorrect) {
        if (!state.correctClicksPerQuestion.has(qIdx)) {
          state.correctClicksPerQuestion.set(qIdx, new Set<number>());
        }
        state.correctClicksPerQuestion.get(qIdx)!.add(targetId);

        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });
        this.quizService.scoreDirectly(qIdx, true, false);

        if (!state.disabledOptionsPerQuestion.has(qIdx)) {
          state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
        }
        const dSet = state.disabledOptionsPerQuestion.get(qIdx)!;

        state.optionBindings = state.optionBindings.map(b => {
          const isInc = !b.option?.correct;
          if (isInc && typeof b.option?.optionId === 'number') {
            dSet.add(b.option.optionId);
          }
          return { ...b, disabled: isInc };
        });

        state.disableRenderTrigger++;
      }
    } else {
      // Multi-answer
      // Use relaxed correct check (truthy compatibility)
      let correctIds: number[] = [];

      // Priority 1: Use question object from callback (Authoritative Source)
      if (question && Array.isArray(question.options)) {
        correctIds = question.options
          .filter(o => !!o.correct)
          .map(o => Number(o.optionId))
          .filter(id => Number.isFinite(id));
      }

      // Priority 2: Fallback to bindings/display options
      if (correctIds.length === 0) {
        const bindingCorrectIds = (state.optionBindings ?? [])
          .filter(b => !!b.option?.correct)
          .map(b => Number(b.option?.optionId))
          .filter((id): id is number => Number.isFinite(id));
          
        correctIds = bindingCorrectIds.length > 0 ? bindingCorrectIds : 
          (state.optionsToDisplay ?? [])
            .filter(o => !!o.correct)
            .map(o => Number(o.optionId))
            .filter(id => Number.isFinite(id));
      }

      if (!state.correctClicksPerQuestion.has(qIdx)) {
        state.correctClicksPerQuestion.set(qIdx, new Set<number>());
      }
      const clickedCorrectSet = state.correctClicksPerQuestion.get(qIdx)!;

      if (clickedIsCorrect) {
        clickedCorrectSet.add(targetId);
      }

      const selectedIds = simulatedSelection
        .map(a => Number(a.optionId))
        .filter((id): id is number => Number.isFinite(id));
      
      const correctSet = new Set(correctIds);
      const selectedSet = new Set(selectedIds);
      
      // Strict equality check: same size and every correct ID is selected
      let allCorrectSelected = [...correctSet].every(id => selectedSet.has(id));
      isPerfect = correctSet.size > 0 && correctSet.size === selectedSet.size && allCorrectSelected;

      console.log(`[OIS] Multi-Answer Check Q${qIdx + 1}:`, {
        correctIds: [...correctSet],
        selectedIds: [...selectedSet],
        allCorrectSelected,
        isPerfect
      });

      if (isPerfect) {
        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });
        this.quizService.scoreDirectly(qIdx, true, true);
        
        console.log(`[OIS] PERFECT score detected for Q${qIdx + 1}`);

        if (!state.disabledOptionsPerQuestion.has(qIdx)) {
          state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
        }
        const dSet = state.disabledOptionsPerQuestion.get(qIdx)!;

        for (const b of state.optionBindings ?? []) {
          // Disable incorrect options to lock the state
          if (!b.option?.correct && typeof b.option?.optionId === 'number') {
            dSet.add(b.option.optionId);
          }
        }
        state.disableRenderTrigger++;
      }
    }

    const newState = isSingle ? true : !binding.isSelected;
    const mockEvent = isSingle ? { source: null, value: binding.option.optionId } : { source: null, checked: newState };

    updateOptionAndUI(binding, index, mockEvent);

    // Only emit explanation if the question is "answered" fully.
    // For Single: Answered on first click (since we select and disable or move on).
    // For Multi: Answered when all correct options are selected (isPerfect).
    if (isSingle || (isMultipleAnswer && typeof isPerfect !== 'undefined' && isPerfect)) {
      console.log(`[OIS] Triggering emitExplanation for Q${qIdx + 1}`);
      setTimeout(() => {
        emitExplanation(qIdx);
      }, 0);
    }

    try {
      const message = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions,
        qType: isSingle ? QuestionType.SingleAnswer : QuestionType.MultipleAnswer,
        opts: state.optionBindings.map(b => ({
          ...b.option,
          selected: isSingle ? (b.option?.optionId === binding.option?.optionId) : state.correctClicksPerQuestion.get(qIdx)?.has(b.option?.optionId as number)
        })) as Option[]
      });
      this.selectionMessageService.selectionMessageSubject.next(message);
    } catch (e) {
      console.error('[OIS] Selection message update failed', e);
    }
  }
}
