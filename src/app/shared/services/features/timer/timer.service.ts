import { Injectable, OnDestroy, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Subject, Subscription, timer } from 'rxjs';
import { finalize, map, takeUntil, tap } from 'rxjs/operators';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { QuizService } from '../../data/quiz.service';

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

  // Signal-first sources of truth
  readonly elapsedTimeSig = signal<number>(0);
  public elapsedTime$ = toObservable(this.elapsedTimeSig);

  private static _initTimerType(): 'countdown' | 'stopwatch' {
    try {
      return localStorage.getItem('timerType') === 'stopwatch'
        ? 'stopwatch'
        : 'countdown';
    } catch {
      return 'countdown';
    }
  }
  readonly timerTypeSig = signal<'countdown' | 'stopwatch'>(TimerService._initTimerType());
  public timerType$ = toObservable(this.timerTypeSig);

  readonly stopSig = signal<number>(0);
  public stop$ = toObservable(this.stopSig);

  private timerSubscription: Subscription | null = null;
  private stopTimerSignalSubscription: Subscription | null = null;

  private expiredSubject = new Subject<void>();
  public expired$ = this.expiredSubject.asObservable();

  private _authoritativeStop = false;
  private hasExpiredForRun = false;
  /** The question index the timer most recently expired for, or -1 if none. */
  public expiredForQuestionIndex = -1;
  /** Signal version — read this in OnPush templates so Angular auto-tracks it. */
  public readonly expiredForQuestionIndexSig = signal(-1);

  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) {
    this.isCountdown = this.timerTypeSig() === 'countdown';
    this.setupTimer();
    this.listenForCorrectSelections();
  }

  private setupTimer(): void {
    this.stopTimerSignalSubscription =
      this.selectedOptionService.stopTimer$.subscribe(() => {
        if (!this.isTimerRunning) {
          return;
        }
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
          return;
        }
        this.handleStopTimerSignal();
      });
  }

  private handleStopTimerSignal(): void {
    if (!this.isTimerRunning) {
      return;
    }

    const activeQuestionIndex = this.normalizeQuestionIndex(
      this.quizService?.currentQuestionIndex
    );
    if (activeQuestionIndex < 0) {
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
        }
      }
    });

    if (!stopped) {
      this.stopTimer(undefined, { force: true });
    }
  }

  setTimerType(type: 'countdown' | 'stopwatch'): void {
    if (this.timerTypeSig() === type) {
      return;
    }

    this.timerTypeSig.set(type);
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
      return;
    }

    // Anti-thrash: ignore any (re)start that happens within 5s of a previous
    // start, regardless of running state. The init chain repeatedly fires
    // stop+start; suppressing the duplicates lets the tick stream survive.
    const nowMs = Date.now();
    // Once expired for this question, refuse all further starts until
    // restartForQuestion is called for a new question.
    if (this.hasExpiredForRun) {
      return;
    }
    if (this._lastStartedAtMs > 0 && (nowMs - this._lastStartedAtMs) < this.timePerQuestion * 1000) {
      // Re-arm running flag in case a rogue stop slipped through
      if (!this.isTimerRunning && this.timerSubscription) {
        this.isTimerRunning = true;
      }
      return;
    }

    if (this.isTimerRunning) {
      if (!forceRestart) {
        return;  // prevent restarting an already running timer
      }
      this.stopTimer(undefined, { force: true });
    }
    this._lastStartedAtMs = nowMs;

    if (forceRestart) {
      this.isTimerStoppedForCurrentQuestion = false;
    }

    this.isTimerRunning = true;  // mark timer as running
    this.isCountdown = isCountdown;
    this.elapsedTime = 0;
    this.hasExpiredForRun = false;

    // Show initial value immediately
    this.elapsedTimeSig.set(0);

    // Start ticking after 1s so the initial value stays visible for a second
    const timer$ = timer(1000, 1000).pipe(
      tap((tick) => {
        // Tick starts at 0 after 1s → elapsed = tick + 1 (1,2,3,…)
        const elapsed = tick + 1;

        this.elapsedTime = elapsed;
        this.elapsedTimeSig.set(this.elapsedTime);

        // If reached the duration, emit expiration once (stop only for countdown)
        if (elapsed >= duration && !this.hasExpiredForRun) {
          this.hasExpiredForRun = true;
          this.expiredForQuestionIndex = this.quizService.currentQuestionIndex;
          this.expiredForQuestionIndexSig.set(this.expiredForQuestionIndex);
          this.expiredSubject.next();
          if (isCountdown) {
            this.stopTimer(undefined, { force: true });
          }
        }
      }),
      takeUntil(this.isStop),
      finalize(() => {
        this.isTimerRunning = false;
      }),
    );

    this.timerSubscription = timer$.subscribe();
  }

  // Stops the timer
  stopTimer(
    callback?: (elapsedTime: number) => void,
    options: { force?: boolean; bypassAntiThrash?: boolean } = {}
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
      return;
    }

    // Anti-thrash: ignore stops fired immediately after a fresh start
    // (init-chain churn). Only honor stops once the timer has had a chance
    // to actually tick, OR if expiry has been reached.
    const sinceStart = Date.now() - this._lastStartedAtMs;
    if (sinceStart < this.timePerQuestion * 1000 && !this.hasExpiredForRun && !options.bypassAntiThrash) {
      return;
    }

    // End the ticking subscription
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = null;
    } else {
    }

    this.isTimerRunning = false;  // mark the timer as stopped
    this.isTimerStoppedForCurrentQuestion = true;  // prevent restart for current question
    this.stopSig.update(v => v + 1);  // emit stop signal to stop the timer
    this.isStop.next();

    if (callback) {
      callback(this.elapsedTime);
    }
  }

  // Resets the timer
  resetTimer(): void {

    // Anti-thrash: ignore resets after a start is in flight or after expiry,
    // until restartForQuestion explicitly clears the flags for a new question.
    if (this.hasExpiredForRun) {
      return;
    }
    const sinceStart = Date.now() - this._lastStartedAtMs;
    if (this._lastStartedAtMs > 0 && sinceStart < this.timePerQuestion * 1000) {
      return;
    }

    if (this.isTimerRunning) {
      this.stopTimer(undefined, { force: true });
    }

    this.elapsedTime = 0;
    this.isTimerRunning = false;
    this.isTimerStoppedForCurrentQuestion = false;  // allow restart for the new question
    this.hasExpiredForRun = false;

    this.isReset.next();  // signal to reset
    this.elapsedTimeSig.set(0);  // reset elapsed time for observers
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
        return;
      }

      if (!question || !Array.isArray(question.options)) {
        return;
      }

      const normalizedIndex = this.normalizeQuestionIndex(questionIndex);
      if (normalizedIndex < 0) {
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
        } else {
          selectedOptionsFinal = selectedOptionsFromQQC ?? [];
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
        console.groupEnd();
        return;
      }

      const stopped = this.attemptStopTimerForQuestion({
        questionIndex: normalizedIndex,
        onStop: (elapsed?: number) => {
          if (elapsed != null) {
            this.elapsedTimes[normalizedIndex] = elapsed;
            this.saveTimerState();
          }
        }
      });

      if (!stopped) {
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

  /**
   * Convenience: stop, reset, clear flags, and start a fresh timer for a question.
   * Consolidates the 4-step pattern used across QuizComponent navigation paths.
   */
  private _runningForQuestion: number | null = null;
  private _lastStartedAtMs = 0;

  public restartForQuestion(questionIndex: number): void {
    if (this._runningForQuestion === questionIndex && (this.isTimerRunning || this.hasExpiredForRun)) {
      return;
    }
    this._runningForQuestion = questionIndex;
    // Clear expiry/start guards so this fresh question can run
    this.hasExpiredForRun = false;
    this.expiredForQuestionIndex = -1;
    this.expiredForQuestionIndexSig.set(-1);
    this._lastStartedAtMs = 0;
    this.stopTimer?.(undefined, { force: true });
    this.resetTimer();
    this.resetTimerFlagsFor(questionIndex);
    this.startTimer(this.timePerQuestion, this.isCountdown, true);
  }

  public resetTimerFlagsFor(questionIndex: number): void {
    if (questionIndex == null || questionIndex < 0) {
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