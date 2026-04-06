import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Option } from '../../models/Option.model';
import { QuestionType } from '../../models/question-type.enum';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuizService } from '../data/quiz.service';
import { QuizDataService } from '../data/quizdata.service';
import { ExplanationTextService } from '../features/explanation-text.service';

/**
 * Handles question data fetching, normalization, and preparation.
 * Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizQuestionDataService {

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private explanationTextService: ExplanationTextService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // FETCH QUESTION DETAILS
  // ═══════════════════════════════════════════════════════════════

  async fetchQuestionDetails(questionIndex: number): Promise<QuizQuestion | null> {
    try {
      const resolvedQuestion: QuizQuestion | null = await firstValueFrom(
        this.quizService.getQuestionByIndex(questionIndex)
      );

      if (!resolvedQuestion || !resolvedQuestion.questionText?.trim()) {
        console.error(`[Q${questionIndex}] Missing or invalid question payload`);
        return null;
      }

      const trimmedText = resolvedQuestion.questionText.trim();

      const options =
        Array.isArray(resolvedQuestion.options)
          ? resolvedQuestion.options.map((option, idx) => ({
            ...option,
            optionId: option.optionId ?? idx
          }))
          : [];

      if (!options.length) {
        console.error(`[Q${questionIndex}] No valid options`);
        return null;
      }

      let explanation = 'No explanation available';
      if (this.explanationTextService.explanationsInitialized) {
        const fetchedExplanation = await firstValueFrom(
          this.explanationTextService.getFormattedExplanationTextForQuestion(
            questionIndex
          )
        );
        explanation = fetchedExplanation?.trim() || 'No explanation available';
      } else {
        console.warn(`[Q${questionIndex}] Explanations not initialized`);
      }

      if (
        (!explanation || explanation === 'No explanation available') &&
        resolvedQuestion.explanation?.trim()
      ) {
        explanation = resolvedQuestion.explanation.trim();
      }

      const correctCount = options.filter((opt: Option) => opt.correct).length;
      const type =
        correctCount > 1
          ? QuestionType.MultipleAnswer
          : QuestionType.SingleAnswer;

      const question: QuizQuestion = {
        questionText: trimmedText,
        options,
        explanation,
        type
      };

      this.quizDataService.setQuestionType(question);
      return question;
    } catch (error: any) {
      console.error(`[fetchQuestionDetails] Error loading Q${questionIndex}:`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FETCH QUESTION DATA (legacy path)
  // ═══════════════════════════════════════════════════════════════

  async fetchQuestionData(
    quizId: string,
    questionIndex: number
  ): Promise<QuizQuestion | undefined> {
    try {
      const rawData = this.quizService.getQuestionData(quizId, questionIndex);
      if (!rawData) {
        return undefined;
      }

      const explanationObservable = this.explanationTextService.explanationsInitialized
        ? this.explanationTextService.getFormattedExplanationTextForQuestion(questionIndex)
        : undefined;

      let explanation = '';
      if (explanationObservable) {
        explanation = (await firstValueFrom(explanationObservable)) ?? '';
      }

      return {
        questionText: (rawData as any).questionText ?? '',
        options: (rawData as any).currentOptions ?? [],
        explanation: explanation ?? '',
        type: this.quizDataService.questionType as QuestionType,
      } as QuizQuestion;
    } catch (error) {
      console.error('Error fetching question data:', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FORMAT EXPLANATIONS FOR QUESTION SET
  // ═══════════════════════════════════════════════════════════════

  formatExplanationsForQuestions(
    hydratedQuestions: QuizQuestion[]
  ): Array<{ questionIndex: number; explanation: string }> {
    return hydratedQuestions.map((question, index) => {
      const rawExplanation = (question.explanation ?? '').trim();

      const correctIndices = this.explanationTextService.getCorrectOptionIndices(
        question,
        question.options,
        index
      );

      const formattedText = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        rawExplanation
      );

      return { questionIndex: index, explanation: formattedText };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // FORCE REGENERATE EXPLANATION
  // ═══════════════════════════════════════════════════════════════

  forceRegenerateExplanation(question: QuizQuestion, index: number): void {
    if (question && question.options) {
      console.log(`[forceRegenerateExplanation] Q${index + 1} options:`,
        question.options.map((o, i) => ({
          idx: i + 1,
          text: o.text?.substring(0, 20),
          correct: o.correct,
          optionId: o.optionId
        }))
      );

      const correctIndices = this.explanationTextService.getCorrectOptionIndices(
        question,
        question.options,
        index
      );
      console.log(`[forceRegenerateExplanation] Q${index + 1} correctIndices:`, correctIndices);

      const formattedExplanation = this.explanationTextService.formatExplanation(
        question,
        correctIndices,
        question.explanation
      );
      console.log(`[forceRegenerateExplanation] Q${index + 1} formattedExplanation:`,
        formattedExplanation?.substring(0, 80));

      this.explanationTextService.storeFormattedExplanation(
        index,
        formattedExplanation,
        question,
        question.options,
        true
      );
      console.log(`[forceRegenerateExplanation] Updated FET for Q${index + 1}`);
    } else {
      console.warn(`[forceRegenerateExplanation] Q${index + 1} has no options!`);
    }
  }
}
