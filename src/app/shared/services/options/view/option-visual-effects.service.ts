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

  toggleSelectedOption(option: Option, selectedOptionMap: Map<number, boolean>): void {
    const id = option?.optionId;
    if (id == null) return;
    
    // Support both numeric and string IDs by normalizing to number if possible, 
    // or using as-is if the map supports mixed keys (it's typed Map<number, boolean> but runtime permits mixed)
    const numId = Number(id);
    const key = isNaN(numId) ? id : numId;
    
    selectedOptionMap.set(key as any, !selectedOptionMap.get(key as any));
  }
}
