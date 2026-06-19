import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadGatedRunConfig, resolveProviderApiKey } from '../../src/llm-gated-run/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mmx-gated-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('llm-gated-run config', () => {
  test('loads registered tasks', async () => {
    const file = await writeTemp(`
providers:
  minimax-general:
    type: minimax
    model: general
    window: interval
    min_headroom_percent: 2
default_provider: minimax-general
tasks:
  nightly:
    provider: minimax-general
    cmd: pnpm test
    cwd: /tmp
  report:
    command: node
    args: ["scripts/report.js"]
    env:
      NODE_ENV: test
`);

    const config = await loadGatedRunConfig(file);
    expect(config.defaultProvider).toBe('minimax-general');
    expect(config.providers['minimax-general']?.type).toBe('minimax');
    expect(config.providers['minimax-general']?.model).toBe('general');
    expect(config.providers['minimax-general']?.minHeadroomPercent).toBe(2);
    expect(config.tasks.nightly?.provider).toBe('minimax-general');
    expect(config.tasks.nightly?.cmd).toBe('pnpm test');
    expect(config.tasks.nightly?.shell).toBe(true);
    expect(config.tasks.report?.command).toBe('node');
    expect(config.tasks.report?.args).toEqual(['scripts/report.js']);
    expect(config.tasks.report?.env.NODE_ENV).toBe('test');
  });

  test('lets tasks select different registered providers', async () => {
    const file = await writeTemp(`
providers:
  light:
    type: minimax
    model: general
    min_headroom_percent: 0
    scheduler:
      interval_seconds: 900
      run_immediately: true
      jitter_seconds: 30
    tasks:
      - a
  heavy:
    type: minimax
    model: video
    min_headroom_percent: 20
    scheduler:
      interval_seconds: 1800
      run_immediately: false
      stop_on_error: true
    tasks:
      - b
default_provider: light
tasks:
  a:
    cmd: echo a
  b:
    provider: heavy
    cmd: echo b
`);

    const config = await loadGatedRunConfig(file);
    expect(config.defaultProvider).toBe('light');
    expect(config.tasks.a?.provider).toBeUndefined();
    expect(config.tasks.b?.provider).toBe('heavy');
    expect(config.providers.heavy?.minHeadroomPercent).toBe(20);
    expect(config.providers.light?.tasks).toEqual(['a']);
    expect(config.providers.light?.scheduler?.jitterSeconds).toBe(30);
    expect(config.providers.heavy?.tasks).toEqual(['b']);
    expect(config.providers.heavy?.scheduler?.stopOnError).toBe(true);
  });

  test('keeps legacy top-level MiniMax provider fields compatible', async () => {
    const file = await writeTemp(`
model: general
window: interval
min_headroom_percent: 2
tasks:
  nightly:
    cmd: pnpm test
`);

    const config = await loadGatedRunConfig(file);
    expect(config.defaultProvider).toBe('default');
    expect(config.providers.default).toMatchObject({
      type: 'minimax',
      model: 'general',
      window: 'interval',
      minHeadroomPercent: 2,
    });
  });

  test('rejects unknown provider', async () => {
    const file = await writeTemp(`
provider:
  type: openai
tasks:
  nightly:
    cmd: pnpm test
`);

    await expect(loadGatedRunConfig(file)).rejects.toThrow(/目前只支持 minimax/);
  });

  test('rejects task provider that is not registered', async () => {
    const file = await writeTemp(`
providers:
  light:
    type: minimax
tasks:
  nightly:
    provider: missing
    cmd: pnpm test
`);

    await expect(loadGatedRunConfig(file)).rejects.toThrow(/tasks\.nightly\.provider 未注册/);
  });

  test('rejects provider loop task that is not registered', async () => {
    const file = await writeTemp(`
providers:
  light:
    type: minimax
    tasks:
      - missing
tasks:
  nightly:
    cmd: pnpm test
`);

    await expect(loadGatedRunConfig(file)).rejects.toThrow(/providers\.light\.tasks 引用了未注册任务/);
  });

  test('rejects unregistered command shape', async () => {
    const file = await writeTemp(`
tasks:
  broken:
    args: ["test"]
`);
    await expect(loadGatedRunConfig(file)).rejects.toThrow(/cmd 或 command/);
  });

  test('parses per-provider api key fields (api_key / api_key_env / env_file)', async () => {
    const file = await writeTemp(`
providers:
  with-env:
    type: minimax
    api_key_env: MINIMAX_KEY_A
    env_file: ~/custom/.env
  with-inline:
    type: minimax
    api_key: sk-plain-b
default_provider: with-env
tasks:
  t:
    cmd: echo t
`);
    const config = await loadGatedRunConfig(file);
    expect(config.providers['with-env']?.apiKeyEnv).toBe('MINIMAX_KEY_A');
    expect(config.providers['with-env']?.envFile).toBe('~/custom/.env');
    expect(config.providers['with-inline']?.apiKey).toBe('sk-plain-b');
  });
});

describe('resolveProviderApiKey', () => {
  const fallback = { envFile: '/no/such/.env', apiKeyEnv: 'FALLBACK_KEY' };

  test('uses inline api_key first (over env)', async () => {
    process.env.PROVIDER_KEY = 'sk-from-env';
    try {
      const key = await resolveProviderApiKey(
        { type: 'minimax', apiKey: 'sk-inline', apiKeyEnv: 'PROVIDER_KEY' } as any,
        fallback
      );
      expect(key).toBe('sk-inline');
    } finally {
      delete process.env.PROVIDER_KEY;
    }
  });

  test('uses provider api_key_env over global fallback', async () => {
    process.env.PROVIDER_KEY = 'sk-from-provider-env';
    process.env.FALLBACK_KEY = 'sk-global';
    try {
      const key = await resolveProviderApiKey({ type: 'minimax', apiKeyEnv: 'PROVIDER_KEY' } as any, fallback);
      expect(key).toBe('sk-from-provider-env');
    } finally {
      delete process.env.PROVIDER_KEY;
      delete process.env.FALLBACK_KEY;
    }
  });

  test('falls back to global apiKeyEnv when provider omits key config', async () => {
    process.env.FALLBACK_KEY = 'sk-global';
    try {
      const key = await resolveProviderApiKey({ type: 'minimax' } as any, fallback);
      expect(key).toBe('sk-global');
    } finally {
      delete process.env.FALLBACK_KEY;
    }
  });
});
