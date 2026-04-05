import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionState } from '../../models/QuestionState.model';
import { QuizStateService } from '../state/quizstate.service';
import { ExplanationTextService } from './explanation-text.service';
import { TimerService } from './timer.service';
import { QqcStatePersistenceService } from '../state/qqc-state-persistence.service';
import { QuizService } from '../data/quiz.service';
import { SelectedOptionService } from '../state/selectedoption.service';

/**
 * Manages navigation-related logic for QuizQuestionComponent:
 * - Visibility change handling (tab switch, background/foreground)
 * - Route parameter processing for question navigation
 * - Quiz state restoration after tab switches
 * - Display subscription lifecycle for page visibility
 *
 * Extracted from QuizQuestionComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QqcNavigationHandlerService {

  /** Tracks whether the page was hidden (for FET purge logic) */
  private _wasHidden = false;

  /** Performance timestamp when the page was hidden */
  private _hiddenAt: number | null = null;

  /** Elapsed timer value captured when the page was hidden */
  private _elapsedAtHide: number | null = null;

  constructor(
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService,
    private timerService: TimerService,
    private statePersistence: QqcStatePersistenceService,
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // VISIBILITY STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Persists the current FET display state when the page goes hidden.
   * Called on `visibilityState === 'hidden'`.
   */
  persistStateOnHide(params: {
    quizId: string;
    currentQuestionIndex: number;
    displayExplanation: boolean;
  }): void {
    const { quizId, currentQuestionIndex: idx, displayExplanation } = params;

    try {
      const qState = this.quizStateService.getQuestionState(quizId, idx)
        || this.quizStateService.createDefaultQuestionState();

      this.quizStateService.setQuestionState(quizId, idx, {
        isAnswered: qState.isAnswered ?? false,
        selectedOptions: qState.selectedOptions ?? [],
        isCorrect: qState.isCorrect,
        numberOfCorrectAnswers: qState.numberOfCorrectAnswers,
        explanationDisplayed: displayExplanation,
        explanationText: this.explanationTextService.latestExplanation ?? ''
      });

      console.log(
        `[VISIBILITY] 💾 Saved FET display state for Q${idx + 1}:`,
        displayExplanation
      );
    } catch (err) {
      console.warn('[VISIBILITY] ⚠️ Failed to persist FET state', err);
    }
  }

  /**
   * Resets explanation state before the page goes to the background.
   * Prevents stale FET from replaying on restore.
   */
  resetExplanationStateOnHide(): void {
    try {
      const ets = this.explanationTextService;
      ets.setShouldDisplayExplanation(false);
      ets.setIsExplanationTextDisplayed(false);
      ets.updateFormattedExplanation('');
      ets._activeIndex = -1;
      ets.latestExplanation = '';
      console.log('[VISIBILITY] 💤 Cleared FET cache before backgrounding');
    } catch (err) {
      console.warn('[VISIBILITY] ⚠️ Failed to reset FET cache before sleep', err);
    }
  }

  /**
   * Captures the elapsed timer value when the page goes hidden.
   */
  async captureElapsedOnHide(): Promise<void> {
    try {
      const snap = await firstValueFrom<number>(
        this.timerService.elapsedTime$.pipe(take(1))
      );
      this._elapsedAtHide = snap;
    } catch {
      this._elapsedAtHide = null;
    }

    this._hiddenAt = performance.now();
    this._wasHidden = true;
  }

  /**
   * Checks if the timer has expired while the page was hidden.
   * Returns the index to expire, or null if no expiration needed.
   */
  async checkFastPathExpiry(params: {
    currentQuestionIndex: number;
    displayExplanation: boolean;
    normalizeIndex: (idx: number) => number;
  }): Promise<{ shouldExpire: boolean; expiredIndex: number }> {
    const { currentQuestionIndex, displayExplanation, normalizeIndex } = params;

    try {
      const duration = this.timerService.timePerQuestion ?? 30;

      const elapsedLive = await firstValueFrom<number>(
        this.timerService.elapsedTime$.pipe(take(1))
      );

      let candidate = elapsedLive;
      if (this._hiddenAt != null && this._elapsedAtHide != null) {
        const hiddenDeltaSec = Math.floor((performance.now() - this._hiddenAt) / 1000);
        candidate = this._elapsedAtHide + hiddenDeltaSec;
      }

      if (candidate >= duration) {
        const i0 = normalizeIndex(currentQuestionIndex ?? 0);

        const alreadyShowing =
          displayExplanation ||
          (await firstValueFrom<boolean>(
            this.explanationTextService.shouldDisplayExplanation$.pipe(take(1))
          ));

        if (!alreadyShowing) {
          this._hiddenAt = null;
          this._elapsedAtHide = null;
          return { shouldExpire: true, expiredIndex: i0 };
        }
      }

      this._hiddenAt = null;
      this._elapsedAtHide = null;
    } catch (err) {
      console.warn('[NavigationHandler] fast-path expiry check failed', err);
    }

    return { shouldExpire: false, expiredIndex: -1 };
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE RESTORATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Restores core quiz state from persistence after a visibility change.
   * Returns the restored state for the component to apply.
   */
  restoreQuizState(params: {
    currentQuestionIndex: number;
    optionsToDisplay: Option[];
  }): {
    explanationText: string;
    displayMode: string;
    parsedOptions: Option[] | null;
    selectedOptions: any[];
    feedbackText: string;
    optionsToDisplay: Option[];
  } {
    try {
      const restored = this.statePersistence.restoreState(params.currentQuestionIndex);

      let optionsToDisplay = params.optionsToDisplay;

      // Restore options
      if (restored.parsedOptions) {
        const storageIndex =
          typeof params.currentQuestionIndex === 'number' && !Number.isNaN(params.currentQuestionIndex)
            ? params.currentQuestionIndex
            : 0;
        optionsToDisplay = this.quizService.assignOptionIds(restored.parsedOptions, storageIndex);
      }

      // Fallback: use last known options if still empty
      if (!optionsToDisplay || optionsToDisplay.length === 0) {
        const lastKnownOptions = this.quizService.getLastKnownOptions();
        if (lastKnownOptions && lastKnownOptions.length > 0) {
          optionsToDisplay = [...lastKnownOptions];
        }
      }

      // Restore selected options
      for (const option of restored.selectedOptions) {
        this.selectedOptionService.setSelectedOption(option);
      }

      // Mark that at least one full restore has occurred
      this.quizStateService.hasRestoredOnce = true;
      console.log('[restoreQuizState] hasRestoredOnce set -> true');

      return {
        explanationText: restored.explanationText,
        displayMode: restored.displayMode,
        parsedOptions: restored.parsedOptions,
        selectedOptions: restored.selectedOptions,
        feedbackText: restored.feedbackText,
        optionsToDisplay,
      };
    } catch (error) {
      console.error('[restoreQuizState] Error restoring quiz state:', error);
      return {
        explanationText: '',
        displayMode: 'question',
        parsedOptions: null,
        selectedOptions: [],
        feedbackText: '',
        optionsToDisplay: params.optionsToDisplay,
      };
    }
  }

  /**
   * Restores the FET display state after visibility change.
   * Returns whether explanation should be displayed.
   */
  restoreFetDisplayState(params: {
    quizId: string;
    currentQuestionIndex: number;
  }): { shouldShowExplanation: boolean; explanationText: string } {
    const { quizId, currentQuestionIndex: qIdx } = params;

    try {
      const qState = this.quizStateService.getQuestionState(quizId, qIdx);
      const shouldShowExplanation =
        qState?.explanationDisplayed === true ||
        (this.explanationTextService as any)?.shouldDisplayExplanation$.value === true;

      if (shouldShowExplanation) {
        this.explanationTextService.setShouldDisplayExplanation(true, { force: true });
        this.explanationTextService.setIsExplanationTextDisplayed(true, { force: true });
        this.explanationTextService.setExplanationText(
          qState?.explanationText ?? this.explanationTextService.latestExplanation ?? '',
          { force: true }
        );

        console.log(`[NavigationHandler] ✅ Restored FET for Q${qIdx + 1}`);
      } else {
        this.explanationTextService.setShouldDisplayExplanation(false, { force: true });
        this.explanationTextService.setIsExplanationTextDisplayed(false, { force: true });
        console.log(`[NavigationHandler] ↩️ Restored question text for Q${qIdx + 1}`);
      }

      return {
        shouldShowExplanation,
        explanationText: qState?.explanationText ?? ''
      };
    } catch (fetErr) {
      console.warn('[NavigationHandler] ⚠️ FET restore failed:', fetErr);
      return { shouldShowExplanation: false, explanationText: '' };
    }
  }

  /**
   * Handles FET purge logic when user navigated to another question while hidden.
   */
  purgeFetIfNavigatedWhileHidden(currentQuestionIndex: number): void {
    if (this._wasHidden && currentQuestionIndex !== this.explanationTextService._activeIndex) {
      console.log(`[Visibility] User navigated while hidden → purging FET for Q${currentQuestionIndex + 1}`);
      this.explanationTextService.purgeAndDefer(currentQuestionIndex);
    } else {
      console.log('[Visibility] Same question — skipping FET clear');
    }

    this._wasHidden = false;
  }

  /**
   * Refreshes explanation state after the restore phase completes.
   */
  refreshExplanationStatePostRestore(currentQuestionIndex: number): void {
    try {
      const ets = this.explanationTextService;
      ets._activeIndex = currentQuestionIndex;
      ets.updateFormattedExplanation('');
      ets.latestExplanation = '';
      ets.setShouldDisplayExplanation(false);
      ets.setIsExplanationTextDisplayed(false);

      console.log(`[VISIBILITY] 🔄 Explanation state refreshed for Q${currentQuestionIndex + 1}`);
    } catch (err) {
      console.warn('[VISIBILITY] ⚠️ Failed post-restore FET refresh', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ROUTE HANDLING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parses a route parameter into a 0-based question index.
   * Returns the clamped, valid index.
   */
  parseRouteIndex(rawParam: string | null, totalQuestions: number): number {
    const parsedParam = Number(rawParam);
    let questionIndex = isNaN(parsedParam) ? 1 : parsedParam;

    if (questionIndex < 1 || questionIndex > totalQuestions) {
      console.warn(`[⚠️ Invalid questionIndex param: ${rawParam}. Defaulting to Q1]`);
      questionIndex = 1;
    }

    return questionIndex - 1; // Convert to 0-based
  }

  /**
   * Handles page visibility state change (pause/resume).
   */
  handlePageVisibilityChange(
    isHidden: boolean,
    callbacks: {
      clearDisplaySubscriptions: () => void;
      prepareAndSetExplanationText: (index: number) => Promise<string>;
      currentQuestionIndex: number;
    }
  ): { isPaused: boolean } {
    if (isHidden) {
      callbacks.clearDisplaySubscriptions();
      return { isPaused: true };
    } else {
      callbacks.prepareAndSetExplanationText(callbacks.currentQuestionIndex);
      return { isPaused: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FAST-PATH EXPIRY (VISIBLE PHASE)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Checks if the timer expired while the page was hidden and handles
   * the fast-path expiry flow. Returns whether the component should
   * short-circuit the rest of the onVisibilityChange handler.
   *
   * The component should call `onTimerExpiredFor(expiredIndex)` if
   * `shouldExpire` is true.
   */
  async handleFastPathExpiry(params: {
    currentQuestionIndex: number;
    displayExplanation: boolean;
    normalizeIndex: (idx: number) => number;
  }): Promise<{ shouldExpire: boolean; expiredIndex: number }> {
    const result = await this.checkFastPathExpiry(params);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL VISIBILITY RESTORE FLOW
  // ═══════════════════════════════════════════════════════════════

  /**
   * Orchestrates the full restore flow when the page becomes visible.
   * This combines purging stale FET, restoring quiz state, and
   * restoring FET display state into a single coordinated call.
   *
   * Returns the restore results for the component to apply to its
   * local state.
   */
  handleVisibilityRestore(params: {
    quizId: string;
    currentQuestionIndex: number;
    optionsToDisplay: any[];
  }): {
    restoredState: {
      explanationText: string;
      displayMode: string;
      parsedOptions: any[] | null;
      selectedOptions: any[];
      feedbackText: string;
      optionsToDisplay: any[];
    };
    fetState: {
      shouldShowExplanation: boolean;
      explanationText: string;
    };
  } {
    const { quizId, currentQuestionIndex, optionsToDisplay } = params;

    // 1. Purge stale FET if user navigated while hidden
    this.purgeFetIfNavigatedWhileHidden(currentQuestionIndex);

    // 2. Restore core quiz state
    const restoredState = this.restoreQuizState({
      currentQuestionIndex,
      optionsToDisplay,
    });

    // 3. Restore FET display state
    const fetState = this.restoreFetDisplayState({
      quizId,
      currentQuestionIndex,
    });

    return { restoredState, fetState };
  }

  // ═══════════════════════════════════════════════════════════════
  // DISPLAY STATE GUARD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Guard wrapper for display state changes.
   * Suppresses any update while restoration lock is active or within the debounce window.
   * Returns true if the update was allowed, false if suppressed.
   */
  guardDisplayStateUpdate(params: {
    state: { mode: 'question' | 'explanation'; answered: boolean };
    visibilityRestoreInProgress: boolean;
    suppressDisplayStateUntil: number;
  }): boolean {
    if (params.visibilityRestoreInProgress || performance.now() < params.suppressDisplayStateUntil) {
      console.log('[safeSetDisplayState] 🚫 Suppressed reactive display update during restore:', params.state);
      return false; // suppressed
    }
    return true; // allowed
  }

  /**
   * Computes the display subscription cleanup state when page becomes hidden.
   * Returns the reset values for explanation display.
   * Extracted from clearDisplaySubscriptions().
   */
  computeDisplaySubscriptionCleanup(): {
    explanationToDisplay: string;
    showExplanation: boolean;
  } {
    return {
      explanationToDisplay: '',
      showExplanation: false,
    };
  }

  /**
   * Determines the action to take when page visibility changes.
   * Returns whether to pause or resume, and triggers explanation refresh if resuming.
   * Extracted from handlePageVisibilityChange().
   */
  computeVisibilityAction(isHidden: boolean): {
    isPaused: boolean;
    shouldClearSubscriptions: boolean;
    shouldRefreshExplanation: boolean;
  } {
    if (isHidden) {
      return {
        isPaused: true,
        shouldClearSubscriptions: true,
        shouldRefreshExplanation: false,
      };
    } else {
      return {
        isPaused: false,
        shouldClearSubscriptions: false,
        shouldRefreshExplanation: true,
      };
    }
  }
}
