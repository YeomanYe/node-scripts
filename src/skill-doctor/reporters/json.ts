import type { RunReport } from '../types';

export function renderJson(report: RunReport): string {
  if (!report.fix_mode) {
    return JSON.stringify(report, null, 2);
  }

  return JSON.stringify({
    ...report,
    fixes_pending: report.fix_mode === 'dry-run' ? report.fixes_pending ?? [] : [],
    fixes_applied: report.fix_mode === 'apply' ? report.fixes_applied ?? [] : [],
  }, null, 2);
}
