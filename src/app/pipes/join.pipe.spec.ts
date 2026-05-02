import { JoinPipe } from './join.pipe';

describe('JoinPipe', () => {
  let pipe: JoinPipe;

  beforeEach(() => {
    pipe = new JoinPipe();
  });

  it('should create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('should join two items with " and "', () => {
    expect(pipe.transform(['Angular', 'React'])).toBe('Angular and React');
  });

  it('should join three items with " and "', () => {
    expect(pipe.transform(['A', 'B', 'C'])).toBe('A and B and C');
  });

  it('should return a single item as-is', () => {
    expect(pipe.transform(['Solo'])).toBe('Solo');
  });

  it('should return empty string for empty array', () => {
    expect(pipe.transform([])).toBe('');
  });
});
