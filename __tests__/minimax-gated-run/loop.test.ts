import { GatedRunConfig, ProviderConfig, RegisteredTask } from '../../src/minimax-gated-run/config';
import { runProviderLoop } from '../../src/minimax-gated-run/loop';
import { MiniMaxQuotaSnapshot } from '../../src/minimax-usage/types';

function makeSnapshot(): MiniMaxQuotaSnapshot {
  const now = Date.now();
  return {
    raw: {},
    models: [
      {
        modelName: 'general',
        interval: {
          startMs: now - 3 * 60 * 60 * 1000,
          endMs: now + 2 * 60 * 60 * 1000,
          remainsMs: 2 * 60 * 60 * 1000,
          totalCount: 100,
          usageCount: 10,
          remainingPercent: 90,
          usedPercent: 10,
          status: 1,
        },
        weekly: {
          startMs: now - 1,
          endMs: now + 1,
          remainsMs: 1,
          totalCount: 100,
          usageCount: 10,
          remainingPercent: 90,
          usedPercent: 10,
          status: 1,
        },
      },
    ],
  };
}

describe('minimax-gated-run loop', () => {
  test('runs tasks from the provider task list', async () => {
    const provider: ProviderConfig = {
      type: 'minimax',
      model: 'general',
      window: 'interval',
      minHeadroomPercent: 0,
      allowOnUnknownQuota: false,
      scheduler: {
        mode: 'sequence',
        runImmediately: true,
        intervalSeconds: 900,
        jitterSeconds: 0,
        stopOnError: false,
      },
      tasks: ['task-a'],
    };
    const task: RegisteredTask = {
      cmd: 'echo a',
      args: [],
      env: {},
      shell: true,
    };
    const config: GatedRunConfig = {
      providers: { light: provider },
      defaultProvider: 'light',
      skipExitCode: 75,
      tasks: { 'task-a': task },
    };
    const signal = { stopped: false };
    const ran: string[] = [];

    await runProviderLoop({
      config,
      providerId: 'light',
      provider,
      envFile: '',
      apiKeyEnv: '',
      signal,
      snapshotFetcher: async () => makeSnapshot(),
      runner: async (registeredTask) => {
        ran.push(registeredTask.cmd ?? '');
        signal.stopped = true;
        return { code: 0, signal: null };
      },
      logLine: () => undefined,
      logError: () => undefined,
    });

    expect(ran).toEqual(['echo a']);
  });
});
