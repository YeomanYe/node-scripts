/** 通知消息 */
export interface NotifierMessage {
  /** 标题（飞书卡片 header） */
  title: string;
  /** lark_md 格式正文 */
  content: string;
  /** 级别：warn 时使用红色 header，info 使用蓝色 */
  level: 'info' | 'warn';
}

/** 通知器接口 */
export interface Notifier {
  /** 通知器名（用于日志） */
  readonly name: string;
  /** 发送消息；失败时抛出错误 */
  send(msg: NotifierMessage): Promise<void>;
}

/** 飞书通道配置（已有 claude-task-runner 使用） */
export interface FeishuChannelConfig {
  type: 'feishu';
  app_id: string;
  app_secret: string;
  domain?: string;
  receive_id: string;
  receive_id_type?: 'chat_id' | 'open_id' | 'user_id' | 'email';
}

/** 通道配置联合类型（后续可扩展） */
export type ChannelConfig = FeishuChannelConfig;
