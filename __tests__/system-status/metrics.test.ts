import { parseTopProcesses } from '../../src/system-status/metrics';

// `ps -Aceo pid,pcpu,pmem,comm -r` style output (sorted by CPU desc, header first).
const PS_OUTPUT = `  PID %CPU %MEM COMM
  701 92.4  6.1 Google Chrome
 1234 45.2  3.0 node
   55  4.7  1.2 WindowServer
   88  0.0  0.5 launchd
`;

describe('parseTopProcesses', () => {
  it('parses ps output into process samples and skips the header', () => {
    const procs = parseTopProcesses(PS_OUTPUT, 10);
    expect(procs).toHaveLength(4);
    expect(procs[0]).toEqual({
      pid: 701,
      cpuPercent: 92.4,
      memPercent: 6.1,
      command: 'Google Chrome'
    });
    expect(procs[1]).toMatchObject({ pid: 1234, cpuPercent: 45.2, command: 'node' });
  });

  it('preserves command names that contain spaces', () => {
    const procs = parseTopProcesses(PS_OUTPUT, 10);
    expect(procs[0].command).toBe('Google Chrome');
  });

  it('respects the topN limit (keeps ps ordering = CPU desc)', () => {
    const procs = parseTopProcesses(PS_OUTPUT, 2);
    expect(procs).toHaveLength(2);
    expect(procs.map((p) => p.pid)).toEqual([701, 1234]);
  });

  it('ignores blank and malformed lines without throwing', () => {
    const messy = `  PID %CPU %MEM COMM

 1234 45.2 3.0 node
garbage line without numbers
   55 4.7 1.2 WindowServer
`;
    const procs = parseTopProcesses(messy, 10);
    expect(procs.map((p) => p.pid)).toEqual([1234, 55]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseTopProcesses('', 5)).toEqual([]);
    expect(parseTopProcesses('  PID %CPU %MEM COMM\n', 5)).toEqual([]);
  });
});
