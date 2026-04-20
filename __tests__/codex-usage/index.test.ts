import { parseSeconds } from '../../src/codex-usage/index';

describe('codex-usage/index', () => {
  it('uses default seconds when raw is true', () => {
    expect(parseSeconds(true, 30)).toBe(30);
    expect(parseSeconds(true, 300)).toBe(300);
  });

  it('parses an explicit interval', () => {
    expect(parseSeconds('15', 30)).toBe(15);
  });

  it('throws for invalid interval', () => {
    expect(() => parseSeconds('0', 30)).toThrow('interval must be a positive integer');
    expect(() => parseSeconds('abc', 30)).toThrow('interval must be a positive integer');
  });
});
