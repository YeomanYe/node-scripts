import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  FeishuNotifier,
  sendFeishuCard,
  sendFeishuFile,
  sendFeishuImage,
  sendFeishuText,
} from '../../../src/shared/notifiers/feishu';
import type { FeishuChannelConfig } from '../../../src/shared/notifiers/types';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

const config: FeishuChannelConfig = {
  type: 'feishu',
  app_id: 'cli_test',
  app_secret: 'secret',
  domain: 'https://open.feishu.cn',
  receive_id: 'oc_chat',
  receive_id_type: 'chat_id',
};

function mockSpawnExit(code: number, stderr = ''): void {
  mockedSpawn.mockImplementationOnce(() => {
    const proc = new EventEmitter() as ReturnType<typeof spawn>;
    const stderrEmitter = new EventEmitter();
    proc.stdout = new EventEmitter() as ReturnType<typeof spawn>['stdout'];
    proc.stderr = stderrEmitter as ReturnType<typeof spawn>['stderr'];
    process.nextTick(() => {
      if (stderr) stderrEmitter.emit('data', Buffer.from(stderr));
      proc.emit('close', code);
    });
    return proc;
  });
}

function mockSuccessfulSend(): void {
  mockSpawnExit(0);
  mockSpawnExit(0);
}

function getSpawnArgs(): string[] {
  const args = mockedSpawn.mock.calls[mockedSpawn.mock.calls.length - 1]?.[1];
  if (!Array.isArray(args)) throw new Error('spawn args missing');
  return args;
}

function getCardFromSpawn(): { header: { template: string } } {
  const args = getSpawnArgs();
  const contentIndex = args.indexOf('--content');
  if (contentIndex === -1) throw new Error('--content missing');
  return JSON.parse(args[contentIndex + 1] ?? '{}') as { header: { template: string } };
}

describe('shared feishu notifier', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  test('sendFeishuCard sends interactive card through lark-cli', async () => {
    mockSuccessfulSend();

    await sendFeishuCard(config, 'Title 1', 'body 1');

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'lark-cli',
      [
        'profile',
        'add',
        '--name',
        'cli_test',
        '--app-id',
        'cli_test',
        '--app-secret-stdin',
        '--brand',
        'feishu',
      ],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'lark-cli',
      expect.arrayContaining([
        '--profile',
        'cli_test',
        'im',
        '+messages-send',
        '--as',
        'bot',
        '--chat-id',
        'oc_chat',
        '--msg-type',
        'interactive',
        '--content',
      ]),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    );
    expect(getCardFromSpawn().header.template).toBe('blue');
  });

  test('FeishuNotifier.send with level=warn uses red template', async () => {
    mockSuccessfulSend();

    const notifier = new FeishuNotifier(config);
    await notifier.send({ title: 'T', content: 'c', level: 'warn' });

    expect(getCardFromSpawn().header.template).toBe('red');
  });

  test('level=info uses blue template', async () => {
    mockSuccessfulSend();

    const notifier = new FeishuNotifier(config);
    await notifier.send({ title: 'T', content: 'c', level: 'info' });

    expect(getCardFromSpawn().header.template).toBe('blue');
  });

  test('FeishuNotifier.send throws when lark-cli exits non-zero', async () => {
    mockSpawnExit(0);
    mockSpawnExit(2, 'nope');

    const notifier = new FeishuNotifier(config);
    await expect(
      notifier.send({ title: 'T', content: 'c', level: 'info' })
    ).rejects.toThrow(/nope/);
  });

  test('continues when lark-cli profile already exists', async () => {
    mockSpawnExit(2, 'profile "cli_test" already exists');
    mockSpawnExit(0);

    await sendFeishuCard(config, 'Title 1', 'body 1');

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(getCardFromSpawn().header.template).toBe('blue');
  });

  test('sendFeishuCard is a no-op when required fields missing', async () => {
    await sendFeishuCard(
      { type: 'feishu', app_id: '', app_secret: '', receive_id: '' } as FeishuChannelConfig,
      'T',
      'c'
    );

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  test('sendFeishuImage sends one local image through lark-cli', async () => {
    mockSuccessfulSend();

    await sendFeishuImage(config, '/tmp/screen.png');

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(getSpawnArgs()).toEqual(
      expect.arrayContaining([
        '--profile',
        'cli_test',
        'im',
        '+messages-send',
        '--chat-id',
        'oc_chat',
        '--image',
        './screen.png',
      ])
    );
    expect(mockedSpawn).toHaveBeenLastCalledWith(
      'lark-cli',
      expect.any(Array),
      expect.objectContaining({ cwd: '/tmp' })
    );
  });

  test('sendFeishuFile sends one local file through lark-cli', async () => {
    mockSuccessfulSend();

    await sendFeishuFile(config, '/tmp/error.txt');

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(getSpawnArgs()).toEqual(
      expect.arrayContaining([
        '--profile',
        'cli_test',
        'im',
        '+messages-send',
        '--chat-id',
        'oc_chat',
        '--file',
        './error.txt',
      ])
    );
    expect(mockedSpawn).toHaveBeenLastCalledWith(
      'lark-cli',
      expect.any(Array),
      expect.objectContaining({ cwd: '/tmp' })
    );
  });

  test('sendFeishuText sends caption text through lark-cli', async () => {
    mockSuccessfulSend();

    await sendFeishuText(config, 'caption: 主页面截图');

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(getSpawnArgs()).toEqual(
      expect.arrayContaining([
        '--profile',
        'cli_test',
        'im',
        '+messages-send',
        '--chat-id',
        'oc_chat',
        '--text',
        'caption: 主页面截图',
      ])
    );
  });
});
