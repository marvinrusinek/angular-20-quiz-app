import { Injectable } from '@angular/core';

import { QuestionType } from '../../../models/question-type.enum';
import { OptionBindings } from '../../../models/OptionBindings.model';

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

    const isCorrectBinding = (b: OptionBindings) => {
      if (b.isCorrect === true) return true;
      const v: any = b.option?.correct;
      return v === true || String(v) === 'true' || v === 1 || v === '1';
    };

    const hasCorrectSelection = bindings.some(
      b => b.isSelected && isCorrectBinding(b)
    );
    const correctBindings = bindings.filter(isCorrectBinding);
    const allCorrectSelected =
      correctBindings.length > 0 && correctBindings.every(b => b.isSelected);

    const hasIncorrectSelection = bindings.some(
      b => b.isSelected && !isCorrectBinding(b)
    );
    const isPerfect = allCorrectSelected && !hasIncorrectSelection;

    console.log(`[OptionLockPolicy] Q Evaluation: hasCorrect=${hasCorrectSelection}, allCorrect=${allCorrectSelected}, isPerfect=${isPerfect}, type=${params.resolvedType}`);

    const shouldLockIncorrect = params.computeShouldLockIncorrectOptions(
      params.resolvedType,
      hasCorrectSelection,
      allCorrectSelected
    );

    const locked = new Set<number>();

    if (!shouldLockIncorrect && !isPerfect) {
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
      // GRANULAR LOCKING:
      // 1. If perfectly resolved, disable everything.
      // 2. If all correct found but not perfect, disable unselected options ONLY.
      // 3. If single answer and correct selection found, disable everything.
      let shouldDisable = false;
      if (isPerfect || allCorrectSelected) {
        shouldDisable = true;
      } else if (params.resolvedType === QuestionType.SingleAnswer && hasCorrectSelection) {
        shouldDisable = true;
      }

      b.disabled = shouldDisable;
      if (b.option) b.option.active = !shouldDisable;

      const bIdx = b.index;
      if (shouldDisable && bIdx != null) {
        locked.add(bIdx);
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