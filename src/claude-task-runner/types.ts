/** 任务失败时的行为 */
export type OnFailure = 'continue' | 'stop';

/** 任务执行状态 */
export type TaskStatus = 'success' | 'failed' | 'timeout';

/** 权限模式 */
export type PermissionMode = 'default' | 'plan' | 'bypassPermissions';

/** 单个任务配置 */
export interface TaskConfig {
  /** 任务名称 */
  name: string;
  /** 发送给 Claude 的提示词 */
  prompt: string;
  /** 工作目录 */
  workdir?: string;
  /** 使用的模型 */
  model?: string;
  /** 最大预算（美元） */
  max_budget?: number;
  /** 执行优先级（数值越小越优先） */
  priority?: number;
  /** 失败时的行为 */
  on_failure?: OnFailure;
}

/** 任务文件结构 */
export interface TaskFile {
  /** 任务列表 */
  tasks: TaskConfig[];
}

/** 飞书配置 */
export interface FeishuConfig {
  /** 飞书应用 ID */
  app_id: string;
  /** 飞书应用密钥 */
  app_secret: string;
  /** 飞书 API 域名 */
  domain: string;
  /** 接收者 ID */
  receive_id: string;
  /** 接收者 ID 类型（chat_id 或 open_id） */
  receive_id_type: string;
}

/** 并发规则 */
export interface ParallelismRule {
  /** 当用量低于该百分比时生效 */
  max_usage: number;
  /** 对应并发数 */
  concurrency: number;
}

/** 并发度配置（基于 API 用量百分比） */
export interface ParallelismConfig {
  /** 自定义规则列表，按 max_usage 升序匹配 */
  rules: ParallelismRule[];
}

/** 默认配置 */
export interface DefaultsConfig {
  /** 默认模型 */
  model: string;
  /** 默认最大预算（美元） */
  max_budget_usd: number;
  /** 默认权限模式 */
  permission_mode: PermissionMode;
  /** 默认超时时间（分钟） */
  timeout_minutes: number;
  /** 默认失败行为 */
  on_failure: OnFailure;
}

/** 运行器总配置 */
export interface RunnerConfig {
  /** 飞书通知配置 */
  feishu: FeishuConfig;
  /** 并发度配置 */
  parallelism: ParallelismConfig;
  /** 默认值配置 */
  defaults: DefaultsConfig;
}

/** 单个任务的执行结果 */
export interface TaskResult {
  /** 任务在列表中的索引 */
  index: number;
  /** 任务名称 */
  name: string;
  /** 执行状态 */
  status: TaskStatus;
  /** 状态对应的 emoji */
  emoji: string;
  /** 耗时（秒） */
  durationSec: number;
  /** 消耗的费用（美元） */
  costUsd: number;
  /** 进程退出码 */
  exitCode: number;
  /** 结果摘要 */
  summary: string;
}

/** CLI 命令选项 */
export interface CommandOptions {
  /** 自定义配置文件路径 */
  config?: string;
}

/** Claude CLI 输出的 JSON 结构 */
export interface ClaudeOutputJson {
  /** 结果文本 */
  result?: string;
  /** 费用（美元） */
  cost_usd?: number;
  /** 总费用（美元，--output-format json 时的字段名） */
  total_cost_usd?: number;
  /** 是否达到预算上限 */
  is_error?: boolean;
  /** 错误信息 */
  error?: string;
}

/** 并发度查询结果 */
export interface ParallelismResult {
  /** 当前并发度 */
  parallelism: number;
  /** 当前用量百分比 */
  usage: number;
}
