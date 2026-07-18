/**
 * Session-only integrity state for Interview/Assessment Mode. A browser-based
 * DETERRENT only — it cannot prevent opening another window/device/connection.
 * Persisted to sessionStorage (its own key) so a refresh/resume keeps the count;
 * NEVER mixed into topic-quiz progress, achievements, scores, or high scores.
 */
export interface AssessmentIntegrityState {
  /** Number of confirmed focus-loss episodes this assessment session. */
  focusLossCount: number;
  /** Epoch ms of the most recent focus-loss (optional; for status/debug). */
  lastFocusLossAt?: number;
  /** True when a warning should be shown to the user on their return. */
  warningPending: boolean;
}
