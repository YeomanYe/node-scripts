import * as path from 'path';

// 文档/代码契约回归测试：README.md / CLAUDE.md 的工具表必须与
// package.json.bin 一一对应（由 scripts/gen-tools-table.cjs 生成与校验）。
// 新增/删除工具后未跑 `pnpm run tools:gen` 同步文档，此测试会变红。

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gen = require(path.resolve(__dirname, '../../scripts/gen-tools-table.cjs'));

describe('tools-table contract (package.json.bin <-> README/CLAUDE)', () => {
  it('every registered bin has a description in the generator map', () => {
    const problems: string[] = gen.auditDescriptions();
    expect(problems).toEqual([]);
  });

  it('README.md and CLAUDE.md tool tables are in sync with package.json.bin', () => {
    const { ok, problems } = gen.checkDocs();
    if (!ok) {
      // 失败时直接把修复指令打出来，方便定位。
      throw new Error('文档工具表漂移:\n' + problems.map((p: string) => '  - ' + p).join('\n'));
    }
    expect(ok).toBe(true);
  });

  it('generated tables enumerate exactly the 20 registered bins', () => {
    const names: string[] = gen.binNames();
    expect(names.length).toBe(21);
    // README/CLAUDE 表里每个 bin 名都应出现
    const readme = gen.buildReadmeTable();
    const claude = gen.buildClaudeTable();
    for (const name of names) {
      expect(readme).toContain(name);
      expect(claude).toContain(`**${name}**`);
    }
  });
});
