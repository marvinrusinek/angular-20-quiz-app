import { computed, inject, Injectable } from '@angular/core';

import { InterviewAttemptHistoryEntry } from '../../../models/interview-history.model';
import {
  InterviewReadiness,
  InterviewReadinessBand,
  InterviewReadinessFactor
} from '../../../models/interview-readiness.model';
import { getQuizData } from '../../../quiz-data-cache';
import { InterviewHistoryService } from './interview-history.service';

// Factor weights — the single source of truth for the readiness formula. Recent
// performance dominates because it is the strongest available signal.
export const READINESS_WEIGHTS: Readonly<Record<InterviewReadinessFactor, number>> = {
  'recent-performance': 0.45,
  consistency: 0.2,
  'topic-coverage': 0.2,
  'topic-strength': 0.15
};

// Only the latest N attempts feed Recent Performance + Consistency.
const RECENT_WINDOW = 5;
// A factor value at/above this reads as a strength; below it, a limitation.
const WEAK_FACTOR = 60;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
const round = (n: number): number => Math.round(n);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Computes the Interview Readiness estimate from retained Interview History.
 * Presentation-free and storage-free: it reuses InterviewHistoryService's
 * validated history (which already includes the just-completed attempt) and the
 * eligible Interview Mode topic list from the quiz-data cache. All scoring lives
 * in the pure helpers below so it is easy to test and tune.
 */
@Injectable({ providedIn: 'root' })
export class InterviewReadinessService {
  private readonly history = inject(InterviewHistoryService);

  /** null when there are no completed interviews (section is hidden). */
  readonly readiness = computed<InterviewReadiness | null>(() =>
    calculateReadiness(this.history.history(), eligibleTopicIds())
  );
}

/** Eligible Interview Mode topic ids = every quiz in the catalogue (Mixed pool).
 *  Returns [] before the cache is populated, which safely disables coverage. */
