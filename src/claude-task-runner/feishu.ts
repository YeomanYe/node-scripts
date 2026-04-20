import { FeishuConfig } from './types';
import { log, logError } from './log';
import { sendFeishuCard as sharedSend } from '../shared/notifiers/feishu';

/**
 * 发送飞书交互卡片（保持旧接口：config/title/content）。
 * 与 shared 实现的差异：保留旧的 log / logError 行为。
 */
export async function sendFeishuCard(
  config: FeishuConfig,
  title: string,
  content: string
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id) {
    log('飞书未配置，跳过通知发送');
    return;
  }

  try {
    await sharedSend(
      {
        type: 'feishu',
        app_id: config.app_id,
        app_secret: config.app_secret,
        domain: config.domain,
        receive_id: config.receive_id,
        receive_id_type: config.receive_id_type as 'chat_id' | 'open_id' | 'user_id' | 'email',
      },
      title,
      content,
      'info'
    );
    log(`飞书通知已发送: ${title}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    logError(`飞书通知发送失败: ${message}`);
  }
}
