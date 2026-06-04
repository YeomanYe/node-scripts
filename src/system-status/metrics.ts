import * as os from 'os';
import { spawn } from 'child_process';

export interface BatterySample {
  percentage: number;
  source: string;
  state: string;
  timeRemaining?: string;
  onAC: boolean;
}

export interface DiskSample {
  mount: string;
  usedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface SystemSample {
  tsMs: number;
  hostname: string;
  uptimeSeconds: number;
  cpuPercent: number;
  cpuCount: number;
  memoryPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  load: [number, number, number];
  load1mPerCore: number;
  disks: DiskSample[];
  battery: BatterySample | null;
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} 退出码 ${code}: ${stderr.trim() || 'unknown'}`));
    });
  });
}

interface CpuSnapshot { idle: number; total: number; }

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

interface MemorySample { usedBytes: number; totalBytes: number; percent: number; }

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
  return { usedBytes, totalBytes, percent: (usedBytes / totalBytes) * 100 };
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

interface DfRow { mount: string; totalKB: number; usedKB: number; availKB: number; }

export function parseDf(stdout: string): DfRow[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: DfRow[] = [];
  for (const line of lines.slice(1)) {
    const tokens = line.split(/\s+/);
    if (tokens.length < 6) continue;
    let blocksIdx = -1;
    for (let i = 1; i < tokens.length; i++) {
      if (/^\d+$/.test(tokens[i])) { blocksIdx = i; break; }
    }
    if (blocksIdx === -1 || blocksIdx + 4 >= tokens.length) continue;
    const totalKB = parseInt(tokens[blocksIdx], 10);
    const usedKB = parseInt(tokens[blocksIdx + 1], 10);
    const availKB = parseInt(tokens[blocksIdx + 2], 10);
    const cap = tokens[blocksIdx + 3];
    if (!/%$/.test(cap)) continue;
    const mount = tokens.slice(blocksIdx + 4).join(' ');
    if (!mount.startsWith('/')) continue;
    if (!Number.isFinite(totalKB) || totalKB <= 0) continue;
    if (!Number.isFinite(availKB) || availKB < 0) continue;
    rows.push({ mount, totalKB, usedKB, availKB });
  }
  return rows;
}

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

async function sampleDisks(wanted: string[]): Promise<DiskSample[]> {
  try {
    const stdout = await runCommand('df', ['-kP'], 5000);
    const rows = filterDisks(parseDf(stdout), wanted);
    return rows.map((r) => {
      // 与 df Capacity 列一致:used / (used + avail);APFS 容器共享空间时,
      // 仅以 totalKB(容器大小)作分母会让单卷使用率被严重低估
      const denomKB = r.usedKB + r.availKB;
      return {
        mount: r.mount,
        usedBytes: r.usedKB * 1024,
        totalBytes: denomKB * 1024,
        percent: denomKB > 0 ? (r.usedKB / denomKB) * 100 : 0,
      };
    });
  } catch {
    return [];
  }
}

async function sampleBattery(): Promise<BatterySample | null> {
  if (process.platform !== 'darwin') return null;
  let stdout: string;
  try {
    stdout = await runCommand('/usr/bin/pmset', ['-g', 'batt'], 5000);
  } catch {
    return null;
  }
  const sourceMatch = stdout.match(/Now drawing from '([^']+)'/);
  const battLine = stdout.split('\n').find((l) => /\d+%/.test(l)) ?? '';
  const pctMatch = battLine.match(/(\d+)%/);
  if (!pctMatch) return null;
  const segments = battLine.split(';').map((s) => s.trim());
  const stateSegment = segments[1] ?? '';
  const timeMatch = battLine.match(/(\d+:\d+)\s+remaining/);
  const source = sourceMatch?.[1] ?? 'unknown';
  return {
    percentage: Number(pctMatch[1]),
    source,
    state: stateSegment || 'unknown',
    timeRemaining: timeMatch?.[1],
    onAC: /AC Power/i.test(source),
  };
}

export interface CollectOptions {
  cpuSampleMs?: number;
  disks?: string[];
}

export async function collectSample(options: CollectOptions = {}): Promise<SystemSample> {
  const cpuSampleMs = options.cpuSampleMs ?? 800;
  // macOS APFS:`/` 是只读系统卷(用量很少且无变化),用户实际数据在 /System/Volumes/Data
  const defaultDisks = process.platform === 'darwin' ? ['/System/Volumes/Data'] : ['/'];
  const disksWanted = options.disks ?? defaultDisks;
  const [cpuPercent, memory, disks, battery] = await Promise.all([
    sampleCpuPercent(cpuSampleMs),
    sampleMemory(),
    sampleDisks(disksWanted),
    sampleBattery(),
  ]);
  const load = os.loadavg() as [number, number, number];
  const cpuCount = os.cpus().length || 1;
  return {
    tsMs: Date.now(),
    hostname: os.hostname(),
    uptimeSeconds: os.uptime(),
    cpuPercent,
    cpuCount,
    memoryPercent: memory.percent,
    memoryUsedBytes: memory.usedBytes,
    memoryTotalBytes: memory.totalBytes,
    load,
    load1mPerCore: load[0] / cpuCount,
    disks,
    battery,
  };
}
