import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { SelectedOption } from '../../models/SelectedOption.model';
import { OptionIdResolverService } from './option-id-resolver.service';

@Injectable({ providedIn: 'root' })
export class OptionFeedbackStateService {
  readonly showFeedbackForOptionSig = signal<Record<string, boolean>>({});
  readonly showFeedbackForOption$ = toObservable(this.showFeedbackForOptionSig);

  private feedbackByQuestion = new Map<number, Record<string, boolean>>();

  constructor(private idResolver: OptionIdResolverService) {}

  // ── Read ────────────────────────────────────────────────────

  getShowFeedbackForOption(): { [optionId: number]: boolean } {
    return this.showFeedbackForOptionSig();
  }

  getFeedbackForQuestion(questionIndex: number): Record<string, boolean> {
    return { ...(this.feedbackByQuestion.get(questionIndex) ?? {}) };
  }

  // ── Write / Publish ─────────────────────────────────────────

  setFeedbackForQuestion(questionIndex: number, feedback: Record<string, boolean>): void {
    this.feedbackByQuestion.set(questionIndex, feedback);
  }

  deleteFeedbackForQuestion(questionIndex: number): void {
    this.feedbackByQuestion.delete(questionIndex);
  }

  publishFeedback(feedback: Record<string, boolean>): void {
    this.showFeedbackForOptionSig.set({ ...feedback });
  }

  clearFeedbackSignal(): void {
    this.showFeedbackForOptionSig.set({});
  }

  publishFeedbackForQuestion(
    questionIndex: number | null | undefined,
    currentQuestionIndex: number | null | undefined
  ): void {
    const resolvedIndex =
      typeof questionIndex === 'number' && Number.isInteger(questionIndex)
        ? questionIndex
        : Number.isInteger(currentQuestionIndex)
          ? (currentQuestionIndex as number)
          : null;

    if (resolvedIndex === null) {
      this.showFeedbackForOptionSig.set({});
      return;
    }

    const cached = this.feedbackByQuestion.get(resolvedIndex) ?? {};
    this.showFeedbackForOptionSig.set({ ...cached });
  }

  // ── Sync / Build ────────────────────────────────────────────

  syncFeedbackForQuestion(
    questionIndex: number,
    selections: SelectedOption[],
    currentQuestionIndex: number | null | undefined,
    isMultiAnswer: boolean
  ): void {
    if (!Array.isArray(selections) || selections.length === 0) {
      this.feedbackByQuestion.delete(questionIndex);

      if (currentQuestionIndex === questionIndex) {
        this.showFeedbackForOptionSig.set({});
      }
      return;
    }

    const feedbackMap = this.buildFeedbackMap(questionIndex, selections, isMultiAnswer);
    this.feedbackByQuestion.set(questionIndex, feedbackMap);

    if (currentQuestionIndex === questionIndex) {
      this.showFeedbackForOptionSig.set({ ...feedbackMap });
    }
  }

  buildFeedbackMap(
    questionIndex: number,
    selections: SelectedOption[],
    isMultiAnswer: boolean
  ): Record<string, boolean> {
    const feedbackMap: Record<string, boolean> = {};

    const targetSelections = isMultiAnswer && selections.length > 0
      ? [selections[selections.length - 1]]
      : selections;

    for (const selection of targetSelections ?? []) {
      if (!selection) {
        continue;
      }

      const keys = this.collectFeedbackKeys(questionIndex, selection);
      for (const key of keys) {
        if (key) {
          feedbackMap[String(key)] = true;
        }
      }
    }

    return feedbackMap;
  }

  private collectFeedbackKeys(
    questionIndex: number,
    selection: SelectedOption
  ): Array<string | number> {
    const keys = new Set<string | number>();

    const normalizedSelectionId = this.idResolver.normalizeOptionId(selection.optionId);
    if (normalizedSelectionId && String(normalizedSelectionId) !== '-1') {
      keys.add(normalizedSelectionId);
    }

    const numericSelectionId = this.idResolver.extractNumericId(selection.optionId);
    if (numericSelectionId !== null && String(numericSelectionId) !== '-1') {
      keys.add(numericSelectionId);
    }

    if (selection.optionId !== undefined && selection.optionId !== null && String(selection.optionId) !== '-1') {
      keys.add(selection.optionId);
    }

    const options = this.idResolver.getKnownOptions(questionIndex);
    if (options.length > 0) {
      const resolvedIndex = this.idResolver.resolveOptionIndexFromSelection(
        options,
        selection
      );

      if (
        resolvedIndex !== null &&
        resolvedIndex >= 0 &&
        resolvedIndex < options.length
      ) {
        const option: any = options[resolvedIndex];

        const normalizedOptionId = this.idResolver.normalizeOptionId(option?.optionId);
        if (normalizedOptionId && String(normalizedOptionId) !== '-1') {
          keys.add(normalizedOptionId);
        }

        const numericOptionId = this.idResolver.extractNumericId(option?.optionId);
        if (numericOptionId !== null && String(numericOptionId) !== '-1') {
          keys.add(numericOptionId);
        }

        if (option?.optionId !== undefined && option?.optionId !== null && String(option.optionId) !== '-1') {
          keys.add(option.optionId);
        }

        keys.add(resolvedIndex);
      }
    }

    return Array.from(keys);
  }

  // ── Republish ───────────────────────────────────────────────

  republishFeedbackForQuestion(
    questionIndex: number,
    selections: SelectedOption[],
    currentQuestionIndex: number | null | undefined,
    isMultiAnswer: boolean
  ): void {
    if (!Array.isArray(selections) || selections.length === 0) {
      this.feedbackByQuestion.delete(questionIndex);

      if (currentQuestionIndex === questionIndex) {
        this.showFeedbackForOptionSig.set({});
      }

      return;
    }

    let feedback = this.feedbackByQuestion.get(questionIndex);
    if (!feedback || Object.keys(feedback).length === 0) {
      feedback = this.buildFeedbackMap(questionIndex, selections, isMultiAnswer);
      this.feedbackByQuestion.set(questionIndex, feedback);
    }

    if (currentQuestionIndex === questionIndex) {
      this.showFeedbackForOptionSig.set({ ...feedback });
    }
  }

  // ── Bulk clear ──────────────────────────────────────────────

  clearAll(): void {
    this.feedbackByQuestion.clear();
    this.showFeedbackForOptionSig.set({});
  }
}
