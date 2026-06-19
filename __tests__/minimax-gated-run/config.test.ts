import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadGatedRunConfig } from '../../src/minimax-gated-run/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mmx-gated-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('minimax-gated-run config', () => {
  test('loads registered tasks', async () => {
    const file = await writeTemp(`
provider:
  type: minimax
  model: general
  window: interval
  min_headroom_percent: 2
tasks:
  nightly:
    cmd: pnpm test
    cwd: /tmp
  report:
    command: node
    args: ["scripts/report.js"]
    env:
      NODE_ENV: test
`);

    const config = await loadGatedRunConfig(file);
    expect(config.provider.type).toBe('minimax');
    expect(config.provider.model).toBe('general');
    expect(config.provider.minHeadroomPercent).toBe(2);
    expect(config.tasks.nightly?.cmd).toBe('pnpm test');
    expect(config.tasks.nightly?.shell).toBe(true);
    expect(config.tasks.report?.command).toBe('node');
    expect(config.tasks.report?.args).toEqual(['scripts/report.js']);
    expect(config.tasks.report?.env.NODE_ENV).toBe('test');
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
    expect(config.provider).toMatchObject({
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

  test('rejects unregistered command shape', async () => {
    const file = await writeTemp(`
tasks:
  broken:
    args: ["test"]
`);
    await expect(loadGatedRunConfig(file)).rejects.toThrow(/cmd 或 command/);
  });
});
