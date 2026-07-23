import { computed, inject, Injectable, signal } from '@angular/core';

import { InterviewResult } from '../../../models/InterviewResult.model';
import {
  INTERVIEW_HISTORY_MAX,
  INTERVIEW_HISTORY_VERSION,
  InterviewAttemptHistoryEntry,
  InterviewAttemptHistoryStore,
  InterviewCompletionReason,
  InterviewTopicHistoryEntry,
  InterviewTrendDirection,
  InterviewTrendPoint,
  InterviewTrends
} from '../../../models/interview-history.model';
import { SK_INTERVIEW_HISTORY } from '../../../constants/session-keys';
import { readLocalJson, removeLocalKey, writeLocalJson } from '../../../utils/local-storage';

import { InterviewAnalyticsService } from './interview-analytics.service';

// A change of ±5 percentage points is the threshold for a directional claim; the
// dead band between is "holding steady". Kept factual — never exaggerated.
const TREND_THRESHOLD = 5;

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampPct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Owns Interview Mode performance history end-to-end: reading + validating the
 * persisted store, adding a completed attempt exactly once, enforcing the
 * latest-20 retention window, and exposing the history + derived trends as
 * signals. Storage and trend math live here so the Results component stays
 * presentation-only. Topic Performance is NOT recomputed — it reuses
 * InterviewAnalyticsService's output.
 *
 * Kept entirely separate from topic-quiz progress/best-score/achievement stores.
 */
@Injectable({ providedIn: 'root' })
export class InterviewHistoryService {
  private readonly analytics = inject(InterviewAnalyticsService);

  private readonly _history = signal<InterviewAttemptHistoryEntry[]>(this.load());

  /** Retained attempts, chronological (oldest → latest). */
  readonly history = this._history.asReadonly();

  /** Everything the Performance Trends UI needs, derived from `history`. */
  readonly trends = computed<InterviewTrends>(() => summarizeTrends(this._history()));

  // Dedup anchor: the exact result object last recorded. A finalized interview
  // produces one result object; recording it a second time (e.g. a stray
  // re-invocation) is a no-op, while two genuinely-distinct interviews always
  // yield distinct objects and are both saved.
  private lastRecorded: InterviewResult | null = null;
  private seq = 0;

  /**
   * Persist a completed interview. Call this ONCE, at the submission chokepoint
   * (InterviewSessionService.submit), which is already idempotent — so a manual
   * submit racing a timer-expiry submit yields one record. Safe to call with a
   * null/undefined result (no-op) and re-entrant on the same result object.
   */
  record(result: InterviewResult | null | undefined): void {
    if (!result) return;
    if (result === this.lastRecorded) return;   // already recorded this attempt
    this.lastRecorded = result;

    const entry = this.toEntry(result);
    // Append + keep only the latest N (drops the oldest, preserves order).
    const attempts = [...this._history(), entry].slice(-INTERVIEW_HISTORY_MAX);
    this._history.set(attempts);
    this.save(attempts);
  }

  /**
   * Clear all Interview Mode history. Exposed for a future global "clear all
   * progress" action — it is NOT wired to any destructive UI here, and is never
   * triggered by a refresh, a new interview, returning to the builder, or
   * clearing the active session.
   */
  clear(): void {
    this.lastRecorded = null;
    this._history.set([]);
    removeLocalKey(SK_INTERVIEW_HISTORY);
  }

  // ── internals ───────────────────────────────────────────────────
  private toEntry(result: InterviewResult): InterviewAttemptHistoryEntry {
    // Reuse Topic Performance analytics rather than re-deriving topic tallies.
    const topicPerformance: InterviewTopicHistoryEntry[] = this.analytics
      .analyze(result)
      .topics.map((t) => ({
        topicId: t.topicId,
        topicName: t.topicName,
        correct: t.correct,
        total: t.total,
        percentage: t.percentage
      }));

    return {
      id: this.nextId(),
      completedAt: new Date().toISOString(),
      score: result.correct,
      totalQuestions: result.total,
      percentage: clampPct(result.percentage),
      completionReason: result.submittedByExpiry ? 'time-expired' : 'submitted',
      durationSeconds: result.timeUsedSeconds,
      configuredDifficulty: result.difficulty,
      selectedTopicIds: [...(result.topicIds ?? [])],
      topicPerformance
    };
  }

  private nextId(): string {
    this.seq += 1;
    // Timestamp + monotonic sequence → unique even for back-to-back saves.
    return `att_${Date.now().toString(36)}_${this.seq}`;
  }

  private load(): InterviewAttemptHistoryEntry[] {
    // readLocalJson already returns null on missing/invalid JSON; validation
    // then rejects unsupported versions / malformed entries.
    return validateHistoryStore(readLocalJson<unknown>(SK_INTERVIEW_HISTORY, null));
  }

  private save(attempts: InterviewAttemptHistoryEntry[]): void {
    const store: InterviewAttemptHistoryStore = {
      version: INTERVIEW_HISTORY_VERSION,
      attempts
    };
    writeLocalJson(SK_INTERVIEW_HISTORY, store);
  }
}

// ── pure helpers (exported for tests) ─────────────────────────────────

