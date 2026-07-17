/**
 * Format a duration in seconds as `M:SS` (minutes not zero-padded, seconds
 * always two digits). Negative values clamp to 0. Shared by the Interview timer
 * and the Interview Results "time used" display.
 *
 *   formatMMSS(1800) === '30:00'
 *   formatMMSS(65)   === '1:05'
 *   formatMMSS(9)    === '0:09'
 */
export function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
