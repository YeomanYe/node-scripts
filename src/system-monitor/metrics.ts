import * as os from 'os';
import { spawn } from 'child_process';
import { DiskSample, SystemSample } from './types';

interface MemorySample {
  usedBytes: number;
  totalBytes: number;
  percent: number;
}

/** os.cpus() 中单核累计 tick 求和 */
interface CpuSnapshot {
  idle: number;
  total: number;
}

function snapshotCpu(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** 两次采样间隔 ms 内的 CPU 使用率；间隔太短不稳，建议 >= 500 */
async function sampleCpuPercent(sampleMs: number): Promise<number> {
  const a = snapshotCpu();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = snapshotCpu();
  const idleDiff = b.idle - a.idle;
  const totalDiff = b.total - a.total;
  if (totalDiff <= 0) return 0;
  const pct = 100 * (1 - idleDiff / totalDiff);
  return Math.max(0, Math.min(100, pct));
}

interface DfRow {
  mount: string;
  totalKB: number;
  usedKB: number;
}

function runDf(timeoutMs = 5000): Promise<string> {
  // -k 1KB 块；-P portable 格式（不换行）
  return runCommand('df', ['-kP'], timeoutMs);
}

/**
 * 解析 `df -kP` 输出。
 * 表头第一行；后续每行：Filesystem  1024-blocks  Used  Available  Capacity  Mounted-on
 * Mounted-on 可能含空格，因此我们从右往左数列：最后一列是 mount。
 */
export function parseDf(stdout: string): DfRow[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: DfRow[] = [];
  for (const line of lines.slice(1)) {
    // 拆成 token；最后 5 列是 blocks/used/avail/cap/mount，但 mount 可能带空格
    // 策略：找到从左数第 1 个能解析为整数的位置（blocks），假设之后 used/avail 也是整数、capacity 以 % 结尾、剩下全部拼回去当 mount
    const tokens = line.split(/\s+/);
    if (tokens.length < 6) continue;
    // 定位到 blocks 列：找到第一个纯整数 token
    let blocksIdx = -1;
    for (let i = 1; i < tokens.length; i++) {
      if (/^\d+$/.test(tokens[i])) {
        blocksIdx = i;
        break;
      }
    }
    if (blocksIdx === -1 || blocksIdx + 4 >= tokens.length) continue;
    const totalKB = parseInt(tokens[blocksIdx], 10);
    const usedKB = parseInt(tokens[blocksIdx + 1], 10);
    const cap = tokens[blocksIdx + 3];
    if (!/%$/.test(cap)) continue;
    const mount = tokens.slice(blocksIdx + 4).join(' ');
    if (!mount.startsWith('/')) continue;
    if (!Number.isFinite(totalKB) || totalKB <= 0) continue;
    rows.push({ mount, totalKB, usedKB });
  }
  return rows;
}

/** 过滤掉伪文件系统挂载点，并按用户指定列表筛选 */
export function filterDisks(rows: DfRow[], wanted: string[]): DfRow[] {
  const skipPrefixes = ['/System/Volumes/VM', '/System/Volumes/Preboot', '/System/Volumes/Update', '/dev', '/private/var/vm'];
  const skipExact = new Set(['/System/Volumes/Hardware']);
  const filtered = rows.filter((r) => {
    if (skipExact.has(r.mount)) return false;
    if (skipPrefixes.some((p) => r.mount.startsWith(p))) return false;
    return true;
  });
  if (wanted.length === 0) return filtered;
  const wantedSet = new Set(wanted);
  return filtered.filter((r) => wantedSet.has(r.mount));
}

/**
 * 读取 macOS 上更接近 Activity Monitor 的内存使用率。
 * os.freemem() 在 macOS 不包含 inactive / cached / purgeable，几乎永远显示 ~100% 已用，
 * 用 vm_stat 重新计算：used = (wired + active + compressor) * pageSize。
 */
async function sampleMemoryDarwin(): Promise<MemorySample | null> {
  let stdout: string;
  try {
    stdout = await runCommand('vm_stat', [], 5000);
  } catch {
    return null;
  }
  const pageMatch = stdout.match(/page size of (\d+) bytes/);
  if (!pageMatch) return null;
  const pageSize = parseInt(pageMatch[1], 10);
  const read = (name: string): number | null => {
    const re = new RegExp(`${name}:\\s+(\\d+)\\.`);
    const m = stdout.match(re);
    return m ? parseInt(m[1], 10) : null;
  };
  const wired = read('Pages wired down');
  const active = read('Pages active');
  const compressed = read('Pages occupied by compressor');
  if (wired === null || active === null) return null;
  const usedPages = wired + active + (compressed ?? 0);
  const usedBytes = usedPages * pageSize;
  const totalBytes = os.totalmem();
  if (totalBytes <= 0) return null;
  return {
    usedBytes,
    totalBytes,
    percent: (usedBytes / totalBytes) * 100,
  };
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} 退出码 ${code}: ${stderr.trim() || 'unknown'}`));
    });
  });
}

async function sampleMemory(): Promise<MemorySample> {
  if (process.platform === 'darwin') {
    const mac = await sampleMemoryDarwin();
    if (mac) return mac;
  }
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    usedBytes,
    totalBytes,
    percent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
  };
}

async function sampleDisks(wanted: string[]): Promise<DiskSample[]> {
  try {
    const stdout = await runDf();
    const rows = filterDisks(parseDf(stdout), wanted);
    return rows.map((r) => ({
      mount: r.mount,
      usedBytes: r.usedKB * 1024,
      totalBytes: r.totalKB * 1024,
      percent: r.totalKB > 0 ? (r.usedKB / r.totalKB) * 100 : 0,
    }));
  } catch {
    return [];
  }
}

export interface CollectOptions {
  /** CPU 采样窗口 ms，默认 800 */
  cpuSampleMs?: number;
  disks: string[];
}

export async function collectSample(options: CollectOptions): Promise<SystemSample> {
  const cpuSampleMs = options.cpuSampleMs ?? 800;
  const [cpuPercent, memory, disks] = await Promise.all([
    sampleCpuPercent(cpuSampleMs),
    sampleMemory(),
    sampleDisks(options.disks),
  ]);
  const load = os.loadavg() as [number, number, number];
  const cpuCount = os.cpus().length || 1;
  return {
    tsMs: Date.now(),
    cpuPercent,
    memoryPercent: memory.percent,
    memoryUsedBytes: memory.usedBytes,
    memoryTotalBytes: memory.totalBytes,
    load,
    cpuCount,
    load1mPerCore: load[0] / cpuCount,
    hostname: os.hostname(),
    uptimeSeconds: os.uptime(),
    disks,
  };
}
