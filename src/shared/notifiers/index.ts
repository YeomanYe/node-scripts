import { ChannelConfig, Notifier } from './types';
import { FeishuNotifier } from './feishu';

/** 根据配置构造 Notifier 数组；未知 type 抛错 */
export function buildNotifiers(channels: ChannelConfig[]): Notifier[] {
  return channels.map((channel) => {
    switch (channel.type) {
      case 'feishu':
        return new FeishuNotifier(channel);
      default: {
        const exhaustive: never = channel;
        throw new Error(`未知通道类型: ${JSON.stringify(exhaustive)}`);
      }
    }
  });
}

export type { ChannelConfig, Notifier, NotifierMessage, FeishuChannelConfig } from './types';
export { FeishuNotifier, sendFeishuCard } from './feishu';
