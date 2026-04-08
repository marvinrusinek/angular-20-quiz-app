import { Injectable } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { SelectedOption } from '../../models/SelectedOption.model';
import { ScoreAnalysisItem } from '../../models/Final-Result.model';
import { QuizService } from '../data/quiz.service';
import { QuizStateService } from '../state/quizstate.service';
import { SelectedOptionService } from '../state/selectedoption.service';
import { SelectionMessageService } from '../features/selection-message/selection-message.service';

/**
 * Manages scoring, progress calculation, and expected-correct-count
 * initialization. Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizScoringService {

  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private selectionMessageService: SelectionMessageService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZE CORRECT EXPECTED COUNTS
  // ═══════════════════════════════════════════════════════════════

  initializeCorrectExpectedCounts(questionsArray: QuizQuestion[]): void {
    type QuizQuestionWithExpectedCorrect = QuizQuestion & {
      expectedCorrect?: number;
      _id?: string | number;
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
  // CALCULATE ANSWERED COUNT
  // ═══════════════════════════════════════════════════════════════

  calculateAnsweredCount(params: {
    totalCount: number;
    totalQuestions: number;
    quizQuestionsLength: number;
  }): number {
    const answeredIndices = new Set<number>();
    const total = params.totalCount;
    if (total <= 0) {
      return 0;
    }

    // Source 1: Service Maps (The most immediate interactive source)
    const mapsByRef = [
      { name: 'SOS.Map', map: this.selectedOptionService?.selectedOptionsMap },
      { name: 'QS.Map', map: this.quizService?.selectedOptionsMap }
    ];
    for (const item of mapsByRef) {
      if (item.map) {
        for (const [key, value] of item.map.entries()) {
          const idx = Number(key);
          if (!isNaN(idx) && idx >= 0 && idx < total) {
            const hasData = Array.isArray(value)
              ? value.length > 0
              : (value !== undefined);
            if (hasData) {
              answeredIndices.add(idx);
            }
          }
        }
      }
    }

    // Explicitly check questionCorrectness
    const qc = this.quizService.questionCorrectness;
    if (qc instanceof Map) {
      for (const [key, val] of qc.entries()) {
        const idx = Number(key);
        if (!isNaN(idx) && idx >= 0 && idx < total && val !== undefined) {
          answeredIndices.add(idx);
        }
      }
    }

    // Source 2: QuizStateService (Interaction Tracker)
    if (this.quizStateService) {
      this.quizStateService._answeredQuestionIndices?.forEach(idx => {
        if (idx >= 0 && idx < total) {
          answeredIndices.add(idx);
        }
      });
      this.quizStateService._hasUserInteracted?.forEach(idx => {
        if (idx >= 0 && idx < total) {
          answeredIndices.add(idx);
        }
      });
    }

    // Source 3: User Answers Persistence
    const userAnswers = this.quizService?.userAnswers;
    if (Array.isArray(userAnswers)) {
      userAnswers.forEach((ans, idx) => {
        if (idx < total && Array.isArray(ans) && ans.length > 0) {
          answeredIndices.add(idx);
        }
      });
    }

    const count = answeredIndices.size;
    const sortedIndices = Array.from(answeredIndices).sort((a, b) => a - b);
    console.log(`[PROGRESS] calculateAnsweredCount SUMMARY:
      TotalAnswered: ${count}/${total}
      AnsweredIndices: [${sortedIndices.map(i => i + 1).join(',')}]
      TotalCountSource: ${total} (totalQuestions=${params.totalQuestions}, quizQuestions=${params.quizQuestionsLength})
    `);
    return count;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD SCORE ANALYSIS SNAPSHOT
  // ═══════════════════════════════════════════════════════════════

  buildScoreAnalysisSnapshot(): ScoreAnalysisItem[] {
    const questions = this.quizService.activeQuiz?.questions
      ?? this.quizService.questions
      ?? [];
    const analysis: ScoreAnalysisItem[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q) {
        continue;
      }

      const selected = this.selectedOptionService.getSelectedOptionsForQuestion(i) ?? [];
      const selectedIds = selected
        .map(o => String(o?.optionId ?? ''))
        .filter(Boolean);

      const correctIds = (q.options ?? [])
        .filter((o: Option) => o.correct === true)
        .map((o: Option) => String(o.optionId))
        .filter(Boolean);

      // "wasCorrect" logic: selected set equals correct set
      const selectedSet: Set<string> = new Set<string>(selectedIds);
      const correctSet: Set<string> = new Set<string>(correctIds);

      const wasCorrect =
        correctSet.size > 0 &&
        correctSet.size === selectedSet.size &&
        Array.from(correctSet).every((id: string) => selectedSet.has(id));

      analysis.push({
        questionIndex: i,
        questionText: String(q.questionText ?? ''),
        wasCorrect,
        selectedOptionIds: selectedIds,
        correctOptionIds: correctIds
      });
    }

    return analysis;
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
