import { Injectable } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';

/**
 * Manages option display preparation and render-readiness logic for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 *
 * This service handles pure data transformations for options display.
 * The component retains subject emissions, cdRef calls, and sharedOptionComponent interactions.
 */
@Injectable({ providedIn: 'root' })
export class QqcDisplayStateManagerService {

  /**
   * Builds display-ready options from a source question.
   * Returns null if the question has no valid options.
   * Extracted from setOptionsToDisplay().
   */
  buildOptionsToDisplay(
    sourceQuestion: QuizQuestion | null | undefined
  ): Option[] | null {
    const context = '[buildOptionsToDisplay]';

    if (!sourceQuestion || !Array.isArray(sourceQuestion.options)) {
      console.warn(
        `${context} ❌ No valid sourceQuestion or options. Skipping option assignment.`
      );
      return null;
    }

    const validOptions = (sourceQuestion.options ?? []).filter(
      (o: Option) => !!o && typeof o === 'object'
    );
    if (!validOptions.length) {
      console.warn(`${context} ❌ All options were invalid.`);
      return null;
    }

    return validOptions.map((opt: Option, index: number) => ({
      ...opt,
      optionId: opt.optionId ?? index,
      active: opt.active ?? true,
      feedback: opt.feedback ?? '',
      showIcon: opt.showIcon ?? false,
      selected: false,
      highlighted: false
    }));
  }

  /**
   * Compares incoming options with current and determines if a swap is needed.
   * Returns the new options array (with reset selection/highlight flags),
   * a reactive form group, and the serialized representation.
   * Returns null if no change is needed.
   * Extracted from updateOptionsSafely().
   */
  prepareOptionSwap(params: {
    newOptions: Option[];
    currentOptionsJson: string;
  }): {
    needsSwap: boolean;
    cleanedOptions: Option[];
    formGroup: FormGroup;
    serialized: string;
  } {
    const incoming = JSON.stringify(params.newOptions);
    const needsSwap = incoming !== params.currentOptionsJson;

    if (needsSwap) {
      // Clear previous highlight / form flags before we clone
      params.newOptions.forEach((o: Option) => {
        o.selected = false;
        o.highlight = false;
        o.showIcon = false;
      });

      // Rebuild the reactive form
      const formGroup = new FormGroup({});
      params.newOptions.forEach((o: Option) =>
        formGroup.addControl(
          `opt_${o.optionId}`,
          new FormControl(false)
        )
      );

      return {
        needsSwap: true,
        cleanedOptions: [...params.newOptions],
        formGroup,
        serialized: incoming,
      };
    }

    return {
      needsSwap: false,
      cleanedOptions: params.newOptions,
      formGroup: new FormGroup({}),
      serialized: incoming,
    };
  }

  /**
   * Hydrates component state from a QuestionPayload.
   * Returns the derived state without mutating anything.
   * Returns null if hydration should be skipped.
   * Extracted from hydrateFromPayload().
   */
  hydrateFromPayload(params: {
    payload: QuestionPayload;
    currentQuestionText: string | undefined;
    isAlreadyRendered: boolean;
  }): {
    shouldSkip: boolean;
    currentQuestion: QuizQuestion;
    optionsToDisplay: Option[];
    explanationToDisplay: string;
    serializedPayload: string;
  } | null {
    const incomingQuestionText = params.payload?.question?.questionText?.trim();
    const currentQuestionText = params.currentQuestionText?.trim();

    // Skip if same question text and already rendered
    if (
      incomingQuestionText &&
      incomingQuestionText === currentQuestionText &&
      params.isAlreadyRendered
    ) {
      console.warn('[⚠️ Skipping rehydration: same question text and already rendered]');
      return null;
    }

    const { question, options, explanation } = params.payload;

    return {
      shouldSkip: false,
      currentQuestion: question,
      optionsToDisplay: structuredClone(options),
      explanationToDisplay: explanation?.trim() || '',
      serializedPayload: JSON.stringify(params.payload),
    };
  }

  /**
   * Checks if hydration fallback should trigger.
   * Extracted from enforceHydrationFallback().
   */
  shouldTriggerHydrationFallback(params: {
    renderReady: boolean;
    options: Option[] | null | undefined;
  }): boolean {
    return (
      !params.renderReady &&
      Array.isArray(params.options) &&
      params.options.length > 0
    );
  }

  /**
   * Determines render readiness from current option state.
   * Extracted from updateShouldRenderOptions().
   */
  computeRenderReadiness(options: Option[] | null | undefined): boolean {
    return Array.isArray(options) && options.length > 0;
  }

  /**
   * Applies display order indices to options.
   * Extracted from applyDisplayOrder().
   */
  applyDisplayOrder(options: Option[] | null | undefined): Option[] {
    if (!Array.isArray(options)) return [];
    return options.map((option, index) => ({ ...option, displayOrder: index }));
  }
}
