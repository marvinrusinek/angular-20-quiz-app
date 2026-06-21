import { deriveHeadingHtml, shouldShowFet, HeadingInputs } from './heading-model';

/**
 * Stage 1 of the heading/FET refactor: lock the heading-derivation rules as an
 * executable spec. These are the rules the eventual single-source heading must
 * satisfy; Stage 2 validates the live behavior against this model.
 */

const base: HeadingInputs = {
  questionHtml: '<span>Question?</span>',
  fetHtml: 'Option 1 is correct because ...',
  isMultiAnswer: false,
  isMultiAnswerComplete: false,
  isSingleAnswered: false,
  isTimedOut: false,
  hasInteracted: false,
  optionsReady: true,
  isNavigatingToPrevious: false,
  interactedThisVisit: false,
};

const inputs = (over: Partial<HeadingInputs>): HeadingInputs => ({ ...base, ...over });

describe('heading-model: shouldShowFet', () => {
  it('single-answer, unanswered → question (no FET)', () => {
    expect(shouldShowFet(inputs({ hasInteracted: true }))).toBe(false);
  });

  it('single-answer, answered correctly → FET', () => {
    expect(shouldShowFet(inputs({ hasInteracted: true, isSingleAnswered: true }))).toBe(true);
  });

  it('multi-answer, in progress (interacted, not complete) → question + banner (no FET)', () => {
    expect(shouldShowFet(inputs({ isMultiAnswer: true, hasInteracted: true }))).toBe(false);
  });

  it('multi-answer, complete → FET', () => {
    expect(shouldShowFet(inputs({ isMultiAnswer: true, hasInteracted: true, isMultiAnswerComplete: true }))).toBe(true);
  });

  it('timeout reveals the FET even without interaction', () => {
    expect(shouldShowFet(inputs({ isTimedOut: true }))).toBe(true);
    expect(shouldShowFet(inputs({ isMultiAnswer: true, isTimedOut: true }))).toBe(true);
  });

  it('no interaction and no timeout → never FET', () => {
    expect(shouldShowFet(inputs({ isSingleAnswered: true }))).toBe(false);
    expect(shouldShowFet(inputs({ isMultiAnswer: true, isMultiAnswerComplete: true }))).toBe(false);
  });

  // §5.3 — cold load / options not ready never shows a (stale) FET.
  it('cold load (options not ready) → never FET, even when otherwise resolved', () => {
    expect(shouldShowFet(inputs({ optionsReady: false, hasInteracted: true, isSingleAnswered: true }))).toBe(false);
    expect(shouldShowFet(inputs({ optionsReady: false, isTimedOut: true }))).toBe(false);
  });

  // §5.2 / §5.11 — on a revisit the FET is suppressed even for a resolved or
  // timed-out question; it shows only on the live answer view.
  it('revisit (navigated here, not re-answered) → never FET, even when resolved', () => {
    expect(shouldShowFet(inputs({ isNavigatingToPrevious: true, hasInteracted: true, isSingleAnswered: true }))).toBe(false);
    expect(shouldShowFet(inputs({ isNavigatingToPrevious: true, isMultiAnswer: true, hasInteracted: true, isMultiAnswerComplete: true }))).toBe(false);
    expect(shouldShowFet(inputs({ isNavigatingToPrevious: true, isTimedOut: true }))).toBe(false);
  });

  // §5.6 — a first-time timeout on the live view (not a revisit) reveals the FET.
  it('live first-time timeout (not a revisit) → FET', () => {
    expect(shouldShowFet(inputs({ isTimedOut: true }))).toBe(true);
    expect(shouldShowFet(inputs({ isTimedOut: true, isNavigatingToPrevious: false }))).toBe(true);
  });

  // §5.7 — completing a question REACHED BY NAVIGATION still shows the FET, even
  // though isNavigatingToPrevious can remain stale-true: interactedThisVisit
  // (set on the genuine click) distinguishes the live completion view from a
  // revisit. Regression guard for the shadow-sweep false negative.
  it('completion view reached by nav (isNavigatingToPrevious stale-true + interactedThisVisit) → FET', () => {
    expect(shouldShowFet(inputs({
      isMultiAnswer: true, hasInteracted: true, isMultiAnswerComplete: true,
      isNavigatingToPrevious: true, interactedThisVisit: true,
    }))).toBe(true);
    expect(shouldShowFet(inputs({
      hasInteracted: true, isSingleAnswered: true,
      isNavigatingToPrevious: true, interactedThisVisit: true,
    }))).toBe(true);
  });

  // The revisit suppression still holds when the user has NOT interacted this visit.
  it('revisit without interaction this visit → no FET (resolved or timed-out)', () => {
    expect(shouldShowFet(inputs({
      isMultiAnswer: true, hasInteracted: true, isMultiAnswerComplete: true,
      isNavigatingToPrevious: true, interactedThisVisit: false,
    }))).toBe(false);
    expect(shouldShowFet(inputs({ isTimedOut: true, isNavigatingToPrevious: true, interactedThisVisit: false }))).toBe(false);
  });
});

describe('heading-model: deriveHeadingHtml', () => {
  it('returns the FET when the FET should show and text exists', () => {
    const i = inputs({ hasInteracted: true, isSingleAnswered: true });
    expect(deriveHeadingHtml(i)).toBe(i.fetHtml);
  });

  it('returns the question (+banner) when the FET should NOT show', () => {
    const i = inputs({ isMultiAnswer: true, hasInteracted: true });
    expect(deriveHeadingHtml(i)).toBe(i.questionHtml);
  });

  it('falls back to the question when the FET should show but no FET text exists', () => {
    const i = inputs({ isTimedOut: true, fetHtml: '   ' });
    expect(deriveHeadingHtml(i)).toBe(i.questionHtml);
  });

  it('multi-answer in progress keeps the question + banner', () => {
    const i = inputs({ isMultiAnswer: true, hasInteracted: true, questionHtml: 'Q <span class="correct-count">2 answers are correct</span>' });
    expect(deriveHeadingHtml(i)).toBe(i.questionHtml);
  });
});
