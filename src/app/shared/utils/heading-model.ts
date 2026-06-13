/**
 * Single-source heading-derivation model (Stage 1 of the heading/FET state-model
 * refactor — see E6_FET_STATE_MACHINE_DESIGN.md §7).
 *
 * The `<h3 #qText>` heading is currently produced by 5+ competing imperative
 * writers (writeQText/qTextHtmlSig, questionHeadingService.setHtml,
 * computeIntendedQText, the timer-expiry DOM write, the MutationObserver
 * watchdog) plus a chain of gates in cqc-fet-guard. This pure function is the
 * intended REPLACEMENT decision: given the resolved state for a question,
 * return the heading HTML — question(+banner) or the FET.
 *
 * It is intentionally UNUSED for now. Stage 2 runs it in shadow mode (compute +
 * compare against the live heading, dev-log mismatches) to validate it matches
 * the current behavior across every scenario BEFORE anything is switched over.
 * Keep it PURE (no services, no DOM, no signals) so it stays trivially testable.
 */

export interface HeadingInputs {
  /** Question text already with the multi-answer banner attached when applicable
   *  (i.e. what should show while NOT displaying the FET). */
  questionHtml: string;
  /** Formatted explanation text (FET) for this question, or '' if not available. */
  fetHtml: string;
  /** Pristine: does this question have >1 correct option? */
  isMultiAnswer: boolean;
  /** Multi-answer completed — every pristine-correct option selected
   *  (a.k.a. _multiAnswerPerfect / fetBypass for this index). */
  isMultiAnswerComplete: boolean;
  /** Single-answer answered correctly (the pristine-correct option selected). */
  isSingleAnswered: boolean;
  /** The per-question countdown expired for this question. */
  isTimedOut: boolean;
  /** A real in-session interaction happened for this question. */
  hasInteracted: boolean;
}

/**
 * Decide whether the heading should show the FET (vs the question + banner).
 *
 * Rules distilled from this codebase's behavior (resolveDisplayText /
 * computeIntendedQText / the multi-answer heading rule):
 *  - A timeout always reveals the FET (no interaction required).
 *  - Otherwise the FET shows only after a real interaction AND the question is
 *    "done": multi-answer fully selected, or single-answer answered correctly.
 *  - In-progress / unanswered multi-answer keeps the question + banner.
 */
export function shouldShowFet(i: HeadingInputs): boolean {
  if (i.isTimedOut) {
    return true;
  }
  if (!i.hasInteracted) {
    return false;
  }
  if (i.isMultiAnswer) {
    return i.isMultiAnswerComplete;
  }
  return i.isSingleAnswered;
}

/** The single source of truth for the heading HTML. Falls back to the question
 *  HTML whenever the FET should show but no FET text is available. */
export function deriveHeadingHtml(i: HeadingInputs): string {
  return shouldShowFet(i) && i.fetHtml.trim().length > 0 ? i.fetHtml : i.questionHtml;
}
