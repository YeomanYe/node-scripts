import { spawn } from 'child_process';
import * as path from 'path';
import { FeishuChannelConfig, Notifier, NotifierMessage } from './types';

/** 仅用于测试 */
export function _resetFeishuTokenCache(): void {
  // Kept for compatibility with older tests/imports. lark-cli owns auth state now.
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

function buildLarkCliArgs(config: FeishuChannelConfig, cardContent: string): string[] {
  const receiveIdType = config.receive_id_type ?? 'chat_id';
  if (receiveIdType === 'chat_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--chat-id',
      config.receive_id,
      '--msg-type',
      'interactive',
      '--content',
      cardContent,
    ];
  }

  if (receiveIdType === 'open_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--user-id',
      config.receive_id,
      '--msg-type',
      'interactive',
      '--content',
      cardContent,
    ];
  }

  return [
    '--profile',
    config.app_id,
    'api',
    'POST',
    '/open-apis/im/v1/messages',
    '--params',
    JSON.stringify({ receive_id_type: receiveIdType }),
    '--data',
    JSON.stringify({
      receive_id: config.receive_id,
      msg_type: 'interactive',
      content: cardContent,
    }),
  ];
}

function buildLarkCliTextArgs(config: FeishuChannelConfig, text: string): string[] {
  const receiveIdType = config.receive_id_type ?? 'chat_id';
  if (receiveIdType === 'chat_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--chat-id',
      config.receive_id,
      '--text',
      text,
    ];
  }

  if (receiveIdType === 'open_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--user-id',
      config.receive_id,
      '--text',
      text,
    ];
  }

  return [
    '--profile',
    config.app_id,
    'api',
    'POST',
    '/open-apis/im/v1/messages',
    '--params',
    JSON.stringify({ receive_id_type: receiveIdType }),
    '--data',
    JSON.stringify({
      receive_id: config.receive_id,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  ];
}

function buildLarkCliAttachmentArgs(
  config: FeishuChannelConfig,
  flag: '--image' | '--file',
  filePath: string
): string[] {
  const receiveIdType = config.receive_id_type ?? 'chat_id';
  if (receiveIdType === 'chat_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--chat-id',
      config.receive_id,
      flag,
      filePath,
    ];
  }

  if (receiveIdType === 'open_id') {
    return [
      '--profile',
      config.app_id,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--user-id',
      config.receive_id,
      flag,
      filePath,
    ];
  }

  throw new Error(`lark-cli attachment send does not support receive_id_type=${receiveIdType}`);
}

function runLarkCli(
  args: string[],
  input?: string,
  allowAlreadyExists = false,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('lark-cli', args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stderr = '';

    if (input !== undefined) {
      proc.stdin?.end(input);
    }
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      reject(new Error(`lark-cli 启动失败: ${error.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (allowAlreadyExists && /already exists/i.test(stderr)) {
        resolve();
        return;
      }
      reject(new Error(`lark-cli 发送失败 (${code ?? 'unknown'}): ${stderr.trim() || 'unknown error'}`));
    });
  });
}

async function ensureLarkCliProfile(config: FeishuChannelConfig): Promise<void> {
  await runLarkCli(
    [
      'profile',
      'add',
      '--name',
      config.app_id,
      '--app-id',
      config.app_id,
      '--app-secret-stdin',
      '--brand',
      'feishu',
    ],
    config.app_secret,
    true
  );
}

/**
 * 通过 lark-cli 发送飞书交互卡片（保持与旧 claude-task-runner 签名兼容）。
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

  await ensureLarkCliProfile(config);
  await runLarkCli(buildLarkCliArgs(config, buildCardMessage(title, content, level)));
}

/**
 * 通过 lark-cli 发送普通文本消息，适合附件 caption 这类纯文字说明。
 */
export async function sendFeishuText(
  config: FeishuChannelConfig,
  text: string
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id || !text) {
    return;
  }

  await ensureLarkCliProfile(config);
  await runLarkCli(buildLarkCliTextArgs(config, text));
}

/**
 * 通过 lark-cli 发送本地图片。调用方负责控制图片数量，避免触发消息频率/大小上限。
 */
export async function sendFeishuImage(
  config: FeishuChannelConfig,
  imagePath: string
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id || !imagePath) {
    return;
  }

  const cwd = path.isAbsolute(imagePath) ? path.dirname(imagePath) : undefined;
  const relativeImagePath = path.isAbsolute(imagePath) ? `.${path.sep}${path.basename(imagePath)}` : imagePath;
  await ensureLarkCliProfile(config);
  await runLarkCli(buildLarkCliAttachmentArgs(config, '--image', relativeImagePath), undefined, false, cwd);
}

/**
 * 通过 lark-cli 发送本地文件。调用方负责控制发送节奏，避免触发消息频率上限。
 */
export async function sendFeishuFile(
  config: FeishuChannelConfig,
  filePath: string
): Promise<void> {
  if (!config.app_id || !config.app_secret || !config.receive_id || !filePath) {
    return;
  }

  const cwd = path.isAbsolute(filePath) ? path.dirname(filePath) : undefined;
  const relativeFilePath = path.isAbsolute(filePath) ? `.${path.sep}${path.basename(filePath)}` : filePath;
  await ensureLarkCliProfile(config);
  await runLarkCli(buildLarkCliAttachmentArgs(config, '--file', relativeFilePath), undefined, false, cwd);
}

/** Notifier 接口实现：把 FeishuChannelConfig 包装成 Notifier */
export class FeishuNotifier implements Notifier {
  readonly name = 'feishu';
  constructor(private readonly config: FeishuChannelConfig) {}

  async send(msg: NotifierMessage): Promise<void> {
    await sendFeishuCard(this.config, msg.title, msg.content, msg.level);
  }
}
