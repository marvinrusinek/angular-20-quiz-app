/**
 * Contract tests for `norm()` — the foundation normalizer used by every
 * pristine-helper in QuizService and by every consumer that wants to
 * compare against pristine-helper output.
 *
 * The 2026-05-31 sweep hit a regression where consumers using a
 * HTML-aware `normalize()` mismatched the pristine helpers' `norm()`
 * output. These tests document the exact behavior of `norm()` so any
 * consumer can verify compatibility:
 *
 *   norm(value) === String(value ?? '').trim().toLowerCase()
 *
 * Critically, `norm()` does NOT:
 *   - Strip HTML tags
 *   - Replace `&nbsp;` or ` ` with space
 *   - Collapse internal whitespace
 *
 * Consumers needing those transforms must implement them separately.
 */
import { norm } from './text-norm';

describe('norm (simple text normalizer)', () => {
  // ── basic shape ───────────────────────────────────────────────────

  it('lowercases the input', () => {
    expect(norm('HELLO')).toBe('hello');
    expect(norm('Hello World')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(norm('  hello  ')).toBe('hello');
    expect(norm('\thello\n')).toBe('hello');
  });

  it('lowercases AND trims in one pass', () => {
    expect(norm('  HELLO  ')).toBe('hello');
  });

  // ── what norm() deliberately does NOT do ──────────────────────────

  it('does NOT strip HTML tags (preserved as-is)', () => {
    expect(norm('What is <code>2+2</code>?')).toBe('what is <code>2+2</code>?');
    expect(norm('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('does NOT replace &nbsp; with space', () => {
    expect(norm('hello&nbsp;world')).toBe('hello&nbsp;world');
  });

  it('does NOT replace non-breaking space (U+00A0) with regular space', () => {
    expect(norm('hello world')).toBe('hello world');
  });

  it('does NOT collapse internal whitespace', () => {
    expect(norm('hello   world')).toBe('hello   world');
    expect(norm('a\t\tb')).toBe('a\t\tb');
  });

  // ── null / undefined / empty inputs ───────────────────────────────

  it('returns empty string for null', () => {
    expect(norm(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(norm(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(norm('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(norm('   ')).toBe('');
    expect(norm('\n\t\n')).toBe('');
  });

  // ── coerces non-string inputs via String(...) ─────────────────────

  it('coerces numbers to string', () => {
    expect(norm(42)).toBe('42');
    expect(norm(0)).toBe('0');
  });

  it('coerces booleans to string', () => {
    expect(norm(true)).toBe('true');
    expect(norm(false)).toBe('false');
  });

  it('coerces objects via String() (typically "[object Object]")', () => {
    expect(norm({ a: 1 })).toBe('[object object]');
  });
});
