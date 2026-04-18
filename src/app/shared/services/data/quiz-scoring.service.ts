import { Injectable, Injector } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { QUIZ_DATA } from '../../quiz';
import { QuizScore } from '../../models/QuizScore.model';
import { QuizShuffleService } from '../flow/quiz-shuffle.service';
import { SelectedOptionService } from '../state/selectedoption.service';

@Injectable({ providedIn: 'root' })
export class QuizScoringService {
  // State tracking for scoring (Index -> IsCorrect)
  public questionCorrectness = new Map<number, boolean>();

  correctCount = 0;
  score = 0;
  quizScore: QuizScore | null = null;
  highScores: QuizScore[] = [];
  highScoresLocal = JSON.parse(localStorage.getItem('highScoresLocal') ?? '[]');

  public correctAnswersCountSubject = new BehaviorSubject<number>(0);

  // Tracks confirmed correct clicks per question. Each call to recordCorrectClick
  // adds the option text; the pristine gate only allows scoring when the count
  // matches the pristine correct count. This avoids relying on SelectedOptionService
  // which can return polluted/extra selections.
  private _confirmedCorrectClicks = new Map<number, Set<string>>();

  /** Record that a correct option was clicked for a multi-answer question. */
  recordCorrectClick(questionIndex: number, optionText: string): void {
    const nrm = String(optionText ?? '').trim().toLowerCase();
    if (!nrm) return;
    if (!this._confirmedCorrectClicks.has(questionIndex)) {
      this._confirmedCorrectClicks.set(questionIndex, new Set());
    }
    this._confirmedCorrectClicks.get(questionIndex)!.add(nrm);
  }

  /** Clear confirmed clicks for a question (used on reset). */
  clearConfirmedClicks(questionIndex?: number): void {
    if (questionIndex !== undefined) {
      this._confirmedCorrectClicks.delete(questionIndex);
    } else {
      this._confirmedCorrectClicks.clear();
    }
  }

  private readonly scoreQuizIdStorageKey = 'scoreQuizId';

