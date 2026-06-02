/** 一次采样得到的系统指标 */
export interface SystemSample {
  /** 采样时间 ms */
  tsMs: number;
  /** CPU 使用率 0-100，跨核平均 */
  cpuPercent: number;
  /** 内存使用率 0-100 */
  memoryPercent: number;
  /** 已用内存字节 */
  memoryUsedBytes: number;
  /** 总内存字节 */
  memoryTotalBytes: number;
  /** 1m / 5m / 15m load average */
  load: [number, number, number];
  /** CPU 核心数 */
  cpuCount: number;
  /** 1m load 除以核心数（>1 表示满载） */
  load1mPerCore: number;
  /** 主机名 */
  hostname: string;
  /** 进程已运行秒数（os.uptime） */
  uptimeSeconds: number;
  /** 磁盘按挂载点的使用率 */
  disks: DiskSample[];
}

export interface DiskSample {
  mount: string;
  usedBytes: number;
  totalBytes: number;
  percent: number;
}

/** 单条指标的告警维度，用于状态机 key */
export type MetricKey =
  | 'cpu'
  | 'memory'
  | 'load1m_per_core'
  | `disk:${string}`;

export interface BreachInfo {
  key: MetricKey;
  /** 人类可读的名字 */
  label: string;
  /** 当前值 */
  value: number;
  /** 阈值 */
  threshold: number;
  /** 单位，比如 % */
  unit: string;
}
