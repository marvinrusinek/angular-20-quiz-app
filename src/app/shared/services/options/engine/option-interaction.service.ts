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

    // Helper for truthy correctness check
    const isCorrectHelper = (v: any) => v === true || String(v) === 'true' || v === 1 || v === '1';

    // Determine type for scoring
    const bindingsForScore = state.optionBindings ?? [];
    const correctCountForScore = bindingsForScore.filter(b => isCorrectHelper(b.option?.correct)).length;
    const isMultipleForScore = correctCountForScore > 1;

    // Guard: prevent deselection of correct answers in multiple-answer questions
    if (isMultipleForScore && binding.isSelected && isCorrectHelper(binding.option?.correct)) {
      console.log('[OIS] Blocking deselection of correct answer:', effectiveId);
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      return;
    }

    // Use SelectedOptionService as source of truth
    const storedSelection = this.selectedOptionService.getSelectedOptionsForQuestion(qIdx) || [];
    let simulatedSelection = [...storedSelection];

    // NORMALIZE IDs for reliable lookups
    const existingIdx = simulatedSelection.findIndex(o => {
        const oId = (o.optionId != null && o.optionId !== -1) ? o.optionId : (o as any).index;
        return oId === effectiveId;
    });

    if (existingIdx > -1) {
      simulatedSelection.splice(existingIdx, 1);
    } else {
      simulatedSelection.push({
        ...binding.option,
        selected: true,
        questionIndex: qIdx,
        index: index // ensure index is preserved for fallback
      } as SelectedOption);
    }

    // Update service
    const allBindings = state.optionBindings ?? [];
    const validIds = simulatedSelection.map((o) => {
      if (typeof o.optionId === 'number') return o.optionId;
      const trueIndex = allBindings.findIndex(b => b.option === o || (b.option?.text === o.text));
      const idxToUse = trueIndex >= 0 ? trueIndex : (o as any).index ?? 0;
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
    let clickedIsCorrect = isCorrectHelper(binding.option.correct);

    // Fallbacks for correctness detection
    if (!clickedIsCorrect) {
      const match = (o: Option) => {
        const oId = (o.optionId != null && o.optionId !== -1) ? o.optionId : undefined;
        return (oId === effectiveId) || (o.text && o.text.trim().toLowerCase() === (binding.option.text ?? '').trim().toLowerCase());
      };
      
      const matchingOpt = (question?.options?.find(match)) || 
                          (state.optionBindings?.find(b => match(b.option))?.option) ||
                          (state.optionsToDisplay?.find(match));
      
      if (matchingOpt && isCorrectHelper(matchingOpt.correct)) {
        clickedIsCorrect = true;
      }
    }

    let isMultipleAnswer = state.type === 'multiple';
    if (!isMultipleAnswer && state.optionsToDisplay?.length > 0) {
      const correctCount = state.optionsToDisplay.filter(o => isCorrectHelper(o.correct)).length;
      if (correctCount > 1) {
        isMultipleAnswer = true;
      }
    }

    console.log(`[OIS] Q${qIdx + 1} Logic Mode: ${isMultipleAnswer ? 'MULTIPLE' : 'SINGLE'} | TargetID: ${effectiveId} | ClickCorrect: ${clickedIsCorrect}`);

    const isSingle = !isMultipleAnswer;
    let isPerfect = false;

    if (isSingle) {
      if (clickedIsCorrect) {
        if (!state.correctClicksPerQuestion.has(qIdx)) {
          state.correctClicksPerQuestion.set(qIdx, new Set<number>());
        }
        state.correctClicksPerQuestion.get(qIdx)!.add(effectiveId as any);

        this.timerService.allowAuthoritativeStop();
        this.timerService.stopTimer(undefined, { force: true });
        this.quizService.scoreDirectly(qIdx, true, false);

        if (!state.disabledOptionsPerQuestion.has(qIdx)) {
          state.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
        }
        const dSet = state.disabledOptionsPerQuestion.get(qIdx)!;

        state.optionBindings = state.optionBindings.map((b, i) => {
          const isInc = !isCorrectHelper(b.option?.correct);
          if (isInc) {
            const bId = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : i;
            dSet.add(bId as any);
          }
          return { ...b, disabled: isInc };
        });

        state.disableRenderTrigger++;
      }
    } else {
      // Multi-answer
      let correctIds: (number|string)[] = [];

      // Priority 1: Use question object from callback (Authoritative Source)
      if (question && Array.isArray(question.options)) {
        correctIds = question.options
          .filter(o => isCorrectHelper(o.correct))
          .map((o, i) => (o.optionId != null && o.optionId !== -1) ? o.optionId : i)
          .filter(id => id !== undefined);
      }

      // Priority 2: Fallback to bindings/display options
      if (correctIds.length === 0) {
        const bindingCorrectIds = (state.optionBindings ?? [])
          .filter(b => isCorrectHelper(b.option?.correct))
          .map((b, i) => (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : i);
          
        correctIds = bindingCorrectIds.length > 0 ? bindingCorrectIds : 
          (state.optionsToDisplay ?? [])
            .filter(o => isCorrectHelper(o.correct))
            .map((o, i) => (o.optionId != null && o.optionId !== -1) ? o.optionId : i);
      }

      const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();
      const questionOptions = Array.isArray(question?.options) ? question.options : [];
      const questionIds = new Set(
        questionOptions
          .map((o) => (o?.optionId != null && o.optionId !== -1) ? String(o.optionId).trim() : '')
          .filter(Boolean)
      );

      const keyForQuestionOption = (opt: Option | undefined, fallbackIndex: number): string => {
        if (!opt) return `idx:${fallbackIndex}`;
        const id = opt?.optionId;
        const text = normalizeText(opt?.text);
        if (id != null && id !== -1) return `id:${String(id).trim()}`;
        if (text) return `text:${text}`;
        return `idx:${fallbackIndex}`;
      };

      const correctSet = questionOptions.length > 0
        ? new Set(
          questionOptions
            .filter((o) => isCorrectHelper(o?.correct))
            .map((o, i) => keyForQuestionOption(o, i))
        )
        : new Set((correctIds ?? []).map((id) => `id:${String(id).trim()}`));
      
      if (!state.correctClicksPerQuestion.has(qIdx)) {
        state.correctClicksPerQuestion.set(qIdx, new Set<number>());
      }
      const clickedCorrectSet = state.correctClicksPerQuestion.get(qIdx)!;

      if (clickedIsCorrect) {
        clickedCorrectSet.add(effectiveId as any);
      }

      const selectedKeys = simulatedSelection
        .map((a) => {
          const id = (a?.optionId != null && a.optionId !== -1) ? String(a.optionId).trim() : '';
          const text = normalizeText(a?.text);
          const explicitIndex = Number((a as any)?.index);

          if (id && questionIds.has(id)) {
            return `id:${id}`;
          }

          if (text) {
            const qOptByText = questionOptions.find((opt) => normalizeText(opt?.text) === text);
            if (qOptByText) {
              return keyForQuestionOption(qOptByText, questionOptions.indexOf(qOptByText));
            }
          }

          if (Number.isInteger(explicitIndex) && explicitIndex >= 0 && explicitIndex < questionOptions.length) {
            return keyForQuestionOption(questionOptions[explicitIndex], explicitIndex);
          }

          if (id) return `id:${id}`;
          if (text) return `text:${text}`;
          return null;
        })
        .filter((k): k is string => !!k);

      const selectedSet = new Set(selectedKeys);

      // Strict equality check: same size and every correct key is selected
      const allCorrectSelected = [...correctSet].every((key) => selectedSet.has(key));

      isPerfect = correctSet.size > 0 && correctSet.size === selectedSet.size && allCorrectSelected;

      console.log(`[OIS] Multi-Answer Check Q${qIdx + 1}:`, {
        correctKeys: [...correctSet],
        selectedKeys: [...selectedSet],
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

        state.optionBindings.forEach((b, i) => {
          // Disable incorrect options to lock the state
          if (!isCorrectHelper(b.option?.correct)) {
            const bId = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : i;
            dSet.add(bId as any);
          }
        });
        state.disableRenderTrigger++;
      }
    }

    const newState = isSingle ? true : !binding.isSelected;
    const mockEvent = isSingle ? { source: null, value: binding.option.optionId } : { source: null, checked: newState };

    updateOptionAndUI(binding, index, mockEvent);

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
        opts: state.optionBindings.map((b, i) => {
          const bId = (b.option?.optionId != null && b.option.optionId !== -1) ? b.option.optionId : i;
          return {
            ...b.option,
            selected: isSingle ? (bId === effectiveId) : state.correctClicksPerQuestion.get(qIdx)?.has(bId as any)
          };
        }) as Option[]
      });
      this.selectionMessageService.selectionMessageSubject.next(message);
    } catch (e) {
      console.error('[OIS] Selection message update failed', e);
    }
  }
}
