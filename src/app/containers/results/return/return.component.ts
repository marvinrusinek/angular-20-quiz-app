import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';

import { QuizStatus } from '../../../shared/models/quiz-status.enum';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
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
    private quizDataService: QuizDataService,
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
  
    // this.router.navigate(['/intro/', this.quizId]);
  }

  selectQuiz(): void {
    const id = this.quizId;
  
    // Force selection screen to NOT treat it as completed/continue
    if (id) {
      this.quizService.quizCompleted = false;
      this.quizService.setQuizStatus(QuizStatus.STARTED); // or a NOT_STARTED if you have one
      this.quizDataService.updateQuizStatus(id, QuizStatus.STARTED);
    }
  
    this.selectedOptionService.clearAllSelectionsForQuiz(id);
    this.quizService.clearFinalResult();
  
    this.quizService.resetAll();
    this.quizService.resetQuestions();
  
    this.quizId = '';
    this.indexOfQuizId = 0;
    this.router.navigate(['/select/']);
  }  
}
