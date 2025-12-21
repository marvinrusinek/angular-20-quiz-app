import { Injectable } from '@angular/core';

import { Option } from '../models/Option.model';
import { isValidOption } from '../utils/option-utils';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  lastKnownOptions: Option[] = [];

  public generateFeedbackForOptions(
    correctOptions: Option[],
    optionsToDisplay: Option[],
  ): string {
    const validCorrectOptions = (correctOptions || []).filter(isValidOption);
    const validOptionsToDisplay = (optionsToDisplay || []).filter(
      isValidOption,
    );

    if (validCorrectOptions.length === 0) {
      console.warn(
        '[generateFeedbackForOptions] ❌ No valid correct options provided.',
      );
      return 'No correct answers available for this question.';
    }
    if (validOptionsToDisplay.length === 0) {
      console.warn(
        '[generateFeedbackForOptions] ❌ No valid options to display. STOPPING BEFORE CALLING setCorrectMessage.',
      );
      return 'Feedback unavailable.';
    }

    // Use the full options array so setCorrectMessage can calculate correct indices
    const correctFeedback = this.setCorrectMessage(validOptionsToDisplay);
    if (!correctFeedback?.trim()) {
      console.warn(
        '[generateFeedbackForOptions] ❌ setCorrectMessage returned empty or invalid feedback. Falling back...',
      );
      return 'Feedback unavailable.';
    }

    return correctFeedback;
  }

  public setCorrectMessage(optionsToDisplay?: Option[]): string {
    // Store the last known options
    if (optionsToDisplay && optionsToDisplay.length > 0) {
      this.lastKnownOptions = [...optionsToDisplay];
    }

    if (!optionsToDisplay || optionsToDisplay.length === 0) {
      console.warn(`[FeedbackService] ❌ No options to display.`);
      return 'Feedback unavailable.';
    }

    // ⚡ SYNCED WITH FET: Use displayOrder-aware logic same as ExplanationTextService.getCorrectOptionIndices
    const indices = optionsToDisplay
      .map((option, idx) => {
        if (!option.correct) return null;

        // Match FET logic: use displayOrder when valid, else fall back to array index
        const hasValidDisplayOrder =
          typeof option.displayOrder === 'number' &&
          Number.isFinite(option.displayOrder) &&
          option.displayOrder >= 0;

        const zeroBasedPos = hasValidDisplayOrder ? option.displayOrder! : idx;

        // ⚡ DEBUG LOG
        console.log(`[FeedbackService] Opt ID ${option.optionId}: displayOrder=${option.displayOrder}, hasValid=${hasValidDisplayOrder}, idx=${idx}, calcPos=${zeroBasedPos + 1}`);

        return zeroBasedPos + 1; // 1-based for "Option N"
      })
      .filter((n): n is number => n !== null);

    // Dedupe + sort for stable, readable "Options 1 and 2" strings (matches FET)
    const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);

    if (deduped.length === 0) {
      console.warn(`[FeedbackService] ❌ No matching correct options found.`);
      return 'No correct options found for this question.';
    }

    return this.formatFeedbackMessage(deduped);
  }

  private formatFeedbackMessage(indices: number[]): string {
    const optionsText =
      indices.length === 1 ? 'answer is Option' : 'answers are Options';
    const optionStrings =
      indices.length > 1
        ? `${indices.slice(0, -1).join(', ')} and ${indices.slice(-1)}`
        : `${indices[0]}`;

    return `The correct ${optionsText} ${optionStrings}.`;
  }
}
