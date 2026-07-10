import { Injectable } from '@angular/core';

import { Quiz } from '../../models/Quiz.model';
import {
  AchievementDefinition,
  AchievementId,
  EarnedAchievement
} from '../../models/achievement.model';
import { ACHIEVEMENT_DEFINITIONS } from '../../constants/achievements';
import { SK_QUIZ_ACHIEVEMENTS, SK_QUIZ_BEST_SCORES } from '../../constants/session-keys';
import { readLocalJson, writeLocalJson } from '../../utils/local-storage';

/** quizId -> best score (0-100). A key's presence means the quiz was completed. */
type BestScores = Record<string, number>;

/**
 * Centralized, backend-free achievement engine. It owns the ONLY durable state
 * this feature adds:
 *   - best score per quiz (quizBestScores)  — key presence = completed
 *   - earned achievements (quizAchievements) — id + ISO earnedAt
 *
 * All achievement rules live here (not scattered across components). Evaluation
 * is idempotent: re-running with the same data earns nothing new.
 */
@Injectable({ providedIn: 'root' })
export class AchievementService {
  readonly definitions: readonly AchievementDefinition[] = ACHIEVEMENT_DEFINITIONS;

  /**
   * Record a completed quiz's score, keeping the BEST per quiz. A later, lower
   * attempt never lowers a previously stored higher score.
   */
  recordQuizResult(quizId: string, scorePercent: number): void {
    if (!quizId) return;
    const score = this.clampPercent(scorePercent);
    const best = this.readBestScores();
    const previous = best[quizId];
    best[quizId] = previous == null ? score : Math.max(previous, score);
    writeLocalJson(SK_QUIZ_BEST_SCORES, best);
  }

  /**
   * Evaluate all achievements against current quiz metadata + persisted best
   * scores. Persists any newly earned achievement and returns ONLY the ones
   * earned by THIS evaluation (so a repeat call returns []).
   */
  evaluate(quizzes: Quiz[]): AchievementDefinition[] {
    this.seedFromLegacyIfEmpty();

    const best = this.readBestScores();
    const earned = this.readEarned();
    const earnedIds = new Set<AchievementId>(earned.map(e => e.id));

    const newly: AchievementDefinition[] = [];
    for (const def of this.definitions) {
      if (earnedIds.has(def.id)) continue;                 // already earned → never twice
      if (this.isSatisfied(def.id, quizzes, best)) newly.push(def);
    }

    if (newly.length > 0) {
      const now = new Date().toISOString();
      const updated: EarnedAchievement[] = [
        ...earned,
        ...newly.map(d => ({ id: d.id, earnedAt: now }))
      ];
      writeLocalJson(SK_QUIZ_ACHIEVEMENTS, updated);
    }
    return newly;
  }

  /** Ids of every achievement earned so far. */
  earnedIds(): Set<AchievementId> {
    return new Set<AchievementId>(this.readEarned().map(e => e.id));
  }

  /** Compact progress summary for the catalog UI (e.g. "3 / 6"). */
  summary(): { earned: number; total: number } {
    return { earned: this.earnedIds().size, total: this.definitions.length };
  }

  // ── rules ──────────────────────────────────────────────────────
  private isSatisfied(id: AchievementId, quizzes: Quiz[], best: BestScores): boolean {
    const isCompleted = (q: Quiz): boolean => best[q.quizId] != null;   // any score counts
    const isPerfect = (q: Quiz): boolean => best[q.quizId] === 100;
    const inDifficulty = (d: string): Quiz[] =>
      quizzes.filter(q => (q.difficulty ?? '').toLowerCase() === d);

    switch (id) {
      case 'perfect-score':
        return quizzes.some(isPerfect);
      case 'angular-explorer':
        return quizzes.length > 0 && quizzes.every(isCompleted);
      case 'angular-master':
        return quizzes.length > 0 && quizzes.every(isPerfect);
      case 'beginner-complete':
      case 'intermediate-complete':
      case 'advanced-complete': {
        const difficulty = id.replace('-complete', '');    // beginner | intermediate | advanced
        const group = inDifficulty(difficulty);
        return group.length > 0 && group.every(isCompleted);  // zero quizzes → not awarded
      }
      default:
        return false;
    }
  }

  // ── persisted state (safe reads) ───────────────────────────────
  private readBestScores(): BestScores {
    const raw = readLocalJson<unknown>(SK_QUIZ_BEST_SCORES, {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: BestScores = {};
    for (const [quizId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[quizId] = this.clampPercent(value);
    }
    return out;
  }

  private readEarned(): EarnedAchievement[] {
    const raw = readLocalJson<unknown>(SK_QUIZ_ACHIEVEMENTS, []);
    if (!Array.isArray(raw)) return [];
    const valid = new Set(this.definitions.map(d => d.id));
    const seen = new Set<string>();
    const out: EarnedAchievement[] = [];
    for (const entry of raw) {
      const id = (entry as EarnedAchievement)?.id;
      if (typeof id !== 'string' || !valid.has(id as AchievementId) || seen.has(id)) continue;
      seen.add(id);
      const earnedAt = (entry as EarnedAchievement)?.earnedAt;
      out.push({
        id: id as AchievementId,
        earnedAt: typeof earnedAt === 'string' ? earnedAt : new Date().toISOString()
      });
    }
    return out;
  }

  /**
   * One-time best-effort migration: if no best scores are stored yet, seed them
   * from the legacy `highScoresLocal` recent-scores list so users with existing
   * progress get credit without retaking quizzes.
   */
  private seedFromLegacyIfEmpty(): void {
    if (Object.keys(this.readBestScores()).length > 0) return;
    const legacy = readLocalJson<unknown[]>('highScoresLocal', []);
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    const best: BestScores = {};
    for (const entry of legacy) {
      const quizId = (entry as { quizId?: unknown })?.quizId;
      const score = (entry as { score?: unknown })?.score;
      if (typeof quizId === 'string' && typeof score === 'number' && Number.isFinite(score)) {
        const pct = this.clampPercent(score);
        best[quizId] = best[quizId] == null ? pct : Math.max(best[quizId], pct);
      }
    }
    if (Object.keys(best).length > 0) writeLocalJson(SK_QUIZ_BEST_SCORES, best);
  }

  private clampPercent(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
