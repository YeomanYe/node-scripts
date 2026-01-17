import { getTodayDateString } from '../src/auto-cmd/state';

describe('getTodayDateString', () => {
  it('should return today\'s date in YYYY-MM-DD format', () => {
    const result = getTodayDateString();
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    expect(regex.test(result)).toBe(true);
  });
});
