import { AggregateCard, ProviderKey, ProviderResult } from './types';

/** 各 provider 在卡片中的展示样式（emoji + 标签） */
export const PROVIDER_DISPLAY: Record<ProviderKey, { emoji: string; label: string }> = {
  claude: { emoji: '🟦', label: 'Claude' },
  codex: { emoji: '🟩', label: 'Codex' },
  minimax: { emoji: '🟪', label: 'MiniMax' },
  zai: { emoji: '🟧', label: 'Z.ai' },
};

/** 把 epoch ms 格式化为本地时间字符串 YYYY-MM-DD HH:mm:ss */
export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 把 4 个 provider 的结果拼成一张飞书卡片的 {title, content, level, summaryLine}。
 * 纯函数，无副作用。
 *
 * - level：任一「成功且 warn」的 provider 触发整体 warn（红 header）；失败的 provider 不计入
 * - content：顶部时间戳 header + 4 个 provider 分块（块间用 lark_md 分隔线 ---）
 * - 失败的 provider 块显示「⚠️ 获取失败：<message>」
 */
export function buildAggregateCard(results: ProviderResult[], opts: { nowMs: number }): AggregateCard {
  const anyWarn = results.some((r) => r.status === 'ok' && r.report.level === 'warn');
  const level: 'info' | 'warn' = anyWarn ? 'warn' : 'info';
  const title = anyWarn ? '🚨 LLM 用量告警' : '📊 LLM 用量汇总';

  const blocks: string[] = [`**当前时间**：${formatLocalTime(opts.nowMs)}`];

  for (const r of results) {
    const { emoji, label } = PROVIDER_DISPLAY[r.key];
    blocks.push('---');
    blocks.push(`${emoji} **${label}**`);
    if (r.status === 'ok') {
      blocks.push(r.report.content);
    } else {
      blocks.push(`⚠️ 获取失败：${r.message}`);
    }
  }

  const content = blocks.join('\n');

  const summaryLine = results
    .map((r) => (r.status === 'ok' ? `${r.key}=${r.report.summaryLine}` : `${r.key}=ERROR:${r.message}`))
    .join(' ');

  return { title, content, level, summaryLine };
}
