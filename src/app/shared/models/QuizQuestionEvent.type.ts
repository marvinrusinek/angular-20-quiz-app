import { SelectedOption } from './SelectedOption.model';

/**
 * Discriminated union type for all events emitted by QuizQuestionComponent.
 * Using a single output with typed events for cleaner template bindings.
 */
export type QuizQuestionEvent =
  | { type: 'answer'; payload: number }
  | { type: 'optionSelected'; payload: SelectedOption }
  | { type: 'selectionMessageChange'; payload: string }
  | { type: 'explanationToDisplayChange'; payload: string }
  | { type: 'showExplanationChange'; payload: boolean };

/**
 * Type guard helpers for narrowing event types
 */
export function isAnswerEvent(
  event: QuizQuestionEvent
): event is { type: 'answer'; payload: number } {
  return event.type === 'answer';
}

export function isOptionSelectedEvent(
  event: QuizQuestionEvent
): event is { type: 'optionSelected'; payload: SelectedOption } {
  return event.type === 'optionSelected';
}

export function isSelectionMessageChangeEvent(
  event: QuizQuestionEvent
): event is { type: 'selectionMessageChange'; payload: string } {
  return event.type === 'selectionMessageChange';
}

export function isExplanationToDisplayChangeEvent(
  event: QuizQuestionEvent
): event is { type: 'explanationToDisplayChange'; payload: string } {
  return event.type === 'explanationToDisplayChange';
}

export function isShowExplanationChangeEvent(
  event: QuizQuestionEvent
): event is { type: 'showExplanationChange'; payload: boolean } {
  return event.type === 'showExplanationChange';
}
