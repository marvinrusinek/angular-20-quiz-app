import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';

import { QuizService } from '../../../shared/services/data/quiz.service';
import { ExplanationTextService } from '../../../shared/services/features/explanation-text.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { TimerService } from '../../../shared/services/features/timer.service';

@Component({
  selector: 'codelab-results-return',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatListModule],
  templateUrl: './return.component.html',
  styleUrls: ['./return.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReturnComponent implements OnInit {
  quizId = '';
  indexOfQuizId = 0;
  codelabUrl = 'https://www.codelab.fun';

  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private explanationTextService: ExplanationTextService,
    private timerService: TimerService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.quizId = this.quizService.quizId;
  }

  restartQuiz(): void {
    if (!this.quizId) {
      this.quizId = this.quizService.quizId;
    }

    // CRITICAL: Reset score FIRST before anything else
    this.quizService.resetScore();
    localStorage.removeItem('correctAnswersCount');
    localStorage.removeItem('questionCorrectness');

    // Clear “results snapshot”
    this.quizService.clearFinalResult();

    // Clear session state (answered, selections, resume index, completion flags)
    if (this.quizId) {
      this.quizService.resetQuizSessionForNewRun(this.quizId);
      this.selectedOptionService.clearState();
    }

    this.quizService.resetAll();
    this.quizService.resetQuestions();
    this.explanationTextService.resetExplanationState();

    this.timerService.clearTimerState();

    if (this.quizId) {
      void this.router.navigate(['/quiz/question', this.quizId, 1]);
    }
  }

  selectQuiz(): void {
    const id = this.quizId;

    this.selectedOptionService.clearState();

    this.quizService.resetAll();
    this.quizService.resetQuestions();
    this.explanationTextService.resetExplanationState();
    this.timerService.clearTimerState();

    this.quizId = '';
    this.indexOfQuizId = 0;
    this.router.navigate(['/select/']);
  }
}