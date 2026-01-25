import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  BehaviorSubject,
  combineLatest,
  Observable,
  of,
  Subject,
  Subscription,
} from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  startWith,
  takeUntil,
} from 'rxjs/operators';

import { QuizQuestion } from '../../../shared/models/QuizQuestion.model';
import { QuizService } from '../../../shared/services/quiz.service';

@Component({
  selector: 'codelab-scoreboard-score',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatMenuModule, MatToolbarModule],
  templateUrl: './score.component.html',
  styleUrls: ['./score.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoreComponent implements OnInit, OnDestroy {
  @Input() correctAnswersCount = 0;
  @Input() totalQuestions = 0;
  questions$: Observable<QuizQuestion[]> = of([]);
  totalQuestions$: Observable<number>;
  correctAnswersCount$: BehaviorSubject<number> = new BehaviorSubject<number>(
    0,
  );

  numericalScore = '0/0';
  percentageScore = '';
  isPercentage = false;
  percentage = 0;
  private readonly scoreDisplayStorageKey = 'scoreDisplayType';

  currentScore$: BehaviorSubject<string> = new BehaviorSubject<string>(
    this.numericalScore,
  );
  scoreSubscription!: Subscription;

  private unsubscribeTrigger$: Subject<void> = new Subject<void>();

  constructor(private quizService: QuizService, private cdRef: ChangeDetectorRef) {
    // ⚡ FIX: Derive total questions dynamically from the questions stream
    // Fall back to quizService.totalQuestions if questions$ is empty (e.g., after navigation)
    this.totalQuestions$ = this.quizService.questions$.pipe(
      map((questions: QuizQuestion[]) => {
        const fromStream = Array.isArray(questions) ? questions.length : 0;
        // If stream is empty but service has totalQuestions set, use that
        if (fromStream === 0 && this.quizService.totalQuestions > 0) {
          return this.quizService.totalQuestions;
        }
        return fromStream;
      }),
      distinctUntilChanged()
    );
  }

  ngOnInit(): void {
    this.restoreScoreDisplayPreference();
    this.setupScoreSubscription();
  }

  ngOnDestroy(): void {
    this.unsubscribeTrigger$.next();
    this.unsubscribeTrigger$.complete();
    this.currentScore$.complete();
    this.scoreSubscription?.unsubscribe();
  }

  private setupScoreSubscription(): void {
    this.scoreSubscription = combineLatest([
      // 🔑 FIX: Use QuizService's correctAnswersCountSubject instead of local one
      this.quizService.correctAnswersCountSubject.pipe(
        takeUntil(this.unsubscribeTrigger$),
        distinctUntilChanged(),
      ),

      this.totalQuestions$.pipe(
        startWith(0), // Provide a default value to ensure it's never undefined
        distinctUntilChanged(),
      ),
      this.quizService.questions$.pipe(startWith([])),
    ])
      .pipe(
        map(this.processScoreData),
        catchError((error) => {
          console.error('Error combining score data:', error);
          return of(null); // Gracefully handle the error and continue the stream
        }),
      )
      .subscribe({
        next: (value) => {
          if (value) this.handleScoreUpdate(value);
        },
        error: (error) =>
          console.error('Error in ScoreComponent subscription:', error),
      });
  }

  private processScoreData = ([
    correctAnswersCount,
    totalQuestions,
    questions,
  ]: [number, number, any[]]): {
    correctAnswersCount: number;
    totalQuestions: number;
    questions: any[];
  } => {
    this.totalQuestions = totalQuestions;
    return { correctAnswersCount, totalQuestions, questions };
  };

  private handleScoreUpdate = ({
    correctAnswersCount,
    totalQuestions,
    questions,
  }: {
    correctAnswersCount: number;
    totalQuestions: number;
    questions: any[];
  }): void => {
    console.log(`[ScoreComponent] 📊 Update: Correct=${correctAnswersCount}, Total=${totalQuestions}`);
    this.correctAnswersCount = correctAnswersCount;
    this.updateScoreDisplay();
    this.cdRef.markForCheck();
  };

  private handleError = (error: Error) => {
    console.error('Error in combineLatest in ScoreComponent:', error);
    return of({ correctAnswersCount: 0, totalQuestions: 0, questions: [] });
  };

  toggleScoreDisplay(scoreType?: 'numerical' | 'percentage'): void {
    // Store the current state of isPercentage before changing it
    const previousIsPercentage = this.isPercentage;

    // Update isPercentage based on the user's choice
    if (scoreType) {
      this.isPercentage = scoreType === 'percentage';
    }

    // Call updateScoreDisplay only if the display type has actually changed
    if (this.isPercentage !== previousIsPercentage) {
      this.persistScoreDisplayPreference();
      this.updateScoreDisplay();
    }
  }

  updateScoreDisplay(): void {
    if (this.isPercentage) {
      this.displayPercentageScore();
    } else {
      this.displayNumericalScore();
    }
  }

  displayPercentageScore(): void {
    const totalPossibleScore = 100;

    this.percentageScore = `${(
      (this.correctAnswersCount / this.totalQuestions) *
      totalPossibleScore
    ).toFixed(0)}%`;

    this.currentScore$.next(this.percentageScore);
  }

  displayNumericalScore(): void {
    this.numericalScore = `${this.correctAnswersCount}/${this.totalQuestions}`;
    this.currentScore$.next(this.numericalScore);
  }

  private restoreScoreDisplayPreference(): void {
    try {
      this.isPercentage =
        localStorage.getItem(this.scoreDisplayStorageKey) === 'percentage';
    } catch {
      this.isPercentage = false;
    }
  }

  private persistScoreDisplayPreference(): void {
    try {
      localStorage.setItem(
        this.scoreDisplayStorageKey,
        this.isPercentage ? 'percentage' : 'numerical',
      );
    } catch {
      // ignore storage failures
    }
  }
}