export function eligibleTopicIds(): string[] {
  return getQuizData()
    .map((q) => q.quizId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

// ── pure factor helpers (exported for tests) ──────────────────────────

/** Factor 1 — average percentage of the latest ≤ 5 attempts (0–100). */
export function calculateRecentPerformance(
  attempts: readonly InterviewAttemptHistoryEntry[]
): number {
  const recent = attempts.slice(-RECENT_WINDOW);
  if (recent.length === 0) return 0;
  return round(clamp100(avg(recent.map((a) => a.percentage))));
}

/** Factor 2 — stability of the latest ≤ 5 scores, safeguarded by performance so
 *  consistently low scores are not rewarded (0–100). */
export function calculateConsistency(
  attempts: readonly InterviewAttemptHistoryEntry[]
): number {
  const recent = attempts.slice(-RECENT_WINDOW);
  if (recent.length < 2) return 0;
  const pcts = recent.map((a) => a.percentage);
  const range = Math.max(...pcts) - Math.min(...pcts);
  const stability = consistencyFromRange(range);
  const recentPerformance = round(clamp100(avg(pcts)));
  return round(clamp100(stability * (recentPerformance / 100)));
}

/** Range (percentage points) → raw stability score. */
export function consistencyFromRange(range: number): number {
  if (range <= 5) return 100;
  if (range <= 10) return 90;
  if (range <= 15) return 75;
  if (range <= 20) return 60;
  if (range <= 30) return 40;
  return 20;
}

/** Factor 3 — breadth of practice: unique practiced topics ÷ eligible topics
 *  (0–100). Returns null when the eligible total is unknown. */
export function calculateTopicCoverage(
  attempts: readonly InterviewAttemptHistoryEntry[],
  eligibleTopicCount: number
): number | null {
  if (!Number.isFinite(eligibleTopicCount) || eligibleTopicCount <= 0) return null;
  const practiced = uniquePracticedTopics(attempts).length;
  return round(clamp100((practiced / eligibleTopicCount) * 100));
}

/** Factor 4 — strength across practiced topics, aggregating raw correct/total
 *  across attempts (never averaging pre-rounded percentages), then averaging the
 *  per-topic percentages (0–100). */
export function calculateTopicStrength(
  attempts: readonly InterviewAttemptHistoryEntry[]
): number {
  const perTopic = aggregateTopicPercentages(attempts);
  if (perTopic.length === 0) return 0;
  return round(clamp100(avg(perTopic.map((t) => t.percentage))));
}

/** Unique practiced topic ids across all retained attempts (deduped). */
export function uniquePracticedTopics(
  attempts: readonly InterviewAttemptHistoryEntry[]
): string[] {
  const set = new Set<string>();
  for (const a of attempts) {
    if (a.topicPerformance.length > 0) {
      for (const t of a.topicPerformance) set.add(t.topicId);
    } else {
      for (const id of a.selectedTopicIds ?? []) set.add(id);
    }
  }
  return [...set];
}

interface AggregatedTopic {
  topicId: string;
  topicName: string;
  correct: number;
  total: number;
  percentage: number;   // raw: correct/total across ALL attempts
}

/** Aggregate topicPerformance history by topic (raw correct/total sums). */
export function aggregateTopicPercentages(
  attempts: readonly InterviewAttemptHistoryEntry[]
): AggregatedTopic[] {
  const map = new Map<string, { topicName: string; correct: number; total: number }>();
  for (const a of attempts) {
    for (const t of a.topicPerformance) {
      if (!(t.total > 0)) continue;   // skip empty/invalid topic samples
      const cur = map.get(t.topicId) ?? { topicName: t.topicName, correct: 0, total: 0 };
      cur.correct += t.correct;
      cur.total += t.total;
      cur.topicName = t.topicName || cur.topicName;
      map.set(t.topicId, cur);
    }
  }
  return [...map.entries()].map(([topicId, v]) => ({
    topicId,
    topicName: v.topicName,
    correct: v.correct,
    total: v.total,
    percentage: v.total > 0 ? (v.correct / v.total) * 100 : 0
  }));
}

/** Score → band. */
export function getReadinessBand(score: number): InterviewReadinessBand {
  if (score >= 90) return 'interview-ready';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'progressing';
  if (score >= 40) return 'developing';
  return 'early-preparation';
}

/**
 * Full readiness estimate. null when there are no attempts (hide the section);
 * a 'insufficient' result for exactly one attempt (limited-data message); a
 * calculated 'ready' result for two or more.
 */
export function calculateReadiness(
  attempts: readonly InterviewAttemptHistoryEntry[],
  eligibleTopicIdList: readonly string[]
): InterviewReadiness | null {
  const totalAttempts = attempts.length;
  if (totalAttempts === 0) return null;

  const attemptsUsed = Math.min(totalAttempts, RECENT_WINDOW);
  const recentPerformance = calculateRecentPerformance(attempts);
  const eligibleTopicCount = eligibleTopicIdList.length;
  const practicedTopicCount = uniquePracticedTopics(attempts).length;

  if (totalAttempts < 2) {
    // One completed interview — recorded, but not enough for an authoritative score.
    return {
      status: 'insufficient',
      score: 0,
      band: 'early-preparation',
      recentPerformance,
      consistency: 0,
      topicCoverage: 0,
      topicStrength: calculateTopicStrength(attempts),
      coverageAvailable: eligibleTopicCount > 0,
      practicedTopicCount,
      eligibleTopicCount,
      strongestFactor: 'recent-performance',
      limitingFactor: 'recent-performance',
      explanation: '',
      recommendations: [],
      attemptsUsed,
      totalAttempts
    };
  }

  const consistency = calculateConsistency(attempts);
  const topicStrength = calculateTopicStrength(attempts);
  const coverage = calculateTopicCoverage(attempts, eligibleTopicCount);
  const coverageAvailable = coverage !== null;
  const topicCoverage = coverage ?? 0;

  // Weighted score. If coverage is unavailable, renormalise across the other
  // three weights so the total still spans 0–100.
  const w = READINESS_WEIGHTS;
  const raw = coverageAvailable
    ? recentPerformance * w['recent-performance'] +
      consistency * w.consistency +
      topicCoverage * w['topic-coverage'] +
      topicStrength * w['topic-strength']
    : (recentPerformance * w['recent-performance'] +
        consistency * w.consistency +
        topicStrength * w['topic-strength']) /
      (w['recent-performance'] + w.consistency + w['topic-strength']);
  const score = round(clamp100(raw));
  const band = getReadinessBand(score);

  // Strongest / limiting among the AVAILABLE factors (raw values, deterministic).
  const factorScores: { key: InterviewReadinessFactor; value: number }[] = [
    { key: 'recent-performance', value: recentPerformance },
    { key: 'consistency', value: consistency },
    ...(coverageAvailable ? [{ key: 'topic-coverage' as const, value: topicCoverage }] : []),
    { key: 'topic-strength', value: topicStrength }
  ];
  const strongestFactor = factorScores.reduce((a, b) => (b.value > a.value ? b : a)).key;
  const limitingFactor = factorScores.reduce((a, b) => (b.value < a.value ? b : a)).key;

  const explanation = buildExplanation(strongestFactor, limitingFactor, band);
  const recommendations = buildRecommendations(attempts, {
    topicCoverage,
    coverageAvailable,
    recentPerformance,
    consistency
  });

  return {
    status: 'ready',
    score,
    band,
    recentPerformance,
    consistency,
    topicCoverage,
    topicStrength,
    coverageAvailable,
    practicedTopicCount,
    eligibleTopicCount,
    strongestFactor,
    limitingFactor,
    explanation,
    recommendations,
    attemptsUsed,
    totalAttempts
  };
}

// ── explanation + recommendations (factual, concise) ──────────────────

const STRONG_PHRASE: Record<InterviewReadinessFactor, string> = {
  'recent-performance': 'Your recent interview scores are strong.',
  consistency: 'Your recent scores are consistent.',
  'topic-coverage': 'You have practiced a broad range of Angular topics.',
  'topic-strength': 'You perform well across the topics you have practiced.'
};

const LIMITING_PHRASE: Record<InterviewReadinessFactor, string> = {
  'recent-performance':
    'Recent interview scores are currently limiting your readiness. Higher scores on upcoming interviews will improve it.',
  consistency:
    'Your scores vary between interviews. More consistent results will improve your readiness.',
  'topic-coverage':
    'Topic coverage is currently limiting your readiness. Practice a broader range of Angular topics to improve it.',
  'topic-strength':
    'Some practiced topics are weak. Reviewing them will improve your readiness.'
};

const READY_CAVEAT =
  ' This score is an estimate based on your app performance — keep reviewing weaker topics before a real interview.';

export function buildExplanation(
  strongest: InterviewReadinessFactor,
  limiting: InterviewReadinessFactor,
  band: InterviewReadinessBand
): string {
  const parts = [STRONG_PHRASE[strongest]];
  if (limiting !== strongest) parts.push(LIMITING_PHRASE[limiting]);
  let text = parts.join(' ');
  if (band === 'interview-ready') text += READY_CAVEAT;
  return text;
}

/** At most two recommendations, in priority order. */
export function buildRecommendations(
  attempts: readonly InterviewAttemptHistoryEntry[],
  ctx: {
    topicCoverage: number;
    coverageAvailable: boolean;
    recentPerformance: number;
    consistency: number;
  }
): string[] {
  const recs: string[] = [];

  // 1. Weakest practiced topics.
  const weak = aggregateTopicPercentages(attempts)
    .filter((t) => t.percentage < WEAK_FACTOR)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 2)
    .map((t) => t.topicName);
  if (weak.length > 0) {
    recs.push(`Review ${joinTopics(weak)}.`);
  }

  // 2. Low topic coverage.
  if (recs.length < 2 && ctx.coverageAvailable && ctx.topicCoverage < WEAK_FACTOR) {
    recs.push('Complete interviews covering additional Angular topics to broaden your coverage.');
  }

  // 3. Low recent performance.
  if (recs.length < 2 && ctx.recentPerformance < WEAK_FACTOR) {
    recs.push('Aim for higher scores on your next interviews.');
  }

  // 4. Inconsistent results.
  if (recs.length < 2 && ctx.consistency < WEAK_FACTOR) {
    recs.push('Work toward more consistent interview scores across attempts.');
  }

  return recs.slice(0, 2);
}

function joinTopics(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
