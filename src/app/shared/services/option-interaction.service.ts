import { Injectable, NgZone, ApplicationRef } from '@angular/core';
import { Subject } from 'rxjs';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatRadioChange } from '@angular/material/radio';

import { Option } from '../models/Option.model';
import { OptionBindings } from '../models/OptionBindings.model';
import { SelectedOption } from '../models/SelectedOption.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { QuestionType } from '../models/question-type.enum';
import { FeedbackProps } from '../models/FeedbackProps.model';

import { QuizService } from './quiz.service';
import { QuizStateService } from './quizstate.service';
import { SelectedOptionService } from './selectedoption.service';
import { TimerService } from './timer.service';
import { FeedbackService } from './feedback.service';
import { SelectionMessageService } from './selection-message.service';
import { SoundService } from './sound.service';
import { NextButtonStateService } from './next-button-state.service';

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
    private soundService: SoundService,
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

    // Immediately disable this option after click to prevent re-clicking
    const optionIdToDisable = binding.option?.optionId;
    if (typeof optionIdToDisable === 'number') {
      if (!state.disabledOptionsPerQuestion.has(qIdx)) {
        state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
      }
      state.disabledOptionsPerQuestion.get(qIdx)!.add(optionIdToDisable);
      console.log(`[OIS] Disabled option ${optionIdToDisable} for Q${qIdx + 1} to prevent re-click`);
    }

    // Determine type for scoring
    const bindingsForScore = state.optionBindings ?? [];
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

    // Update Set
    if (isMultipleForScore) {
      if (willBeSelected) {
        if (!currentSelectedOptions.find(o => o.optionId === binding.option.optionId)) {
          currentSelectedOptions.push(binding.option);
        }
      } else {
        currentSelectedOptions = currentSelectedOptions.filter(o => o.optionId !== binding.option.optionId);
      }
    } else {
      currentSelectedOptions = [binding.option];
    }

    // Use SelectedOptionService as source of truth
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) || [];
    let simulatedSelection = [...storedSelection];

    const existingIdx = simulatedSelection.findIndex(o => o.optionId === binding.option.optionId);

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
    let clickedIsCorrect = binding.option.correct === true;

    // Fallbacks for correctness detection
    if (!clickedIsCorrect) {
      const match = (o: Option) => o.optionId === binding.option.optionId || 
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
      const correctCount = state.optionsToDisplay.filter(o => o.correct === true).length;
      if (correctCount > 1) {
        isMultipleAnswer = true;
      }
    }

    const isSingle = !isMultipleAnswer;

    if (isSingle) {
      if (clickedIsCorrect) {
        if (!state.correctClicksPerQuestion.has(qIdx)) {
          state.correctClicksPerQuestion.set(qIdx, new Set<number>());
        }
        if (typeof binding.option.optionId === 'number') {
          state.correctClicksPerQuestion.get(qIdx)!.add(binding.option.optionId);
        }

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
      const bindingCorrectIds = (state.optionBindings ?? [])
        .filter(b => b.option?.correct === true)
        .map(b => b.option?.optionId)
        .filter((id): id is number => typeof id === 'number');

      const correctIds = bindingCorrectIds.length > 0 ? bindingCorrectIds : 
        (state.optionsToDisplay ?? []).filter(o => o.correct).map(o => o.optionId).filter(id => id != null);

      if (!state.correctClicksPerQuestion.has(qIdx)) {
        state.correctClicksPerQuestion.set(qIdx, new Set<number>());
      }
      const clickedCorrectSet = state.correctClicksPerQuestion.get(qIdx)!;

      if (clickedIsCorrect && typeof binding.option.optionId === 'number') {
        clickedCorrectSet.add(binding.option.optionId);
      }

      const selectedIds = simulatedSelection.map(a => a.optionId).filter((id): id is number => typeof id === 'number');
      const allCorrectSelected = (correctIds as number[]).every(id => selectedIds.includes(id));
      const isPerfect = allCorrectSelected && selectedIds.length >= correctIds.length;

      if (isPerfect) {
        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });
        this.quizService.scoreDirectly(qIdx, true, true);

        if (!state.disabledOptionsPerQuestion.has(qIdx)) {
          state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
        }
        const dSet = state.disabledOptionsPerQuestion.get(qIdx)!;

        for (const b of state.optionBindings ?? []) {
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
    emitExplanation(qIdx);

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

    try {
      this.soundService.playOnceForOption({...binding.option, questionIndex: qIdx});
    } catch (e) {}
  }
}
