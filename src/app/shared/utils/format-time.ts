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

/**
 * Human-friendly duration for the Interview History record, e.g. `24m 31s`,
 * `45s`, or `1h 4m 31s`. Negative/invalid values clamp to `0s`. Distinct from
 * formatMMSS (a clock display) — this reads as prose in the history cards.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}
