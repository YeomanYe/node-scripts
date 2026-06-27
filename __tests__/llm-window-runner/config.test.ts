import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadWindowRunnerConfig } from '../../src/llm-window-runner/config';

async function tempConfig(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-window-runner-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

describe('loadWindowRunnerConfig', () => {
  it('解析 4 provider + 多 task', async () => {
    const file = await tempConfig(`
providers:
  z:
    type: zai
    window: primary
    apiKeyEnv: Z_API_KEY
  m:
    type: minimax
    model: M2
    window: interval
  c:
    type: claude
    window: fiveHour
  x:
    type: codex
    window: secondary
tasks:
  daily:
    provider: z
    scheduledTime: "06:00"
    cmd: "echo hi"
  cleanup:
    provider: m
    scheduledTime: "22:30"
    command: pnpm
    args: ["clean"]
`);
    const cfg = await loadWindowRunnerConfig(file);
    expect(Object.keys(cfg.providers)).toEqual(['z', 'm', 'c', 'x']);
    expect(cfg.providers['z']).toMatchObject({ type: 'zai', window: 'primary', apiKeyEnv: 'Z_API_KEY' });
    expect(cfg.providers['m']).toMatchObject({ type: 'minimax', model: 'M2', window: 'interval' });
    expect(cfg.providers['c']).toMatchObject({ type: 'claude', window: 'fiveHour' });
    expect(cfg.providers['x']).toMatchObject({ type: 'codex', window: 'secondary' });
    expect(cfg.tasks['daily']).toMatchObject({ provider: 'z', scheduledTime: '06:00', cmd: 'echo hi', shell: true });
    expect(cfg.tasks['cleanup']).toMatchObject({ provider: 'm', scheduledTime: '22:30', command: 'pnpm', args: ['clean'], shell: false });
  });

  it('task 引用未知 provider → 报错', async () => {
    const file = await tempConfig(`
providers:
  z: { type: zai, window: primary }
tasks:
  bad: { provider: ghost, scheduledTime: "06:00", cmd: "x" }
`);
    await expect(loadWindowRunnerConfig(file)).rejects.toThrow(/未注册/);
  });

  it('scheduledTime 格式校验', async () => {
    const file = await tempConfig(`
providers:
  z: { type: zai, window: primary }
tasks:
  bad: { provider: z, scheduledTime: "2500", cmd: "x" }
`);
    await expect(loadWindowRunnerConfig(file)).rejects.toThrow(/HH:MM/);
  });

  it('同时配 cmd 和 command → 报错', async () => {
    const file = await tempConfig(`
providers:
  z: { type: zai, window: primary }
tasks:
  bad:
    provider: z
    scheduledTime: "06:00"
    cmd: "x"
    command: y
`);
    await expect(loadWindowRunnerConfig(file)).rejects.toThrow(/不能同时/);
  });

  it('provider type 不支持 → 报错', async () => {
    const file = await tempConfig(`
providers:
  z: { type: openai, window: primary }
tasks: {}
`);
    await expect(loadWindowRunnerConfig(file)).rejects.toThrow(/不支持/);
  });

  it('文件不存在 → 提示路径', async () => {
    await expect(loadWindowRunnerConfig('/no/such/file.yaml')).rejects.toThrow(/配置文件不存在/);
  });
});