  constructor(
    private quizShuffleService: QuizShuffleService,
    private _injector: Injector
  ) {
    this.loadQuestionCorrectness();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Core Scoring
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Simple Scoring: Direct scoring method that bypasses complex answer matching.
   * Call this when you already know whether the user's selection is correct.
   * @param questionIndex The display index of the question
   * @param isCorrect Whether the user's current answer state is correct
   * @param isMultipleAnswer Whether this is a multi-answer question
   * @param shouldShuffle Whether shuffle is currently enabled
   * @param quizId The current quiz ID
   */
  // Lazily resolved to avoid circular dependency
  private _selectedOptionService: SelectedOptionService | null = null;
  private get selectedOptionServiceLazy(): SelectedOptionService | null {
    if (!this._selectedOptionService) {
      try {
        this._selectedOptionService = this._injector.get(SelectedOptionService);
      } catch { /* ignore */ }
    }
    return this._selectedOptionService;
  }

  public scoreDirectly(
    questionIndex: number,
    isCorrect: boolean,
    isMultipleAnswer: boolean,
    shouldShuffle: boolean,
    quizId: string
  ): void {
    this.incrementScore([], isCorrect, isMultipleAnswer, questionIndex, shouldShuffle, quizId);
  }

  incrementScore(
    answers: number[],
    correctAnswerFound: boolean,
    isMultipleAnswer: boolean,
    questionIndex: number,
    shouldShuffle: boolean,
    quizId: string
  ): void {
    const qIndex = questionIndex >= 0 ? questionIndex : 0;

    // Scoring Key Resolution
    let scoringKey = qIndex;

    // Strict Shuffle Guard
    // Only use the shuffle service mapping if shuffle is explicitly ENABLED.
    // If we rely on valid ID checks alone, a stale map in QuizShuffleService (from a prev session)
    // might incorrectly remap an unshuffled question (0->3), updating the wrong score key.
    if (shouldShuffle) {
      // Try to get quizId from various sources if it's empty
      let effectiveQuizId = quizId;
      if (!effectiveQuizId) {
        // Try localStorage
        try {
          effectiveQuizId = localStorage.getItem('lastQuizId') || '';
        } catch { }
      }
      if (!effectiveQuizId) {
        // Try to find any active shuffle state
        const shuffleKeys = Object.keys(localStorage).filter(k => k.startsWith('shuffleState:'));
        if (shuffleKeys.length > 0) {
          effectiveQuizId = shuffleKeys[0].replace('shuffleState:', '');
          console.log(`[incrementScore] Found shuffle state for quizId: ${effectiveQuizId}`);
        }
      }

      if (effectiveQuizId) {
        const originalIndex = this.quizShuffleService.toOriginalIndex(effectiveQuizId, qIndex);

        // Valid original index is >= 0
        if (typeof originalIndex === 'number' && originalIndex >= 0) {
          scoringKey = originalIndex;
        }
      } else {
        console.warn(`[incrementScore] Shuffle enabled but no quizId found - using display index as scoringKey`);
      }
    }

    // IMPORTANT: Only use scoringKey for questionCorrectness lookups.
    // Previously we also stored/checked by qIndex (display index), but in shuffled mode
    // one question's qIndex can collide with another question's scoringKey, causing
    // false "already scored" hits that block increments.
    let wasCorrect = this.questionCorrectness.get(scoringKey) || false;

    // Self-heal: if questionCorrectness says "already correct" but correctCount is 0,
    // the map entry is stale (e.g. from a previous localStorage session that wasn't
    // fully cleared). Reset so scoring can proceed.
    if (wasCorrect && this.correctCount === 0) {
      wasCorrect = false;
      this.questionCorrectness.set(scoringKey, false);
    }

    let isNowCorrect = correctAnswerFound;  // simplified

    // PRISTINE GATE (incrementScore): Block increment for multi-answer questions
    // unless ALL pristine correct answers have been confirmed clicked.
    if (isNowCorrect && quizId) {
      const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
      const pristineQuiz = QUIZ_DATA.find((qz: any) => qz?.quizId === quizId);
      const pristineQ = pristineQuiz?.questions?.[scoringKey];
      if (pristineQ) {
        const pristineCorrectTexts = (pristineQ.options ?? [])
          .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
          .map((o: any) => nrm(o?.text))
          .filter((t: string) => !!t);

        if (pristineCorrectTexts.length > 1) {
          const confirmed = this._confirmedCorrectClicks.get(qIndex) ?? new Set();
          const allConfirmed = pristineCorrectTexts.every((t: string) => confirmed.has(t));
          if (!allConfirmed) {
            isNowCorrect = false;
          }
        }
      }
    }

    if (isNowCorrect && !wasCorrect) {
      this.questionCorrectness.set(scoringKey, true);
      this.updateCorrectCountForResults(this.correctCount + 1);
    } else if (!isNowCorrect && wasCorrect) {
      this.updateCorrectCountForResults(Math.max(this.correctCount - 1, 0));
      this.questionCorrectness.set(scoringKey, false);
    } else if (!isNowCorrect) {
      this.questionCorrectness.set(scoringKey, false);
    }

    this.saveQuestionCorrectness();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Score Updates & Guards
  // ═══════════════════════════════════════════════════════════════════════

  private updateCorrectCountForResults(value: number): void {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    this.correctCount = safeValue;
    this.sendCorrectCountToResults(this.correctCount);
  }

  sendCorrectCountToResults(value: number, quizId?: string): void {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

    // GUARD: If something tries to set score to 0 but we have correctly answered
    // questions in our map, ignore the zero and re-derive from the map.
    // This prevents navigation-triggered accidental resets.
    if (safeValue === 0 && this.questionCorrectness.size > 0) {
      localStorage.setItem('DEBUG_sendCorrectCount_BLOCKED', new Error().stack || 'no stack');
      const trueCount = Array.from(this.questionCorrectness.values())
        .filter(v => v === true).length;
      if (trueCount > 0) {
        this.correctCount = trueCount;
        this.correctAnswersCountSubject.next(trueCount);
        localStorage.setItem('correctAnswersCount', String(trueCount));
        if (quizId) {
          localStorage.setItem(this.scoreQuizIdStorageKey, quizId);
        }
        return;
      }
    }

    this.correctCount = safeValue;
    this.correctAnswersCountSubject.next(safeValue);
    localStorage.setItem('correctAnswersCount', String(safeValue));
    if (quizId) {
      localStorage.setItem(this.scoreQuizIdStorageKey, quizId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Reset
  // ═══════════════════════════════════════════════════════════════════════

  resetScore(quizId?: string): void {
    localStorage.setItem('DEBUG_resetScore', new Error().stack || 'no stack');
    this.questionCorrectness.clear();
    this._confirmedCorrectClicks.clear();
    this.saveQuestionCorrectness();  // clear persistence
    this.correctCount = 0;
    // Use _forceSetScore to bypass the guard in sendCorrectCountToResults
    this._forceSetScore(0, quizId);
    console.log('[QuizScoringService] Score fully reset.');
  }

  /** Bypass guard — only for explicit resets (restart, new quiz). */
  _forceSetScore(value: number, quizId?: string): void {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    this.correctCount = safeValue;
    this.correctAnswersCountSubject.next(safeValue);
    localStorage.setItem('correctAnswersCount', String(safeValue));
    if (quizId) {
      localStorage.setItem(this.scoreQuizIdStorageKey, quizId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════════════════════════════════════

  loadQuestionCorrectness(): void {
    try {
      const stored = localStorage.getItem('questionCorrectness');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.questionCorrectness = new Map(
          Object.entries(parsed).map(([k, v]) => [Number(k), Boolean(v)])
        );
        console.log('[QuizScoringService] Loaded questionCorrectness:', this.questionCorrectness);
      }
    } catch (err) {
      console.warn('Failed to load questionCorrectness:', err);
    }
  }

  saveQuestionCorrectness(): void {
    try {
      const obj = Object.fromEntries(this.questionCorrectness);
      localStorage.setItem('questionCorrectness', JSON.stringify(obj));
    } catch (err) {
      console.warn('Failed to save questionCorrectness:', err);
    }
  }

  restoreScoreFromPersistence(quizId: string): void {
    try {
      // If quizId is not yet known (e.g. called from QuizService constructor
      // before the route has resolved), do nothing. Wiping state here
      // destroys the localStorage-persisted score the user just earned
      // right before the refresh.
      if (!quizId || quizId.length === 0) {
        console.log('[QuizScoringService] restoreScoreFromPersistence skipped — no quizId yet');
        return;
      }

      const savedIndexRaw = localStorage.getItem('savedQuestionIndex');
      const savedIndex = Number(savedIndexRaw);
      const hasInProgressIndex = Number.isFinite(savedIndex) && Math.trunc(savedIndex) >= 0;
      const scoreQuizId = localStorage.getItem(this.scoreQuizIdStorageKey) ?? '';
      const quizMatches = scoreQuizId.length > 0 && scoreQuizId === quizId;

      // Compute what we HAVE stored for this quiz. If there's real data,
      // this is an in-progress session and we must restore it on refresh,
      // even if the user was on Q1 (savedIndex === 0).
      const storedRaw = localStorage.getItem('correctAnswersCount');
      const storedCount = Number(storedRaw);
      const safeStored = Number.isFinite(storedCount) ? Math.max(0, Math.trunc(storedCount)) : 0;
      const mapTrueCount = Array.from(this.questionCorrectness.values())
        .filter((v) => v === true)
        .length;
      const hasStoredScore = safeStored > 0 || mapTrueCount > 0;

      // Wipe ONLY when: (a) quiz doesn't match (switching quizzes), OR
      // (b) there is genuinely no progress (no stored score AND no
      // in-progress index). Otherwise, restore from the stronger source.
      const shouldWipe = !quizMatches || (!hasInProgressIndex && !hasStoredScore);
      if (shouldWipe) {
        this.correctCount = 0;
        this.correctAnswersCountSubject.next(0);
        this.questionCorrectness.clear();
        this.saveQuestionCorrectness();
        localStorage.setItem('correctAnswersCount', '0');
        localStorage.setItem(this.scoreQuizIdStorageKey, quizId);
        return;
      }

      const restored = Math.max(safeStored, mapTrueCount);
      this.correctCount = restored;
      this.correctAnswersCountSubject.next(restored);
      localStorage.setItem('correctAnswersCount', String(restored));
      console.log(`[QuizScoringService] Restored score from persistence: ${restored} (stored=${safeStored}, map=${mapTrueCount}, savedIndex=${savedIndex})`);
    } catch (err) {
      console.warn('[QuizScoringService] Failed to restore score from persistence:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // High Scores
  // ═══════════════════════════════════════════════════════════════════════

  saveHighScores(quizId: string, totalQuestions: number): void {
    this.quizScore = {
      quizId: quizId,
      attemptDateTime: new Date(),
      score: this.calculatePercentageOfCorrectlyAnsweredQuestions(totalQuestions),
      totalQuestions: totalQuestions
    };

    const MAX_HIGH_SCORES = 10;  // show results of the last 10 quizzes
    this.highScoresLocal = this.highScoresLocal ?? [];
    this.highScoresLocal.push(this.quizScore);

    // Sort descending by date
    this.highScoresLocal.sort((a: any, b: any) => {
      const dateA = new Date(a.attemptDateTime);
      const dateB = new Date(b.attemptDateTime);
      return dateB.getTime() - dateA.getTime();
    });
    // Filter out scores older than 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    this.highScoresLocal = this.highScoresLocal.filter((score: any) => {
      const scoreDate = new Date(score.attemptDateTime);
      return scoreDate >= oneWeekAgo;
    });

    this.highScoresLocal.splice(MAX_HIGH_SCORES);
    localStorage.setItem(
      'highScoresLocal',
      JSON.stringify(this.highScoresLocal)
    );
    this.highScores = this.highScoresLocal;
  }

  calculatePercentageOfCorrectlyAnsweredQuestions(totalQuestions: number): number {
    const correctAnswers = this.correctAnswersCountSubject.getValue();

    if (totalQuestions === 0) {
      return 0;  // handle division by zero
    }

    return Math.round((correctAnswers / totalQuestions) * 100);
  }
}
