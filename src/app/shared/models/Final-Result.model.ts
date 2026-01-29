export interface ScoreAnalysisItem {
  questionIndex: number;
  questionText: string;
  wasCorrect: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
}
  
export interface FinalResult {
  quizId: string;
  correct: number;
  total: number;
  percentage: number;
  analysis: ScoreAnalysisItem[];
  completedAt: number;
}  