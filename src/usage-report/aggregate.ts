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

  // 顶部时间戳 header
  const header = `**当前时间**：${formatLocalTime(opts.nowMs)}`;

  // 每个 provider 一块：标题独占一行，块与块之间用空行分隔（lark_md 里单 \n 换行较弱，
  // 用空行让 4 个 provider 在卡片里清晰分行、互不挤压）
  const providerBlocks = results.map((r) => {
    const { emoji, label } = PROVIDER_DISPLAY[r.key];
    const body = r.status === 'ok' ? r.report.content : `⚠️ 获取失败：${r.message}`;
    return `${emoji} **${label}**\n${body}`;
  });

  const content = [header, ...providerBlocks].join('\n\n');

  const summaryLine = results
    .map((r) => (r.status === 'ok' ? `${r.key}=${r.report.summaryLine}` : `${r.key}=ERROR:${r.message}`))
    .join(' ');

  return { title, content, level, summaryLine };
}
