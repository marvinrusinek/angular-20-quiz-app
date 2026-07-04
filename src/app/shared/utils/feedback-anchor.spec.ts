import { feedbackAnchorMatches } from './feedback-anchor';

describe('feedbackAnchorMatches', () => {
  it('returns false for a null/undefined anchor', () => {
    expect(feedbackAnchorMatches(null, 5, 0)).toBe(false);
    expect(feedbackAnchorMatches(undefined, 5, 0)).toBe(false);
  });

  it('matches by optionId (identity) regardless of display index', () => {
    const anchor = { idx: 2, optionId: 42 };
    // Pinned AOTA: canonical idx 2, now rendered at display index 3.
    expect(feedbackAnchorMatches(anchor, 42, 3)).toBe(true);
    // A different option sitting at the anchor's old canonical index must NOT match.
    expect(feedbackAnchorMatches(anchor, 99, 2)).toBe(false);
  });

  it('falls back to index when no optionId is tracked', () => {
    const anchor = { idx: 1 };
    expect(feedbackAnchorMatches(anchor, 7, 1)).toBe(true);
    expect(feedbackAnchorMatches(anchor, 7, 2)).toBe(false);
  });

  it('falls back to index when the option has no id', () => {
    const anchor = { idx: 1, optionId: 7 };
    expect(feedbackAnchorMatches(anchor, null, 1)).toBe(true);
    expect(feedbackAnchorMatches(anchor, undefined, 2)).toBe(false);
  });
});
