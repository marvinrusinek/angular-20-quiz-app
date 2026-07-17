import { formatMMSS } from './format-time';

describe('formatMMSS', () => {
  it('formats minutes:seconds with two-digit seconds', () => {
    expect(formatMMSS(1800)).toBe('30:00');
    expect(formatMMSS(65)).toBe('1:05');
    expect(formatMMSS(9)).toBe('0:09');
    expect(formatMMSS(0)).toBe('0:00');
    expect(formatMMSS(600)).toBe('10:00');
  });

  it('clamps negatives and floors fractions', () => {
    expect(formatMMSS(-5)).toBe('0:00');
    expect(formatMMSS(90.9)).toBe('1:30');
  });
});
