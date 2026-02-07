import { Injectable } from '@angular/core';
import { OptionBindings } from '../models/OptionBindings.model';
import { SelectionMessageService } from './selection-message.service';
import { SelectedOptionService } from './selectedoption.service';

@Injectable({ providedIn: 'root' })
export class OptionLockService {
  constructor(
    private selectionMessageService: SelectionMessageService,
    private selectedOptionService: SelectedOptionService
  ) {}

  isLocked(
    binding: OptionBindings,
    displayIndex: number,
    questionIndex: number
  ): boolean {
    try {
      const id = this.selectionMessageService.stableKey(binding.option, displayIndex);
      return this.selectedOptionService.isOptionLocked(questionIndex, id);
    } catch {
      return false;
    }
  }
}
