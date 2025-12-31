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

    // ⚡ FIX: Use array INDEX for visual position, NOT displayOrder
    // The UI renders options based on their position in optionsToDisplay array.
    // "Option 1" is optionsToDisplay[0], "Option 2" is optionsToDisplay[1], etc.
    // displayOrder may be stale or from a different source, so we use idx directly.

    // 🔍 DIAGNOSTIC: Log ALL options to compare with ETS array
    console.log('[FeedbackService] 📋 ALL options in order:');
    optionsToDisplay.forEach((opt, i) => {
      console.log(`  [${i}] "${opt.text?.slice(0, 25)}..." correct=${opt.correct}`);
    });

    const indices = optionsToDisplay
      .map((option, idx) => {
        if (!option.correct) return null;

        // Use array index directly - this is the visual position in the UI
        const visualPosition = idx + 1; // 1-based for "Option N"

        // ⚡ DEBUG LOG
        console.log(`[FeedbackService] Opt ID ${option.optionId}: idx=${idx}, visualPos=${visualPosition}, text="${option.text?.slice(0, 15)}..."`);

        return visualPosition;
      })
      .filter((n): n is number => n !== null);

    // Dedupe + sort for stable, readable "Options 1 and 2" strings (matches FET)
    const deduped = Array.from(new Set(indices)).sort((a, b) => a - b);

    console.log(`[FeedbackService] setCorrectMessage. Options Count: ${optionsToDisplay.length}. Indices: ${JSON.stringify(deduped)}`);

    if (deduped.length === 0) {
      console.warn(`[FeedbackService] ❌ No matching correct options found.`);
      return 'No correct options found for this question.';
    }

    const msg = this.formatFeedbackMessage(deduped);
    console.log(`[FeedbackService] Returning msg: "${msg}"`);
    return msg;
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
