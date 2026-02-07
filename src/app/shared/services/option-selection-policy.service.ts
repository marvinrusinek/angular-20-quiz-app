import { Injectable } from '@angular/core';

import { OptionBindings } from '../models/OptionBindings.model';

@Injectable({ providedIn: 'root' })
export class OptionSelectionPolicyService {
  enforceSingleSelection(params: {
    optionBindings: OptionBindings[];
    selectedBinding: OptionBindings;

    showFeedbackForOption: Record<number, boolean>;
    updateFeedbackState: (id: number) => void;
  }): void {
    const { optionBindings, selectedBinding, showFeedbackForOption, updateFeedbackState } = params;

    for (const binding of optionBindings ?? []) {
      const isTarget = binding === selectedBinding;

      if (!isTarget && binding.isSelected) {
        binding.isSelected = false;
        if (binding.option) binding.option.selected = false;

        // Preserve feedback state for previously selected option
        const id = binding.option?.optionId ?? -1;
        if (id !== -1) {
          showFeedbackForOption[id] = true;
          updateFeedbackState(id);
        }
      }
    }
  }
}