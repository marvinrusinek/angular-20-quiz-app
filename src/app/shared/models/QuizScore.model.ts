export interface QuizScore {
  quizId: string;
  attemptDateTime: Date;
  score: number;
  totalQuestions: number;
  // Stable id for the quiz ATTEMPT this score belongs to. Minted when an attempt
  // starts (and re-minted on Restart Quiz); used to dedup High Scores writes so
  // re-opening/refreshing Results doesn't duplicate a row, while two genuine
  // retakes with the same score stay as separate rows. Optional for backward
  // compatibility with records persisted before this field existed.
  attemptId?: string;
}
