/**
 * Safe wrappers around localStorage. Unlike sessionStorage (see
 * session-storage.ts), localStorage persists across browser sessions — use it
 * for durable user preferences. Errors are swallowed so callers don't need to
 * re-implement try/catch (private-browsing / quota failures are non-fatal for
 * preference data).
 */

import { swallow } from './error-logging';

/** Read a raw string from localStorage. Returns `fallback` on miss / error. */
export function readLocalString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write a raw string to localStorage. Errors are swallowed. */
export function writeLocalString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err: unknown) { swallow('local-storage.ts', err); /* ignore */ }
}
