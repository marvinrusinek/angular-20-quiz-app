import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionType } from '../../models/question-type.enum';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from './selection-message.service';

/**
 * Manages option click orchestration: canonical option building, multi-answer
 * selection tracking, correctness evaluation, and lock logic for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcOptionClickOrchestratorService {

  /**
   * Per-question multi-answer selection tracking.
   * Maps question index → set of selected option indices.
   */
  private _multiAnswerSelections = new Map<number, Set<number>>();

  constructor(
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) {}

  /**
   * Computes a stable ID for an option, used for deduplication and matching.
   */
  getStableId(o: Option | SelectedOption, idx?: number): string | number {
    const effectiveIdx = idx ?? (o as any).index ?? (o as any).idx;
    return this.selectionMessageService.stableKey(o as Option, effectiveIdx);
  }

  /**
   * Applies local selection state for single/multi-answer questions.
   * Mutates the provided option arrays in place.
   */
  applyLocalSelectionState(params: {
    questionType: QuestionType | undefined;
    optionsNow: Option[];
    optionsToDisplay: Option[];
    evtIdx: number;
    checked: boolean;
    questionIndex: number;
  }): void {
    const { questionType, optionsNow, optionsToDisplay, evtIdx, checked, questionIndex } = params;

    if (questionType === QuestionType.SingleAnswer && checked === false) {
      optionsNow.forEach(opt => { if (opt.selected) opt.selected = true; });
      if (Array.isArray(optionsToDisplay)) {
        optionsToDisplay.forEach(opt => { if (opt.selected) opt.selected = true; });
      }
    } else {
      this.selectionMessageService.releaseBaseline(questionIndex);

      if (questionType === QuestionType.SingleAnswer) {
        optionsNow.forEach((opt, i) => {
          opt.selected = i === evtIdx ? (checked ?? true) : false;
        });
        if (Array.isArray(optionsToDisplay)) {
          optionsToDisplay.forEach((opt, i) => {
            opt.selected = i === evtIdx ? (checked ?? true) : false;
          });
        }
      } else {
        optionsNow[evtIdx].selected = checked ?? true;
        if (Array.isArray(optionsToDisplay)) {
          optionsToDisplay[evtIdx].selected = checked ?? true;
        }
      }
    }
  }

  /**
   * Determines if a question should use multi-answer selection logic.
   */
  isMultiForSelection(question: QuizQuestion | undefined): boolean {
    if (!question) return false;
    return question.type === QuestionType.MultipleAnswer ||
      ((question.options?.filter((o: any) => o.correct === true || String(o.correct) === 'true').length ?? 0) > 1);
  }

  /**
   * Tracks multi-answer selections and scores if all correct are selected.
   * Returns whether all correct options are now selected.
   */
  trackMultiAnswerSelection(params: {
    questionIndex: number;
    evtIdx: number;
    checked: boolean;
    question: QuizQuestion;
  }): { allCorrectSelected: boolean; selections: Set<number> } {
    const { questionIndex, evtIdx, checked, question } = params;

    if (!this._multiAnswerSelections.has(questionIndex)) {
      this._multiAnswerSelections.set(questionIndex, new Set());
    }
    const selections = this._multiAnswerSelections.get(questionIndex)!;

    if (checked !== false) {
      selections.add(evtIdx);
    } else {
      selections.delete(evtIdx);
    }

    const correctIndices = question.options
      .map((o: any, i: number) => (o.correct === true || String(o.correct) === 'true') ? i : -1)
      .filter((i: number) => i !== -1);

    const allCorrectSelected = correctIndices.length > 0 &&
      correctIndices.every((ci: number) => selections.has(ci));

    console.log(`[SCORE-FIX] Q${questionIndex + 1} evtIdx=${evtIdx} checked=${checked} selections=[${[...selections]}] correctIndices=[${correctIndices}] allCorrect=${allCorrectSelected}`);

    return { allCorrectSelected, selections };
  }

  /**
   * Records per-click dot color tracking for the clicked option.
   */
  trackClickedOptionCorrectness(
    questionIndex: number,
    evtIdx: number,
    question: QuizQuestion | undefined
  ): boolean {
    const clickedOptData = question?.options?.[evtIdx];
    const clickedIsCorrect = clickedOptData?.correct === true || String(clickedOptData?.correct) === 'true';

    this.selectedOptionService.lastClickedCorrectByQuestion.set(questionIndex, clickedIsCorrect);
    this.selectedOptionService.clickConfirmedDotStatus.set(
      questionIndex,
      clickedIsCorrect ? 'correct' : 'wrong'
    );
    try {
      sessionStorage.setItem('dot_confirmed_' + questionIndex, clickedIsCorrect ? 'correct' : 'wrong');
    } catch {}

    return clickedIsCorrect;
  }

  /**
   * Builds canonical options with consistent selection state from the service.
   * Returns a clean snapshot of all options with correct selected flags.
   */
  buildCanonicalOptions(params: {
    question: QuizQuestion;
    questionIndex: number;
    evtIdx: number;
    evtOpt: SelectedOption;
    checked: boolean;
  }): Option[] {
    const { question, questionIndex, evtIdx, evtOpt, checked } = params;
    const getStableId = (o: Option | SelectedOption, idx?: number) => this.getStableId(o, idx);

    const currentSelectedFromService =
      this.selectedOptionService.selectedOptionsMap?.get(questionIndex) ?? [];

    const canonicalOpts: Option[] = (question.options ?? []).map((o, i) => {
      const stableId = getStableId(o, i);
      const isSelected = currentSelectedFromService.some(sel => {
        const selId = sel.optionId;
        const oId = o.optionId;
        if (selId != null && oId != null && String(selId) !== '-1' && String(oId) !== '-1' && String(selId) === String(oId)) return true;
        return getStableId(sel, (sel as any).index ?? -1) === stableId;
      });

      return {
        ...o,
        optionId: (o.optionId != null && String(o.optionId) !== '-1') ? Number(o.optionId) : i,
        selected: isSelected,
      };
    });

    // Enforce single-answer exclusivity canonically
    if (question.type === QuestionType.SingleAnswer) {
      canonicalOpts.forEach((opt, i) => { opt.selected = i === evtIdx; });
      if (evtOpt?.correct && canonicalOpts[evtIdx]) {
        canonicalOpts[evtIdx].selected = true;
        this.selectionMessageService._singleAnswerCorrectLock.add(questionIndex);
        this.selectionMessageService._singleAnswerIncorrectLock.delete(questionIndex);
      }
    } else if (canonicalOpts[evtIdx]) {
      canonicalOpts[evtIdx].selected = checked ?? true;
    }

    return canonicalOpts;
  }

  /**
   * Applies lock logic for the clicked option.
   * For multi-answer: only locks incorrect options.
   * For single-answer: locks clicked option; if correct, locks all.
   */
  applyOptionLocks(params: {
    questionIndex: number;
    evtOpt: SelectedOption;
    question: QuizQuestion;
    optionsToDisplay: Option[];
  }): void {
    const { questionIndex, evtOpt, question, optionsToDisplay } = params;

    try {
      const clickedIdNum = Number(evtOpt?.optionId ?? NaN);
      const isMultiAnswer = question.type === QuestionType.MultipleAnswer ||
        (question.options?.filter((o: any) => o.correct === true || String(o.correct) === 'true').length ?? 0) > 1;

      if (Number.isFinite(clickedIdNum)) {
        if (!isMultiAnswer || !evtOpt?.correct) {
          this.selectedOptionService.lockOption(questionIndex, clickedIdNum);
        }
      }
      if (question.type === QuestionType.SingleAnswer) {
        if (evtOpt?.correct) {
          const allIdsNum = (optionsToDisplay ?? [])
            .map(o => Number(o.optionId))
            .filter(Number.isFinite);
          this.selectedOptionService.lockMany(questionIndex, allIdsNum as number[]);
        }
      }
    } catch {}
  }

  /**
   * Computes whether all correct answers are selected.
   */
  computeCorrectness(params: {
    canonicalOpts: Option[];
    question: QuizQuestion;
    questionIndex: number;
    evtOpt: SelectedOption;
    isMultiForSelection: boolean;
  }): { allCorrect: boolean; enableNext: boolean; hasAnySelection: boolean } {
    const { canonicalOpts, question, questionIndex, evtOpt, isMultiForSelection } = params;
    const getStableId = (o: Option | SelectedOption, idx?: number) => this.getStableId(o, idx);

    const correctOpts = canonicalOpts.filter(o => !!o.correct);
    const selKeys = new Set(
      canonicalOpts.filter(o => o.selected).map((o, i) => getStableId(o, i))
    );
    const selectedCorrectCount = correctOpts.filter((o) => {
      const originalIdx = (question.options ?? []).findIndex(orig => orig === o);
      return selKeys.has(getStableId(o, originalIdx !== -1 ? originalIdx : -1));
    }).length;

    const allCorrect =
      isMultiForSelection
        ? correctOpts.length > 0 && selectedCorrectCount === correctOpts.length
        : !!evtOpt?.correct;

    const hasAnySelection = canonicalOpts.some(o => o.selected);
    const enableNext = isMultiForSelection ? hasAnySelection : allCorrect;

    return { allCorrect, enableNext, hasAnySelection };
  }

  /**
   * Checks if an option is locked (already clicked) by numeric ID.
   * Returns true if the click should be blocked.
   */
  isOptionLocked(questionIndex: number, optionId: number | undefined): boolean {
    try {
      const lockIdNum = Number(optionId);
      if (Number.isFinite(lockIdNum) && this.selectedOptionService.isOptionLocked(questionIndex, lockIdNum)) {
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Resets multi-answer selections for a question (for use on question change).
   */
  resetSelectionsForQuestion(questionIndex: number): void {
    this._multiAnswerSelections.delete(questionIndex);
  }

  /**
   * Clears all tracked multi-answer selections.
   */
  resetAllSelections(): void {
    this._multiAnswerSelections.clear();
  }
}
