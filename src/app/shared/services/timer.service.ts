import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, Subscription, timer } from 'rxjs';
import { finalize, map, takeUntil, tap } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { QuizQuestion } from '../models/QuizQuestion.model';
import { SelectedOption } from '../models/SelectedOption.model';
import { SelectedOptionService } from './selectedoption.service';
import { QuizService } from './quiz.service';

interface StopTimerAttemptOptions {
  questionIndex?: number,
  optionsSnapshot?: Option[],
  onBeforeStop?: () => void,
  onStop?: (elapsedMs?: number) => void  // allow elapsed to be delivered
}

@Injectable({ providedIn: 'root' })
export class TimerService implements OnDestroy {
  timePerQuestion = 30;
  public elapsedTime = 0;
  completionTime = Number(sessionStorage.getItem('completionTime')) || 0;
  elapsedTimes: number[] = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('elapsedTimes') || '[]');
    } catch {
      return [];
    }
  })();

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

  private readonly timerTypeSubject = new BehaviorSubject<'countdown' | 'stopwatch'>(
    (() => {
      try {
        return localStorage.getItem('timerType') === 'stopwatch'
          ? 'stopwatch'
          : 'countdown';
      } catch {
        return 'countdown';
      }
    })()
  );
  public timerType$ = this.timerTypeSubject.asObservable();

  // Consolidated stop/reset using BehaviorSubjects
  private stopSubject = new BehaviorSubject<void>(undefined);
  public stop$ = this.stopSubject.asObservable().pipe(map(() => 0));

  private timerSubscription: Subscription | null = null;
  private stopTimerSignalSubscription: Subscription | null = null;

  private expiredSubject = new Subject<void>();
  public expired$ = this.expiredSubject.asObservable();

  private _authoritativeStop = false;
  private hasExpiredForRun = false;

  constructor(
    private ngZone: NgZone,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) {
    this.isCountdown = this.timerTypeSubject.value === 'countdown';
    this.setupTimer();
    this.listenForCorrectSelections();
  }

  private setupTimer(): void {
    this.stopTimerSignalSubscription =
      this.selectedOptionService.stopTimer$.subscribe(() => {
        if (!this.isTimerRunning) {
          console.log(
            '[TimerService] Stop signal received but timer is not running.'
          );
          return;
        }
        console.log(
          '[TimerService] Stop signal received from SelectedOptionService. Stopping timer.'
        );
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
          console.log(
            '[TimerService] Stop signal received but timer is not running.'
          );
          return;
        }
        this.handleStopTimerSignal();
      });
  }

  private handleStopTimerSignal(): void {
    if (!this.isTimerRunning) {
      console.log(
        '[TimerService] Stop signal received but timer is not running.'
      );
      return;
    }

    const activeQuestionIndex = this.normalizeQuestionIndex(
      this.quizService?.currentQuestionIndex
    );
    if (activeQuestionIndex < 0) {
      console.warn(
        '[TimerService] Stop signal received without a valid question index. Forcing timer stop.'
      );
      this.stopTimer(undefined, { force: true });
      return;
    }

    // Must grant authority before calling attemptStopTimerForQuestion
    this._authoritativeStop = true;

    const stopped = this.attemptStopTimerForQuestion({
      questionIndex: activeQuestionIndex,
      onStop: (elapsed?: number) => {
        if (elapsed != null && activeQuestionIndex != null) {
          this.elapsedTimes[activeQuestionIndex] = elapsed;
          this.saveTimerState();
          console.log(
            `[TimerService] Stored elapsed time for Q${activeQuestionIndex + 1}: ${elapsed}s`
          );
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

  setTimerType(type: 'countdown' | 'stopwatch'): void {
    if (this.timerTypeSubject.value === type) {
      return;
    }

    this.timerTypeSubject.next(type);
    this.isCountdown = type === 'countdown';
    try {
      localStorage.setItem('timerType', type);
    } catch {
      // ignore storage failures
    }
  }

  // Starts the timer
  startTimer(
    duration: number = this.timePerQuestion,
    isCountdown: boolean = true,
    forceRestart: boolean = false
  ): void {    
    if (this.isTimerStoppedForCurrentQuestion && !forceRestart) {
      console.log(`[TimerService] Timer restart prevented.`);
      return;
    }

    if (this.isTimerRunning) {
      if (!forceRestart) {
        console.info(`[TimerService] Timer is already running. Start ignored.`);
        return;  // prevent restarting an already running timer
      }
      this.stopTimer(undefined, { force: true });
    }

    if (forceRestart) {
      this.isTimerStoppedForCurrentQuestion = false;
    }

    this.isTimerRunning = true;  // mark timer as running
    this.isCountdown = isCountdown;
    this.elapsedTime = 0;
    this.hasExpiredForRun = false;

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

        // If reached the duration, emit expiration once (stop only for countdown)
        if (elapsed >= duration && !this.hasExpiredForRun) {
          this.hasExpiredForRun = true;
          console.log(
            `[TimerService] Time expired${isCountdown ? '. Stopping timer.' : '.'}`
          );
          this.ngZone.run(() => this.expiredSubject.next());
          if (isCountdown) {
            this.stopTimer(undefined, { force: true });
          }
        }
      }),
      takeUntil(this.isStop),
      finalize(() => {
        console.log('[TimerService] Timer finalized.');
        // Reset running state when timer completes (inside Angular)
        this.ngZone.run(() => {
          this.isTimerRunning = false;
        });
      }),
    );

    this.timerSubscription = timer$.subscribe();
    console.log('[TimerService] Timer started successfully.');
  }

  // Stops the timer
  stopTimer(
    callback?: (elapsedTime: number) => void,
    options: { force?: boolean } = {}  // future use
  ): void {
    // Authoritative Stop Guard: Blocks rogue direct calls
    if (!options.force && !this._authoritativeStop) {
      console.error('ILLEGAL stopTimer() CALL — BLOCKED', {
        elapsedTime: this.elapsedTime,
        stack: new Error().stack
      });
      return;
    }

    // Reset authority immediately to prevent re-entry / double stop paths
    this._authoritativeStop = false;

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

    console.log(
      `[TimerService] Timer stopped successfully. Elapsed: ${this.elapsedTime}s`
    );
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
    this.hasExpiredForRun = false;

    this.isReset.next();  // signal to reset
    this.elapsedTimeSubject.next(0);  // reset elapsed time for observers
    console.log('Timer reset successfully.');
  }

  public attemptStopTimerForQuestion(
    options: StopTimerAttemptOptions = {}
  ): boolean {
    // Guard: NOTHING may stop the timer without authority
    if (!this._authoritativeStop) {
      console.error('ILLEGAL attemptStopTimerForQuestion — BLOCKED', {
        questionIndex: options.questionIndex,
        stack: new Error().stack
      });
      return false;
    }

    const questionIndex = this.normalizeQuestionIndex(
      typeof options.questionIndex === 'number'
        ? options.questionIndex
        : this.quizService?.currentQuestionIndex
    );

    if (questionIndex == null || questionIndex < 0) {
      console.warn(
        '[TimerService] attemptStopTimerForQuestion called without a valid question index.'
      );
      return false;
    }

    const snapshot = Array.isArray(options.optionsSnapshot)
      ? options.optionsSnapshot
      : undefined;

    // If we get here, all correct answers are selected
    // Clear any previous stop state to allow stopping again
    this.selectedOptionService.stopTimerEmitted = false;
    this.isTimerStoppedForCurrentQuestion = false;
    this.stoppedForQuestion.delete(questionIndex);

    // If the timer isn't running, nothing to stop
    if (!this.isTimerRunning) {
      console.log(
        '[TimerService] attemptStopTimerForQuestion — all correct selected but timer is not running.'
      );
      return true;  // return true since the answer is correct, even if timer isn't running
    }

    // Fire sound (or any UX) BEFORE stopping so teardown doesn't stop it
    try {
      options.onBeforeStop?.();
    } catch { }

    try {
      // Stop the timer with force to ensure it stops
      this.stopTimer(options.onStop, { force: true });

      // Mark as stopped to prevent duplicate stops
      this.selectedOptionService.stopTimerEmitted = true;
      this.isTimerStoppedForCurrentQuestion = true;
      this.stoppedForQuestion.add(questionIndex);

      return true;
    } catch (error: any) {
      console.error(
        '[TimerService] stopTimer failed in attemptStopTimerForQuestion:',
        error
      );
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
    selectedOptionsFromQQC: Array<SelectedOption | Option> | null
  ): Promise<void> {
    try {
      // Basic validation
      if (this.isTimerStoppedForCurrentQuestion) {
        console.log('[TimerService] Timer already stopped for this question.');
        return;
      }

      if (!question || !Array.isArray(question.options)) {
        console.warn('[TimerService] Invalid question/options.');
        return;
      }

      const normalizedIndex = this.normalizeQuestionIndex(questionIndex);
      if (normalizedIndex < 0) {
        console.warn('[TimerService] Invalid index.');
        return;
      }

      // Determine correct answers
      const correctOptions = question.options.filter((opt) => opt.correct);
      const correctOptionIds = correctOptions.map((opt) =>
        String(opt.optionId)
      );
      const isMultiple = correctOptionIds.length > 1;

      // Build SELECTED set
      //  - For MULTIPLE: prefer SelectedOptionService
      //  - For SINGLE: use QQC payload
      let selectedOptionsFinal: Array<SelectedOption | Option> = [];

      if (isMultiple) {
        // pull from SelectedOptionService for this question
        const fromStore =
          this.selectedOptionService?.getSelectedOptionsForQuestion(
            normalizedIndex
          ) ?? [];

        if (fromStore.length > 0) {
          selectedOptionsFinal = fromStore;
          console.log(
            '[TimerService] Using SelectedOptionService selections (multi):',
            fromStore
          );
        } else {
          selectedOptionsFinal = selectedOptionsFromQQC ?? [];
          console.log(
            '[TimerService] Fallback to QQC payload selections (multi):',
            selectedOptionsFinal
          );
        }
      } else {
        // single-answer: payload is fine
        selectedOptionsFinal = selectedOptionsFromQQC ?? [];
      }

      const selectedIds = selectedOptionsFinal.map((o) =>
        String((o as any).optionId ?? '')
      );

      let shouldStop = false;

      // MULTIPLE-ANSWER LOGIC (match computeCorrectness)
      if (isMultiple) {
        const selectedSet = new Set(selectedIds);

        const selectedCorrectCount = correctOptionIds.filter((id) =>
          selectedSet.has(id)
        ).length;

        // EXACT match: all and only correct options selected
        shouldStop =
          correctOptionIds.length > 0 &&
          selectedCorrectCount === correctOptionIds.length;
      }

      // SINGLE-ANSWER LOGIC
      else {
        const firstSelected = selectedOptionsFinal[0] as any;
        const isCorrect =
          !!firstSelected &&
          (firstSelected.correct === true || firstSelected.correct === 'true');
        shouldStop = isCorrect;
      }

      // STOP TIMER IF CONDITIONS MET
      if (!shouldStop) {
        console.log('[TimerService] Conditions NOT met → timer continues.');
        console.groupEnd();
        return;
      }

      console.log('[TimerService] Conditions met → STOPPING TIMER!');

      const stopped = this.attemptStopTimerForQuestion({
        questionIndex: normalizedIndex,
        onStop: (elapsed?: number) => {
          if (elapsed != null) {
            this.elapsedTimes[normalizedIndex] = elapsed;
            this.saveTimerState();
            console.log(
              `[TimerService] Saved elapsed time for Q${normalizedIndex + 1}: ${elapsed}s`
            );
          }
        }
      });

      if (!stopped) {
        console.warn('[TimerService] Stop rejected → FORCING TIMER STOP.');
        this.stopTimer(undefined, { force: true });
      }
    } catch (error) {
      console.error('[TimerService] Error in stopTimerIfApplicable:', error);
    }
  }

  public stopTimerForQuestion(questionIndex: number): void {
    const idx = this.normalizeQuestionIndex(questionIndex);
    if (idx < 0) return;

    // Prevent double-stops
    if (this.isTimerStoppedForCurrentQuestion) {
      console.warn('[TimerService] Timer already stopped for this question');
      return;
    }

    // Authoritative Stop — grant authority immediately before stopping
    this._authoritativeStop = true;

    const stopped = this.attemptStopTimerForQuestion({
      questionIndex: idx,
      onStop: (elapsed?: number) => {
        if (elapsed != null) {
          this.elapsedTimes[idx] = elapsed;
          this.saveTimerState();
        }
      }
    });

    if (!stopped) {
      // Force is allowed, but stopTimer() will still clear authority
      this.stopTimer(undefined, { force: true });
    }
  }

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
  }

  public async requestStopEvaluationFromClick(
    questionIndex: number,
    selectedOption: SelectedOption | null
  ): Promise<void> {
    const normalizedIndex = this.normalizeQuestionIndex(questionIndex);
    const q = this.quizService?.questions?.[normalizedIndex];
    if (!q) return;

    // Always convert SelectedOption → SelectedOption[]
    const selectedOptionsArray =
      this.selectedOptionService.getSelectedOptionsForQuestion(normalizedIndex);

    // Now fully valid call
    await this.stopTimerIfApplicable(q, normalizedIndex, selectedOptionsArray);
  }

  public calculateTotalElapsedTime(elapsedTimes: number[]): number {
    if (!elapsedTimes || !Array.isArray(elapsedTimes)) {
      console.warn(
        '[TimerService] calculateTotalElapsedTime: Invalid elapsedTimes array'
      );
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
      this.saveTimerState();
      console.log(`[TimerService] Calculated total elapsed time: ${total}s`);
      return total;
    } catch (error) {
      console.error(
        '[TimerService] Error calculating total elapsed time:', error
      );
      return 0;
    }
  }

  private normalizeQuestionIndex(index: number | null | undefined): number {
    if (!Number.isFinite(index as number)) {
      return -1;
    }

    const normalized = Math.trunc(index as number);
    const questions = this.quizService?.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      return normalized;
    }

    if (questions[normalized] != null) {
      return normalized;
    }

    const potentialOneBased = normalized - 1;
    if (
      potentialOneBased >= 0 &&
      potentialOneBased < questions.length &&
      questions[potentialOneBased] != null
    ) {
      return potentialOneBased;
    }

    return Math.min(Math.max(normalized, 0), questions.length - 1);
  }

  public allowAuthoritativeStop(): void {
    this._authoritativeStop = true;
  }

  private saveTimerState(): void {
    try {
      sessionStorage.setItem('elapsedTimes', JSON.stringify(this.elapsedTimes));
      sessionStorage.setItem('completionTime', String(this.completionTime));
    } catch {
      // ignore
    }
  }

  public clearTimerState(): void {
    this.elapsedTimes = [];
    this.completionTime = 0;
    try {
      sessionStorage.removeItem('elapsedTimes');
      sessionStorage.removeItem('completionTime');
    } catch {
      // ignore
    }
  }
}