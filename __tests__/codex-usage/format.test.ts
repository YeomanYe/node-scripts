import { formatUsageTable } from '../../src/codex-usage/format';

describe('codex-usage/format', () => {
  it('renders a readable summary', () => {
    const output = formatUsageTable({
      planType: 'pro',
      primary: {
        usedPercent: 2,
        windowMinutes: 300,
        resetsAt: 1775670982,
      },
      secondary: {
        usedPercent: 13,
        windowMinutes: 10080,
        resetsAt: 1776221738,
      },
      credits: {
        hasCredits: false,
        unlimited: false,
        balance: '0',
      },
      additional: [],
      raw: {},
    });

    expect(output).toContain('Plan');
    expect(output).toContain('pro');
    expect(output).toContain('Primary');
    expect(output).toContain('2%');
  });
});
