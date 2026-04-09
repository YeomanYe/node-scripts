import { FeishuConfig } from './types';
import { log, logError } from './log';

/** 飞书 tenant_access_token 响应 */
interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

/** 缓存的 token 信息 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/** token 缓存 */
let tokenCache: CachedToken | null = null;

/**
 * 获取飞书 tenant_access_token
 * @param config - 飞书配置
 * @returns tenant_access_token
 */
async function getTenantToken(config: FeishuConfig): Promise<string> {
  // 检查缓存是否有效（提前 60 秒过期）
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }

  const url = `${config.domain}/open-apis/auth/v3/tenant_access_token/internal`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: config.app_id,
      app_secret: config.app_secret,
    }),
  });

  if (!response.ok) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  const result = data as TenantTokenResponse;

  if (result.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${result.msg}`);
  }

  tokenCache = {
    token: result.tenant_access_token,
    expiresAt: Date.now() + result.expire * 1000,
  };

  return result.tenant_access_token;
}

/**
 * 构建飞书交互卡片消息体
 * @param title - 卡片标题
 * @param content - Markdown 格式的卡片内容
 * @returns 卡片 JSON 字符串
 */
function buildCardMessage(title: string, content: string): string {
  const card = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: title,
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content,
        },
      },
    ],
  };

  return JSON.stringify(card);
}

/**
 * 发送飞书交互卡片消息
 * @param config - 飞书配置
 * @param title - 卡片标题
 * @param content - Markdown 格式的卡片内容
 */
export async function sendFeishuCard(
  config: FeishuConfig,
  title: string,
  content: string
): Promise<void> {
  // 如果未配置飞书则跳过
  if (!config.app_id || !config.app_secret || !config.receive_id) {
    log('飞书未配置，跳过通知发送');
    return;
  }

  try {
    const token = await getTenantToken(config);
    const url = `${config.domain}/open-apis/im/v1/messages?receive_id_type=${config.receive_id_type}`;

    const body = {
      receive_id: config.receive_id,
      msg_type: 'interactive',
      content: buildCardMessage(title, content),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const result: unknown = await response.json();
    const resultObj = result as Record<string, unknown>;

    if (resultObj['code'] !== 0) {
      throw new Error(`发送消息失败: ${String(resultObj['msg'] ?? '未知错误')}`);
    }

    log(`飞书通知已发送: ${title}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    logError(`飞书通知发送失败: ${message}`);
  }
}
