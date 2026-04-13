import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { RunnerConfig, TaskFile } from './types';

/** 默认配置文件路径（相对于项目根目录） */
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/claude-task-runner-config.yaml');

/** 默认运行器配置 */
const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  feishu: {
    app_id: '',
    app_secret: '',
    domain: 'https://open.feishu.cn',
    receive_id: '',
    receive_id_type: 'chat_id',
  },
  parallelism: {
    rules: [
      { max_usage: 30, concurrency: 4 },
      { max_usage: 50, concurrency: 3 },
      { max_usage: 80, concurrency: 2 },
      { max_usage: 100, concurrency: 0 },
    ],
  },
  defaults: {
    model: 'sonnet',
    max_budget_usd: 5,
    permission_mode: 'bypassPermissions',
    timeout_minutes: 30,
    on_failure: 'continue',
  },
};

/**
 * 合并配置对象，用用户配置覆盖默认值
 * @param userConfig - 用户提供的部分配置
 * @returns 完整的运行器配置
 */
function mergeConfig(userConfig: Partial<RunnerConfig>): RunnerConfig {
  const rules = Array.isArray(userConfig.parallelism?.rules) && userConfig.parallelism.rules.length > 0
    ? [...userConfig.parallelism.rules].sort((a, b) => a.max_usage - b.max_usage)
    : DEFAULT_RUNNER_CONFIG.parallelism.rules;

  return {
    feishu: {
      ...DEFAULT_RUNNER_CONFIG.feishu,
      ...(userConfig.feishu ?? {}),
    },
    parallelism: { rules },
    defaults: {
      ...DEFAULT_RUNNER_CONFIG.defaults,
      ...(userConfig.defaults ?? {}),
    },
  };
}

/**
 * 加载运行器配置文件
 * @param configPath - 配置文件路径，不传则使用默认路径
 * @returns 完整的运行器配置
 */
export async function loadRunnerConfig(configPath?: string): Promise<RunnerConfig> {
  const filePath = configPath ? path.resolve(configPath) : DEFAULT_CONFIG_PATH;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = YAML.parse(content);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('配置文件格式无效：不是对象');
    }

    return mergeConfig(parsed as Partial<RunnerConfig>);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`配置文件不存在: ${filePath}`);
    }
    if (error instanceof Error && error.message.startsWith('配置文件格式无效')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`读取配置文件失败: ${message}`);
  }
}

/**
 * 验证任务配置是否有效
 * @param task - 未知数据
 * @param index - 任务索引
 */
function validateTask(task: unknown, index: number): void {
  if (typeof task !== 'object' || task === null) {
    throw new Error(`任务 #${index} 格式无效：不是对象`);
  }

  const obj = task as Record<string, unknown>;

  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    throw new Error(`任务 #${index} 缺少有效的 name 字段`);
  }

  if (typeof obj['prompt'] !== 'string' || obj['prompt'].length === 0) {
    throw new Error(`任务 #${index} 缺少有效的 prompt 字段`);
  }
}

/**
 * 加载任务文件
 * @param taskFilePath - 任务文件路径
 * @returns 解析后的任务文件
 */
export async function loadTaskFile(taskFilePath: string): Promise<TaskFile> {
  const filePath = path.resolve(taskFilePath);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = YAML.parse(content);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('任务文件格式无效：不是对象');
    }

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj['tasks'])) {
      throw new Error('任务文件缺少 tasks 数组');
    }

    const tasks = obj['tasks'] as unknown[];
    tasks.forEach((task, index) => validateTask(task, index));

    return parsed as TaskFile;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`任务文件不存在: ${filePath}`);
    }
    if (error instanceof Error &&
      (error.message.startsWith('任务文件') || error.message.startsWith('任务 #'))) {
      throw error;
    }
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`读取任务文件失败: ${message}`);
  }
}
