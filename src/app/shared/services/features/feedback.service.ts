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
      console.warn('[generateFeedbackForOptions] ❌ No valid options to display.');
      return 'Feedback unavailable.';
    }

    const correctFeedback = this.setCorrectMessage(validOptionsToDisplay);
    if (!correctFeedback?.trim()) {
      console.warn('[generateFeedbackForOptions] ❌ setCorrectMessage returned empty or invalid feedback. Falling back...');
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

    const quizSvc = this.injector.get(QuizService, null);
    const qIdx = displayIndex ?? (question as any).questionIndex ?? quizSvc?.currentQuestionIndex ?? 0;

    let correctIndices = this.explanationTextService.getCorrectOptionIndices(
      question,
      question.options,
      qIdx
    );

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
          }
        }
      }
    }

    if ((!correctIndices || correctIndices.length === 0) && question.options) {
      correctIndices = question.options
        .map((o, i) => (o.correct === true || (o as any).correct === 'true' ? i + 1 : null))
        .filter((n): n is number => n !== null);
    }

    const optionsRaw = (question.options || []);
    const totalCorrectInQ = optionsRaw.filter(o => o.correct === true || (o as any).correct === 'true').length;

    // Multi-Answer detection: trust multiple indices OR multiple database flags
    const isMultiMode =
      correctIndices.length > 1 ||
      totalCorrectInQ > 1 ||
      question.type === QuestionType.MultipleAnswer ||
      (question as any).multipleAnswer === true;

    const selectedArr = (selected ?? []) as any[];
    let numCorrectSelected = 0;
    let numIncorrectSelected = 0;

    selectedArr.forEach(sel => {
      let visualIdx = sel.displayIndex;
      if (visualIdx === undefined || visualIdx < 0) {
        visualIdx = optionsRaw.findIndex(o =>
          o === sel ||
          (o.optionId != null && sel.optionId === o.optionId) ||
          (o.text && sel.text && String(o.text).trim() === String(sel.text).trim())
        );
      }

      if (visualIdx >= 0) {
        if (correctIndices.includes(visualIdx + 1)) {
          numCorrectSelected++;
        } else {
          numIncorrectSelected++;
        }
      } else {
        if (sel.correct === true || (sel as any).correct === 'true') numCorrectSelected++;
        else numIncorrectSelected++;
      }
    });

    const totalCorrectRequired = (correctIndices.length > 0) ? correctIndices.length : Math.max(totalCorrectInQ, 1);

    const isActuallyResolved = totalCorrectRequired > 0 &&
      numCorrectSelected === totalCorrectRequired &&
      numIncorrectSelected === 0;

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

    if (!selected || selectedArr.length === 0) {
      return '';
    }

    if (isMultiMode) {
      if (numIncorrectSelected > 0) {
        return 'Not right, try again!';
      }
      if (isActuallyResolved) {
        return `You're right! ${revealMessage}`;
      }
      if (numCorrectSelected > 0) {
        const remainingTotal = Math.max(totalCorrectRequired - numCorrectSelected, 0);
        const remainingText = remainingTotal === 1
          ? '1 more correct answer'
          : `${remainingTotal} more correct answers`;
        return `That's correct. Select ${remainingText}.`;
      }
      return 'Not right, try again!';
    } else {
      if (isActuallyResolved || (numCorrectSelected >= 1 && numIncorrectSelected === 0)) {
        return `You're right! ${revealMessage}`;
      }
      return 'Not correct, try again!';
    }
  }

  public setCorrectMessage(
    optionsToDisplay?: Option[],
    question?: QuizQuestion
  ): string {
    if (optionsToDisplay && optionsToDisplay.length > 0) {
      this.lastKnownOptions = [...optionsToDisplay];
    }

    if (!optionsToDisplay || optionsToDisplay.length === 0) {
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

    const optionsText = deduped.length === 1 ? 'answer is Option' : 'answers are Options';
    const optionStrings = deduped.length > 1
      ? `${deduped.slice(0, -1).join(', ')} and ${deduped.slice(-1)}`
      : `${deduped[0]}`;

    return `The correct ${optionsText} ${optionStrings}.`;
  }
}