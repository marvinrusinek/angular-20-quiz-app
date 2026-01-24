import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Observable, of } from 'rxjs';

import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizMetadata } from '../../../shared/models/QuizMetadata.model';
import { QuizScore } from '../../../shared/models/QuizScore.model';
import { SummaryIconsComponent } from './summary-icons/summary-icons.component';
import { SummaryStatsComponent } from './summary-stats/summary-stats.component';
import { QuizService } from '../../../shared/services/quiz.service';
import { QuizDataService } from '../../../shared/services/quizdata.service';
import { TimerService } from '../../../shared/services/timer.service';

@Component({
  selector: 'codelab-results-summary',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    SummaryIconsComponent,
    SummaryStatsComponent
  ],
  templateUrl: './summary-report.component.html',
  styleUrls: ['./summary-report.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SummaryReportComponent implements OnInit {
  quizzes$: Observable<Quiz[]> = of([]);
  quizName$: Observable<string> = of('');
  quizId = '';
  quizMetadata: Partial<QuizMetadata> = {};
  elapsedMinutes = 0;
  elapsedSeconds = 0;
  checkedShuffle = false;
  checkedShuffle$: Observable<boolean> = of(false);
  highScores: QuizScore[] = [];
  currentScore: QuizScore | null = null; // The current quiz attempt score
  codelabUrl = 'https://www.codelab.fun';
  @Input() viewMode: 'summary' | 'highscores' | 'all' = 'all';

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private timerService: TimerService,
    private cdRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    try {
      // Initialize quizMetadata in ngOnInit when service data is available
      this.quizMetadata = {
        totalQuestions: this.quizService.totalQuestions,
        totalQuestionsAttempted: this.quizService.totalQuestions,
        correctAnswersCount$: this.quizService.correctAnswersCountSubject,
        percentage:
          this.quizService.calculatePercentageOfCorrectlyAnsweredQuestions(),
        completionTime: this.timerService.calculateTotalElapsedTime(
          this.timerService.elapsedTimes
        )
      };

      this.quizzes$ = this.quizDataService.getQuizzes();
      this.quizId = this.quizService.quizId;

      this.quizName$ = of(this.quizId);
      this.checkedShuffle$ = this.quizService.checkedShuffle$;
      this.calculateElapsedTime();
      this.quizService.saveHighScores();
      this.highScores = this.quizService.highScores;

      // Create current score object for display
      this.currentScore = {
        quizId: this.quizId,
        attemptDateTime: new Date(),
        score: this.quizMetadata.percentage ?? 0,
        totalQuestions: this.quizService.totalQuestions,
      };
    } catch (error) {
      console.error('[SUMMARY] ❌ Error in ngOnInit:', error);
      // Fallback to ensure UI doesn't look broken
      this.currentScore = {
        quizId: this.quizService.quizId || 'Unknown',
        attemptDateTime: new Date(),
        score: 0,
        totalQuestions: 0
      };
    }

    // Force change detection for OnPush when navigating back
    this.cdRef.detectChanges();
  }

  calculateElapsedTime(): void {
    const completionTime = this.quizMetadata?.completionTime ?? 0;
    this.elapsedMinutes = Math.floor(completionTime / 60);
    this.elapsedSeconds = completionTime % 60;
  }
}