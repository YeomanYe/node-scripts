import { executeCommands } from '../src/auto-cmd/executor';
import { Config } from '../src/auto-cmd/types';
import { updateConfig } from '../src/auto-cmd/config';

// 模拟依赖
jest.mock('../src/auto-cmd/executor', () => ({
  executeCommand: jest.fn().mockResolvedValue(true),
  executeCommandGroup: jest.fn().mockResolvedValue(true),
  executeCommands: jest.requireActual('../src/auto-cmd/executor').executeCommands,
  parseCount: jest.fn().mockReturnValue({ min: 2, max: 2 }) // 固定返回执行2个命令组
}));

jest.mock('../src/auto-cmd/log', () => ({
  writeLog: jest.fn()
}));

jest.mock('../src/auto-cmd/config', () => ({
  updateConfig: jest.fn()
}));

describe('count behavior in executeCommands', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should decrease count when count > 1 and mode is once', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      commands: [{
        path: '/',
        cmds: ['ls -la'],
        count: 5
      }]
    };

    await executeCommands(config);

    // 验证updateConfig被调用，且count减1
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: [{
        path: '/',
        cmds: ['ls -la'],
        count: 4
      }]
    }, 1);
  });

  it('should delete command when count === 1 and mode is once', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      commands: [{
        path: '/',
        cmds: ['ls -la'],
        count: 1
      }]
    };

    await executeCommands(config);

    // 验证updateConfig被调用，且命令组被删除
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: []
    }, 1);
  });

  it('should delete command when count is undefined and mode is once', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      commands: [{
        path: '/',
        cmds: ['ls -la']
      }]
    };

    await executeCommands(config);

    // 验证updateConfig被调用，且命令组被删除
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: []
    }, 1);
  });

  it('should handle multiple command groups with different counts', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 3
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 1
        },
        {
          path: '/',
          cmds: ['pwd']
        }
      ]
    };

    // 设置executeCount为2（通过设置count: '2'）
    const configWithCount: Config = {
      ...config,
      count: '2'
    };

    await executeCommands(configWithCount);

    // 验证updateConfig被调用，第一个命令count减1，第二个命令被删除
    expect(updateConfig).toHaveBeenCalledWith({
      ...configWithCount,
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 2
        },
        {
          path: '/',
          cmds: ['pwd']
        }
      ]
    }, 2);
  });
});
