import { QuizDifficulty } from './Quiz.model';

/** Per-quiz progress, derived from the quiz list + the best-score store. */
export interface QuizProgress {
  quizId: string;
  completed: boolean;
  bestScore: number | null;   // null when not completed (or no reliable score)
  difficulty?: QuizDifficulty;
}

/** Completion progress within a single difficulty group. */
export interface DifficultyProgress {
  difficulty: QuizDifficulty;
  completed: number;
  total: number;
}

/** A completed quiz surfaced as strongest / weakest. */
export interface QuizProgressSummary {
  quizId: string;
  milestone: string;
  bestScore: number;
}

/** Aggregate, derived progress across all quizzes. Nothing here is persisted. */
export interface ProgressSummary {
  completedCount: number;
  totalCount: number;
  completionPercentage: number;
  byDifficulty: DifficultyProgress[];
  strongestQuiz: QuizProgressSummary | null;
  weakestQuiz: QuizProgressSummary | null;
}
