import { sendFeishuCard } from '../../shared/notifiers/feishu';
import type { FeishuChannelConfig, NotifierMessage } from '../../shared/notifiers/types';
import type { Finding, RunReport } from '../types';

export type NotifyMode = 'on-error' | 'always' | 'off';

const MAX_PER_BUCKET = 5;

function renderBucket(label: string, items: Finding[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_PER_BUCKET);
  const lines = shown.map((finding) => {
    const loc = finding.line != null ? `${finding.file ?? ''}:${finding.line}` : finding.file ?? '';
    return `- \`${finding.skill}\` ${loc} - [${finding.rule}] ${finding.message}`;
  });
  if (items.length > MAX_PER_BUCKET) {
    lines.push(`- ... and ${items.length - MAX_PER_BUCKET} more`);
  }
  return `**${label}**\n${lines.join('\n')}`;
}

export function shouldSend(report: RunReport, mode: NotifyMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return report.counts.error > 0;
}

export function buildMessage(report: RunReport): NotifierMessage {
  const errors = report.findings.filter((finding) => finding.level === 'error');
  const warnings = report.findings.filter((finding) => finding.level === 'warn');
  const level: 'warn' | 'info' = errors.length > 0 ? 'warn' : 'info';
  const title = `🩺 skill-doctor — ${errors.length} errors / ${warnings.length} warnings`;
  const parts = [
    `**Root**: ${report.root}`,
    `**Rules**: ${report.rulesRun.join(', ')}`,
    renderBucket('❌ Errors', errors),
    renderBucket('⚠️ Warnings', warnings),
    `**Duration**: ${report.durationMs}ms`,
  ].filter((part) => part.length > 0);
  return { title, content: parts.join('\n\n'), level };
}

export async function maybeSendFeishu(
  report: RunReport,
  config: FeishuChannelConfig,
  mode: NotifyMode,
): Promise<void> {
  if (!shouldSend(report, mode)) return;
  const message = buildMessage(report);
  await sendFeishuCard(config, message.title, message.content, message.level);
}
