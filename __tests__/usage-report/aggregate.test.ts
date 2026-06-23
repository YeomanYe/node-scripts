import { buildAggregateCard } from '@/usage-report/aggregate';
import { ProviderResult } from '@/usage-report/types';

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0); // 2026-06-21 12:00:00 UTC

function ok(key: 'claude' | 'codex' | 'minimax' | 'zai', content: string, level: 'info' | 'warn' = 'info', summaryLine = `${key}-summary`): ProviderResult {
  return { status: 'ok', key, report: { title: `${key} title`, content, level, summaryLine } };
}

function err(key: 'claude' | 'codex' | 'minimax' | 'zai', message: string): ProviderResult {
  return { status: 'error', key, message };
}

describe('buildAggregateCard', () => {
  it('全部 info 时 level=info，标题含「汇总」', () => {
    const card = buildAggregateCard(
      [ok('claude', 'c', 'info'), ok('codex', 'c', 'info'), ok('minimax', 'c', 'info'), ok('zai', 'c', 'info')],
      { nowMs: NOW }
    );
    expect(card.level).toBe('info');
    expect(card.title).toContain('汇总');
  });

  it('任一 ok 且 warn 时 level=warn，标题含「告警」', () => {
    const card = buildAggregateCard(
      [ok('claude', 'c', 'warn'), ok('codex', 'c', 'info'), ok('minimax', 'c', 'info'), ok('zai', 'c', 'info')],
      { nowMs: NOW }
    );
    expect(card.level).toBe('warn');
    expect(card.title).toContain('告警');
  });

  it('失败 provider 不影响 level：1 error + 3 info 仍是 info', () => {
    const card = buildAggregateCard(
      [err('claude', 'keychain 不可用'), ok('codex', 'c', 'info'), ok('minimax', 'c', 'info'), ok('zai', 'c', 'info')],
      { nowMs: NOW }
    );
    expect(card.level).toBe('info');
  });

  it('失败 provider 不影响 level：1 error + 1 warn + 2 info 仍是 warn', () => {
    const card = buildAggregateCard(
      [err('claude', 'x'), ok('codex', 'c', 'warn'), ok('minimax', 'c', 'info'), ok('zai', 'c', 'info')],
      { nowMs: NOW }
    );
    expect(card.level).toBe('warn');
  });

  it('四块都在，每块标题独占一行，块间用空行分隔', () => {
    const card = buildAggregateCard(
      [ok('claude', 'claude-body'), ok('codex', 'codex-body'), ok('minimax', 'minimax-body'), ok('zai', 'zai-body')],
      { nowMs: NOW }
    );
    expect(card.content).toContain('🟦 **Claude**');
    expect(card.content).toContain('🟩 **Codex**');
    expect(card.content).toContain('🟪 **MiniMax**');
    expect(card.content).toContain('🟧 **Z.ai**');
    // 每个 provider 标题独占一行（标题后紧跟换行再接正文）
    expect(card.content).toContain('🟦 **Claude**\nclaude-body');
    // 块间用空行分隔：header 后、各 provider 块之间都是 \n\n
    expect(card.content).toMatch(/\n\n🟦 \*\*Claude\*\*/);
    expect(card.content).toMatch(/claude-body\n\n🟩 \*\*Codex\*\*/);
    expect(card.content).toMatch(/codex-body\n\n🟪 \*\*MiniMax\*\*/);
  });

  it('ok 的块正文原样拼接（不二次格式化）', () => {
    const card = buildAggregateCard(
      [ok('claude', '**账号**：pro\n  5 小时：30%'), ok('codex', 'x'), ok('minimax', 'y'), ok('zai', 'z')],
      { nowMs: NOW }
    );
    expect(card.content).toContain('**账号**：pro\n  5 小时：30%');
  });

  it('失败的 provider 块显示「⚠️ 获取失败：<message>」', () => {
    const card = buildAggregateCard(
      [err('claude', '无法获取凭证'), ok('codex', 'c'), ok('minimax', 'c'), ok('zai', 'c')],
      { nowMs: NOW }
    );
    expect(card.content).toContain('🟦 **Claude**');
    expect(card.content).toContain('⚠️ 获取失败：无法获取凭证');
  });

  it('顶部带当前时间 header', () => {
    const card = buildAggregateCard([ok('claude', 'c'), ok('codex', 'c'), ok('minimax', 'c'), ok('zai', 'c')], { nowMs: NOW });
    expect(card.content).toContain('**当前时间**：');
    expect(card.content).toContain('2026-06-21');
  });

  it('summaryLine：ok 形如 key=<report.summaryLine>，error 形如 key=ERROR:<message>', () => {
    const card = buildAggregateCard(
      [ok('claude', 'c', 'info', 'alert=false'), err('codex', '401'), ok('minimax', 'c', 'info', 'mm alert=true'), ok('zai', 'c', 'info', 'z ok')],
      { nowMs: NOW }
    );
    expect(card.summaryLine).toContain('claude=alert=false');
    expect(card.summaryLine).toContain('codex=ERROR:401');
    expect(card.summaryLine).toContain('minimax=mm alert=true');
    expect(card.summaryLine).toContain('zai=z ok');
  });
});
