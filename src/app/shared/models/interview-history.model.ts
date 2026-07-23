/**
 * Interview Mode performance history — the durable, versioned analytics data
 * behind the Performance Trends chart. Compact by design: it stores per-attempt
 * SCORES and per-topic tallies only, NEVER the full questions, options,
 * explanations or review payload. Kept fully separate from topic-quiz progress /
 * best-score / achievement stores (its own SK_INTERVIEW_HISTORY key).
 */

/** Retention window: only the latest N completed attempts are kept. */
export const INTERVIEW_HISTORY_MAX = 20;

/** Storage schema version. Bump only on a breaking shape change. */
export const INTERVIEW_HISTORY_VERSION = 1 as const;

/** How a completed interview reached its final state. */
export type InterviewCompletionReason = 'submitted' | 'time-expired';

/** Per-topic tally within a retained attempt (mirrors the Topic Performance
 *  analytics output, minus the derived colour band). */
export interface InterviewTopicHistoryEntry {
  topicId: string;
  topicName: string;
  correct: number;
  total: number;
  percentage: number;    // 0–100
}

/** One completed Interview Mode attempt. */
export interface InterviewAttemptHistoryEntry {
  id: string;                    // stable, unique per attempt (dedup anchor)
  completedAt: string;           // ISO 8601 timestamp
  score: number;                 // correct count
  totalQuestions: number;
  percentage: number;            // 0–100 (normalised so counts stay comparable)
  completionReason: InterviewCompletionReason;
  durationSeconds?: number;
  configuredDifficulty?: string;
  selectedTopicIds: string[];
  topicPerformance: InterviewTopicHistoryEntry[];
}

/** The persisted store shape. */
export interface InterviewAttemptHistoryStore {
  version: typeof INTERVIEW_HISTORY_VERSION;
  attempts: InterviewAttemptHistoryEntry[];
}

// ── Derived (UI) trend shapes ─────────────────────────────────────────

/** One plotted point on the score trend, chronological. */
export interface InterviewTrendPoint {
  id: string;
  index: number;                 // 1-based position within the retained window
  completedAt: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  completionReason: InterviewCompletionReason;
  isLatest: boolean;
}

/** Direction of the latest change; drives the (theme-aware, non-colour-only)
 *  interpretation message. 'none' = not enough attempts to make any claim. */
export type InterviewTrendDirection = 'improving' | 'steady' | 'declining' | 'none';

/** Everything the Performance Trends UI needs — derived purely from the retained
 *  attempts, so the Results component stays presentation-only. */
export interface InterviewTrends {
  points: InterviewTrendPoint[];   // chronological (oldest → latest)
  count: number;
  latest: number | null;           // latest attempt %
  best: number | null;             // highest retained %
  average: number | null;          // arithmetic mean of retained %, rounded
  change: number | null;           // latest − previous, in percentage points (null if <2)
  direction: InterviewTrendDirection;
  interpretation: string;          // canonical (English) message; '' when direction === 'none'
  isPersonalBest: boolean;         // latest STRICTLY exceeds every previous attempt (needs ≥2, no ties)
}
