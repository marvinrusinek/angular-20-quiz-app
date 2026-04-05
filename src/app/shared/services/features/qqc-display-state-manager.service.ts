import { Injectable } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';

import { Option } from '../../models/Option.model';
import { QuizQuestion } from '../../models/QuizQuestion.model';
import { QuestionPayload } from '../../models/QuestionPayload.model';
import { SimpleChange } from '@angular/core';
import { QuizService } from '../data/quiz.service';

/**
 * Manages option display preparation and render-readiness logic for QQC.
 * Extracted from QuizQuestionComponent to reduce its size.
 *
 * This service handles pure data transformations for options display.
 * The component retains subject emissions, cdRef calls, and sharedOptionComponent interactions.
 */
@Injectable({ providedIn: 'root' })
export class QqcDisplayStateManagerService {

  constructor(
    private quizService: QuizService
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // QUESTION AND OPTIONS CHANGE HANDLING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handles the logic when question and/or options inputs change.
   * Resolves the effective question and incoming options from SimpleChanges.
   * Extracted from handleQuestionAndOptionsChange().
   */
  handleQuestionAndOptionsChange(params: {
    currentQuestionChange: SimpleChange | undefined;
    optionsChange: SimpleChange | undefined;
    currentQuestion: QuizQuestion | null;
  }): {
    nextQuestion: QuizQuestion | null;
    effectiveQuestion: QuizQuestion | null;
    incomingOptions: Option[] | null;
  } {
    const nextQuestion = (params.currentQuestionChange
      ? (params.currentQuestionChange.currentValue as QuizQuestion)
      : null) ?? null;

    const incomingOptions = (params.optionsChange?.currentValue as Option[]) ??
      nextQuestion?.options ??
      params.currentQuestionChange?.currentValue?.options ??
      null;

    const effectiveQuestion = nextQuestion ?? params.currentQuestion ?? null;

    return { nextQuestion, effectiveQuestion, incomingOptions };
  }

  /**
   * Extracts selected option values from a question for change handling.
   * Extracted from handleQuestionAndOptionsChange().
   */
  extractSelectedOptionValues(effectiveQuestion: QuizQuestion | null): any[] {
    return (effectiveQuestion?.selectedOptions ?? [])
      .map((opt: any) => {
        if (opt == null) {
          return null;
        }

        if (typeof opt === 'object') {
          return opt.value ?? opt.optionId ?? opt.text ?? null;
        }

        return opt;
      })
      .filter((value) => value != null);
  }

  /**
   * Synchronizes the local option inputs with the currently active question,
   * important for randomization/shuffling.
   * Returns the normalized options array.
   * Extracted from refreshOptionsForQuestion().
   */
  refreshOptionsForQuestion(params: {
    question: QuizQuestion | null;
    providedOptions?: Option[] | null;
    currentQuestionIndex: number;
  }): {
    normalizedOptions: Option[];
    options: Option[];
    optionsToDisplay: Option[];
  } {
    const baseOptions = Array.isArray(params.providedOptions) && params.providedOptions.length
      ? params.providedOptions
      : Array.isArray(params.question?.options)
        ? params.question!.options
        : [];

    if (!baseOptions.length) {
      console.warn('[refreshOptionsForQuestion] No options found for the current question.');
      return { normalizedOptions: [], options: [], optionsToDisplay: [] };
    }

    const normalizedOptions = this.quizService.assignOptionIds(
      baseOptions.map((option) => ({ ...option })),
      params.currentQuestionIndex
    );

    const optionsToDisplay = normalizedOptions.map((option, index) => ({
      ...option,
      optionId: option.optionId ?? index + 1,
      selected: !!option.selected,
      showIcon: option.showIcon ?? false
    }));

    return { normalizedOptions, options: normalizedOptions, optionsToDisplay };
  }

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

  /**
   * Resolves correctness and builds display-ready options from a question's
   * raw options and answer values. Returns the mapped options with correct,
   * selected, and displayOrder fields set.
   * Extracted from QuizQuestionComponent.setQuestionOptions().
   */
  buildOptionsWithCorrectness(
    question: QuizQuestion
  ): Option[] {
    const options = question.options ?? [];

    if (!Array.isArray(options) || options.length === 0) {
      console.error(
        `[buildOptionsWithCorrectness] No options available for question.`
      );
      return [];
    }

    const answerValues = (question.answer ?? [])
      .map((answer: any) => answer?.value)
      .filter((value: any): value is Option['value'] => value !== undefined && value !== null);

    const resolveCorrect = (option: Option): boolean => {
      if (option.correct === true) {
        return true;
      }

      if (Array.isArray(answerValues) && answerValues.length > 0) {
        return answerValues.includes(option.value);
      }

      return false;
    };

    return options.map((option, index) => ({
      ...option,
      correct: resolveCorrect(option),
      selected: false,
      displayOrder: index
    }));
  }

  /**
   * Builds clean options for a route change: resets feedback, showIcon, and active state.
   * Extracted from handleRouteChanges().
   */
  buildCleanOptionsForRouteChange(question: QuizQuestion): Option[] {
    const originalOptions = question.options ?? [];
    return originalOptions.map((opt) => ({
      ...opt,
      active: true,
      feedback: undefined,
      showIcon: false,
    }));
  }

  /**
   * Determines if the page visibility change should suppress display state updates.
   * Returns true if the update should be suppressed.
   * Extracted from safeSetDisplayState().
   */
  shouldSuppressDisplayState(params: {
    visibilityRestoreInProgress: boolean;
    suppressDisplayStateUntil: number;
  }): boolean {
    return params.visibilityRestoreInProgress || performance.now() < params.suppressDisplayStateUntil;
  }

  /**
   * Computes whether renderReady should be emitted based on question and options validity.
   * Extracted from ngOnChanges (lines 789–808).
   */
  computeRenderReadyFromInputs(params: {
    questionDataText: string | undefined;
    currentQuestionText: string | undefined;
    options: Option[] | null | undefined;
  }): boolean {
    const hasValidQuestion =
      !!params.questionDataText?.trim() ||
      !!params.currentQuestionText?.trim();

    const hasValidOptions =
      Array.isArray(params.options) && params.options.length > 0;

    if (hasValidQuestion && hasValidOptions) {
      return true;
    } else {
      console.warn('[⏸️ renderReady] Conditions not met:', {
        hasValidQuestion,
        hasValidOptions,
      });
      return false;
    }
  }

  /**
   * Computes whether _fetEarlyShown should be cleared for a question transition.
   * Extracted from ngOnChanges (lines 737–750).
   */
  shouldClearFetEarlyShown(params: {
    newIndex: number | undefined;
    prevIndex: number | undefined;
  }): { shouldClear: boolean; indexToClear: number } {
    if (
      typeof params.newIndex === 'number' &&
      typeof params.prevIndex === 'number' &&
      params.newIndex !== params.prevIndex
    ) {
      console.log(`[QQC] 🔄 Reset _fetEarlyShown for transition ${params.prevIndex + 1} → ${params.newIndex + 1}`);
      return { shouldClear: true, indexToClear: params.prevIndex };
    }
    return { shouldClear: false, indexToClear: -1 };
  }
}
