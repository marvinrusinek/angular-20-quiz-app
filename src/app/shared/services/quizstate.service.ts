import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  EMPTY,
  Observable,
  ReplaySubject,
  Subject,
} from 'rxjs';
import { catchError, distinctUntilChanged, filter, map } from 'rxjs/operators';

import { Option } from '../models/Option.model';
import { QAPayload } from '../models/QAPayload.model';
import { QuestionState } from '../models/QuestionState.model';
import { QuizQuestion } from '../models/QuizQuestion.model';

@Injectable({ providedIn: 'root' })
export class QuizStateService {
  currentQuestion: BehaviorSubject<QuizQuestion | null> =
    new BehaviorSubject<QuizQuestion | null>(null);

  currentQuestionSubject = new BehaviorSubject<QuizQuestion | null>(null);
  currentQuestion$: Observable<QuizQuestion | null> =
    this.currentQuestionSubject.asObservable();

  private currentQuestionIndexSubject = new BehaviorSubject<number>(0);
  currentQuestionIndex$: Observable<number> =
    this.currentQuestionIndexSubject.asObservable();

  private currentOptionsSubject = new BehaviorSubject<Option[]>([]);
  currentOptions$: Observable<Option[]> =
    this.currentOptionsSubject.asObservable();

  questionStates: Map<number, QuestionState> = new Map();
  private quizStates: { [quizId: string]: Map<number, QuestionState> } = {};

  private restoreStateSubject = new Subject<void>();

  private quizQuestionCreated = false;
  public displayExplanationLocked = false;

  // Visibility restoration lock - prevents display state changes during tab restore
  private _visibilityRestoreLock = false;
  private _visibilityRestoreLockTimeout: ReturnType<typeof setTimeout> | null = null;

  loadingSubject = new BehaviorSubject<boolean>(false);

  isLoadingSubject = new BehaviorSubject<boolean>(false);
  public isLoading$ = this.isLoadingSubject.asObservable();

  isNavigatingSubject = new BehaviorSubject<boolean>(false);
  public isNavigating$ = this.isNavigatingSubject.asObservable();

  answeredSubject = new BehaviorSubject<boolean>(false);
  isAnswered$: Observable<boolean> = this.answeredSubject.asObservable();

  // Tracks when the explanation text (FET) is fully formatted & ready
  private explanationReadySubject =
    new BehaviorSubject<boolean>(false);
  public explanationReady$ = this.explanationReadySubject.asObservable();

  public displayStateSubject = new BehaviorSubject<{
    mode: 'question' | 'explanation';
    answered: boolean;
  }>({
    mode: 'question',
    answered: false
  });
  public displayState$ =
    this.displayStateSubject.asObservable();

  qaSubject = new ReplaySubject<QAPayload>(1);
  qa$ = this.qaSubject.asObservable();

  private interactionReadySubject =
    new BehaviorSubject<boolean>(true);
  public interactionReady$ = this.interactionReadySubject.asObservable();

  // Tracks whether the quiz state has completed at least one full restoration
  public hasRestoredOnce = false;

  public _hasUserInteracted = new Set<number>();
  public _answeredQuestionIndices = new Set<number>();

  constructor() {
    this.questionStates = new Map<number, QuestionState>();
  }

  setDisplayState(state: {
    mode: 'question' | 'explanation';
    answered: boolean;
  }, options?: { force?: boolean }): void {
    // If visibility restore lock is active, block state changes unless forced
    if (this._visibilityRestoreLock && !options?.force) {
      console.log('[QSS] 🔒 setDisplayState blocked by visibility restore lock:', state);
      return;
    }
    this.displayStateSubject.next(state);
  }

  // Lock display state changes (used during tab visibility restoration)
  lockDisplayStateForVisibilityRestore(durationMs: number = 500): void {
    this._visibilityRestoreLock = true;
    console.log('[QSS] 🔐 Visibility restore lock ENABLED');

    // Clear any existing timeout
    if (this._visibilityRestoreLockTimeout) {
      clearTimeout(this._visibilityRestoreLockTimeout);
    }

    // Automatically unlock after duration
    this._visibilityRestoreLockTimeout = setTimeout(() => {
      this._visibilityRestoreLock = false;
      this._visibilityRestoreLockTimeout = null;
      console.log('[QSS] 🔓 Visibility restore lock RELEASED');
    }, durationMs);
  }

  unlockDisplayStateForVisibilityRestore(): void {
    if (this._visibilityRestoreLockTimeout) {
      clearTimeout(this._visibilityRestoreLockTimeout);
      this._visibilityRestoreLockTimeout = null;
    }
    this._visibilityRestoreLock = false;
    console.log('[QSS] 🔓 Visibility restore lock manually RELEASED');
  }

