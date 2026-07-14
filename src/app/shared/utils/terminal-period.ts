/**
 * Ensure a sentence ends with a period.
 *
 * Appends a period when `text` (with trailing whitespace ignored) does NOT
 * already end in sentence-ending punctuation (`.`, `!`, `?` or `…`). A single
 * run of trailing closers (`)`, `]`, `}`, or a quote) is ignored for the check,
 * so a parenthesised/quoted ending that already has a period isn't
 * double-punctuated. Empty/whitespace input is returned unchanged (never a lone
 * period). Idempotent — a no-op when a terminator is already present.
 */
export function withTerminalPeriod(text: string): string {
  const trimmed = (text ?? '').replace(/\s+$/, '');
  if (!trimmed) return text;
  const meaningful = trimmed.replace(/[)\]}"'”’»]+$/, '');
  if (/[.!?…]$/.test(meaningful || trimmed)) return text;
  return `${trimmed}.`;
}
