import { Injectable } from '@angular/core';

import { OptionBindings } from '../../../models/OptionBindings.model';

@Injectable({ providedIn: 'root' })
export class OptionHydrationService {
  /**
   * Hydrate bindings' selection state from a persisted set of optionIds.
   * Pure mapping: does NOT touch change detection, DOM, timers, or storage.
   */
  applySavedSelections(
    bindings: OptionBindings[] | null | undefined,
    savedIds: Set<number | string>
  ): void {
    if (!bindings?.length) return;

    for (const b of bindings) {
      const id = b?.option?.optionId;
      b.isSelected = id !== undefined && id !== null && savedIds.has(id);
    }
  }

  // Convenience helper if there are saved selections as objects
  toIdSet(
    saved: Array<{ optionId?: number | string; selected?: boolean }> | null | undefined
  ): Set<number | string> {
    const set = new Set<number | string>();
    if (!saved?.length) return set;

    for (const s of saved) {
      // Skip unselect traces so a never-clicked binding whose optionId
      // happens to match a prior unselect record does not get stamped
      // as highlighted by processOptionBindings.
      if ((s as any)?.selected === false) continue;
      const id = s?.optionId;
      if (id !== undefined && id !== null) {
        set.add(id);
      }
    }
    return set;
  }
}