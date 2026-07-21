export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'complete';

/** Optional call-to-action attached to a recommendation. */
export interface DifficultyAction {
  label: string;
  /** 'interview' → Interview Builder; 'browse' → surface quizzes of `difficulty`. */
  kind: 'interview' | 'browse';
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * An ADVISORY readiness message for the Quiz Selection screen. Informational
 * only — it never locks, hides, or moves the user. Derived from existing
 * progress + best scores; nothing is persisted.
 */
export interface DifficultyRecommendation {
  level: DifficultyLevel;
  heading: string;
  message: string;
  action: DifficultyAction | null;
}
