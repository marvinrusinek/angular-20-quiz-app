import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Observable, of } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';

import { Quiz } from '../../../shared/models/Quiz.model';
import { QuizMetadata } from '../../../shared/models/QuizMetadata.model';
import { QuizScore } from '../../../shared/models/QuizScore.model';
import { SummaryIconsComponent } from './summary-icons/summary-icons.component';
import { SummaryStatsComponent } from './summary-stats/summary-stats.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuizService } from '../../../shared/services/data/quiz.service';
import { QuizDataService } from '../../../shared/services/data/quizdata.service';
import { TimerService } from '../../../shared/services/features/timer.service';

@Component({
  selector: 'codelab-results-summary',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    SummaryIconsComponent,
    SummaryStatsComponent,
    MatTooltipModule
  ],
  templateUrl: './summary-report.component.html',
  styleUrls: ['./summary-report.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SummaryReportComponent implements OnInit, OnChanges {
  @Input() quizId = '';
  @Input() viewMode: 'summary' | 'highscores' | 'all' = 'all';
  quizzes$: Observable<Quiz[]> = of([]);
  quizName$: Observable<string> = of('');
  quizMetadata: Partial<QuizMetadata> = {};
  elapsedMinutes = 0;
  elapsedSeconds = 0;
  checkedShuffle = false;
  checkedShuffle$: Observable<boolean> = of(false);
  highScores: QuizScore[] = [];
  quizMilestones: Record<string, string> = {};
  currentScore: QuizScore | null = null;  // the current quiz attempt score
  codelabUrl = 'https://www.codelab.fun';

  constructor(
    private quizService: QuizService,
    private quizDataService: QuizDataService,
    private timerService: TimerService,
    private cdRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.initComponent();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['quizId'] && !changes['quizId'].firstChange) {
      this.initComponent();
    }
  }

  private initComponent(): void {
    if (!this.quizId) {
      this.quizId = this.quizService.quizId || localStorage.getItem('quizId') || '';
    }

    try {
      // Initialize quizMetadata in initComponent when service data is available
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
      this.quizzes$.pipe(take(1)).subscribe((quizzes) => {
        this.quizMilestones = quizzes.reduce<Record<string, string>>((acc, quiz) => {
          acc[quiz.quizId] = quiz.milestone;
          return acc;
        }, {});
        this.cdRef.markForCheck();
      });

      this.quizName$ = of(this.quizId);
      this.checkedShuffle$ = this.quizService.checkedShuffle$;
      this.checkedShuffle = this.quizService.isShuffleEnabled();
      this.calculateElapsedTime();
      this.quizService.saveHighScores();
      this.highScores = this.quizService.highScores;

      // Create current score object for display
      this.currentScore = {
        quizId: this.quizId,
        attemptDateTime: new Date(),
        score: this.quizMetadata.percentage ?? 0,
        totalQuestions: this.quizService.totalQuestions
      };
    } catch (error) {
      console.error('[SUMMARY] Error in initComponent:', error);
      // Fallback to ensure UI doesn't look broken
      this.currentScore = {
        quizId: this.quizId || 'Unknown',
        attemptDateTime: new Date(),
        score: 0,
        totalQuestions: 0
      };
    }

    // Force change detection for OnPush when navigating back or tab switching
    this.cdRef.markForCheck();
    this.cdRef.detectChanges();
  }

  calculateElapsedTime(): void {
    const completionTime = this.quizMetadata?.completionTime ?? 0;
    this.elapsedMinutes = Math.floor(completionTime / 60);
    this.elapsedSeconds = completionTime % 60;
  }

  getMilestoneLabel(quizId: string): string {
    return this.quizMilestones[quizId] ?? quizId;
  }
}