import { UsageData, Credentials, ResetInfo } from './types';

/** ANSI 颜色代码 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[97m',
} as const;

/** 进度条宽度（字符数） */
const BAR_WIDTH = 30;

/**
 * 根据百分比返回对应颜色代码
 * @param percent - 使用百分比（0-100）
 * @returns ANSI 颜色代码
 */
function getColor(percent: number): string {
  if (percent < 50) return COLORS.green;
  if (percent <= 80) return COLORS.yellow;
  return COLORS.red;
}

/**
 * 生成彩色进度条
 * @param percent - 使用百分比（0-100）
 * @returns 带颜色的进度条字符串
 */
function progressBar(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const color = getColor(clamped);

  const bar = `${color}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset}`;
  const label = `${COLORS.bold}${color}${clamped.toFixed(1)}%${COLORS.reset}`;

  return `${bar} ${label}`;
}

/**
 * 计算距重置时间的剩余时长描述
 * @param resetsAt - ISO 8601 格式的重置时间
 * @returns 剩余时长文本（如 "2h 15m"）
 */
function formatTimeRemaining(resetsAt: string): string {
  const resetTime = new Date(resetsAt).getTime();
  const now = Date.now();
  const diffMs = resetTime - now;

  if (diffMs <= 0) return '已重置';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * 将 ISO 8601 时间转换为本地时间字符串
 * @param resetsAt - ISO 8601 格式的重置时间
 * @returns 本地时间描述（MM-DD HH:MM 格式）
 */
function formatLocalTime(resetsAt: string): string {
  const date = new Date(resetsAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * 显示单项用量信息
 * @param label - 标签名称
 * @param info - 重置信息
 */
function displayUsageItem(label: string, info: ResetInfo): void {
  const remaining = formatTimeRemaining(info.resetsAt);
  const localTime = formatLocalTime(info.resetsAt);

  process.stdout.write(
    `  ${COLORS.bold}${COLORS.white}  ${label}${COLORS.reset}\n` +
    `  ${progressBar(info.utilization)}\n` +
    `  ${COLORS.dim}  重置: ${localTime} (剩余 ${remaining})${COLORS.reset}\n\n`
  );
}

/**
 * 格式化并显示完整的用量信息
 * @param usage - 用量数据
 * @param credentials - 凭证信息
 */
export function displayUsage(usage: UsageData, credentials: Credentials): void {
  const divider = `  ${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`;

  process.stdout.write('\n');
  process.stdout.write(`  ${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════════════════╗${COLORS.reset}\n`);
  process.stdout.write(`  ${COLORS.bold}${COLORS.cyan}║         ${COLORS.white}Claude Usage Monitor${COLORS.cyan}                    ║${COLORS.reset}\n`);
  process.stdout.write(`  ${COLORS.bold}${COLORS.cyan}╚══════════════════════════════════════════════════╝${COLORS.reset}\n\n`);

  // 订阅信息
  process.stdout.write(
    `  ${COLORS.dim}Subscription:${COLORS.reset} ${COLORS.bold}${COLORS.magenta}${credentials.subscriptionType}${COLORS.reset}` +
    `  ${COLORS.dim}|  Tier:${COLORS.reset} ${COLORS.bold}${COLORS.blue}${credentials.rateLimitTier}${COLORS.reset}\n` +
    `  ${COLORS.dim}${new Date().toLocaleString()}${COLORS.reset}\n\n`
  );

  process.stdout.write(`${divider}\n\n`);

  // 5 小时窗口
  displayUsageItem('5 小时限额', usage.fiveHour);

  process.stdout.write(`${divider}\n\n`);

  // 7 天总用量
  displayUsageItem('7 天总限额', usage.sevenDay);

  // 7 天 Sonnet（非空且有用量时显示）
  if (usage.sevenDaySonnet && usage.sevenDaySonnet.utilization > 0) {
    displayUsageItem('7 天 Sonnet', usage.sevenDaySonnet);
  }

  // 7 天 Opus（非空且有用量时显示）
  if (usage.sevenDayOpus && usage.sevenDayOpus.utilization > 0) {
    displayUsageItem('7 天 Opus', usage.sevenDayOpus);
  }

  // 7 天 Cowork（非空且有用量时显示）
  if (usage.sevenDayCowork && usage.sevenDayCowork.utilization > 0) {
    displayUsageItem('7 天 Cowork', usage.sevenDayCowork);
  }

  process.stdout.write(`${divider}\n\n`);

  // 额外用量
  process.stdout.write(`  ${COLORS.bold}${COLORS.white}  Extra Usage${COLORS.reset}\n`);
  if (usage.extraUsage && usage.extraUsage.isEnabled) {
    const pct = usage.extraUsage.monthlyLimit > 0
      ? (usage.extraUsage.usedCredits / usage.extraUsage.monthlyLimit) * 100
      : 0;
    process.stdout.write(
      `  ${COLORS.green}  已启用${COLORS.reset}  ${COLORS.dim}|${COLORS.reset}  ` +
      `$${usage.extraUsage.usedCredits} / $${usage.extraUsage.monthlyLimit} 月额度\n`
    );
    process.stdout.write(`  ${progressBar(pct)}\n\n`);
  } else {
    process.stdout.write(`  ${COLORS.dim}  未启用${COLORS.reset}\n\n`);
  }

  process.stdout.write(`${divider}\n\n`);
}

/**
 * 清除终端屏幕（用于 watch 模式）
 */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}
