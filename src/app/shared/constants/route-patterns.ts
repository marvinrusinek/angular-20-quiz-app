/** Centralized regex patterns for parsing route/URL segments. */

/** Matches /question/<quizId>/<questionIndex> and captures the 1-based index. */
export const QUESTION_ROUTE_REGEX = /\/question\/[^/]+\/(\d+)/;

/** Matches a trailing /<digits> segment with optional trailing slash, before query string or end. */
export const TRAILING_INDEX_REGEX = /\/(\d+)(?:\/)?(?:\?|$)/;

/** Matches a trailing /<digits> segment before query string or end (no optional slash). */
export const TRAILING_INDEX_STRICT_REGEX = /\/(\d+)(?:\?|$)/;
