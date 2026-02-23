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
  private lastCorrectIndices: number[] = [];

  constructor(
    private selectedOptionService: SelectedOptionService,
    @Inject(forwardRef(() => ExplanationTextService))
    private explanationTextService: ExplanationTextService,
    private injector: Injector
  ) { }

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
    displayIndex?: number,
    optionsToDisplay?: Option[],
    targetOption?: Option
  ): string {
    if (timedOut) return 'Time\'s up. Review the explanation above.';

    const quizSvc = this.injector.get(QuizService, null);
    const qIdx = displayIndex ?? (question as any).questionIndex ?? quizSvc?.currentQuestionIndex ?? 0;
    let correctIndices = this.explanationTextService.getCorrectOptionIndices(question, optionsToDisplay ?? question.options ?? [], qIdx);

    const isCorrectHelper = (val: any) => val === true || String(val) === 'true' || val === 1 || val === '1';
    
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

    // Use provided optionsToDisplay (visual order) as the source of truth for indices
    // This ensures indices match what the user sees even if shuffled.
    const optionsRaw = optionsToDisplay || (question.options || []);
    
    // Always calculate visual correct indices from the actual options being displayed
    correctIndices = optionsRaw
      .map((o: Option, i: number) => isCorrectHelper(o.correct) ? i + 1 : null)
      .filter((n: number | null): n is number => n !== null);

    const totalCorrectInQ = correctIndices.length;

    // Multi-Answer detection: trust multiple indices OR multiple database flags
    const isMultiMode =
      correctIndices.length > 1 ||
      question.type === QuestionType.MultipleAnswer ||
      (question as any).multipleAnswer === true;

    const selectedArr = (selected ?? []) as any[];
    let numCorrectSelected = 0;
    let numIncorrectSelected = 0;

    const normalizedSelected = new Map<string, any>();
    selectedArr.forEach(sel => {
      const id = sel.optionId != null ? String(sel.optionId) : sel.text;
      if (id) normalizedSelected.set(id, sel);
    });
    const dedupedSelected = Array.from(normalizedSelected.values());

    dedupedSelected.forEach(sel => {
      let visualIdx = sel.displayIndex;
      if (visualIdx === undefined || visualIdx < 0) {
        visualIdx = optionsRaw.findIndex((o: Option) =>
          o === sel ||
          (o.optionId != null && sel.optionId != null && String(o.optionId) === String(sel.optionId)) ||
          (o.text && sel.text && String(o.text).trim() === String(sel.text).trim())
        );
      }

      // ROBUST EVALUATION: 
      // An option is correct if its 'correct' flag is true OR if its visual position matches a correct index.
      const isCorrect = sel.correct === true || (sel as any).correct === "true" || (sel as any).correct === 1 ||
                        (visualIdx >= 0 && correctIndices.includes(visualIdx + 1));
      
      if (isCorrect) {
        numCorrectSelected++;
      } else {
        numIncorrectSelected++;
      }
    });

    const totalCorrectRequired = correctIndices.length > 0 ? correctIndices.length : 1;
    
    // Multi-Answer detection consistency: Resolved if counts match and no errors
    const isMultiResolved = isMultiMode && numCorrectSelected >= totalCorrectRequired && numIncorrectSelected === 0;

    // Special safeguard: if it was truly perfectly resolved by our counts, override text right here.
    if (isMultiResolved) {
       const formatReveal = (indices: number[]) => {
         const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);
         if (deduped.length === 0) return '';
         if (deduped.length === 1) return `The correct answer is Option ${deduped[0]}.`;
         const list = `${deduped.slice(0, -1).join(', ')} and ${deduped[deduped.length - 1]}`;
         return `The correct answers are Options ${list}.`;
       };
       return `You're right! ${formatReveal(correctIndices)}`;
    }

    console.log(`[FeedbackService] Evaluation: Q${qIdx + 1}`, {
      numCorrectSelected,
      totalCorrectRequired,
      numIncorrectSelected,
      isMultiMode,
      isMultiResolved,
      dedupedCount: dedupedSelected.length,
      correctIndices,
      selectedIds: dedupedSelected.map(s => s.optionId),
      selectedFlags: dedupedSelected.map(s => s.correct)
    });

    const formatReveal = (indices: number[]) => {
      const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);
      if (deduped.length === 0) return '';
      if (deduped.length === 1) return `The correct answer is Option ${deduped[0]}.`;
      const list = `${deduped.slice(0, -1).join(', ')} and ${deduped[deduped.length - 1]}`;
      return `The correct answers are Options ${list}.`;
    };

    const finalRevealMessage = formatReveal(correctIndices);

    if (!selected || dedupedSelected.length === 0) {
      return '';
    }

    if (isMultiMode) {
      if (numIncorrectSelected > 0) {
        return 'Not this one, try again!';
      }
      
      // If all required correct answers have been selected, show final message
      if (numCorrectSelected >= totalCorrectRequired) {
        return `You're right! ${finalRevealMessage}`;
      }
      
      // At least one correct answer but not all yet → progress message
      if (numCorrectSelected > 0) {
        const remainingTotal = Math.max(totalCorrectRequired - numCorrectSelected, 0);
        const remainingText = remainingTotal === 1
          ? '1 more correct answer'
          : `${remainingTotal} more correct answers`;
        return `That's correct. Please select ${remainingText}.`;
      }
      return 'Not this one, try again!';
    } else {
      if (numCorrectSelected >= 1 && numIncorrectSelected === 0) {
        return `You're right! ${finalRevealMessage}`;
      }
      return 'Not this one, try again!';
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
    const indices = this.explanationTextService.getCorrectOptionIndices(question!, optionsToDisplay, typeof currentIndex === 'number' ? currentIndex : undefined);
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