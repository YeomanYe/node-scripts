import { parseSeconds } from '@/usage-report/index';

describe('parseSeconds', () => {
  it('数字字符串 → 正整数', () => {
    expect(parseSeconds('900', 300)).toBe(900);
    expect(parseSeconds('60', 300)).toBe(60);
  });

  it('true（--poll 无值）→ 默认值', () => {
    expect(parseSeconds(true, 300)).toBe(300);
  });

  it('非正整数抛错', () => {
    expect(() => parseSeconds('0', 300)).toThrow();
    expect(() => parseSeconds('-5', 300)).toThrow();
    expect(() => parseSeconds('abc', 300)).toThrow();
  });
});
