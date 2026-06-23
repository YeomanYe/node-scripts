// boot-tasks supervisor 与子任务之间的契约。
// 一个 SubTask 表示一个可在 supervisor 进程里并发运行的工作单元。

export type SubTaskKind = 'long-running' | 'one-shot';

export interface SubTaskResult {
  status: 'success' | 'failed';
  summary?: string;
  error?: string;
}

export interface SubTaskContext {
  // supervisor 收到 SIGINT/SIGTERM 后置 true。子任务可在循环里检查它提前收尾。
  stopped: boolean;
  log(msg: string): void;
}

export interface SubTaskHandle {
  // 子任务结束(成功或失败)时 resolve;不应该 reject,supervisor 通过 status 区分。
  promise: Promise<SubTaskResult>;
  // 可选的优雅停止入口,supervisor 在 shutdown 时调用。
  stop?: () => void;
}

export interface SubTask {
  name: string;
  kind: SubTaskKind;
  start(ctx: SubTaskContext): Promise<SubTaskHandle>;
}
