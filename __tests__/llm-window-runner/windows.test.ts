import {
  anchorFromClaude,
  anchorFromCodex,
  anchorFromMinimax,
  anchorFromZai,
} from '../../src/llm-window-runner/windows';
import { MiniMaxQuotaSnapshot } from '../../src/minimax-usage/types';
import { ZaiUsageSnapshot } from '../../src/zai-usage/types';
import { UsageData as ClaudeUsageData } from '../../src/claude-usage/types';
import { UsageSnapshot as CodexSnapshot } from '../../src/codex-usage/types';

const HOUR = 60 * 60 * 1000;
const FIVE_HOUR = 5 * HOUR;
const SEVEN_DAY = 7 * 24 * HOUR;

describe('anchorFromMinimax', () => {
  const snapshot: MiniMaxQuotaSnapshot = {
    raw: {},
    planName: null,
    models: [
      {
        modelName: 'M2',
        interval: {
          startMs: 1000,
          endMs: 1000 + FIVE_HOUR,
          remainsMs: HOUR,
          totalCount: 100,
          usageCount: 10,
          remainingPercent: 90,
          usedPercent: 10,
          status: 1,
        },
        weekly: {
          startMs: 2000,
          endMs: 2000 + SEVEN_DAY,
          remainsMs: HOUR,
          totalCount: 1000,
          usageCount: 100,
          remainingPercent: 90,
          usedPercent: 10,
          status: 1,
        },
      },
    ],
  };

  it('interval 窗口 → start + 5h duration', () => {
    const result = anchorFromMinimax(snapshot, { type: 'minimax', model: 'M2', window: 'interval' });
    expect(result.anchor).toEqual({ startMs: 1000, durationMs: FIVE_HOUR });
  });

  it('weekly 窗口 → start + 7d duration', () => {
    const result = anchorFromMinimax(snapshot, { type: 'minimax', model: 'M2', window: 'weekly' });
    expect(result.anchor).toEqual({ startMs: 2000, durationMs: SEVEN_DAY });
  });

  it('未配 model → 取首个', () => {
    const result = anchorFromMinimax(snapshot, { type: 'minimax', window: 'interval' });
    expect(result.meta['modelName']).toBe('M2');
  });

  it('指定 model 不存在 → 抛错', () => {
    expect(() => anchorFromMinimax(snapshot, { type: 'minimax', model: 'ghost', window: 'interval' })).toThrow(/未包含/);
  });

  it('windowStartMs/endMs 缺失 → 抛错', () => {
    const bad: MiniMaxQuotaSnapshot = {
      ...snapshot,
      models: [{
        ...snapshot.models[0]!,
        interval: { ...snapshot.models[0]!.interval, startMs: null },
      }],
    };
    expect(() => anchorFromMinimax(bad, { type: 'minimax', model: 'M2', window: 'interval' })).toThrow(/缺少/);
  });
});

describe('anchorFromZai', () => {
  const window = {
    type: 'TOKENS_LIMIT' as const,
    windowMinutes: 300, // 5h
    windowLabel: '5h',
    usage: 10,
    remaining: 90,
    currentValue: 10,
    usedPercent: 10,
    resetsAtMs: 5_000,
    usageDetails: [],
  };
  const snapshot: ZaiUsageSnapshot = {
    raw: {},
    planName: 'pro',
    primary: window,
    secondary: { ...window, resetsAtMs: 9_000, windowMinutes: 60 * 24 },
  };

  it('primary → resetsAtMs + windowMinutes*60s duration', () => {
    const result = anchorFromZai(snapshot, { type: 'zai', window: 'primary' });
    expect(result.anchor).toEqual({ startMs: 5_000, durationMs: 300 * 60 * 1000 });
  });

  it('secondary → 不同 resetsAtMs / duration', () => {
    const result = anchorFromZai(snapshot, { type: 'zai', window: 'secondary' });
    expect(result.anchor.startMs).toBe(9_000);
    expect(result.anchor.durationMs).toBe(24 * HOUR);
  });

  it('缺失 windowMinutes → 抛错', () => {
    const bad: ZaiUsageSnapshot = { ...snapshot, primary: { ...window, windowMinutes: null } };
    expect(() => anchorFromZai(bad, { type: 'zai', window: 'primary' })).toThrow(/windowMinutes/);
  });

  it('window=null → 抛错', () => {
    const bad: ZaiUsageSnapshot = { ...snapshot, primary: null };
    expect(() => anchorFromZai(bad, { type: 'zai', window: 'primary' })).toThrow(/缺少/);
  });
});