  getStoredState(quizId: string): Map<number, QuestionState> | null {
    const stateJSON = localStorage.getItem(`quizState_${quizId}`);
    if (stateJSON) {
      try {
        const stateObject = JSON.parse(stateJSON);

        // Additional check to ensure the parsed object matches the expected structure
        if (typeof stateObject === 'object' && !Array.isArray(stateObject)) {
          return new Map<number, QuestionState>(
            Object.entries(stateObject).map(
              ([key, value]): [number, QuestionState] => {
                // Further validation to ensure each key-value pair matches the expected types
                const parsedKey = Number(key);
                if (
                  !isNaN(parsedKey) &&
                  typeof value === 'object' &&
                  value !== null &&
                  'isAnswered' in value
                ) {
                  return [parsedKey, value as QuestionState];
                } else {
                  throw new Error(
                    `Invalid question state format for questionId ${key}`,
                  );
                }
              },
            ),
          );
        } else {
          console.error('Stored state is not in object format');
        }
      } catch (error) {
        console.error(
          `Error parsing stored state for quizId ${quizId}:`,
          error,
        );
        return null;
      }
    }
    return null;
  }

  // Method to set or update the state for a question
  setQuestionState(
    quizId: string,
    questionId: number,
    state: QuestionState,
  ): void {
    // Check if the quizId already exists in the quizStates map, if not, create a new Map for it
    if (!this.quizStates[quizId]) {
      this.quizStates[quizId] = new Map<number, QuestionState>();
    }

    // Set the state for the given questionId within the specified quizId
    this.quizStates[quizId].set(questionId, state);
  }

  // Method to get the state of a question by its ID
  getQuestionState(
    quizId: string,
    questionId: number,
  ): QuestionState | undefined {
    // Initialize the state map for this quiz if it doesn't exist
    if (!this.quizStates[quizId]) {
      this.quizStates[quizId] = new Map<number, QuestionState>();
    }

    let state =
      this.quizStates[quizId].get(questionId) ??
      this.createDefaultQuestionState();
    this.quizStates[quizId].set(questionId, state); // store the default state in the quiz's state map

    return state;
  }

  updateQuestionState(
    quizId: string,
    questionIndex: number,
    stateUpdates: Partial<QuestionState>,
    totalCorrectAnswers: number,
  ): void {
    // Retrieve the current state for the question or initialize if not present
    let currentState = this.getQuestionState(quizId, questionIndex) || {
      isAnswered: false,
      selectedOptions: [],
      numberOfCorrectAnswers: 0, // ensure this property is properly initialized
    };

    // If updating selected options and the question has correct answers to track
    if (stateUpdates.selectedOptions && totalCorrectAnswers > 0) {
      // Ensure selectedOptions is an array and update it based on stateUpdates
      currentState.selectedOptions = Array.isArray(currentState.selectedOptions)
        ? currentState.selectedOptions
        : [];

      for (const option of stateUpdates.selectedOptions) {
        if (
          !currentState.selectedOptions.some(
            (selectedOption) => selectedOption.optionId === option.optionId,
          )
        ) {
          currentState.selectedOptions.push(option);

          const numCorrect = currentState.numberOfCorrectAnswers ?? 0;
          if (option.correct === true && numCorrect < totalCorrectAnswers) {
            currentState.numberOfCorrectAnswers = numCorrect + 1;
          }
        }
      }

      // Mark as answered if the number of correct answers is reached
      currentState.isAnswered =
        (currentState.numberOfCorrectAnswers ?? 0) >= totalCorrectAnswers;
    }

    // Merge the current state with other updates not related to selected options
    const newState = { ...currentState, ...stateUpdates };

    // Save the updated state
    this.setQuestionState(quizId, questionIndex, newState);
  }

  updateQuestionStateForExplanation(quizId: string, index: number): void {
    let questionState = this.getQuestionState(quizId, index);

    if (!questionState) {
      questionState = {
        isAnswered: false,
        explanationDisplayed: false,
        selectedOptions: [],
      };
    }

    questionState.explanationDisplayed = true;
    questionState.isAnswered = true;

    // Save the updated state
    this.setQuestionState(quizId, index, questionState);
  }

  createDefaultQuestionState(): QuestionState {
    return {
      isAnswered: false,
      numberOfCorrectAnswers: 0,
      selectedOptions: [],
      explanationDisplayed: false,
    };
  }

