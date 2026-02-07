import { Injectable } from '@angular/core';

import { QuestionType } from '../../../models/question-type.enum';

@Injectable({ providedIn: 'root' })
export class OptionLockRulesService {
  computeShouldLockIncorrectOptions(
    type: QuestionType,
    hasCorrectSelection: boolean,
    allCorrectSelected: boolean
  ): boolean {
    if (type === QuestionType.SingleAnswer) {
      return hasCorrectSelection;
    }

    if (type === QuestionType.MultipleAnswer) {
      return allCorrectSelected;
    }

    return false;
  }
}