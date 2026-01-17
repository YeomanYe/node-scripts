import { parseCount } from '../src/auto-cmd/executor';

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
