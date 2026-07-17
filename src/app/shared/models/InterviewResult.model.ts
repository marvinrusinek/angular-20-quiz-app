import { InterviewDifficulty } from './AssessmentConfig.model';

// Per-topic (source quiz) score within an interview result.
export interface InterviewTopicScore {
  quizId: string;
  title: string;
  correct: number;
  total: number;
  percentage: number;
}

// The computed outcome of a submitted interview/assessment. Derived from the
// generated assessment + the user's answers; NEVER written to topic-quiz
// progress/best-score/achievement state.
export interface InterviewResult {
  total: number;
  answered: number;
  unanswered: number;
  correct: number;
  incorrect: number;
  percentage: number;            // 0–100, rounded
  timeUsedSeconds: number;
  timeRemainingSeconds: number;
  difficulty: InterviewDifficulty;
  topicIds: string[];
  perTopic: InterviewTopicScore[];
  submittedByExpiry: boolean;
}
