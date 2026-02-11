import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { ShuffleState } from '../../models/ShuffleState.model';
import { Utils } from '../../utils/utils';

export interface PrepareShuffleOpts {
  shuffleQuestions?: boolean,
  shuffleOptions?: boolean
}

@Injectable({ providedIn: 'root' })
export class QuizShuffleService {
  private shuffleByQuizId = new Map<string, ShuffleState>();

  // Call once starting a quiz session (after fetching questions)
  public prepareShuffle(
    quizId: string,
    questions: QuizQuestion[],
    opts: PrepareShuffleOpts = { shuffleQuestions: true, shuffleOptions: true }  // Question shuffle ON, Option shuffle ON
  ): void {
    // Only shuffle ONCE per quiz session.
    // If we already have a shuffle order for this quiz, DO NOT recreate it!
    if (this.shuffleByQuizId.has(quizId)) {
      console.log(`[QuizShuffleService] ⚡ REUSING existing shuffle for quiz ${quizId} - NOT re-shuffling!`);
      return;
    }

    // Check persistence
    if (this.loadState(quizId)) {
      console.log(`[QuizShuffleService] 💾 Loaded PERSISTED shuffle for quiz ${quizId}`);
      return;
    }

    // Question shuffling enabled, but option shuffling disabled for stability
    const { shuffleQuestions = true, shuffleOptions = false } = opts;

    console.log(`[QuizShuffleService] 🔀 prepareShuffle FIRST TIME for ${quizId}. shuffleQuestions=${shuffleQuestions}, shuffleOptions=${shuffleOptions}`);

    const qIdx = questions.map((_, i) => i);
    const questionOrder = shuffleQuestions ? Utils.shuffleArray(qIdx) : qIdx;

    const optionOrder = new Map<number, number[]>();
    for (const origIdx of questionOrder) {
      const len = questions[origIdx]?.options?.length ?? 0;
      const base = Array.from({ length: len }, (_, i) => i);
      optionOrder.set(
        origIdx,
        shuffleOptions ? Utils.shuffleArray(base) : base
      );
    }

    this.shuffleByQuizId.set(quizId, { questionOrder, optionOrder });
    this.saveState(quizId);
  }

  public hasShuffleState(quizId: string): boolean {
    return this.shuffleByQuizId.has(quizId) ||
      !!localStorage.getItem(`shuffleState:${quizId}`);
  }

  public getShuffleState(quizId: string): ShuffleState | undefined {
    if (!this.shuffleByQuizId.has(quizId)) {
      this.loadState(quizId);
    }
    return this.shuffleByQuizId.get(quizId);
  }

  // Persistence Utilities
  private saveState(quizId: string): void {
    const state = this.shuffleByQuizId.get(quizId);
    if (!state) return;

    try {
      // Convert Map to Array for JSON serialization
      const serializedState = {
        questionOrder: state.questionOrder,
        optionOrder: Array.from(state.optionOrder.entries())
      };
      localStorage.setItem(`shuffleState:${quizId}`, JSON.stringify(serializedState));
    } catch (err) {
      console.warn('[QuizShuffleService] Failed to persist shuffle state:', err);
    }
  }

