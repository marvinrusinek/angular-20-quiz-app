import { Injectable } from '@angular/core';

import { Quiz } from '../../../models/Quiz.model';
import {
  DifficultyLevel,
  DifficultyRecommendation
} from '../../../models/difficulty-recommendation.model';

type Level = 'beginner' | 'intermediate' | 'advanced';

interface LevelStats {
  total: number;
  completed: number;
  ratio: number;   // completed / total (1 when the level has no quizzes)
  avg: number;     // mean best score of completed quizzes (0 when none)
}

/**
 * ADVISORY difficulty-readiness message for Quiz Selection. Pure: given the
 * catalog + the existing best-score store (quizId → best percent, key presence =
 * completed — the SAME completion definition ProgressService uses), it returns
 * an encouraging recommendation. It reads no storage, owns no completion rules,
 * and never locks/hides/moves anything.
 *
 * Best scores already hold each quiz's HIGHEST attempt, so duplicate/repeated
 * attempts never affect the averages.
 */
@Injectable({ providedIn: 'root' })
export class DifficultyRecommendationService {
  /** Advance once ~this fraction of a level is completed. */
  private static readonly COMPLETION_THRESHOLD = 0.75;
  /** ...and the level's average best score is at least this. */
  private static readonly SCORE_THRESHOLD = 80;

  private static readonly HEADING = $localize`Difficulty Recommendation`;

  recommend(
    quizzes: readonly Quiz[] | null | undefined,
    bestScores: Readonly<Record<string, number>>
  ): DifficultyRecommendation | null {
    const list = (quizzes ?? []).filter((q): q is Quiz => !!q && !!q.quizId);
    const total = list.length;
    if (total === 0) return null;

    const isCompleted = (quizId: string): boolean =>
      Object.prototype.hasOwnProperty.call(bestScores, quizId) &&
      typeof bestScores[quizId] === 'number';

    const completedTotal = list.filter((q) => isCompleted(q.quizId)).length;

    // All quizzes completed → celebratory completion state → Interview Builder.
    if (completedTotal === total) {
      return {
        level: 'complete',
        heading: $localize`Excellent work!`,
        message: $localize`You have completed the Angular learning path. Continue sharpening your skills with Interview Mode.`,
        action: { label: $localize`Build an Interview`, kind: 'interview' }
      };
    }

    const stats = (level: Level): LevelStats => {
      const group = list.filter((q) => (q.difficulty ?? '').toLowerCase() === level);
      const completedQuizzes = group.filter((q) => isCompleted(q.quizId));
      const scores = completedQuizzes.map((q) => bestScores[q.quizId]);
      return {
        total: group.length,
        completed: completedQuizzes.length,
        ratio: group.length === 0 ? 1 : completedQuizzes.length / group.length,
        avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      };
    };

    const beginner = stats('beginner');
    const intermediate = stats('intermediate');
    const advanced = stats('advanced');

    const passed = (s: LevelStats): boolean =>
      s.total === 0 ||
      (s.ratio >= DifficultyRecommendationService.COMPLETION_THRESHOLD &&
        s.avg >= DifficultyRecommendationService.SCORE_THRESHOLD);

    const readyForIntermediate = passed(beginner);
    const readyForAdvanced = readyForIntermediate && passed(intermediate);

    const rec = (
      level: DifficultyLevel,
      message: string,
      action: DifficultyRecommendation['action']
    ): DifficultyRecommendation => ({
      level,
      heading: DifficultyRecommendationService.HEADING,
      message,
      action
    });

    const browse = (difficulty: Level, label: string): DifficultyRecommendation['action'] => ({
      label,
      kind: 'browse',
      difficulty
    });

    // ── Beginner: not yet ready to move up ────────────────────────────
    if (!readyForIntermediate) {
      // ratio below threshold → do more; ratio met but score low → strengthen.
      const message =
        beginner.ratio < DifficultyRecommendationService.COMPLETION_THRESHOLD
          ? $localize`Build confidence with more Beginner quizzes.`
          : $localize`Continue strengthening your Beginner fundamentals.`;
      return rec('beginner', message, null);
    }

    // ── Intermediate: ready for it, not yet ready for Advanced ─────────
    if (!readyForAdvanced) {
      const message =
        intermediate.completed > 0 &&
        intermediate.avg < DifficultyRecommendationService.SCORE_THRESHOLD
          ? $localize`Continue strengthening your Intermediate topics.`
          : $localize`You're ready for Intermediate Angular topics.`;
      return rec('intermediate', message, browse('intermediate', $localize`Browse Intermediate Quizzes`));
    }

    // ── Advanced: ready for it ────────────────────────────────────────
    // "Keep Improving": already in Advanced but the average has dropped.
    if (
      advanced.completed > 0 &&
      advanced.avg < DifficultyRecommendationService.SCORE_THRESHOLD
    ) {
      return rec(
        'advanced',
        $localize`Continue strengthening your Advanced knowledge.`,
        browse('advanced', $localize`Browse Advanced Quizzes`)
      );
    }
    return rec(
      'advanced',
      $localize`You're ready to tackle Advanced Angular concepts.`,
      browse('advanced', $localize`Browse Advanced Quizzes`)
    );
  }
}
