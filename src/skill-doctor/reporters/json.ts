import type { RunReport } from '../types';

export function renderJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}