  private loadState(quizId: string): boolean {
    try {
      const raw = localStorage.getItem(`shuffleState:${quizId}`);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.questionOrder || !Array.isArray(parsed.optionOrder)) return false;

      const state: ShuffleState = {
        questionOrder: parsed.questionOrder,
        optionOrder: new Map(parsed.optionOrder)
      };

      this.shuffleByQuizId.set(quizId, state);
      return true;
    } catch (err) {
      console.warn('[QuizShuffleService] Failed to load shuffle state:', err);
      return false;
    }
  }

  private reorderOptions(options: Option[], order?: number[]): Option[] {
    if (!Array.isArray(options) || options.length === 0) {
      return [];
    }

    const normalizeForDisplay = (opts: Option[]): Option[] =>
      opts.map((option, index) => {
        const id = this.toNum(option.optionId) ?? index + 1;

        // value must remain a number per your model
        const numericValue =
          typeof option.value === 'number'
            ? option.value
            : (this.toNum(option.value) ?? id);

        return {
          ...option,
          optionId: id,
          displayOrder: index,  // if this isn't in Option, you can keep it as an extension or drop it
          value: numericValue   // always number
        } as Option;  // if displayOrder isn't in Option, use a local type if you need it
      });

    if (!Array.isArray(order) || order.length !== options.length) {
      return normalizeForDisplay(options.map((option) => ({ ...option })));
    }

    const reordered = order
      .map((sourceIndex) => {
        const option = options[sourceIndex];
        if (!option) return null;
        return { ...option } as Option;
      })
      .filter((option): option is Option => option !== null);

    if (reordered.length !== options.length) {
      return normalizeForDisplay(options.map((option) => ({ ...option })));
    }

    return normalizeForDisplay(reordered);
  }

  private normalizeAnswerReference(
    answer: Option | null | undefined,
    options: Option[]
  ): Option | null {
    if (!answer) {
      return null;
    }

    const byId = this.toNum(answer.optionId);
    if (byId != null) {
      const matchById = options.find(
        (option) => this.toNum(option.optionId) === byId
      );
      if (matchById) {
        return matchById;
      }
    }

    const byValue = this.toNum(answer.value);
    if (byValue != null) {
      const matchByValue = options.find(
        (option) => this.toNum(option.value) === byValue
      );
      if (matchByValue) {
        return matchByValue;
      }
    }

    const normalizedText = (answer.text ?? '').trim().toLowerCase();
    if (normalizedText) {
      const matchByText = options.find(
        (option) => (option.text ?? '').trim().toLowerCase() === normalizedText
      );
      if (matchByText) {
        return matchByText;
      }
    }

    return null;
  }

  public alignAnswersWithOptions(
    rawAnswers: Option[] | undefined,
    options: Option[] = [],
  ): Option[] {
    const normalizedOptions = Array.isArray(options) ? options : [];
    if (normalizedOptions.length === 0) {
      return [];
    }

    const answers = Array.isArray(rawAnswers) ? rawAnswers : [];
    const aligned = answers
      .map((answer) => this.normalizeAnswerReference(answer, normalizedOptions))
      .filter((option): option is Option => option != null);

    if (aligned.length > 0) {
      const seen = new Set<number>();
      return aligned
        .filter((option) => {
          const id = this.toNum(option.optionId);
          if (id == null) {
            return true;
          }
          if (seen.has(id)) {
            return false;
          }
          seen.add(id);
          return true;
        })
        .map((option) => ({ ...option }));
    }

    const fallback = normalizedOptions.filter((option) => option.correct);
    if (fallback.length > 0) {
      return fallback.map((option) => ({ ...option }));
    }

    return [];
  }

  // Map display index -> original index (for scoring, persistence, timers)
  public toOriginalIndex(quizId: string, displayIdx: number): number | null {
    if (!this.shuffleByQuizId.has(quizId)) {
      this.loadState(quizId);
    }
    const state = this.shuffleByQuizId.get(quizId);
    if (!state) {
      console.warn(`[toOriginalIndex] ⚠️ No shuffle state found for quizId=${quizId}`);
      return null;
    }
    const result = state.questionOrder[displayIdx] ?? null;

    return result;
  }

  // Get a question re-ordered by the saved permutation (options included).
  public getQuestionAtDisplayIndex(
    quizId: string,
    displayIdx: number,
    allQuestions: QuizQuestion[]
  ): QuizQuestion | null {
    const state = this.shuffleByQuizId.get(quizId);
    if (!state) return null;

    const origIdx = state.questionOrder[displayIdx];
    const src = allQuestions[origIdx];
    if (!src) return null;

    // Ensure numeric, stable optionId before reordering
    const normalizedOpts = this.cloneAndNormalizeOptions(
      src.options ?? [],
      origIdx
    );
    const order = state.optionOrder.get(origIdx);
    const safeOptions = this.reorderOptions(normalizedOpts, order);

    return { ...src, options: safeOptions.map((option) => ({ ...option })) };
  }

  public buildShuffledQuestions(
    quizId: string,
    questions: QuizQuestion[]
  ): QuizQuestion[] {
    if (!Array.isArray(questions) || questions.length === 0) {
      return [];
    }

    const state = this.shuffleByQuizId.get(quizId);
    if (!state) {
      return questions.map((question, index) => {
        const normalizedOptions = this.cloneAndNormalizeOptions(
          question.options ?? [],
          index,  // use loop index as question index
        );
        return {
          ...question,
          options: normalizedOptions.map((option) => ({ ...option })),
          answer: this.alignAnswersWithOptions(
            question.answer,
            normalizedOptions
          )
        };
      });
    }

    const displaySet = state.questionOrder
      .map((originalIndex) => {
        const source = questions[originalIndex];
        if (!source) return null;

        const normalizedOptions = this.cloneAndNormalizeOptions(
          source.options ?? [],
          originalIndex
        );
        const orderedOptions = this.reorderOptions(
          normalizedOptions,
          state.optionOrder.get(originalIndex)
        );

        return {
          ...source,
          options: orderedOptions.map((option) => ({ ...option })),
          answer: this.alignAnswersWithOptions(source.answer, orderedOptions)
        } as QuizQuestion;
      })
      .filter((question): question is QuizQuestion => question !== null);

    if (displaySet.length === 0) {
      return questions.map((question, index) => {
        const normalizedOptions = this.cloneAndNormalizeOptions(
          question.options ?? [],
          index
        );
        return {
          ...question,
          options: normalizedOptions.map((option) => ({ ...option })),
          answer: this.alignAnswersWithOptions(
            question.answer,
            normalizedOptions
          )
        };
      });
    }

    return displaySet;
  }

  // Clear when the session ends
  public clear(quizId: string): void {
    this.shuffleByQuizId.delete(quizId);
    localStorage.removeItem(`shuffleState:${quizId}`);
  }

  public clearAll(): void {
    this.shuffleByQuizId.clear();
    try {
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith('shuffleState:')) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn('[QuizShuffleService] Failed to clear localStorage', e);
    }
  }

  private toNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  }

  // Make optionId numeric & stable; idempotent. Prefer 1-based ids for compatibility
  // with existing quiz logic while always normalising the display order.
  // Make optionId numeric & stable; idempotent. Uses questionIndex to ensure global uniqueness.
  public assignOptionIds(options: Option[], questionIndex: number): Option[] {
    return (options ?? []).map((o, i) => {
      // ⚡ FIX: Sync Safeguard - Preserve existing IDs (especially >100)
      const existingId = Number((o as any).optionId);
      if (!isNaN(existingId) && existingId >= 100) {
        return {
          ...o,
          optionId: existingId,
          value: (o as any).value ?? (o as any).text ?? existingId
        } as Option;
      }

      // Build a globally unique numeric ID like 1001, 1002, 2001, 2002, etc.
      // Format: (QuestionIndex + 1) + (OptionIndex + 1 padded to 2 digits)
      const uniqueId = Number(
        `${questionIndex + 1}${(i + 1).toString().padStart(2, '0')}`
      );

      return {
        ...o,
        optionId: uniqueId,
        // Fallback so selectedOptions.includes(option.value) remains viable
        value: (o as any).value ?? (o as any).text ?? uniqueId
      } as Option;
    });
  }

  private cloneAndNormalizeOptions(
    options: Option[] = [],
    questionIndex: number
  ): Option[] {
    const withIds = this.assignOptionIds(options, questionIndex);
    return withIds.map((option, index) => ({
      ...option,
      displayOrder: index,
      correct: option.correct === true,
      selected: option.selected === true,
      highlight: option.highlight ?? false,
      showIcon: option.showIcon ?? false
    }));
  }
}