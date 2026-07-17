import { readClaudeHudSnapshot, DEFAULT_SNAPSHOT_FRESHNESS_MS } from '../../src/claude-usage/hud-snapshot';
import { UsageData } from '../../src/claude-usage/types';

const NOW = Date.parse('2026-07-17T07:00:00.000Z');

function makeSnapshot(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    updated_at: '2026-07-17T06:59:00.000Z', // NOW 前 1 分钟，新鲜
    five_hour: { used_percentage: 42, resets_at: '2026-07-17T12:00:00.000Z' },
    seven_day: { used_percentage: 28, resets_at: '2026-07-23T07:00:00.000Z' },
    ...overrides,
  });
}

function readWith(content: string | null) {
  const readFileSync = jest.fn((_p: unknown, _enc: unknown) => {
    if (content === null) {
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  });
  return readClaudeHudSnapshot({
    snapshotPath: '/fake/snapshot.json',
    nowMs: NOW,
    readFileSync: readFileSync as never,
  });
}

describe('claude-usage/hud-snapshot', () => {
  it('把新鲜快照映射为 UsageData', () => {
    const result = readWith(makeSnapshot());

    expect(result).not.toBeNull();
    const usage = result as UsageData;
    expect(usage.fiveHour.utilization).toBe(42);
    expect(usage.fiveHour.resetsAt).toBe('2026-07-17T12:00:00.000Z');
    expect(usage.sevenDay.utilization).toBe(28);
    expect(usage.sevenDay.resetsAt).toBe('2026-07-23T07:00:00.000Z');
    // claude-hud 快照不携带按模型细分，回退时置空
    expect(usage.sevenDaySonnet).toBeNull();
    expect(usage.sevenDayOpus).toBeNull();
    expect(usage.sevenDayCowork).toBeNull();
    expect(usage.extraUsage).toBeNull();
  });

  it('快照文件缺失时返回 null', () => {
    expect(readWith(null)).toBeNull();
  });

  it('JSON 无效时返回 null', () => {
    expect(readWith('not-json')).toBeNull();
  });

  it('缺少 updated_at 时返回 null', () => {
    expect(readWith(makeSnapshot({ updated_at: undefined }))).toBeNull();
  });

  it('快照过期（超过新鲜度阈值）时返回 null', () => {
    const stale = '2026-07-17T06:00:00.000Z'; // NOW 前 1 小时
    expect(readWith(makeSnapshot({ updated_at: stale }))).toBeNull();
  });

  it('刚好在新鲜度边界内的快照仍可用', () => {
    // 边界值：比 NOW 早刚好 DEFAULT_SNAPSHOT_FRESHNESS_MS - 1ms
    const edge = new Date(NOW - (DEFAULT_SNAPSHOT_FRESHNESS_MS - 1)).toISOString();
    expect(readWith(makeSnapshot({ updated_at: edge }))).not.toBeNull();
  });

  it('five_hour 缺失时返回 null（要求两个窗口都有效）', () => {
    expect(readWith(makeSnapshot({ five_hour: null }))).toBeNull();
  });

  it('seven_day 缺失时返回 null', () => {
    expect(readWith(makeSnapshot({ seven_day: null }))).toBeNull();
  });

  it('used_percentage 不是数字时返回 null', () => {
    expect(
      readWith(makeSnapshot({ five_hour: { used_percentage: 'bad', resets_at: '2026-07-17T12:00:00.000Z' } }))
    ).toBeNull();
  });

  it('resets_at 缺失时仍可用（仅作为空字符串占位）', () => {
    const result = readWith(makeSnapshot({ five_hour: { used_percentage: 42 } }));
    expect(result).not.toBeNull();
    expect((result as UsageData).fiveHour.resetsAt).toBe('');
  });
});
