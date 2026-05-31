/**
 * Contract tests for `isOptionCorrect()` — the canonical coercion
 * helper that replaced ~10 inline copies of the same `true | 'true' |
 * 1 | '1'` check across the click pipeline (A1 work, 2026-05-31).
 *
 * Every option-correctness probe in the codebase routes through this
 * function. Locking down its semantics ensures that:
 *   - A future refactor of the function doesn't silently change
 *     which raw values are treated as "correct"
 *   - Callers can verify their input shape matches the documented
 *     contract without re-running browser tests
 */
import { isOptionCorrect } from './is-option-correct';

describe('isOptionCorrect', () => {
  // ── truthy raw values ─────────────────────────────────────────────

  it('returns true for boolean true', () => {
    expect(isOptionCorrect(true)).toBe(true);
  });

  it("returns true for string 'true'", () => {
    expect(isOptionCorrect('true')).toBe(true);
  });

  it('returns true for number 1', () => {
    expect(isOptionCorrect(1)).toBe(true);
  });

  it("returns true for string '1'", () => {
    expect(isOptionCorrect('1')).toBe(true);
  });

  // ── falsy raw values ──────────────────────────────────────────────

  it('returns false for boolean false', () => {
    expect(isOptionCorrect(false)).toBe(false);
  });

  it("returns false for string 'false'", () => {
    expect(isOptionCorrect('false')).toBe(false);
  });

  it('returns false for number 0', () => {
    expect(isOptionCorrect(0)).toBe(false);
  });

  it("returns false for string '0'", () => {
    expect(isOptionCorrect('0')).toBe(false);
  });

  // ── null / undefined ──────────────────────────────────────────────

  it('returns false for null', () => {
    expect(isOptionCorrect(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isOptionCorrect(undefined)).toBe(false);
  });

  // ── option-object inputs ──────────────────────────────────────────

  it('reads .correct from option objects (true)', () => {
    expect(isOptionCorrect({ correct: true })).toBe(true);
    expect(isOptionCorrect({ correct: 'true' })).toBe(true);
    expect(isOptionCorrect({ correct: 1 })).toBe(true);
    expect(isOptionCorrect({ correct: '1' })).toBe(true);
  });

  it('reads .correct from option objects (false / missing)', () => {
    expect(isOptionCorrect({ correct: false })).toBe(false);
    expect(isOptionCorrect({ correct: 0 })).toBe(false);
    expect(isOptionCorrect({})).toBe(false);
  });

  it('falls back to .isCorrect when .correct is null/undefined', () => {
    expect(isOptionCorrect({ isCorrect: true })).toBe(true);
    expect(isOptionCorrect({ isCorrect: 'true' })).toBe(true);
    expect(isOptionCorrect({ correct: null, isCorrect: 1 })).toBe(true);
  });

  it('prefers .correct over .isCorrect when both are present', () => {
    expect(isOptionCorrect({ correct: false, isCorrect: true })).toBe(false);
    expect(isOptionCorrect({ correct: true, isCorrect: false })).toBe(true);
  });

  // ── other types ───────────────────────────────────────────────────

  it('returns false for arbitrary strings', () => {
    expect(isOptionCorrect('yes')).toBe(false);
    expect(isOptionCorrect('correct')).toBe(false);
  });

  it('returns false for arrays and other unexpected types', () => {
    // Arrays are objects, so the function reads .correct on them.
    // [] doesn't have a `correct` key — returns false.
    expect(isOptionCorrect([])).toBe(false);
    expect(isOptionCorrect([1, 2, 3])).toBe(false);
  });
});
