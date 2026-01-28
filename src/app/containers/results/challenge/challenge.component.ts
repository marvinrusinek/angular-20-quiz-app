import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Observable, of } from 'rxjs';

import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizMetadata } from '../../../shared/models/QuizMetadata.model';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { TimerService } from '../../../shared/services/timer.service';

@Component({
  selector: 'codelab-results-challenge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './challenge.component.html',
  styleUrls: ['./challenge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChallengeComponent implements OnInit {
  quizzes$: Observable<Quiz[]> = of([]);
  quizName$: Observable<string> = of('');
  currentQuizId = '';
  quizMetadata: Partial<QuizMetadata> = {
    totalQuestions: this.quizService.totalQuestions,
    totalQuestionsAttempted: this.quizService.totalQuestions,
    correctAnswersCount$: this.quizService.correctAnswersCountSubject,
    percentage: this.calculatePercentageOfCorrectlyAnsweredQuestions(),
    completionTime: this.timerService.calculateTotalElapsedTime(
      this.timerService.elapsedTimes
    ),
  };
  codelabUrl = 'https://www.codelab.fun';

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private timerService: TimerService,
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.quizzes$ = this.quizDataService.getQuizzes();
    
    // Get quizId from service (most reliable) or from route params
    this.currentQuizId = this.quizService.quizId || 
      this.activatedRoute.snapshot.paramMap.get('quizId') || 
      this.activatedRoute.parent?.snapshot.paramMap.get('quizId') || '';
    
    console.log('[ChallengeComponent] currentQuizId:', this.currentQuizId);
    
    this.quizName$ = of(this.currentQuizId);
  }

  calculatePercentageOfCorrectlyAnsweredQuestions(): number {
    return Math.round(
      (100 * this.quizService.correctAnswersCountSubject.getValue()) /
        this.quizService.totalQuestions
    );
  }
}