import { executeCommands, parseCount } from '../src/auto-cmd/executor';
import { Config } from '../src/auto-cmd/types';
import { updateConfig } from '../src/auto-cmd/config';

// 模拟依赖
jest.mock('../src/auto-cmd/executor', () => ({
  executeCommand: jest.fn().mockResolvedValue(true),
  executeCommandGroup: jest.fn().mockResolvedValue(true),
  executeCommands: jest.requireActual('../src/auto-cmd/executor').executeCommands,
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
      count: '1', // 设置为1，这样只会执行1个命令
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

  it('should keep command when count === 1 and mode is once (count becomes 0)', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      count: '1', // 设置为1，这样只会执行1个命令
      commands: [{
        path: '/',
        cmds: ['ls -la'],
        count: 1
      }]
    };

    await executeCommands(config);

    // 验证updateConfig被调用，命令保留但count变为0
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: [{
        path: '/',
        cmds: ['ls -la'],
        count: 0
      }]
    }, 1);
  });

  it('should keep command when count === 0 in mixed commands scenario', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      count: '1', // 设置为1，这样只会执行1个命令
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 0
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 2
        }
      ]
    };

    await executeCommands(config);

    // count=0的命令被跳过，只执行echo test命令
    // echo test的count减为1，count=0的命令保留在配置中
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 0
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 1
        }
      ]
    }, 1);
  });

  it('should skip commands with count === 0 when selecting commands to execute', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      count: '2', // 设置为2，会执行2个命令（跳过count=0的）
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 0
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 2
        },
        {
          path: '/',
          cmds: ['pwd'],
          count: 1
        },
        {
          path: '/',
          cmds: ['whoami']
        }
      ]
    };

    await executeCommands(config);

    // filteredCommands = [echo test, pwd, whoami] (count=0的命令被跳过)
    // executeCount = 2 (因为count='2')
    // 执行 echo test 和 pwd
    // echo test: count 2->1
    // pwd: count 1->0
    // whoami: 无count参数，保留（因为没有执行它）
    // count=0的命令保留在配置中
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 0
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 1
        },
        {
          path: '/',
          cmds: ['pwd'],
          count: 0
        },
        {
          path: '/',
          cmds: ['whoami']
        }
      ]
    }, 2);
  });

  it('should delete command when count is undefined and mode is once', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      count: '1',
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
      count: '2', // 设置为2，会执行2个命令
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

    await executeCommands(config);

    // filteredCommands = 所有命令（没有count=0的）
    // executeCount = 2
    // 执行前2个命令:
    // - 第一个命令count减1（3->2）
    // - 第二个命令count变为0（保留不删除）
    // - 第三个无count命令没有被执行，所以不会被删除
    expect(updateConfig).toHaveBeenCalledWith({
      ...config,
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 2
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 0
        },
        {
          path: '/',
          cmds: ['pwd']
        }
      ]
    }, 2);
  });

  it('should return false when all commands have count === 0', async () => {
    const config: Config = {
      time: ['12:00'],
      mode: 'once',
      commands: [
        {
          path: '/',
          cmds: ['ls -la'],
          count: 0
        },
        {
          path: '/',
          cmds: ['echo test'],
          count: 0
        }
      ]
    };

    const result = await executeCommands(config);

    // 应该返回false，因为没有可执行的命令
    expect(result).toBe(false);
    // updateConfig不应该被调用
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
