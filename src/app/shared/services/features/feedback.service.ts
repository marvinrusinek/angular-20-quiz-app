import { Injectable, Inject, forwardRef, Injector } from '@angular/core';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
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
  ) {}

  // Get the last computed correct indices for synchronization
  getLastCorrectIndices(): number[] {
    return this.lastCorrectIndices.slice();
  }


  public generateFeedbackForOptions(
    correctOptions: Option[],
    optionsToDisplay: Option[]
  ): string {
    // CRITICAL: Do NOT use isValidOption filter here!
    // isValidOption requires 'correct' in option, but raw JSON options don't have it for incorrect answers.
    // Filtering shifts the array indices, causing wrong option numbers in feedback text.
    const validCorrectOptions = (correctOptions || []).filter(opt => opt && typeof opt === 'object');
    const validOptionsToDisplay = (optionsToDisplay || []).filter(opt => opt && typeof opt === 'object');

    if (validCorrectOptions.length === 0) {
      console.warn(
        '[generateFeedbackForOptions] ❌ No valid correct options provided.'
      );
      return 'No correct answers available for this question.';
    }
    if (validOptionsToDisplay.length === 0) {
      console.warn(
        '[generateFeedbackForOptions] ❌ No valid options to display. STOPPING BEFORE CALLING setCorrectMessage.'
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
    timedOut: boolean = false
  ): string {
    if (timedOut) {
      return 'Time’s up. Review the explanation above.';
    }
  
    const status = this.selectedOptionService.getResolutionStatus(
      question,
      selected as Option[] ?? [],
      strict
    );
  
    const hasAnySelection = (selected ?? []).some(
      (o: any) => o && o.selected !== false
    );
    if (!hasAnySelection) return '';
  
    // Single-answer
    if (status.correctTotal <= 1) {
      if (status.resolved) {
        return this.setCorrectMessage(question.options, question);
      }

      return 'Your selection is incorrect, try again!';
    }
  
    // Multi-answer
    if (status.resolved) {
      // Reveal correct options ONLY when fully resolved
      const reveal = this.setCorrectMessage(question.options, question);
      return reveal || 'Correct. You found all the right answers.';
    }

    // Correct so far, but not finished
    if (status.correctSelected > 0 && status.remainingCorrect > 0) {
      const remainingText =
        status.remainingCorrect === 1
          ? '1 more correct answer'
          : `${status.remainingCorrect} more correct answers`;
      return `That's correct! Select ${remainingText}.`;
    }
  
    // Incorrect option chosen
    if (status.incorrectSelected > 0) {
      return 'Not this one. Keep going...';
    }
  
  return '';
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

    // Use the robust logic from ExplanationTextService to find correct indices.
    // This avoids relying on the potentially corrupted 'correct' property in optionsToDisplay.
    const indices = this.explanationTextService.getCorrectOptionIndices(
      question!,
      optionsToDisplay,
      typeof currentIndex === 'number' ? currentIndex : undefined
    );

    // Dedupe + sort for stable, readable "Options 1 and 2" strings (matches FET)
    const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);
    
    console.log(`[FeedbackService.setCorrectMessage] Computed indices: ${JSON.stringify(deduped)}`);
    
    if (deduped.length === 0) {
      console.warn(`[FeedbackService] ❌ No matching correct options found.`);
      return 'No correct options found for this question.';
    }

    // Store for synchronization with FET
    this.lastCorrectIndices = deduped;

    const msg = this.formatFeedbackMessage(deduped);
    
    return msg;
  }

  private formatFeedbackMessage(indices: number[]): string {
    const optionsText =
      indices.length === 1 ? 'answer is Option' : 'answers are Options';
    const optionStrings =
      indices.length > 1
        ? `${indices.slice(0, -1).join(', ')} and ${indices.slice(-1)}`
        : `${indices[0]}`;

    return `You're right! The correct ${optionsText} ${optionStrings}.`;
  }
}