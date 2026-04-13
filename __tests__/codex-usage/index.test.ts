import { parseWatchInterval } from '../../src/codex-usage/index';

describe('codex-usage/index', () => {
  it('uses 30 seconds when --watch has no explicit value', () => {
    expect(parseWatchInterval(true)).toBe(30);
  });

  it('parses an explicit watch interval', () => {
    expect(parseWatchInterval('15')).toBe(15);
  });

  it('throws for invalid watch interval', () => {
    expect(() => parseWatchInterval('0')).toThrow('watch interval must be a positive integer');
    expect(() => parseWatchInterval('abc')).toThrow('watch interval must be a positive integer');
  });
});
