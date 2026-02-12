import { parseCount, parseWait } from '../src/auto-cmd/executor';

describe('parseCount', () => {
  it('should return default values when count is undefined', () => {
    const result = parseCount();
    expect(result).toEqual({ min: 1, max: 1 });
  });

  it('should return single value when count is a number string', () => {
    expect(parseCount('1')).toEqual({ min: 1, max: 1 });
    expect(parseCount('5')).toEqual({ min: 5, max: 5 });
  });

  it('should return range values when count is a range string', () => {
    expect(parseCount('1-3')).toEqual({ min: 1, max: 3 });
    expect(parseCount('2-5')).toEqual({ min: 2, max: 5 });
  });

  it('should handle invalid count values by returning minimum 1', () => {
    expect(parseCount('0')).toEqual({ min: 1, max: 1 });
    expect(parseCount('-1')).toEqual({ min: 1, max: 1 });
    expect(parseCount('abc')).toEqual({ min: 1, max: 1 });
  });

  it('should ensure min is at least 1 for range values', () => {
    expect(parseCount('0-3')).toEqual({ min: 1, max: 3 });
    expect(parseCount('-1-5')).toEqual({ min: 1, max: 5 });
  });

  it('should ensure max is at least min for range values', () => {
    expect(parseCount('3-1')).toEqual({ min: 1, max: 3 });
  });
});

describe('parseWait', () => {
  it('should return 0 when wait is undefined', () => {
    const result = parseWait();
    expect(result).toEqual({ min: 0, max: 0 });
  });

  it('should return 0 when wait is null', () => {
    // @ts-ignore - testing invalid input
    const result = parseWait(null);
    expect(result).toEqual({ min: 0, max: 0 });
  });

  it('should convert number to milliseconds', () => {
    expect(parseWait(5)).toEqual({ min: 5000, max: 5000 });
    expect(parseWait(0.5)).toEqual({ min: 500, max: 500 });
    expect(parseWait(0)).toEqual({ min: 0, max: 0 });
  });

  it('should handle negative numbers by returning 0', () => {
    expect(parseWait(-1)).toEqual({ min: 0, max: 0 });
    expect(parseWait(-5)).toEqual({ min: 0, max: 0 });
  });

  it('should parse single number string', () => {
    expect(parseWait('5')).toEqual({ min: 5000, max: 5000 });
    expect(parseWait('0.5')).toEqual({ min: 500, max: 500 });
  });

  it('should parse range string and convert to milliseconds', () => {
    expect(parseWait('5-10')).toEqual({ min: 5000, max: 10000 });
    expect(parseWait('1-3')).toEqual({ min: 1000, max: 3000 });
    expect(parseWait('0.5-1.5')).toEqual({ min: 500, max: 1500 });
  });

  it('should handle reversed range string', () => {
    expect(parseWait('10-5')).toEqual({ min: 5000, max: 10000 });
  });

  it('should return 0 for invalid string values', () => {
    expect(parseWait('abc')).toEqual({ min: 0, max: 0 });
    expect(parseWait('')).toEqual({ min: 0, max: 0 });
    expect(parseWait('5-')).toEqual({ min: 0, max: 0 });
    expect(parseWait('-10')).toEqual({ min: 0, max: 0 });
  });

  it('should return 0 for invalid range string', () => {
    expect(parseWait('5-abc')).toEqual({ min: 0, max: 0 });
    expect(parseWait('abc-10')).toEqual({ min: 0, max: 0 });
  });
});
