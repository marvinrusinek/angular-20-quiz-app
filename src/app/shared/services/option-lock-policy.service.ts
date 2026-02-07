import { Injectable } from '@angular/core';

import { QuestionType } from '../models/question-type.enum';
import { OptionBindings } from '../models/OptionBindings.model';

export interface LockIncorrectResult {
  shouldLockIncorrectOptions: boolean;
  lockedIncorrectOptionIds: Set<number>;
  resolvedTypeForLock: QuestionType;
  hasCorrectSelectionForLock: boolean;
  allCorrectSelectedForLock: boolean;
}

@Injectable({ providedIn: 'root' })
export class OptionLockPolicyService {
  updateLockedIncorrectOptions(params: {
    bindings: OptionBindings[];
    forceDisableAll: boolean;
    resolvedType: QuestionType;
    computeShouldLockIncorrectOptions: (
      resolvedType: QuestionType,
      hasCorrectSelection: boolean,
      allCorrectSelected: boolean
    ) => boolean;
  }): LockIncorrectResult {
    const bindings = params.bindings ?? [];

    if (!bindings.length) {
      return {
        shouldLockIncorrectOptions: false,
        lockedIncorrectOptionIds: new Set<number>(),
        resolvedTypeForLock: params.resolvedType,
        hasCorrectSelectionForLock: false,
        allCorrectSelectedForLock: false
      };
    }

    if (params.forceDisableAll) {
      for (const b of bindings) {
        b.disabled = true;
        if (b.option) b.option.active = false;
      }

      return {
        shouldLockIncorrectOptions: true,
        lockedIncorrectOptionIds: new Set(
          bindings
            .map(b => b.option?.optionId)
            .filter((id): id is number => typeof id === 'number')
        ),
        resolvedTypeForLock: params.resolvedType,
        hasCorrectSelectionForLock: false,
        allCorrectSelectedForLock: false
      };
    }

    const hasCorrectSelection = bindings.some(
      b => b.isSelected && b.option?.correct === true
    );
    const correctBindings = bindings.filter(b => b.option?.correct === true);
    const allCorrectSelected =
      correctBindings.length > 0 && correctBindings.every(b => b.isSelected);

    const shouldLockIncorrect = params.computeShouldLockIncorrectOptions(
      params.resolvedType,
      hasCorrectSelection,
      allCorrectSelected
    );

    const locked = new Set<number>();

    if (!shouldLockIncorrect) {
      for (const b of bindings) {
        b.disabled = false;
        if (b.option) b.option.active = true;
      }

      return {
        shouldLockIncorrectOptions: false,
        lockedIncorrectOptionIds: locked,
        resolvedTypeForLock: params.resolvedType,
        hasCorrectSelectionForLock: hasCorrectSelection,
        allCorrectSelectedForLock: allCorrectSelected
      };
    }

    for (const b of bindings) {
      const optionId = b.option?.optionId;
      const shouldDisable = b.option?.correct !== true;

      b.disabled = shouldDisable;
      if (b.option) b.option.active = !shouldDisable;

      if (typeof optionId === 'number') {
        if (shouldDisable) locked.add(optionId);
        else locked.delete(optionId);
      }
    }

    return {
      shouldLockIncorrectOptions: true,
      lockedIncorrectOptionIds: locked,
      resolvedTypeForLock: params.resolvedType,
      hasCorrectSelectionForLock: hasCorrectSelection,
      allCorrectSelectedForLock: allCorrectSelected
    };
  }
}