describe('anchorFromClaude', () => {
  const snapshot: ClaudeUsageData = {
    fiveHour: { utilization: 50, resetsAt: '2026-06-27T10:00:00Z' },
    sevenDay: { utilization: 30, resetsAt: '2026-07-01T00:00:00Z' },
    sevenDaySonnet: null,
    sevenDayOpus: null,
    sevenDayCowork: null,
    extraUsage: null,
  };

  it('fiveHour → 5h duration', () => {
    const result = anchorFromClaude(snapshot, { type: 'claude', window: 'fiveHour' });
    expect(result.anchor.startMs).toBe(Date.parse('2026-06-27T10:00:00Z'));
    expect(result.anchor.durationMs).toBe(FIVE_HOUR);
  });

  it('sevenDay → 7d duration', () => {
    const result = anchorFromClaude(snapshot, { type: 'claude', window: 'sevenDay' });
    expect(result.anchor.startMs).toBe(Date.parse('2026-07-01T00:00:00Z'));
    expect(result.anchor.durationMs).toBe(SEVEN_DAY);
  });

  it('resetsAt 无法解析 → 抛错', () => {
    const bad: ClaudeUsageData = { ...snapshot, fiveHour: { utilization: 0, resetsAt: 'not-a-date' } };
    expect(() => anchorFromClaude(bad, { type: 'claude', window: 'fiveHour' })).toThrow(/解析失败/);
  });
});

describe('anchorFromCodex', () => {
  const epochSec = 1_700_000_000;
  const snapshot: CodexSnapshot = {
    planType: 'plus',
    primary: { usedPercent: 10, windowMinutes: 300, resetsAt: epochSec },
    secondary: { usedPercent: 5, windowMinutes: 7 * 24 * 60, resetsAt: epochSec + 1000 },
    additional: [],
    raw: {},
  };

  it('primary → resetsAt*1000 + duration', () => {
    const result = anchorFromCodex(snapshot, { type: 'codex', window: 'primary' });
    expect(result.anchor.startMs).toBe(epochSec * 1000);
    expect(result.anchor.durationMs).toBe(300 * 60 * 1000);
  });

  it('secondary → 不同窗口', () => {
    const result = anchorFromCodex(snapshot, { type: 'codex', window: 'secondary' });
    expect(result.anchor.startMs).toBe((epochSec + 1000) * 1000);
    expect(result.anchor.durationMs).toBe(SEVEN_DAY);
  });

  it('limitId 指向 additional → 返回对应 window', () => {
    const withExtra: CodexSnapshot = {
      ...snapshot,
      additional: [
        {
          limitId: 'codex-extra',
          limitName: 'Extra',
          primary: { usedPercent: 0, windowMinutes: 60, resetsAt: epochSec + 2000 },
        },
      ],
    };
    const result = anchorFromCodex(withExtra, { type: 'codex', window: 'primary', limitId: 'codex-extra' });
    expect(result.anchor.startMs).toBe((epochSec + 2000) * 1000);
    expect(result.anchor.durationMs).toBe(HOUR);
  });

  it('limitId 未匹配 → 抛错', () => {
    expect(() => anchorFromCodex(snapshot, { type: 'codex', window: 'primary', limitId: 'ghost' })).toThrow(/未包含/);
  });

  it('resetsAt 缺失 → 抛错', () => {
    const bad: CodexSnapshot = { ...snapshot, primary: { usedPercent: 0, windowMinutes: 300, resetsAt: null } };
    expect(() => anchorFromCodex(bad, { type: 'codex', window: 'primary' })).toThrow(/缺少 resetsAt/);
  });
});
