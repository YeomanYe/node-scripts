import { parseSeconds } from '../../src/minimax-usage/index';

describe('minimax-usage/index', () => {
  test('uses default seconds when flag has no explicit value', () => {
    expect(parseSeconds(true, 300)).toBe(300);
  });

  test('parses explicit seconds', () => {
    expect(parseSeconds('900', 300)).toBe(900);
  });

  test('rejects invalid seconds', () => {
    expect(() => parseSeconds('0', 300)).toThrow('interval must be a positive integer');
    expect(() => parseSeconds('abc', 300)).toThrow('interval must be a positive integer');
  });
});
