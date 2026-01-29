import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';

import { QuizService } from '../../../shared/services/quiz.service';
import { SelectedOptionService } from '../../../shared/services/selectedoption.service';
import { TimerService } from '../../../shared/services/timer.service';

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
    private timerService: TimerService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.quizId = this.quizService.quizId;
  }

  restartQuiz(): void {
    // Clear “results snapshot”
    this.quizService.clearFinalResult();
  
    // Clear session state (answered, selections, resume index, completion flags)
    if (this.quizId) {
      this.quizService.resetQuizSessionForNewRun(this.quizId);
    }
  
    this.quizService.resetAll();
  
    this.timerService.elapsedTimes = [];
    this.timerService.completionTime = 0;
  
    this.router.navigate(['/intro/', this.quizId]);
  }

  selectQuiz(): void {
    // Reset progress for THIS quiz first (before quizId becomes '')
    const id = this.quizId;
    if (id) {
      this.quizService.resetQuizSessionForNewRun(id);
  
      // Clear option/answered state
      this.selectedOptionService.clearAllSelectionsForQuiz(id);
    }
  
    // Clear frozen results snapshot (leaving results intentionally)
    this.quizService.clearFinalResult();
  
    // Now it’s safe to clear quiz id + navigate
    this.quizService.resetAll();
    this.quizService.resetQuestions();
  
    this.quizId = '';
    this.indexOfQuizId = 0;
  
    this.router.navigate(['/select/']);
  }
}
