import { isAllOfTheAbove, pinAllOfTheAboveLast } from './all-of-the-above';

describe('isAllOfTheAbove', () => {
  it('matches plain text', () => {
    expect(isAllOfTheAbove('All of the above')).toBe(true);
    expect(isAllOfTheAbove('all of the above')).toBe(true);
  });

  it('ignores trailing punctuation, HTML and extra whitespace', () => {
    expect(isAllOfTheAbove('All of the above.')).toBe(true);
    expect(isAllOfTheAbove('<b>All of the above</b>')).toBe(true);
    expect(isAllOfTheAbove('  All   of the   above  ')).toBe(true);
    expect(isAllOfTheAbove('All of the above&nbsp;')).toBe(true);
  });

  it('rejects non-matches', () => {
    expect(isAllOfTheAbove('None of the above')).toBe(false);
    expect(isAllOfTheAbove('All of these')).toBe(false);
    expect(isAllOfTheAbove('')).toBe(false);
    expect(isAllOfTheAbove(null)).toBe(false);
    expect(isAllOfTheAbove(undefined)).toBe(false);
  });
});

describe('pinAllOfTheAboveLast', () => {
  const get = (o: { text: string }) => o.text;

  it('moves AOTA to the end, preserving other order', () => {
    const items = [{ text: 'A' }, { text: 'All of the above' }, { text: 'B' }, { text: 'C' }];
    expect(pinAllOfTheAboveLast(items, get).map(get)).toEqual(['A', 'B', 'C', 'All of the above']);
  });

  it('is idempotent (already-last stays put, no churn)', () => {
    const items = [{ text: 'A' }, { text: 'B' }, { text: 'All of the above' }];
    const once = pinAllOfTheAboveLast(items, get);
    const twice = pinAllOfTheAboveLast(once, get);
    expect(twice.map(get)).toEqual(['A', 'B', 'All of the above']);
  });

  it('returns the input unchanged when there is no AOTA', () => {
    const items = [{ text: 'A' }, { text: 'B' }];
    expect(pinAllOfTheAboveLast(items, get)).toBe(items);
  });

  it('handles empty / single-item arrays', () => {
    expect(pinAllOfTheAboveLast([], get)).toEqual([]);
    const single = [{ text: 'All of the above' }];
    expect(pinAllOfTheAboveLast(single, get)).toBe(single);
  });
});
