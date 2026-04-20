import { FeishuChannelConfig, Notifier, NotifierMessage } from './types';

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** key = `${app_id}|${domain}` */
const tokenCache = new Map<string, CachedToken>();

/** 仅用于测试 */
export function _resetFeishuTokenCache(): void {
  tokenCache.clear();
}

function resolveDomain(config: FeishuChannelConfig): string {
  return config.domain ?? 'https://open.feishu.cn';
}

function resolveReceiveIdType(config: FeishuChannelConfig): string {
  return config.receive_id_type ?? 'chat_id';
}

async function getTenantToken(config: FeishuChannelConfig): Promise<string> {
  const domain = resolveDomain(config);
  const key = `${config.app_id}|${domain}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: config.app_id, app_secret: config.app_secret }),
  });

  if (!response.ok) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as TenantTokenResponse;
  if (data.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${data.msg}`);
  }

  tokenCache.set(key, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + data.expire * 1000,
  });

  return data.tenant_access_token;
}

function buildCardMessage(title: string, content: string, level: 'info' | 'warn'): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: level === 'warn' ? 'red' : 'blue',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
  });
}

/**
 * 发送飞书交互卡片（保持与旧 claude-task-runner 签名兼容）。
 * 若 app_id / app_secret / receive_id 任一为空则静默跳过。
 */
export async function sendFeishuCard(
  config: FeishuChannelConfig,
  title: string,
  content: string,
  level: 'info' | 'warn' = 'info'
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id) {
    return;
  }

  const token = await getTenantToken(config);
  const domain = resolveDomain(config);
  const url = `${domain}/open-apis/im/v1/messages?receive_id_type=${resolveReceiveIdType(config)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: config.receive_id,
      msg_type: 'interactive',
      content: buildCardMessage(title, content, level),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`飞书消息发送失败 HTTP ${response.status}: ${text}`);
  }

  const result = (await response.json()) as { code?: number; msg?: string };
  if (result.code !== 0) {
    throw new Error(`飞书消息发送失败: ${result.msg ?? '未知错误'}`);
  }
}

/** Notifier 接口实现：把 FeishuChannelConfig 包装成 Notifier */
export class FeishuNotifier implements Notifier {
  readonly name = 'feishu';
  constructor(private readonly config: FeishuChannelConfig) {}

  async send(msg: NotifierMessage): Promise<void> {
    await sendFeishuCard(this.config, msg.title, msg.content, msg.level);
  }
}
