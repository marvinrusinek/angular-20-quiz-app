import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  Input,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
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
import { QuizService } from '../../../shared/services/data/quiz.service';

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
  private correctAnswersCountSignal = signal<number>(0);
  readonly correctAnswersCount$ = toObservable(this.correctAnswersCountSignal);
  readonly correctAnswersCountSig = this.correctAnswersCountSignal.asReadonly();

  numericalScore = '0/0';
  percentageScore = '';
  isPercentage = false;
  percentage = 0;
  private readonly scoreDisplayStorageKey = 'scoreDisplayType';

  private currentScoreSignal = signal<string>(this.numericalScore);
  readonly currentScore$ = toObservable(this.currentScoreSignal);
  readonly currentScoreSig = this.currentScoreSignal.asReadonly();

  // Reactive derivation of the displayed score string.
  // Uses computed() to combine correctCount, total, and display mode.
  private totalQuestionsSig = signal<number>(0);
  private isPercentageSig = signal<boolean>(false);
  readonly displayedScore = computed<string>(() => {
    const correct = this.correctAnswersCountSignal();
    const total = this.totalQuestionsSig();
    if (this.isPercentageSig()) {
      return total > 0 ? `${((correct / total) * 100).toFixed(0)}%` : '0%';
    }
    return `${correct}/${total}`;
  });
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
    // console.log(`[ScoreComponent] 📊 Update: Correct=${correctAnswersCount}, Total=${totalQuestions}`);
    // this.correctAnswersCount = correctAnswersCount;
    const safeTotal = Number.isFinite(totalQuestions) ? Math.max(0, Math.trunc(totalQuestions)) : 0;
    const safeCorrectRaw = Number.isFinite(correctAnswersCount) ? Math.trunc(correctAnswersCount) : 0;
    const safeCorrect = safeTotal > 0
      ? Math.min(Math.max(0, safeCorrectRaw), safeTotal)
      : Math.max(0, safeCorrectRaw);
    
    // Do not override the authoritative score stream with local heuristics.
    // This previously caused legitimate score values (e.g. 1/6) to flash/reset
    // to 0/6 when navigating between questions.
    console.log(`[ScoreComponent] 📊 Update: Correct=${safeCorrect}, Total=${safeTotal} (raw=${correctAnswersCount}/${totalQuestions})`);

    this.totalQuestions = safeTotal;
    this.correctAnswersCount = safeCorrect;
    this.totalQuestionsSig.set(safeTotal);
    // update() variant: bump the signal to the latest authoritative value while
    // logging the previous one — exercises WritableSignal.update for the
    // common "merge prior with incoming" case.
    this.correctAnswersCountSignal.update(prev => {
      if (prev !== safeCorrect) {
        // console.log(`[ScoreComponent] correct count: ${prev} → ${safeCorrect}`);
      }
      return safeCorrect;
    });
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
    } else {
      // update() variant: flip the boolean signal in-place
      this.isPercentageSig.update(v => !v);
      this.isPercentage = this.isPercentageSig();
    }
    this.isPercentageSig.set(this.isPercentage);

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

    if (this.totalQuestions <= 0) {
      this.percentageScore = '0%';
      this.currentScoreSignal.set(this.percentageScore);
      return;
    }

    this.percentageScore = `${(
      (this.correctAnswersCount / this.totalQuestions) *
      totalPossibleScore
    ).toFixed(0)}%`;

    this.currentScoreSignal.set(this.percentageScore);
  }

  displayNumericalScore(): void {
    this.numericalScore = `${this.correctAnswersCount}/${this.totalQuestions}`;
    this.currentScoreSignal.set(this.numericalScore);
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
