import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';

import { QuizService } from '../../../shared/services/data/quiz.service';
import { ExplanationTextService } from '../../../shared/services/features/explanation/explanation-text.service';
import { SelectedOptionService } from '../../../shared/services/state/selectedoption.service';
import { TimerService } from '../../../shared/services/features/timer/timer.service';

@Component({
  selector: 'codelab-results-return',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatListModule],
  templateUrl: './return.component.html',
  styleUrls: ['./return.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReturnComponent implements OnInit {
  readonly quizId = signal<string>('');
  readonly indexOfQuizId = signal<number>(0);
  readonly codelabUrl = 'https://www.codelab.fun';

  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private explanationTextService: ExplanationTextService,
    private timerService: TimerService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.quizId.set(this.quizService.quizId);
  }

  restartQuiz(): void {
    if (!this.quizId()) {
      this.quizId.set(this.quizService.quizId);
    }

    // Reset score FIRST before anything else
    this.quizService.resetScore();
    localStorage.removeItem('correctAnswersCount');
    localStorage.removeItem('questionCorrectness');

    // Clear “results snapshot”
    this.quizService.clearFinalResult();

    const id = this.quizId();

    // Clear session state (answered, selections, resume index, completion flags)
    if (id) {
      this.quizService.resetQuizSessionForNewRun(id);
      this.selectedOptionService.clearState();
    }

    this.quizService.resetAll();
    this.quizService.resetQuestions();
    this.explanationTextService.resetExplanationState();

    this.timerService.clearTimerState();

    if (id) {
      void this.router.navigate(['/quiz/question', id, 1]);
    }
  }

  selectQuiz(): void {
    this.selectedOptionService.clearState();

    this.quizService.resetAll();
    this.quizService.resetQuestions();
    this.explanationTextService.resetExplanationState();
    this.timerService.clearTimerState();

    this.quizId.set('');
    this.indexOfQuizId.set(0);
    this.router.navigate(['/select/']);
  }
}