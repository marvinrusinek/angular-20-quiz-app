import { Injectable, inject } from '@angular/core';

import { QUESTION_ROUTE_REGEX } from '../../../constants/route-patterns';
import { SK_SEL_Q } from '../../../constants/session-keys';

import { Option } from '../../../models/Option.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';

import { QuizDotStatusService } from '../../flow/quiz-dot-status.service';

import type { CodelabQuizContentComponent } from '../../../../containers/quiz/quiz-content/codelab-quiz-content.component';
import { withCorrectCountBanner } from '../../../utils/correct-count-banner';
import { isOptionCorrect } from '../../../utils/is-option-correct';
import { norm } from '../../../utils/text-norm';

type Host = CodelabQuizContentComponent;

/**
 * FET (Formatted Explanation Text) gating logic extracted from CqcOrchestratorService.
 *
 * Responsible for:
 * - writeQText: the central DOM-write method with layered FET gates
 * - buildQuestionDisplayHTML: builds question text with multi-answer banner
 * - isScoredCorrectAtDisplay: checks scoring correctness for a display index
 * - hasInteractionEvidence: checks if user has clicked on a question
 * - isQuestionResolvedFromStorage: checks if all correct answers are selected
 */
@Injectable({ providedIn: 'root' })
export class CqcFetGuardService {
  // ── injects ─────────────────────────────────────────────────────
  private dotStatusService = inject(QuizDotStatusService);

  /**
   * Durable "this question's timer expired" check — survives navigation (unlike
   * the transient timedOutIdxSubject), so the heading re-asserts the FET on
   * revisit for any timed-out question.
   */
  isDurablyTimedOut(idx: number): boolean {
    return this.dotStatusService?.timedOutFetForced?.has(idx) === true;
  }

  /**
   * Write HTML to qText. Updates the host signal (which the template is
   * bound to via [innerHTML]) AND the imperative Renderer2 mirror AND the
   * _lastDisplayedText cache. The signal is the durable source of truth
   * for Angular's change detection — writing it means visibility flips
   * and async restores can't leave the heading blank, because CD will
   * keep re-stamping from the signal on every pass. The Renderer2 write
   * remains for immediate synchronous DOM visibility inside the same
   * microtask (before CD has had a chance to run).
   */
  writeQText(_host: Host, _html: string): void {
    // No-op (Phase 3 Step 2): the heading is rendered solely by the single-source
    // `headingHtml` computed. writeQText only ever set htmlSig (now unread for the
    // DOM since Step 0) plus the _lastDisplayedText cache (read only by other
    // now-dead heading writers). The 6-stage gate chain it ran is therefore dead;
    // this shim neuters it while the chain + its 12 callers are deleted in the
    // following steps.
  }

  /**
   * Build the question display HTML for a given index. Shuffled-aware —
   * reads from host.quizService.shuffledQuestions when shuffle is on,
   * otherwise host.quizService.questions. Adds the "select N" banner
   * for multi-answer questions.
   */
  buildQuestionDisplayHTML(host: Host, idx: number): string {
    try {
      const isShuffled = host.quizService.isShuffleEnabled?.()
        && Array.isArray(host.quizService.shuffledQuestions)
        && host.quizService.shuffledQuestions.length > 0;
      const q = isShuffled
        ? host.quizService.shuffledQuestions[idx]
        : host.quizService.questions?.[idx];
      const rawQ = (q?.questionText ?? '').trim();
      if (!rawQ) return '';
      let numCorrect = 0;
      let totalOpts = (q?.options ?? []).length;
      try {
        const pq = host.quizService?.getPristineQuestionByText(rawQ);
        if (pq) {
          const pOpts = pq.options ?? [];
          numCorrect = pOpts.filter((o: any) => isOptionCorrect(o)).length;
          totalOpts = pOpts.length;
        }
      } catch { /* ignore */ }
      if (numCorrect === 0) {
        const sourceOpts = q?.options ?? [];
        numCorrect = sourceOpts.filter((o: Option) => isOptionCorrect(o)).length;
        totalOpts = sourceOpts.length;
      }
      let display = rawQ;
      if (numCorrect > 1 && totalOpts > 0) {
        try {
          const banner = host.quizQuestionManagerService.getNumberOfCorrectAnswersText(
            numCorrect, totalOpts
          );
          display = withCorrectCountBanner(rawQ, banner);
        } catch { /* ignore */ }
      }
      return display;
    } catch {
      return '';
    }
  }

