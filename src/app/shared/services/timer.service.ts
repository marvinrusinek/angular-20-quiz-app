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
  stoppedForQuestion = new Set<number>();

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

  constructor(
    private ngZone: NgZone,
    private selectedOptionService: SelectedOptionService,
    private quizService: QuizService
  ) {
    this.setupTimer();
    this.listenForCorrectSelections();
  }

  private setupTimer(): void {
    this.stopTimerSignalSubscription = this.selectedOptionService.stopTimer$.subscribe(() => {
      if (!this.isTimerRunning) {
        console.log('[TimerService] Stop signal received but timer is not running.');
        return;
      }
      console.log('[TimerService] Stop signal received from SelectedOptionService. Stopping timer.');
      this.stopTimer(undefined, { force: true });
    });
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

    // Always check if all correct answers are selected when stop signal is received
    const allCorrectSelected = this.selectedOptionService.areAllCorrectAnswersSelectedSync(activeQuestionIndex);
    
    if (allCorrectSelected) {
      console.log('[TimerService] All correct answers selected. Stopping timer.');
      this.stopTimer(undefined, { force: true });
      return;
    }

    const stopped = this.attemptStopTimerForQuestion({
      questionIndex: activeQuestionIndex,
      onStop: (elapsed?: number) => {
        if (elapsed != null && activeQuestionIndex != null) {
          this.elapsedTimes[activeQuestionIndex] = elapsed;
          console.log(`[TimerService] 💾 Stored elapsed time for Q${activeQuestionIndex + 1}: ${elapsed}s`);
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

    console.log(`[TimerService] 🛑 Timer stopped successfully. Elapsed: ${this.elapsedTime}s`);
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

    if (questionIndex == null || questionIndex < 0) {
      console.warn('[TimerService] attemptStopTimerForQuestion called without a valid question index.');
      return false;
    }

    const snapshot = Array.isArray(options.optionsSnapshot)
      ? options.optionsSnapshot
      : undefined;

    const allCorrectSelected = this.selectedOptionService
      .areAllCorrectAnswersSelectedSync(questionIndex, snapshot)
    if (!allCorrectSelected) {
      return false;
    }

    // If we get here, all correct answers are selected
    // Clear any previous stop state to allow stopping again
    this.selectedOptionService.stopTimerEmitted = false;
    this.isTimerStoppedForCurrentQuestion = false;
    this.stoppedForQuestion.delete(questionIndex);

    // If the timer isn't running, nothing to stop
    if (!this.isTimerRunning) {
      console.log('[TimerService] attemptStopTimerForQuestion — all correct selected but timer is not running.');
      return true; // Return true since the answer is correct, even if timer isn't running
    }

    // Fire sound (or any UX) BEFORE stopping so teardown doesn't kill it
    try { options.onBeforeStop?.(); } catch { }

    try {
      // Stop the timer with force to ensure it stops
      this.stopTimer(options.onStop, { force: true });
      
      // Mark as stopped to prevent duplicate stops
      this.selectedOptionService.stopTimerEmitted = true;
      this.isTimerStoppedForCurrentQuestion = true;
      this.stoppedForQuestion.add(questionIndex);
      
      console.log(`[TimerService] ✅ Timer stopped for Q${questionIndex + 1} (all correct answers selected)`);
      return true;
    } catch (err: any) {
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
      console.group(`[TimerService] Checking Q${questionIndex + 1}`);
      
      if (!question?.options?.length) {
        console.warn('No question options available');
        console.groupEnd();
        return;
      }

      // Get all correct options and determine if it's a multiple answer question
      const correctOptions = question.options.filter(opt => opt.correct);
      const isMultiple = correctOptions.length > 1;
      
      // Get all correct option IDs
      const correctOptionIds = correctOptions.map(opt => String(opt.optionId));
          
      // Get selected option IDs
      const selectedOptions = this.selectedOptionService.getSelectedOptionsForQuestion(questionIndex);
      const selectedOptionIds = selectedOptions.map(opt => String(opt.optionId));
      
      console.log('Correct option IDs:', correctOptionIds);
      console.log('Selected option IDs:', selectedOptionIds);
      
      // For Q2 specifically (index 1)
      if (questionIndex === 1) {
        console.log('Q2 Debug - Start');
        console.log('Correct options:', correctOptions);
        console.log('Selected options:', selectedOptions);
        
        // Check if all correct options are selected (regardless of incorrect ones)
        const allCorrectSelected = correctOptions.every(correctOpt => 
          selectedOptions.some(selected => selected.optionId === correctOpt.optionId)
        );
        
        console.log('Q2 - All correct selected?', allCorrectSelected);
        
        if (allCorrectSelected) {
          console.log('Q2 - All correct answers selected. Stopping timer!');
          this.stopTimer();
          console.groupEnd();
          return;
        }
        
        console.log('Q2 - Not all correct answers selected yet');
        console.groupEnd();
        return;
      }
      
      // For other questions
      const allCorrectSelected = correctOptionIds.length > 0 && 
        correctOptionIds.every(id => selectedOptionIds.includes(id)) &&
        (isMultiple ? selectedOptionIds.length === correctOptionIds.length : true);

      if (allCorrectSelected) {
        console.log('All correct answers selected. Stopping timer!');
        this.stopTimer();
      } else if (!isMultiple && selectedOption?.correct) {
        console.log('Correct single answer selected. Stopping timer!');
        this.stopTimer();
      }
      
      console.groupEnd();
    } catch (err) {
      console.error('Error in stopTimerIfApplicable:', err);
      console.groupEnd();
    }
  }

  // Sets a custom elapsed time
  /* setElapsed(time: number): void {
    this.elapsedTime = time;
  } */

  public resetTimerFlagsFor(questionIndex: number): void {
    if (questionIndex == null || questionIndex < 0) {
      console.warn('[TimerService] resetTimerFlagsFor: Invalid question index');
      return;
    }

    this.isTimerStoppedForCurrentQuestion = false;
    
    if (this.selectedOptionService) {
      this.selectedOptionService.stopTimerEmitted = false;
    }
    
    this.stoppedForQuestion.delete(questionIndex);
    
    console.log(`[TimerService] Reset timer flags for Q${questionIndex + 1}`);
  }

  public calculateTotalElapsedTime(elapsedTimes: number[]): number {
    if (!elapsedTimes || !Array.isArray(elapsedTimes)) {
      console.warn('[TimerService] calculateTotalElapsedTime: Invalid elapsedTimes array');
      return 0;
    }

    try {
      const total = elapsedTimes.reduce((acc: number, cur: number) => {
        // Ensure both values are valid numbers
        const a = typeof acc === 'number' ? acc : 0;
        const c = typeof cur === 'number' ? cur : 0;
        return a + c;
      }, 0);

      this.completionTime = total;
      console.log(`[TimerService] Calculated total elapsed time: ${total}s`);
      return total;
    } catch (error) {
      console.error('[TimerService] Error calculating total elapsed time:', error);
      return 0;
    }
  }
}