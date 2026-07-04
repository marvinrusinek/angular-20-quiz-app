/**
 * Feedback-anchor matching.
 *
 * `_feedbackDisplay` records which option currently shows inline feedback. It was
 * historically anchored by array index (`idx === displayIndex`), which is only
 * safe while the rendered order equals the canonical order. The render layer pins
 * "All of the above" LAST, so a pinned option's display index differs from its
 * canonical index — an index-only anchor would render feedback under the wrong
 * row (or double-render). Anchoring by optionId (identity) instead is
 * display-order-independent. We keep the index as a fallback for the rare case
 * where no optionId was captured (legacy/edge paths).
 */
export interface FeedbackAnchorRef {
  idx: number;
  optionId?: number | null;
}

/** True when the feedback anchor points at this option — by identity if available, else by index. */
export function feedbackAnchorMatches(
  anchor: FeedbackAnchorRef | null | undefined,
  optionId: number | null | undefined,
  displayIndex: number
): boolean {
  if (!anchor) return false;
  if (anchor.optionId != null && optionId != null) {
    return anchor.optionId === optionId;
  }
  return anchor.idx === displayIndex;
}
