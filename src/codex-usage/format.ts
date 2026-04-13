import Table from 'cli-table3';
import dayjs from 'dayjs';
import pc from 'picocolors';
import { UsageSnapshot, UsageWindow } from './types';

export function formatUsageTable(snapshot: UsageSnapshot): string {
  const table = new Table({
    style: {
      head: [],
      border: [],
    },
    wordWrap: true,
  });

  table.push(
    [{ content: pc.bold('Plan'), hAlign: 'left' }, snapshot.planType],
    [{ content: pc.bold('Primary'), hAlign: 'left' }, formatWindow(snapshot.primary)],
    [{ content: pc.bold('Secondary'), hAlign: 'left' }, formatWindow(snapshot.secondary)],
    [{ content: pc.bold('Credits'), hAlign: 'left' }, formatCredits(snapshot)],
    [{ content: pc.bold('Additional'), hAlign: 'left' }, formatAdditional(snapshot)]
  );

  return table.toString();
}

function formatWindow(window?: UsageWindow): string {
  if (!window) {
    return 'n/a';
  }

  const pieces = [`${window.usedPercent}% used`];
  if (window.windowMinutes) {
    pieces.push(`${window.windowMinutes} min window`);
  }
  if (window.resetsAt) {
    pieces.push(`resets ${dayjs.unix(window.resetsAt).format('YYYY-MM-DD HH:mm:ss')}`);
  }
  return pieces.join(' | ');
}

function formatCredits(snapshot: UsageSnapshot): string {
  if (!snapshot.credits) {
    return 'n/a';
  }

  if (snapshot.credits.unlimited) {
    return 'unlimited';
  }

  return `hasCredits=${snapshot.credits.hasCredits} | balance=${snapshot.credits.balance ?? 'n/a'}`;
}

function formatAdditional(snapshot: UsageSnapshot): string {
  if (snapshot.additional.length === 0) {
    return 'none';
  }

  return snapshot.additional
    .map((limit) => `${limit.limitName ?? limit.limitId}: ${formatWindow(limit.primary)}`)
    .join('\n');
}
