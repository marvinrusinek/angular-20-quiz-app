/**
 * Check whether an option (or a raw correct-flag value) represents a correct answer.
 *
 * Handles all coercion variants found in quiz data:
 *   boolean true, string 'true', number 1, string '1'
 *
 * Accepts either:
 *   - An option object with a `.correct` (or `.isCorrect`) property
 *   - A raw value (boolean, number, string)
 */
export function isOptionCorrect(o: any): boolean {
  if (o == null) return false;
  if (o === true || o === 'true' || o === 1 || o === '1') return true;
  if (typeof o === 'object') {
    const c = o.correct ?? o.isCorrect;
    return c === true || String(c) === 'true' || c === 1 || c === '1';
  }
  return false;
}
