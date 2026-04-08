import { Injectable } from '@angular/core';

import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { SelectionMessageService } from '../features/selection-message/selection-message.service';

/**
 * Manages scoring, progress calculation, and expected-correct-count
 * initialization. Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizScoringService {

  constructor(
    private selectionMessageService: SelectionMessageService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZE CORRECT EXPECTED COUNTS
  // ═══════════════════════════════════════════════════════════════

  initializeCorrectExpectedCounts(questionsArray: QuizQuestion[]): void {
    type QuizQuestionWithExpectedCorrect = QuizQuestion & {
      expectedCorrect?: number;
      id?: string | number;
      _id?: string | number;
      questionId?: string | number;
      uuid?: string | number;
      qid?: string | number;
      questionID?: string | number;
    };

    const typedQuestionsArray = questionsArray as QuizQuestionWithExpectedCorrect[];

    for (const [idx, qq] of typedQuestionsArray.entries()) {
      const expectedCorrect = qq.expectedCorrect;

      // Prefer explicit expectedCorrect when valid (>0)
      const fromMeta =
          typeof expectedCorrect === 'number' &&
          Number.isFinite(expectedCorrect) &&
          expectedCorrect > 0
              ? Math.floor(expectedCorrect)
              : Array.isArray(qq.answer)
                  ? new Set(
                      qq.answer.map((a) =>
                          String(a ?? '')
                              .trim()
                              .toLowerCase()
                      )
                  ).size
                  : undefined;

      const fromFlags = Array.isArray(qq.options)
          ? qq.options.reduce(
              (n: number, o: any) => n + (o?.correct ? 1 : 0),
              0
          )
          : 0;

      const totalCorrectFromOptions = Array.isArray(qq.options)
          ? qq.options.filter((o: any) => o?.correct === true).length
          : 0;

      const expected = fromMeta ?? fromFlags ?? totalCorrectFromOptions;

      const qid =
          qq.id ??
          qq._id ??
          qq.questionId ??
          qq.uuid ??
          qq.qid ??
          qq.questionID ??
          null;

      if (typeof expected === 'number' && expected > 1) {
        this.selectionMessageService.setExpectedCorrectCount(idx, expected);

        if (qid != null) {
          this.selectionMessageService.setExpectedCorrectCountForId(qid, expected);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD IMMEDIATE SELECTIONS FOR SCORING
  // ═══════════════════════════════════════════════════════════════

  buildImmediateSelectionsForScoring(
    index: number,
    existingSelections: SelectedOption[],
    clickedOption: SelectedOption,
    isSingleAnswerQuestion: boolean,
  ): SelectedOption[] {
    const canonicalClicked: SelectedOption = {
      ...clickedOption,
      questionIndex: index,
      selected:
        clickedOption?.selected !== undefined
          ? clickedOption.selected
          : true,
    };

    if (isSingleAnswerQuestion) {
      if (canonicalClicked.selected === false) {
        return [];
      }
      return [canonicalClicked];
    }

    const merged = new Map<string, SelectedOption>();
    for (const selection of existingSelections) {
      const key = String(selection?.optionId ?? selection?.text ?? '').trim();
      if (!key) {
        continue;
      }
      merged.set(key, selection);
    }

    const clickedKey = String(
      canonicalClicked?.optionId ?? canonicalClicked?.text ?? '',
    ).trim();

    if (clickedKey) {
      const wasPreviouslySelected = merged.has(clickedKey);
      const explicitSelectedState =
        clickedOption?.selected ??
        (clickedOption as any)?.checked ??
        (clickedOption as any)?.isSelected;
      const shouldSelect = explicitSelectedState === undefined
        ? !wasPreviouslySelected
        : explicitSelectedState === true;

      if (!shouldSelect) {
        merged.delete(clickedKey);
      } else {
        merged.set(clickedKey, canonicalClicked);
      }
    }

    return Array.from(merged.values());
  }

  // ═══════════════════════════════════════════════════════════════
  // HYDRATE QUESTION SET
  // ═══════════════════════════════════════════════════════════════

  hydrateQuestionSet(questions: QuizQuestion[] | null | undefined): QuizQuestion[] {
    if (!Array.isArray(questions) || questions.length === 0) {
      return [];
    }

    return questions.map((question) => ({
      ...question,
      options: Array.isArray(question.options)
        ? question.options.map((option) => ({
          ...option,
          correct: (option.correct as any) === true || (option.correct as any) === 'true',
        }))
        : []
    }));
  }
}
