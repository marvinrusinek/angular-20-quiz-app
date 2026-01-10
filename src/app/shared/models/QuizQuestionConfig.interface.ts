import { Observable } from 'rxjs';

import { QuestionPayload } from './QuestionPayload.model';

/**
 * Configuration object for QuizQuestionComponent.
 * Encapsulates all input bindings into a single config object.
 */
export interface QuizQuestionConfig {
  /** The question data payload containing question, options, explanation */
  questionPayload: QuestionPayload;
  
  /** Current question index (0-based) */
  currentQuestionIndex: number;
  
  /** Observable for display state (question vs explanation mode) */
  displayState$: Observable<{ mode: 'question' | 'explanation'; answered: boolean }>;
  
  /** Whether options should be rendered */
  shouldRenderOptions: boolean;
  
  /** Observable for question text to display */
  questionToDisplay$: Observable<string | null>;
  
  /** Explanation text to display */
  explanationToDisplay: string | null;
}
