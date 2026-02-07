import { Injectable } from '@angular/core';

import { OptionBindings } from '../../../models/OptionBindings.model';

@Injectable({ providedIn: 'root' })
export class OptionSelectionUiService {
  // Push the newly‐clicked option into history, then synchronize every binding’s
  // visual state (selected, highlight, icon, feedback) in one synchronous pass.
  applySingleSelectClick(
    optionBindings: OptionBindings[] | null | undefined,
    rawSelectedId: number | string,
    selectedOptionHistory: number[]
  ): void {
    const parsedId =
      typeof rawSelectedId === 'string'
        ? Number.parseInt(rawSelectedId, 10)
        : rawSelectedId;

    if (!Number.isFinite(parsedId)) {
      console.warn(
        '[OptionSelectionUiService] Ignoring non-numeric selection id',
        { rawSelectedId }
      );
      return;
    }

    // Ignore the synthetic “-1 repaint” that runs right after question load
    if (parsedId === -1) return;

    const selectedId = parsedId;

    // Remember every id that has ever been clicked in this question
    if (!selectedOptionHistory.includes(selectedId)) {
      selectedOptionHistory.push(selectedId);
    }

    // Faster lookups than repeated .includes()
    const historySet = new Set<number>(selectedOptionHistory);

    for (const b of optionBindings ?? []) {
      const id = b?.option?.optionId;
      if (id === undefined) {
        continue;
      }

      const everClicked = historySet.has(id);
      const isCurrent = id === selectedId;

      // Color stays ON for anything ever clicked
      b.option.highlight = everClicked;

      // Icon only on the row that was just clicked
      b.option.showIcon = isCurrent;

      // Native control state (single truth for selection in UI)
      b.isSelected = isCurrent;

      // Feedback – only current row is true
      if (!b.showFeedbackForOption) {
        b.showFeedbackForOption = {};
      }
      b.showFeedbackForOption[id] = isCurrent;

      // Repaint row
      b.directiveInstance?.updateHighlight();
    }
  }
}