  /**
   * Check if the question at the given DISPLAY index is scored correct.
   */
  isScoredCorrectAtDisplay(host: Host, displayIdx: number): boolean {
    try {
      const qs: any = host.quizService;
      const scoringSvc = qs?.scoringService;
      if (!scoringSvc?.questionCorrectness) return false;
      const isShuf = qs?.isShuffleEnabled?.() && qs?.shuffledQuestions?.length > 0;
      if (isShuf) {
        let effectiveQuizId = qs?.quizId || '';
        if (!effectiveQuizId) {
          try { effectiveQuizId = localStorage.getItem('lastQuizId') || ''; } catch { /* ignore */ }
        }
        if (!effectiveQuizId) {
          try {
            const shuffleKeys = Object.keys(localStorage).filter((k: string) => k.startsWith('shuffleState:'));
            if (shuffleKeys.length > 0) {
              effectiveQuizId = shuffleKeys[0].replace('shuffleState:', '');
            }
          } catch { /* ignore */ }
        }
        if (effectiveQuizId) {
          const origIdx = scoringSvc.quizShuffleService?.toOriginalIndex?.(effectiveQuizId, displayIdx);
          if (typeof origIdx === 'number' && origIdx >= 0) {
            if (scoringSvc.questionCorrectness.get(origIdx) === true) return true;
          }
        }
      } else {
        if (scoringSvc.questionCorrectness.get(displayIdx) === true) return true;
      }
      return host.explanationTextService?.fetBypassForQuestion?.get(displayIdx) === true;
    } catch {
      return false;
    }
  }

  /**
   * Does this index have concrete evidence that FET should be showing?
   */
  hasInteractionEvidence(host: Host, idx: number): boolean {
    try {
      // Treat a timer-expired-without-answer question as interaction evidence —
      // when the timer auto-resolves a question the FET must show, and must
      // persist across tab visibility cycles. Without this, the visibility
      // restamp computes the question text instead of the FET and overwrites
      // the heading on tab return.
      if (this.dotStatusService.timerExpiredUnanswered?.has(idx)) return true;
      // SOC-set bypass flags are definitive interaction evidence — SOC only
      // sets them after verifying user-clicked selections satisfy the
      // question. Without this, a click→FET race in shuffled mode can leave
      // hasClickedInSession unset at the moment displayText$ emits the FET,
      // causing gates here to block the FET write.
      if (host.explanationTextService?.fetBypassForQuestion?.get(idx) === true) return true;
      if (host.quizService?._multiAnswerPerfect?.get(idx) === true) return true;
      return !!host.quizStateService.hasClickedInSession?.(idx);
    } catch {
      return false;
    }
  }

  /**
   * Check if the question at idx is fully resolved (all correct answers
   * selected) based on persisted sessionStorage / in-memory state.
   */
  isQuestionResolvedFromStorage(host: Host, idx: number): boolean {
    try {
      // Timer-expired-without-answer questions auto-resolve to FET — treat them
      // as resolved so the FET branch of computeIntendedQText fires on visibility
      // restamps. Otherwise tabbing away/back overwrites FET with question text.
      if (this.dotStatusService.timerExpiredUnanswered?.has(idx)) return true;
      if (this.isScoredCorrectAtDisplay(host, idx)) return true;

      let storedSelections: any[] = [];
      try {
        const raw = sessionStorage.getItem(SK_SEL_Q + idx);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) storedSelections = parsed;
        }
      } catch { /* ignore */ }
      if (storedSelections.length === 0) {
        storedSelections =
          host.selectedOptionService.getSelectedOptionsForQuestion?.(idx) ?? [];
      }
      storedSelections = storedSelections.filter((s: any) => s?.selected !== false);
      if (storedSelections.length > 0) {
        const questions = host.quizService.getQuestionsInDisplayOrder?.()
          ?? host.quizService.questions;
        const q = questions?.[idx];
        if (q) {
          const pristineCorrectTexts = Array.from(
            host.quizService?.getPristineCorrectTextsForQuestion(q?.questionText) ?? []
          );
          if (pristineCorrectTexts.length >= 2) {
            const selTexts = new Set(
              storedSelections
                .filter((s: any) => s?.selected !== false)
                .map((s: any) => norm(s?.text))
                .filter((t: string) => !!t)
            );
            return pristineCorrectTexts.every(t => selTexts.has(t));
          }
          return host.selectedOptionService.isQuestionResolvedLeniently?.(q, storedSelections)
            ?? false;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

}
