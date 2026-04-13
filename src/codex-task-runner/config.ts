import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { RunnerConfig, TaskFile } from './types';

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'local/codex-task-runner-config.yaml');

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  feishu: {
    app_id: '',
    app_secret: '',
    domain: 'https://open.feishu.cn',
    receive_id: '',
    receive_id_type: 'chat_id',
  },
  parallelism: {
    below_30: 4,
    below_50: 3,
    below_80: 2,
    above_80: 0,
  },
  defaults: {
    model: 'gpt-5.4',
    sandbox_mode: 'workspace-write',
    dangerously_bypass_approvals_and_sandbox: false,
    timeout_minutes: 30,
    on_failure: 'continue',
  },
};

function mergeConfig(userConfig: Partial<RunnerConfig>): RunnerConfig {
  const mergedParallelism = {
    ...DEFAULT_RUNNER_CONFIG.parallelism,
    ...(userConfig.parallelism ?? {}),
  };
  const rules = Array.isArray(mergedParallelism.rules)
    ? [...mergedParallelism.rules].sort((a, b) => a.max_usage - b.max_usage)
    : undefined;

  return {
    feishu: {
      ...DEFAULT_RUNNER_CONFIG.feishu,
      ...(userConfig.feishu ?? {}),
    },
    parallelism: { ...mergedParallelism, rules },
    defaults: {
      ...DEFAULT_RUNNER_CONFIG.defaults,
      ...(userConfig.defaults ?? {}),
    },
  };
}

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
