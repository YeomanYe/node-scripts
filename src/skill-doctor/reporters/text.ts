import pc from 'picocolors';
import type { Finding, FindingLevel, FixAction, RunReport } from '../types';

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

function renderFixActions(actions: FixAction[]): string[] {
  return actions.map((action) => `  ↻ ${action.file}  ${action.description}`);
}

export function renderText(report: RunReport, opts: TextRenderOptions = {}): string {
  if (report.fix_mode) {
    const lines: string[] = [];
    const actions = report.fix_mode === 'dry-run' ? report.fixes_pending ?? [] : report.fixes_applied ?? [];
    const byFixer = new Map<string, FixAction[]>();
    for (const action of actions) {
      const fixer = action.fixer ?? '<unknown>';
      byFixer.set(fixer, [...byFixer.get(fixer) ?? [], action]);
    }

    for (const fixer of report.fixers_ran ?? []) {
      lines.push(`[FIX ${report.fix_mode}] ${fixer}`);
      lines.push(...renderFixActions(byFixer.get(fixer) ?? []));
      const errors = (report.fix_errors ?? []).filter((error) => error.startsWith(`${fixer}:`));
      lines.push(...errors.map((error) => `  ! ${error}`));
      lines.push('');
    }

    const count = actions.length;
    const fixerCount = byFixer.size;
    lines.push(report.fix_mode === 'dry-run'
      ? `Plan: ${count} fixes / ${fixerCount} fixer would write`
      : `Applied: ${count} fixes / ${fixerCount} fixer wrote`);
    if (report.fix_mode === 'dry-run') {
      lines.push('Run with --apply to commit changes');
    }
    lines.push(`Duration: ${report.durationMs}ms · Root: ${report.root}`);
    return lines.join('\n');
  }

  const color = opts.color ?? false;
  const lines = report.findings.map((finding) => formatLine(finding, color));
  lines.push('');
  lines.push(`Rules: ${report.rulesRun.join(', ')}`);
  lines.push(`Errors: ${report.counts.error} · Warnings: ${report.counts.warn} · Info: ${report.counts.info}`);
  lines.push(`Duration: ${report.durationMs}ms · Root: ${report.root}`);
  return lines.join('\n');
}
