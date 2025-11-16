import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, Subscription, timer } from 'rxjs';
import { finalize, map, takeUntil, tap } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { SelectedOption } from '../models/SelectedOption.model';
import { SelectedOptionService } from './selectedoption.service';
import { QuizService } from './quiz.service';

interface StopTimerAttemptOptions {
  questionIndex?: number;
  optionsSnapshot?: Option[];
  onBeforeStop?: () => void;
  onStop?: (elapsedMs?: number) => void;  // allow elapsed to be delivered
}

@Injectable({ providedIn: 'root' })
export class TimerService implements OnDestroy {
  timePerQuestion = 30;
  private elapsedTime = 0;
  completionTime = 0;
  elapsedTimes: number[] = [];

  isTimerRunning = false;  // tracks whether the timer is currently running
  isCountdown = true;  // tracks the timer mode (true = countdown, false = stopwatch)
  isTimerStoppedForCurrentQuestion = false;

  // Signals
  private isStop = new Subject<void>();
  private isReset = new Subject<void>();

  // Observables
  private elapsedTimeSubject = new BehaviorSubject<number>(0);
  public elapsedTime$ = this.elapsedTimeSubject.asObservable();

  // Consolidated stop/reset using BehaviorSubjects
  private stopSubject = new BehaviorSubject<void>(undefined);
  public stop$ = this.stopSubject.asObservable().pipe(map(() => 0));

  private timerSubscription: Subscription | null = null;
  private stopTimerSignalSubscription: Subscription | null = null;

  private expiredSubject = new Subject<void>();
  public expired$ = this.expiredSubject.asObservable();

  private stoppedForQuestion = new Set<number>();

  constructor(
    private ngZone: NgZone,
    private selectedOptionService: SelectedOptionService,
    private quizService: QuizService
  ) {
    this.stopTimerSignalSubscription = this.selectedOptionService.stopTimer$.subscribe(() => {
      if (!this.isTimerRunning) {
        console.log('[TimerService] Stop signal received but timer is not running.');
        return;
      }

      console.log('[TimerService] Stop signal received from SelectedOptionService. Stopping timer.');
      this.stopTimer(undefined, { force: true });
    });
    this.listenForCorrectSelections();
  }

  ngOnDestroy(): void {
    this.timerSubscription?.unsubscribe();
    this.stopTimerSignalSubscription?.unsubscribe();
  }

  private listenForCorrectSelections(): void {
    this.stopTimerSignalSubscription =
      this.selectedOptionService.stopTimer$.subscribe(() => {
        if (!this.isTimerRunning) {
          console.log('[TimerService] Stop signal received but timer is not running.');
          return;
        }
        this.handleStopTimerSignal();
      });
  }  

  private handleStopTimerSignal(): void {
    if (!this.isTimerRunning) {
      console.log('[TimerService] Stop signal received but timer is not running.');
      return;
    }

    const activeQuestionIndex = this.quizService?.currentQuestionIndex ?? -1;
    if (activeQuestionIndex < 0) {
      console.warn(
        '[TimerService] Stop signal received without a valid question index. Forcing timer stop.'
      );
      this.stopTimer(undefined, { force: true });
      return;
    }

    const stopped = this.attemptStopTimerForQuestion({
      questionIndex: activeQuestionIndex,
      onStop: (elapsed?: number) => {
        if (elapsed != null && activeQuestionIndex != null) {
          this.elapsedTimes[activeQuestionIndex] = elapsed;
        }
      }
    });

    if (!stopped) {
      console.warn(
        '[TimerService] Stop signal received but automatic stop was rejected. Forcing timer stop.'
      );
      this.stopTimer(undefined, { force: true });
    }
  }

  // Starts the timer
  startTimer(duration: number = this.timePerQuestion, isCountdown: boolean = true): void {
    if (this.isTimerStoppedForCurrentQuestion) {
      console.log(`[TimerService] ⚠️ Timer restart prevented.`);
      return;
    }
  
    if (this.isTimerRunning) {
      console.info('[TimerService] Timer is already running. Start ignored.');
      return;  // prevent restarting an already running timer
    }
  
    this.isTimerRunning = true;  // mark timer as running
    this.isCountdown = isCountdown;
    this.elapsedTime = 0;
  
    // Show initial value immediately (inside Angular so UI updates right away)
    this.ngZone.run(() => {
      this.elapsedTimeSubject.next(0);
    });
  
    // Start ticking after 1s so the initial value stays visible for a second
    const timer$ = timer(1000, 1000).pipe(
      tap((tick) => {
        // Tick starts at 0 after 1s → elapsed = tick + 1 (1,2,3,…)
        const elapsed = tick + 1;

        // Internal state can be outside Angular
        this.elapsedTime = elapsed;
  
        // Re-enter Angular so async pipes trigger change detection on every tick
        this.ngZone.run(() => {
          this.elapsedTimeSubject.next(this.elapsedTime);
        });
  
        // If in countdown mode and reached the duration, stop automatically
        if (isCountdown && elapsed >= duration) {
          console.log('[TimerService] Time expired. Stopping timer.');
          this.ngZone.run(() => this.expiredSubject.next());
          this.stopTimer(undefined, { force: true });
        }
      }),
      takeUntil(this.isStop),
      finalize(() => {
        console.log('[TimerService] Timer finalized.');
        // Reset running state when timer completes (inside Angular)
        this.ngZone.run(() => { this.isTimerRunning = false; });
      })
    );
  
    this.timerSubscription = timer$.subscribe();
    console.log('[TimerService] Timer started successfully.');
  }

