import { maybeSendFeishu } from '../../src/skill-doctor/notify/feishu';
import type { RunReport } from '../../src/skill-doctor/types';
import { sendFeishuCard } from '../../src/shared/notifiers/feishu';
import type { FeishuChannelConfig } from '../../src/shared/notifiers/types';

jest.mock('../../src/shared/notifiers/feishu', () => ({
  sendFeishuCard: jest.fn().mockResolvedValue(undefined),
}));

const mockedSendFeishuCard = sendFeishuCard as jest.MockedFunction<typeof sendFeishuCard>;

const FAKE_CONFIG: FeishuChannelConfig = {
  type: 'feishu',
  app_id: 'a',
  app_secret: 's',
  receive_id: 'r',
};

function makeReport(errors: number, warns = 0): RunReport {
  const findings = [
    ...Array.from({ length: errors }, (_, i) => ({
      rule: 'dead-refs',
      level: 'error' as const,
      skill: `s${i}`,
      file: `s${i}/SKILL.md`,
      message: `err ${i}`,
    })),
    ...Array.from({ length: warns }, (_, i) => ({
      rule: 'frontmatter',
      level: 'warn' as const,
      skill: `w${i}`,
      file: `w${i}/SKILL.md`,
      message: `warn ${i}`,
    })),
  ];
  return {
    root: '/tmp',
    startedAt: '2026-05-16T00:00:00.000Z',
    durationMs: 1,
    rulesRun: ['dead-refs'],
    findings,
    counts: { error: errors, warn: warns, info: 0 },
  };
}

beforeEach(() => mockedSendFeishuCard.mockClear());

describe('maybeSendFeishu', () => {
  it('does nothing when mode=off', async () => {
    await maybeSendFeishu(makeReport(3), FAKE_CONFIG, 'off');
    expect(mockedSendFeishuCard).not.toHaveBeenCalled();
  });

  it('does nothing on on-error when zero errors', async () => {
    await maybeSendFeishu(makeReport(0, 5), FAKE_CONFIG, 'on-error');
    expect(mockedSendFeishuCard).not.toHaveBeenCalled();
  });

  it('sends on on-error when errors > 0', async () => {
    await maybeSendFeishu(makeReport(2, 1), FAKE_CONFIG, 'on-error');
    expect(mockedSendFeishuCard).toHaveBeenCalledTimes(1);
    const [, title, content, level] = mockedSendFeishuCard.mock.calls[0];
    expect(level).toBe('warn');
    expect(title).toContain('2 errors');
    expect(content).toContain('err 0');
  });

  it('always sends on always mode', async () => {
    await maybeSendFeishu(makeReport(0, 0), FAKE_CONFIG, 'always');
    expect(mockedSendFeishuCard).toHaveBeenCalledTimes(1);
    const [, title, , level] = mockedSendFeishuCard.mock.calls[0];
    expect(level).toBe('info');
    expect(title).toContain('0 errors');
  });

  it('truncates long lists', async () => {
    await maybeSendFeishu(makeReport(10), FAKE_CONFIG, 'on-error');
    const [, , content] = mockedSendFeishuCard.mock.calls[0];
    expect(content).toContain('and 5 more');
  });
});
