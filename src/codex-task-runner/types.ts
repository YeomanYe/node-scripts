export type OnFailure = 'continue' | 'stop';

export type TaskStatus = 'success' | 'failed' | 'timeout';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface TaskConfig {
  name: string;
  prompt: string;
  workdir?: string;
  model?: string;
  priority?: number;
  on_failure?: OnFailure;
}

export interface TaskFile {
  tasks: TaskConfig[];
}

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  domain: string;
  receive_id: string;
  receive_id_type: string;
}

export interface ParallelismRule {
  max_usage: number;
  concurrency: number;
}

export interface ParallelismConfig {
  rules: ParallelismRule[];
}

export interface DefaultsConfig {
  model: string;
  sandbox_mode: SandboxMode;
  dangerously_bypass_approvals_and_sandbox: boolean;
  timeout_minutes: number;
  on_failure: OnFailure;
}

export interface RunnerConfig {
  feishu: FeishuConfig;
  parallelism: ParallelismConfig;
  defaults: DefaultsConfig;
}

export interface TaskResult {
  index: number;
  name: string;
  status: TaskStatus;
  emoji: string;
  durationSec: number;
  costUsd: number;
  exitCode: number;
  summary: string;
}

export interface CommandOptions {
  config?: string;
}

export interface ParallelismResult {
  parallelism: number;
  usage: number;
}
