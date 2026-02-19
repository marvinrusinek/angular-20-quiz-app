import { Injectable, Inject, forwardRef, Injector } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionType } from '../../models/question-type.enum';
import { SelectedOption } from '../../models/SelectedOption.model';
import { SelectedOptionService } from '../state/selectedoption.service';
import { ExplanationTextService } from './explanation-text.service';
import { QuizService } from '../data/quiz.service';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  lastKnownOptions: Option[] = [];
  // Track the last computed indices for synchronization with FET
  private lastCorrectIndices: number[] = [];

  constructor(
    private selectedOptionService: SelectedOptionService,
    @Inject(forwardRef(() => ExplanationTextService))
    private explanationTextService: ExplanationTextService,
    private injector: Injector
  ) { }

  // Get the last computed correct indices for synchronization
  getLastCorrectIndices(): number[] {
    return this.lastCorrectIndices.slice();
  }

  public generateFeedbackForOptions(
    correctOptions: Option[],
    optionsToDisplay: Option[]
  ): string {
    const validCorrectOptions = (correctOptions || []).filter(opt => opt && typeof opt === 'object');
    const validOptionsToDisplay = (optionsToDisplay || []).filter(opt => opt && typeof opt === 'object');

    if (validOptionsToDisplay.length === 0) {
      console.warn(
        '[generateFeedbackForOptions] ❌ No valid options to display.'
      );
      return 'Feedback unavailable.';
    }

    // Use the full options array so setCorrectMessage can calculate correct indices
    const correctFeedback = this.setCorrectMessage(validOptionsToDisplay);
    if (!correctFeedback?.trim()) {
      console.warn(
        '[generateFeedbackForOptions] ❌ setCorrectMessage returned empty or invalid feedback. Falling back...'
      );
      return 'Feedback unavailable.';
    }

    return correctFeedback;
  }

  public buildFeedbackMessage(
    question: QuizQuestion,
    selected: Array<SelectedOption | Option> | null,
    strict: boolean = false,
    timedOut: boolean = false,
    displayIndex?: number
  ): string {
    if (timedOut) {
      return 'Time’s up. Review the explanation above.';
    }

    // Identify correct indices once
    const quizSvc = this.injector.get(QuizService, null);
    const qIdx =
      displayIndex ?? (question as any).questionIndex ?? quizSvc?.currentQuestionIndex ?? 0;

    let correctIndices = this.explanationTextService.getCorrectOptionIndices(
      question,
      question.options,
      qIdx
    );

    // ULTIMATE FALLBACK: If ETS failed, search the entire quiz for this question's correct answers
    if ((!correctIndices || correctIndices.length === 0) && quizSvc) {
      const qText = (question.questionText || '').trim().toLowerCase();
      if (qText) {
        const allQuestions = (quizSvc as any)._questions || quizSvc.questions || [];
        const sourceQ = allQuestions.find(
          (q: QuizQuestion) => (q.questionText || '').trim().toLowerCase() === qText
        );
        if (sourceQ?.options) {
          const foundIndices = sourceQ.options
            .map((o: Option, i: number) =>
              o.correct === true || (o as any).correct === 'true' ? i + 1 : null
            )
            .filter((n: number | null): n is number => n !== null);

          if (foundIndices.length > 0) {
            correctIndices = foundIndices;
            console.log(`[FeedbackService] ✅ Found ${foundIndices.length} correct answers via global text search fallback.`);
          }
        }
      }
    }

    // Still empty? Try one last catch: Look at question.options themselves
    if ((!correctIndices || correctIndices.length === 0) && question.options) {
      correctIndices = question.options
        .map((o, i) => (o.correct === true || (o as any).correct === 'true' ? i + 1 : null))
        .filter((n): n is number => n !== null);
    }

    const isMultiMode =
      correctIndices.length > 1 ||
      question.type === QuestionType.MultipleAnswer ||
      (question as any).multipleAnswer === true;

    // Patch a local copy of the question for resolution status check
    const patchedQuestion = {
      ...question,
      type: isMultiMode ? QuestionType.MultipleAnswer : QuestionType.SingleAnswer,
      options: (question.options || []).map((o, i) => ({
        ...o,
        correct: correctIndices.includes(i + 1)
      }))
    } as QuizQuestion;

    // Also patch the selected options to ensure they carry the 'correct' flag
    // matching their visual position. This helps getResolutionStatus reconcile them.
    const patchedSelected = (selected ?? []).map(sel => {
      const idx = (question.options || []).findIndex(o =>
        o === sel ||
        (o.optionId != null && sel.optionId === o.optionId) ||
        (o.text && sel.text && String(o.text).trim() === String(sel.text).trim())
      );
      if (idx >= 0) {
        return { ...sel, correct: correctIndices.includes(idx + 1) };
      }
      return sel;
    });

    const status = this.selectedOptionService.getResolutionStatus(
      patchedQuestion,
      patchedSelected as Option[],
      strict
    );

    // Enhanced resolution check: if all known correct indices are accounted for, we are resolved
    const trulyResolved = status.resolved || (
      correctIndices.length > 0 &&
      status.correctSelected === correctIndices.length &&
      status.incorrectSelected === 0
    );

    const formatReveal = (indices: number[]) => {
      const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);
      if (deduped.length === 0) return '';
      const optionsText = deduped.length === 1 ? 'answer is Option' : 'answers are Options';
      const optionStrings = deduped.length > 1
        ? `${deduped.slice(0, -1).join(', ')} and ${deduped.slice(-1)}`
        : `${deduped[0]}`;
      return `The correct ${optionsText} ${optionStrings}.`;
    };

    const revealMessage = formatReveal(correctIndices) || 'Check the correct answers below.';

    if (!selected || (selected as Array<any>).length === 0) {
      return '';
    }

    if (timedOut) {
      return `Time’s up. ${revealMessage}`.trim();
    }

    if (isMultiMode) {
      // 1. INCORRECT SELECTION (Priority)
      if (status.incorrectSelected > 0) {
        return 'Not this one, try again!';
      }

      // 2. FULLY CORRECT
      if (trulyResolved) {
        return `You're right! ${revealMessage}`;
      }

      // 3. PARTIALLY CORRECT
      if (status.correctSelected > 0) {
        const remainingText = status.remainingCorrect === 1
          ? '1 more correct answer'
          : `${status.remainingCorrect} more correct answers`;
        return `That's correct. Select ${remainingText}.`;
      }

      return revealMessage;
    } else {
      // Single-Answer Question
      if (trulyResolved) {
        return `You're right! ${revealMessage}`;
      }
      return 'Incorrect selection, try again!';
    }
  }

  public setCorrectMessage(
    optionsToDisplay?: Option[],
    question?: QuizQuestion
  ): string {
    // Store the last known options
    if (optionsToDisplay && optionsToDisplay.length > 0) {
      this.lastKnownOptions = [...optionsToDisplay];
    }

    if (!optionsToDisplay || optionsToDisplay.length === 0) {
      console.warn(`[FeedbackService] ❌ No options to display.`);
      return 'Feedback unavailable.';
    }

    const quizSvc = this.injector.get(QuizService, null);
    const currentIndex = quizSvc?.currentQuestionIndex;

    const indices = this.explanationTextService.getCorrectOptionIndices(
      question!,
      optionsToDisplay,
      typeof currentIndex === 'number' ? currentIndex : undefined
    );

    const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);
    this.lastCorrectIndices = deduped;

    if (deduped.length === 0) {
      return 'No correct options found.';
    }

    const optionsText =
      deduped.length === 1 ? 'answer is Option' : 'answers are Options';
    const optionStrings =
      deduped.length > 1
        ? `${deduped.slice(0, -1).join(', ')} and ${deduped.slice(-1)}`
        : `${deduped[0]}`;

    return `The correct ${optionsText} ${optionStrings}.`;
  }
}