  // Stops the timer
  stopTimer(
    callback?: (elapsedTime: number) => void,
    options: { force?: boolean } = {}  // future use
  ): void {
    void options;  // prevent unused-parameter warning (intentional)

    if (!this.isTimerRunning) {
      console.log('Timer is not running. Nothing to stop.');
      return;
    }

    // End the ticking subscription
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = null;
      console.log('Timer subscription cleared.');
    } else {
      console.warn('No active timer subscription to unsubscribe.');
    }

    this.isTimerRunning = false;  // mark the timer as stopped
    this.isTimerStoppedForCurrentQuestion = true;  // prevent restart for current question
    this.stopSubject.next();  // emit stop signal to stop the timer
    this.isStop.next();

    if (callback) {
      callback(this.elapsedTime);
      console.log('Elapsed time recorded in callback:', this.elapsedTime);
    }

    console.log('Timer stopped successfully.');
  }

  // Resets the timer
  resetTimer(): void {
    console.log('Attempting to reset timer...');
    if (this.isTimerRunning) {
      console.log('Timer is running. Stopping before resetting...');
      this.stopTimer(undefined, { force: true });
    }

    this.elapsedTime = 0;
    this.isTimerRunning = false;
    this.isTimerStoppedForCurrentQuestion = false;  // allow restart for the new question

    this.isReset.next();  // signal to reset
    this.elapsedTimeSubject.next(0);  // reset elapsed time for observers
    console.log('Timer reset successfully.');
  }

  public attemptStopTimerForQuestion(options: StopTimerAttemptOptions = {}): boolean {
    const questionIndex =
      typeof options.questionIndex === 'number'
        ? options.questionIndex
        : this.quizService?.currentQuestionIndex ?? null;
  
    // Skip if we've already stopped for this question
    if (
      this.selectedOptionService.stopTimerEmitted &&
      this.isTimerStoppedForCurrentQuestion
    ) {
      console.log('[TimerService] attemptStopTimerForQuestion skipped — timer already stopped for this question.');
      return false;
    }
  
    if (questionIndex == null || questionIndex < 0) {
      console.warn('[TimerService] attemptStopTimerForQuestion called without a valid question index.');
      return false;
    }
  
    if (this.stoppedForQuestion.has(questionIndex)) {
      // Extra guard in case flags weren’t reset somewhere else
      return false;
    }
  
    // If the timer isn't running, nothing to stop (prevents no-op reentry)
    if (!this.isTimerRunning) {
      console.log('[TimerService] attemptStopTimerForQuestion skipped — timer is not running.');
      return false;
    }
  
    const allCorrectSelected =
      this.selectedOptionService.areAllCorrectAnswersSelectedSync(questionIndex);
  
    if (!allCorrectSelected) {
      console.log(
        '[TimerService] attemptStopTimerForQuestion rejected — correct answers not fully selected yet.',
        { questionIndex }
      );
      return false;
    }
  
    // Fire sound (or any UX) BEFORE stopping so teardown doesn’t kill it
    try { options.onBeforeStop?.(); } catch {}
  
    // Mark as stopped for this question BEFORE stopping to avoid re-entrance
    this.selectedOptionService.stopTimerEmitted = true;
    this.isTimerStoppedForCurrentQuestion = true;
    this.stoppedForQuestion.add(questionIndex);
  
    try {
      // Force the stop here to mirror your working path
      this.stopTimer(options.onStop, { force: true });
      return true;
    } catch (err) {
      // Roll back flags if stop fails
      this.selectedOptionService.stopTimerEmitted = false;
      this.isTimerStoppedForCurrentQuestion = false;
      this.stoppedForQuestion.delete(questionIndex);
      console.error('[TimerService] stopTimer failed in attemptStopTimerForQuestion:', err);
      return false;
    }
  }

  /**
   * Stops the timer if the answer conditions are met.
   *
   * Single-answer → stop when the clicked option is correct.
   * Multiple-answer → stop when all correct answers are selected.
   */
  public async stopTimerIfApplicable(
    question: QuizQuestion,
    questionIndex: number,
    selectedOption: SelectedOption
  ): Promise<void> {
    try {
      if (!question || !Array.isArray(question.options)) {
        console.warn('[TimerService] Invalid question/options. Cannot evaluate.');
        return;
      }

      let shouldStop!: boolean;

      const correctOptions = question.options.filter(o => o.correct);
      const isMultiple = correctOptions.length > 1;

      if (isMultiple) {
        shouldStop = this.selectedOptionService.areAllCorrectAnswersSelectedSync(
          questionIndex
        );
      } else {
        shouldStop = !!selectedOption?.correct;
      }

      if (shouldStop) {
        const stopped = this.attemptStopTimerForQuestion({ questionIndex });

        if (stopped) {
          console.log('[TimerService] Timer stopped (conditions met).');
        } else {
          console.log('[TimerService] Timer stop rejected (already stopped?).');
        }
      }

    } catch (err) {
      console.error('[TimerService] Error during stop-timer evaluation:', err);
    }
  }

  // Sets a custom elapsed time
  /* setElapsed(time: number): void {
    this.elapsedTime = time;
  } */

  public resetTimerFlagsFor(index: number): void {
    this.isTimerStoppedForCurrentQuestion = false;
    this.selectedOptionService.stopTimerEmitted = false;
    this.stoppedForQuestion.delete(index);
  }

  // Calculates the total elapsed time from recorded times
  calculateTotalElapsedTime(elapsedTimes: number[]): number {
    if (elapsedTimes.length > 0) {
      this.completionTime = elapsedTimes.reduce((acc, cur) => acc + cur, 0);
      return this.completionTime;
    }
    return 0;
  }
}