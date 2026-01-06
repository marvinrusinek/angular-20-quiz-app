import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizMetadata } from '../../../shared/models/QuizMetadata.model';
import { Resource } from '../../../shared/models/Resource.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { TimerService } from '../../../shared/services/timer.service';

enum Status {
  Started = 'Started',
  Continue = 'Continue',
  Completed = 'Completed',
}

@Component({
  selector: 'codelab-results-statistics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatisticsComponent implements OnInit {
  quizzes$: Observable<Quiz[]> = of([]);
  quizName$: Observable<string> = of('');
  quizId = '';
  quizMetadata: Partial<QuizMetadata> = {};
  resources: Resource[] = [];
  status: Status = Status.Started;
  elapsedMinutes = 0;
  elapsedSeconds = 0;
  percentage = 0;

  CONGRATULATIONS =
    'https://raw.githubusercontent.com/marvinrusinek/angular-9-quiz-app/master/src/assets/images/congratulations.jpg';
  NOT_BAD =
    'https://raw.githubusercontent.com/marvinrusinek/angular-9-quiz-app/master/src/assets/images/not-bad.jpg';
  TRY_AGAIN =
    'https://raw.githubusercontent.com/marvinrusinek/angular-9-quiz-app/master/src/assets/images/try-again.jpeg';

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private timerService: TimerService,
    private activatedRoute: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    // Calculate elapsed time from array or use completionTime as fallback
    let totalElapsedTime = this.timerService.calculateTotalElapsedTime(
      this.timerService.elapsedTimes,
    );

    // Fallback: if elapsedTimes is empty, use the direct completionTime property
    if (totalElapsedTime === 0 && this.timerService.completionTime > 0) {
      totalElapsedTime = this.timerService.completionTime;
    }

    // Initialize quizMetadata in ngOnInit when service data is available
    this.quizMetadata = {
      totalQuestions: this.quizService.totalQuestions,
      totalQuestionsAttempted: this.quizService.totalQuestions,
      correctAnswersCount$: this.quizService.correctAnswersCountSubject,
      percentage: this.calculatePercentageOfCorrectlyAnsweredQuestions(),
      completionTime: totalElapsedTime,
    };

    console.log('[RESULTS] StatisticsComponent ngOnInit:', {
      totalQuestions: this.quizService.totalQuestions,
      correctAnswers: this.quizService.correctAnswersCountSubject.getValue(),
      elapsedTimes: this.timerService.elapsedTimes,
      completionTime: this.timerService.completionTime,
      calculatedTotal: totalElapsedTime,
      quizId: this.quizService.quizId,
    });

    this.quizzes$ = this.quizDataService.getQuizzes();
    this.quizId = this.quizService.quizId;

    // Use the quizId from service, not from URL segments
    this.quizName$ = of(this.quizId);

    console.log('[RESULTS] quizId:', this.quizId);

    // Ensure resources are loaded for this quiz
    if (this.quizId) {
      this.quizService.loadResourcesForQuiz(this.quizId);
    }
    this.resources = this.quizService.resources;
    this.status = Status.Completed;
    this.percentage = this.quizMetadata?.percentage ?? 0;
    this.calculateElapsedTime();
    this.sendQuizStatusToQuizService();
  }

  calculateElapsedTime(): void {
    const completionTime = this.quizMetadata?.completionTime ?? 0;
    this.elapsedMinutes = Math.floor(completionTime / 60);
    this.elapsedSeconds = completionTime % 60;
  }

  calculatePercentageOfCorrectlyAnsweredQuestions(): number {
    return Math.round(
      (100 * this.quizService.correctAnswersCountSubject.getValue()) /
      this.quizService.totalQuestions,
    );
  }

  private sendQuizStatusToQuizService(): void {
    this.quizService.setQuizStatus(this.status);
  }
}
