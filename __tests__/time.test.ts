import { parseTime, getCurrentTimeInMinutes, getNextExecutionTime, getNextDayFirstTime } from '../src/auto-cmd/time';

describe('parseTime', () => {
  it('should parse time string to minutes', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('01:00')).toBe(60);
    expect(parseTime('12:30')).toBe(750);
    expect(parseTime('23:59')).toBe(1439);
  });
});

describe('getCurrentTimeInMinutes', () => {
  it('should return current time in minutes', () => {
    const result = getCurrentTimeInMinutes();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1439);
  });
});

describe('getNextExecutionTime', () => {
  it('should return next execution time in milliseconds', () => {
    const targetTimes = ['00:00', '12:00', '23:59'];
    const result = getNextExecutionTime(targetTimes);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('getNextDayFirstTime', () => {
  it('should return next day first execution time in milliseconds', () => {
    const targetTimes = ['00:00', '12:00', '23:59'];
    const result = getNextDayFirstTime(targetTimes);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
