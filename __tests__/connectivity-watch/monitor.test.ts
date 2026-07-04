import {
  buildNotification,
  evaluateTransition,
  probeTargets,
  type ProbeResult,
  type WatchState,
} from '../../src/connectivity-watch/monitor';
import type { WatchTarget } from '../../src/connectivity-watch/config';

const targets: WatchTarget[] = [
  { key: 'google', label: 'Google', url: 'https://www.google.com/generate_204', method: 'GET', successStatus: '200-399' },
  { key: 'github', label: 'GitHub', url: 'https://github.com', method: 'GET', successStatus: '200-399' },
];

function result(key: string, ok: boolean, error?: string): ProbeResult {
  return {
    key,
    label: key,
    url: `https://${key}.example`,
    ok,
    status: ok ? 200 : null,
    timeMs: ok ? 20 : 1000,
    error,
  };
}

describe('connectivity-watch monitor', () => {
  it('sends one down notification until a recovery transition happens', () => {
    let state: WatchState | null = null;
    const firstDown = evaluateTransition(state, [result('google', false, 'timeout'), result('github', true)]);
    expect(firstDown.notification?.kind).toBe('down');
    state = firstDown.nextState;

    const stillDown = evaluateTransition(state, [result('google', false, 'timeout'), result('github', false, 'reset')]);
    expect(stillDown.notification).toBeNull();
    state = stillDown.nextState;

    const recovered = evaluateTransition(state, [result('google', true), result('github', true)]);
    expect(recovered.notification?.kind).toBe('up');
    state = recovered.nextState;

    const stillUp = evaluateTransition(state, [result('google', true), result('github', true)]);
    expect(stillUp.notification).toBeNull();
  });

  it('does not notify on first healthy sample', () => {
    const transition = evaluateTransition(null, [result('google', true), result('github', true)]);
    expect(transition.notification).toBeNull();
    expect(transition.nextState.status).toBe('up');
  });

  it('builds Feishu warning content with failed targets', () => {
    const notification = buildNotification({
      kind: 'down',
      results: [result('google', false, 'timeout'), result('github', true)],
      changedAt: '2026-07-04T00:00:00.000Z',
    });

    expect(notification.level).toBe('warn');
    expect(notification.title).toContain('外网访问异常');
    expect(notification.content).toContain('google');
    expect(notification.content).toContain('timeout');
  });

  it('probes all targets with injected fetch and status matching', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      return {
        status: url.includes('github') ? 503 : 204,
        text: async () => '',
      } as Response;
    });

    const results = await probeTargets(targets, { timeoutMs: 1000, fetchImpl: fetchImpl as typeof fetch });

    expect(results.map((r) => [r.key, r.ok, r.status])).toEqual([
      ['google', true, 204],
      ['github', false, 503],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
