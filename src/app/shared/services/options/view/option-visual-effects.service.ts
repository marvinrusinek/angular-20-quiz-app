import { Injectable } from '@angular/core';
import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';

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

  toggleSelectedOption(index: number, selectedOptionMap: Map<number | string, boolean>): void {
    if (index == null || index < 0) return;
    
    selectedOptionMap.set(index, !selectedOptionMap.get(index));
  }
}
