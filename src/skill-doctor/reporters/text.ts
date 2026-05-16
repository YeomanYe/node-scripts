import pc from 'picocolors';
import type { Finding, FindingLevel, RunReport } from '../types';

export interface TextRenderOptions {
  color?: boolean;
}

function tag(level: FindingLevel, color: boolean): string {
  const text = level.toUpperCase().padEnd(5);
  if (!color) return text;
  if (level === 'error') return pc.red(text);
  if (level === 'warn') return pc.yellow(text);
  return pc.cyan(text);
}

function formatLine(finding: Finding, color: boolean): string {
  const loc = finding.line != null ? `${finding.file ?? ''}:${finding.line}` : finding.file ?? '';
  return `${tag(finding.level, color)}  ${finding.skill}  ${loc}  [${finding.rule}]  ${finding.message}`;
}

export function renderText(report: RunReport, opts: TextRenderOptions = {}): string {
  const color = opts.color ?? false;
  const lines = report.findings.map((finding) => formatLine(finding, color));
  lines.push('');
  lines.push(`Rules: ${report.rulesRun.join(', ')}`);
  lines.push(`Errors: ${report.counts.error} · Warnings: ${report.counts.warn} · Info: ${report.counts.info}`);
  lines.push(`Duration: ${report.durationMs}ms · Root: ${report.root}`);
  return lines.join('\n');
}
