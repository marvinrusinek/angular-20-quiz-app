import { ChangeDetectorRef, ChangeDetectionStrategy, Component, Input, OnInit,
  OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { FeedbackProps } from '../../../../shared/models/FeedbackProps.model';
import { FeedbackService } from '../../../../shared/services/feedback.service';
import { SelectedOptionService } from '../../../../shared/services/selectedoption.service';
import { QuizService } from '../../../../shared/services/quiz.service';
import { QuizStateService } from '../../../../shared/services/quizstate.service';

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
  feedbackPrefix = '';
  displayMessage = '';

  constructor(
    private feedbackService: FeedbackService,
    private quizService: QuizService,
    private quizStateService: QuizStateService,
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
      this.feedbackPrefix = this.determineFeedbackPrefix();
    } else {
      this.displayMessage = '';
    }
  }

  private determineFeedbackPrefix(): string {
    return '';  // ✅/❌ already included
  }

  private determineFeedbackMessageClass(): string {
    const msg = (this.displayMessage ?? '').trim();
    if (msg.startsWith('✅')) return 'correct-message';
    if (msg.startsWith('❌') || msg.startsWith('⏰')) return 'wrong-message';
    return '';
  }

  /* private updateDisplayMessage(): void {
    if (!this.feedbackConfig) {
      this.displayMessage = '';
      return;
    }
  
    const idx = Number.isFinite(this.feedbackConfig.idx) ? this.feedbackConfig.idx : 0;
  
    const question = this.feedbackConfig.question;
    const selected = this.selectedOptionService.getSelectedOptionsForQuestion(idx) ?? [];
  
    // ✅ NEW SOURCE OF TRUTH
    if (question) {
      //const msg = this.feedbackService.buildFeedbackMessage(question, selected, false  strict );
  
      if (msg && msg.trim().length > 0) {
        this.displayMessage = msg;
        return;
      }
    }
  
    // ─────────────────────────────────────────────
    // FALLBACKS (keep, but they should rarely run now)
    // ─────────────────────────────────────────────
    const supplied = this.feedbackConfig.feedback?.trim();
    if (supplied) {
      this.displayMessage = supplied;
      return;
    }
  
    const opts = this.feedbackConfig.options ?? [];
    const correct = this.quizService.correctOptions ?? opts.filter(o => o.correct);
    this.displayMessage = this.feedbackService.generateFeedbackForOptions(correct, opts);
  }  */
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

    const question = this.feedbackConfig.question;
  
    //const { question, options, selectedOption } = this.feedbackConfig;
  
    // 1️⃣ PRIMARY SOURCE OF TRUTH
    //const selected = selectedOption ? [selectedOption] : [];
    // ✅ MULTI-ANSWER FIX: use ALL selections for this question
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
  
    // ✅ If feedbackService decided on a message, USE IT and STOP
    if (msg && msg.trim()) {
      this.displayMessage = msg;
      return; // ✅ STOP: do NOT fall through to “correct option reveal” generator
    }
  
    // 2️⃣ FALLBACK — ONLY when explanation mode is active
    // (Never during retry flows)
    /* const correct =
      this.quizService.correctOptions ??
      options?.filter(o => o.correct) ??
      [];
  
    if (!correct.length || !options?.length) {
      this.displayMessage = '';
      return;
    }
  
    const sentence = this.feedbackService.generateFeedbackForOptions(
      correct,
      options
    ); */
  
    //this.displayMessage = sentence;
    this.displayMessage = '';
  }  
}