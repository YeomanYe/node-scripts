// 定义类型接口
export interface CommandGroup {
  path: string;
  cmds: string[];
  count?: number;
}

export interface Config {
  time: string[];
  mode: 'once' | 'repeat';
  commands: CommandGroup[];
  count?: string; // 每次执行的命令数，支持 "n" 或 "m-n" 格式
}

export interface Options {
  config?: string;
  logDir?: string;
}

export interface ExecutionState {
  lastExecutedDate: string; // YYYY-MM-DD格式
  executed: boolean;
}
