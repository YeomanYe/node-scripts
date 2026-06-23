import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadPollConfig } from '@/usage-report/config';

async function writeTemp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-report-cfg-'));
  const file = path.join(dir, 'config.yaml');
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

const FULL_CONFIG = `
poll:
  interval_seconds: 900
channels:
  - type: feishu
    app_id: "cli_x"
    app_secret: "secret"
    receive_id: "oc_x"
    receive_id_type: chat_id
providers:
  claude:
    windows: [five_hour, seven_day]
  codex:
    windows: [primary, secondary]
  minimax:
    windows: [interval, weekly]
`;

describe('loadPollConfig', () => {
  it('解析完整配置：interval、channels、各 provider windows', async () => {
    const file = await writeTemp(FULL_CONFIG);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(900);
    expect(cfg.channels).toHaveLength(1);
    expect(cfg.channels[0]).toMatchObject({ type: 'feishu', app_id: 'cli_x', receive_id: 'oc_x' });
    expect(cfg.providers.claude.windows).toEqual(['five_hour', 'seven_day']);
    expect(cfg.providers.codex.windows).toEqual(['primary', 'secondary']);
    expect(cfg.providers.minimax.windows).toEqual(['interval', 'weekly']);
  });

  it('省略某 provider 时其 windows 回退到该 provider 默认值', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
providers:
  claude:
    windows: [seven_day_opus]
`);
    const cfg = await loadPollConfig(file);
    // claude 显式指定
    expect(cfg.providers.claude.windows).toEqual(['seven_day_opus']);
    // 其余回退默认
    expect(cfg.providers.codex.windows).toEqual(['primary', 'secondary']);
    expect(cfg.providers.minimax.windows).toEqual(['interval', 'weekly']);
  });

  it('完全省略 providers 时全部回退默认', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.providers.claude.windows).toEqual(['five_hour', 'seven_day']);
  });

  it('interval 缺省回退 300', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.poll.interval_seconds).toBe(300);
  });

  it('拒绝非法 window（claude 配置了 codex 的 primary）', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
providers:
  claude:
    windows: [primary]
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/claude.*windows.*非法|非法.*primary/i);
  });

  it('拒绝非法 window（minimax 配置了 primary）', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
providers:
  minimax:
    windows: [primary]
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/minimax.*windows.*非法|非法.*primary/i);
  });

  it('拒绝缺失 app_id 的 channel', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_secret: s
    receive_id: r
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/app_id/);
  });

  it('拒绝未知通道类型', async () => {
    const file = await writeTemp(`
channels:
  - type: slack
    app_id: a
    app_secret: s
    receive_id: r
`);
    await expect(loadPollConfig(file)).rejects.toThrow(/未知通道类型/);
  });

  it('透传 provider 覆盖参数（codex authFile/baseUrl、minimax envFile/apiHost 等）', async () => {
    const file = await writeTemp(`
channels:
  - type: feishu
    app_id: a
    app_secret: s
    receive_id: r
providers:
  codex:
    auth_file: /tmp/auth.json
    base_url: https://example.com/backend-api
  minimax:
    env_file: /tmp/.env
    api_key_env: MM_KEY
    api_host: https://mm.example.com
`);
    const cfg = await loadPollConfig(file);
    expect(cfg.providers.codex.authFile).toBe('/tmp/auth.json');
    expect(cfg.providers.codex.baseUrl).toBe('https://example.com/backend-api');
    expect(cfg.providers.minimax.envFile).toBe('/tmp/.env');
    expect(cfg.providers.minimax.apiKeyEnv).toBe('MM_KEY');
    expect(cfg.providers.minimax.apiHost).toBe('https://mm.example.com');
  });
});
