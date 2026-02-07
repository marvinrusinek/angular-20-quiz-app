import { Injectable } from '@angular/core';
import { Option } from '../models/Option.model';
import { OptionBindings } from '../models/OptionBindings.model';

@Injectable({ providedIn: 'root' })
export class OptionVisualEffectsService {
  refreshHighlights(bindings: OptionBindings[]): void {
    for (const b of bindings ?? []) {
      b?.directiveInstance?.updateHighlight?.();
    }
  }

  syncSelectedFlags(bindings: OptionBindings[]): void {
    for (const b of bindings ?? []) {
      if (!b?.option) continue;
      b.isSelected = b.option.selected ?? false;
    }
  }

  toggleSelectedOption(option: Option, selectedOptionMap: Map<number, boolean>): void {
    const id = option?.optionId;
    if (typeof id !== 'number') return;
    selectedOptionMap.set(id, !selectedOptionMap.get(id));
  }
}