/**
 * Validate an untrusted persisted store into a clean attempts array. Returns []
 * on anything malformed — wrong version, non-array attempts, invalid JSON
 * (already collapsed to null upstream) — and drops individual bad entries rather
 * than discarding the whole history. Never throws.
 */
export function validateHistoryStore(raw: unknown): InterviewAttemptHistoryEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const store = raw as Partial<InterviewAttemptHistoryStore>;
  if (store.version !== INTERVIEW_HISTORY_VERSION) return [];
  if (!Array.isArray(store.attempts)) return [];

  const clean = store.attempts
    .map(validateAttemptEntry)
    .filter((e): e is InterviewAttemptHistoryEntry => e !== null);

  // Defensive: honour the retention window even if the stored file was longer.
  return clean.slice(-INTERVIEW_HISTORY_MAX);
}

/** Validate a single attempt entry; returns a normalised copy or null. */
export function validateAttemptEntry(raw: unknown): InterviewAttemptHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;

  if (typeof e['id'] !== 'string' || e['id'].length === 0) return null;
  if (typeof e['completedAt'] !== 'string' || e['completedAt'].length === 0) return null;
  if (!isFiniteNum(e['score']) || e['score'] < 0) return null;
  if (!isFiniteNum(e['totalQuestions']) || e['totalQuestions'] <= 0) return null;
  if (!isFiniteNum(e['percentage'])) return null;

  const reason: InterviewCompletionReason =
    e['completionReason'] === 'time-expired' ? 'time-expired' : 'submitted';

  const selectedTopicIds = Array.isArray(e['selectedTopicIds'])
    ? e['selectedTopicIds'].filter((t): t is string => typeof t === 'string')
    : [];

  const topicPerformance = Array.isArray(e['topicPerformance'])
    ? e['topicPerformance']
        .map(validateTopicEntry)
        .filter((t): t is InterviewTopicHistoryEntry => t !== null)
    : [];

  return {
    id: e['id'],
    completedAt: e['completedAt'],
    score: Math.round(e['score']),
    totalQuestions: Math.round(e['totalQuestions']),
    percentage: clampPct(e['percentage']),   // clamp impossible percentages
    completionReason: reason,
    durationSeconds: isFiniteNum(e['durationSeconds']) ? e['durationSeconds'] : undefined,
    configuredDifficulty:
      typeof e['configuredDifficulty'] === 'string' ? e['configuredDifficulty'] : undefined,
    selectedTopicIds,
    topicPerformance
  };
}

function validateTopicEntry(raw: unknown): InterviewTopicHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t['topicId'] !== 'string' || t['topicId'].length === 0) return null;
  if (!isFiniteNum(t['correct']) || !isFiniteNum(t['total']) || !isFiniteNum(t['percentage'])) {
    return null;
  }
  return {
    topicId: t['topicId'],
    topicName: typeof t['topicName'] === 'string' ? t['topicName'] : t['topicId'],
    correct: Math.round(t['correct']),
    total: Math.round(t['total']),
    percentage: clampPct(t['percentage'])
  };
}

/**
 * Derive the trend summary from retained attempts (chronological in → out).
 * Pure: latest/best/average/change + an encouraging, factual interpretation.
 * Makes NO directional claim with fewer than two attempts.
 */
export function summarizeTrends(
  attempts: readonly InterviewAttemptHistoryEntry[]
): InterviewTrends {
  const n = attempts.length;
  const points: InterviewTrendPoint[] = attempts.map((a, i) => ({
    id: a.id,
    index: i + 1,
    completedAt: a.completedAt,
    score: a.score,
    totalQuestions: a.totalQuestions,
    percentage: a.percentage,
    completionReason: a.completionReason,
    isLatest: i === n - 1
  }));

  if (n === 0) {
    return {
      points, count: 0, latest: null, best: null, average: null,
      change: null, direction: 'none', interpretation: '', isPersonalBest: false
    };
  }

  const pcts = attempts.map((a) => a.percentage);
  const latest = pcts[n - 1];
  const best = Math.max(...pcts);
  const average = Math.round(pcts.reduce((s, p) => s + p, 0) / n);
  const change = n >= 2 ? latest - pcts[n - 2] : null;

  // New personal best: the latest attempt STRICTLY beats every previous one.
  // Requires ≥ 2 attempts (a first attempt is never a "best" to celebrate) and
  // excludes ties — matching a prior best doesn't earn the badge.
  const isPersonalBest = n >= 2 && latest > Math.max(...pcts.slice(0, n - 1));

  let direction: InterviewTrendDirection = 'none';
  let interpretation = '';
  if (change !== null) {
    if (change >= TREND_THRESHOLD) {
      direction = 'improving';
      interpretation = 'Your interview performance is improving.';
    } else if (change <= -TREND_THRESHOLD) {
      direction = 'declining';
      interpretation = 'Your latest score was lower. Review the topics that need attention and try again.';
    } else {
      direction = 'steady';
      interpretation = 'Your recent performance is holding steady.';
    }
  }

  return { points, count: n, latest, best, average, change, direction, interpretation, isPersonalBest };
}
