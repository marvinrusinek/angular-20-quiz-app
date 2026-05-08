import { Injectable } from '@angular/core';

import { OptionBindings } from '../../../models/OptionBindings.model';
import { SelectedOptionService } from '../../state/selectedoption.service';

@Injectable({ providedIn: 'root' })
export class OptionLockService {
  constructor(private selectedOptionService: SelectedOptionService) {}

  isLocked(
    binding: OptionBindings,
    displayIndex: number,
    questionIndex: number
  ): boolean {
    try {
      // Prefer stable optionId; fallback to display index
      const id = binding.option.optionId ?? displayIndex;
      return this.selectedOptionService.isOptionLocked(questionIndex, id);
    } catch {
      return false;
    }
  }
}