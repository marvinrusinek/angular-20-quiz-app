import { Injectable } from '@angular/core';

import { QuestionType } from '../../../models/question-type.enum';

@Injectable({ providedIn: 'root' })
export class OptionLockRulesService {
  computeShouldLockIncorrectOptions(
    type: QuestionType,
    hasCorrectSelection: boolean,
    allCorrectSelected: boolean
  ): boolean {
    // If it's a multiple answer question, only lock when all are correct
    if (type === QuestionType.MultipleAnswer || type as any === 'multiple') {
      return allCorrectSelected;
    }

    // Single answer: lock as soon as any correct answer is picked
    return hasCorrectSelection;
  }
}