import { ChangeDetectorRef, ChangeDetectionStrategy, Component, Input, OnInit,
  OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { FeedbackService } from '../../../../shared/services/feedback.service';
import { SelectedOptionService } from '../../../../shared/services/selectedoption.service';
import { QuizService } from '../../../../shared/services/quiz.service';

@Component({
  selector: 'codelab-quiz-feedback',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './feedback.component.html',
  styleUrls: ['./feedback.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeedbackComponent implements OnInit, OnChanges {
  @Input() feedbackConfig?: FeedbackProps | null;
  feedbackMessageClass = '';
  displayMessage = '';

  constructor(
    private feedbackService: FeedbackService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private cdRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.updateFeedback();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const feedbackChange = changes['feedbackConfig'];

    // Log any change to feedbackConfig
    if (feedbackChange) {
      console.log('[🧪 ngOnChanges] feedbackConfig changed:', feedbackChange);
      console.log(
        '[🧪 ngOnChanges] new feedbackConfig:',
        feedbackChange.currentValue
      );
    }

    if (this.shouldUpdateFeedback(changes)) {
      console.log('[🧪 shouldUpdateFeedback returned true]');
      this.updateFeedback();

      // Force view update
      this.cdRef.markForCheck();
    } else {
      console.log('[🛑 No relevant changes for updateFeedback]');
    }
  }

  private shouldUpdateFeedback(changes: SimpleChanges): boolean {
    return (
      'feedbackConfig' in changes && !!changes['feedbackConfig'].currentValue
    );
  }

  private updateFeedback(): void {
    if (this.feedbackConfig?.showFeedback) {
      this.updateDisplayMessage();
      this.feedbackMessageClass = this.determineFeedbackMessageClass();
    } else {
      this.displayMessage = '';
    }
  }

  private determineFeedbackMessageClass(): string {
    const isCorrect = this.feedbackConfig?.selectedOption?.correct;
    return isCorrect ? 'correct-message' : 'wrong-message';
  }

  private updateDisplayMessage(): void {
    if (!this.feedbackConfig) {
      this.displayMessage = '';
      return;
    }

  const fallbackIndex = Number.isFinite(this.feedbackConfig.idx)
    ? this.feedbackConfig.idx
    : 0;
  const selectedQuestionIndex = Number.isFinite(
    (this.feedbackConfig.selectedOption as { questionIndex?: number } | null)
      ?.questionIndex
  )
    ? ((this.feedbackConfig.selectedOption as { questionIndex?: number })
        .questionIndex as number)
    : undefined;
  const activeQuestionIndex = Number.isFinite(
    this.quizService.currentQuestionIndex
  )
    ? (this.quizService.currentQuestionIndex as number)
    : undefined;
  const idx =
    selectedQuestionIndex ?? activeQuestionIndex ?? fallbackIndex;
  const question =
    this.feedbackConfig.question ??
    this.quizService.questions?.[idx] ??
    (this.feedbackConfig.options
      ? {
          questionText: '',
          options: this.feedbackConfig.options,
          explanation: '',
          type: undefined
        }
      : null);
  
    // MULTI-ANSWER: use ALL selections for this question
    const selectedFromMap =
      this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
    const fallbackSelected = this.feedbackConfig.selectedOption
      ? [
          {
            ...this.feedbackConfig.selectedOption,
            selected: true,
            questionIndex: idx
          }
        ]
      : [];
    const selected =
      selectedFromMap.length > 0 ? selectedFromMap : fallbackSelected;

    const msg = question
      ? this.feedbackService.buildFeedbackMessage(
          question,
          selected,
          false,
          this.feedbackConfig?.timedOut === true
        )
      : '';
  
    // If feedbackService decided on a message, USE IT and STOP
    if (msg && msg.trim()) {
      this.displayMessage = msg;
      return;  // STOP: do NOT fall through to “correct option reveal” generator
    }
  
    this.displayMessage = '';
  }  
}