  applyDefaultStates(quizId: string, questions: QuizQuestion[]): void {
    // Initialize the state map for this quiz if it doesn't exist
    if (!this.quizStates[quizId]) {
      this.quizStates[quizId] = new Map<number, QuestionState>();
    }

    for (const [index] of questions.entries()) {
      const defaultState = this.createDefaultQuestionState();
      // Apply the default state to each question using its index as the identifier within the specific quiz's state map
      this.quizStates[quizId].set(index, defaultState);
    }
  }

  updateCurrentQuizState(question$: Observable<QuizQuestion | null>): void {
    if (!question$) {
      throw new Error('question$ must be an observable.');
    }

    question$
      .pipe(
        filter((q): q is QuizQuestion => q !== null),
        distinctUntilChanged((a, b) => a === b), // object reference check
        catchError((err) => {
          console.error('[QuizState] Error in question$ stream:', err);
          return EMPTY; // safest fallback
        }),
      )
      .subscribe((question: QuizQuestion) => {
        this.currentQuestion.next(question);
        this.currentQuestionSubject.next(question);
        this.currentOptionsSubject.next(question.options ?? []);
      });
  }

  updateCurrentQuestion(newQuestion: QuizQuestion): void {
    this.currentQuestionSubject.next(newQuestion);
  }

  onRestoreQuestionState(): Observable<void> {
    return this.restoreStateSubject.asObservable();
  }

  setQuizQuestionCreated(): void {
    this.quizQuestionCreated = true;
  }

  getQuizQuestionCreated(): boolean {
    return this.quizQuestionCreated;
  }

  isLoading(): boolean {
    return this.loadingSubject.getValue();
  }

  setNavigating(isNavigating: boolean): void {
    this.isNavigatingSubject.next(isNavigating);
  }

  setLoading(isLoading: boolean): void {
    this.loadingSubject.next(isLoading);
    this.isLoadingSubject.next(isLoading);
  }

  setAnswered(isAnswered: boolean): void {
    this.answeredSubject.next(isAnswered);
  }

  // Method to set isAnswered and lock displayExplanation
  setAnswerSelected(isAnswered: boolean): void {
    this.answeredSubject.next(isAnswered);
    if (isAnswered && !this.displayExplanationLocked)
      this.displayExplanationLocked = true;
  }

  setExplanationReady(isReady: boolean): void {
    this.explanationReadySubject.next(isReady);
  }

  startLoading(): void {
    if (!this.isLoading()) {
      console.log('Loading started');
      this.loadingSubject.next(true);
    }
  }

  emitQA(
    question: QuizQuestion,
    selectionMessage: string,
    quizId: string,
    index: number,
  ): void {
    if (!question?.options?.length) {
      console.warn('[❌ emitQA] Question or options missing', { question });
      return;
    }

    // Normalize each option safely
    const normalizedOptions = question.options.map((opt, i) => ({
      ...opt,
      optionId: opt.optionId ?? i,
      active: opt.active !== undefined ? opt.active : true,
      showIcon: Boolean(opt.showIcon),
      correct: Boolean(opt.correct),
      selected: Boolean(opt.selected),
      feedback:
        typeof opt.feedback === 'string' ? opt.feedback.trim() : 'No feedback',
    }));

    // Emit the complete QA object as a single payload
    this.qaSubject.next({
      quizId,
      index,
      question: {
        ...question,
        options: normalizedOptions,
      },
      options: normalizedOptions,
      selectionMessage,
      heading: question.questionText ?? 'No question available',
      explanation: question.explanation ?? 'No explanation available',
    });
  }

  setInteractionReady(v: boolean) {
    this.interactionReadySubject.next(v);
  }

  isInteractionReady(): boolean {
    return this.interactionReadySubject.getValue();
  }

  markUserInteracted(idx: number): void {
    this._hasUserInteracted.add(idx);
  }

  hasUserInteracted(idx: number): boolean {
    return this._hasUserInteracted.has(idx);
  }

  markQuestionAnswered(idx: number): void {
    this._answeredQuestionIndices.add(idx);
  }

  isQuestionAnswered(idx: number): boolean {
    return this._answeredQuestionIndices.has(idx);
  }

  // ⚡ FIX: Reset all state (called on Shuffle Toggle or Quiz Reset)
  reset(): void {
    console.log('[QuizStateService] ♻️ Resetting all state.');
    this.questionStates.clear();
    this.quizStates = {};
    this._hasUserInteracted.clear();
    this._answeredQuestionIndices.clear();
    this.currentQuestionSubject.next(null);
    this.explanationReadySubject.next(false);
    this.answeredSubject.next(false);
    this.qaSubject.next(null as any); // Clear replay subject
  }
}
