import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { Option } from '../../models/Option.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { ExplanationTextService } from '../features/explanation-text.service';
import { QuizStateService } from '../state/quizstate.service';

interface DisplayState {
  mode: 'question' | 'explanation';
  answered: boolean;
}

export interface VisibilityRestoreParams {
  currentQuestion: QuizQuestion | null;
  optionsToDisplay: Option[];
  explanationToDisplay: string;
  combinedQuestionDataSubject: BehaviorSubject<QuestionPayload | null>;
  optionsToDisplay$: BehaviorSubject<Option[]>;
}

/**
 * Handles tab visibility change save/restore for quiz display state.
 * Extracted from QuizComponent to reduce its size.
 */
@Injectable({ providedIn: 'root' })
export class QuizVisibilityRestoreService {
  private _savedDisplayState: DisplayState | null = null;

  constructor(
    private quizStateService: QuizStateService,
    private explanationTextService: ExplanationTextService
  ) {}

  /**
   * Handle a visibility change. Returns true if a re-render is needed
   * (caller should call cdRef.markForCheck()).
   */
  handleVisibilityChange(isHidden: boolean, params: VisibilityRestoreParams): boolean {
    if (isHidden) {
      const currentDisplayState = this.quizStateService.displayStateSubject?.value;
      if (currentDisplayState) {
        this._savedDisplayState = { ...currentDisplayState };
        console.log('[VISIBILITY] Saved display state on hide:', this._savedDisplayState);
      }
      return false;
    }

    if (!this._savedDisplayState) return false;

    console.log('[VISIBILITY] Restoring saved display state:', this._savedDisplayState);

    this.quizStateService.lockDisplayStateForVisibilityRestore(500);
    this.quizStateService.setDisplayState(this._savedDisplayState, { force: true });

    const showingExplanation = this._savedDisplayState.mode === 'explanation';
    this.explanationTextService.setShouldDisplayExplanation(showingExplanation);
    this.explanationTextService.setIsExplanationTextDisplayed(showingExplanation);

    if (params.currentQuestion) {
      console.log('[VISIBILITY] Re-emitting question data to force re-render');
      const currentPayload = params.combinedQuestionDataSubject.getValue();
      const payloadToEmit: QuestionPayload = currentPayload || {
        question: params.currentQuestion,
        options: params.optionsToDisplay || [],
        explanation: params.explanationToDisplay || ''
      };

      params.combinedQuestionDataSubject.next(payloadToEmit);

      if (params.optionsToDisplay && params.optionsToDisplay.length > 0) {
        params.optionsToDisplay$.next(params.optionsToDisplay);
      }
    }

    return true;
  }
}
