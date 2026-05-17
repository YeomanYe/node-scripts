# skill-doctor Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 node-scripts monorepo 下新增 `skill-doctor` CLI,跑 4 条 lint 规则(dead-refs / frontmatter / bsd-compat / shared-drift)对 `~/Documents/projects/skills/` 这类 Claude skills 仓库做"体检",支持 text/json 两种 reporter 和飞书 on-error 通知。

**Architecture:** 单进程 Node CLI,commander 解析参数;`runner` 串行调用 4 个 rule 模块,每个 rule 返回 `Finding[]`(level + 位置 + 描述);聚合为 `RunReport` 后交给 reporter 输出;若 `--notify=on-error` 且 errors > 0,调 `src/shared/notifiers/feishu` 推送飞书卡片。所有文件 I/O 走 `fs/promises`,跨平台无 shell 依赖。

**Tech Stack:** TypeScript ES2022 / CommonJS / commander / yaml / picocolors / jest+ts-jest / 复用 `src/shared/notifiers/feishu`

---

## File Structure

```
src/skill-doctor/
  index.ts                 # CLI entry, commander 解析 + main
  config.ts                # 加载 .skillslintrc.json + feishu config 三层优先级
  types.ts                 # Finding / Rule / RuleContext / RunReport
  runner.ts                # 调度 rules、聚合、触发 reporter+notifier
  rules/
    dead-refs.ts           # 校验 SKILL.md 引用的 references/X 路径存在
    frontmatter.ts         # 校验 frontmatter: name、description 长度 + 触发短语
    bsd-compat.ts          # 扫 .sh: \s / \d / grep -P 用法
    shared-drift.ts        # 对比 _shared/X.md ↔ <skill>/references/X.md sha256
  reporters/
    text.ts                # picocolors 彩色终端
    json.ts                # 机器可读 JSON
  notify/
    feishu.ts              # 包装 sendFeishuCard,组装卡片内容
  utils/
    walk.ts                # 异步递归找 SKILL.md / .sh
    frontmatter.ts         # 解析 --- ... --- 头(简单 YAML)

__tests__/skill-doctor/
  fixtures/
    clean/                 # 全部合格的最小 skills 仓库
      good-skill/SKILL.md
      good-skill/references/helper.sh
    bad-refs/
      broken-skill/SKILL.md  # 引用不存在的 references/missing.md
    bad-frontmatter/
      no-name/SKILL.md
      desc-too-long/SKILL.md
    bad-bsd/
      broken-sh/SKILL.md
      broken-sh/scripts/with-pcre.sh
    drift/
      _shared/template.md
      skill-a/references/template.md   # hash 与 _shared 不一致
  rules/
    dead-refs.test.ts
    frontmatter.test.ts
    bsd-compat.test.ts
    shared-drift.test.ts
  runner.test.ts           # 跑 fixtures/clean 应 0 findings、跑 bad-* 应有对应 errors
  notify-feishu.test.ts    # mock sendFeishuCard,验证 on-error 触发 + 内容格式

package.json                # 新增 bin: { "skill-doctor": "dist/skill-doctor/index.js" }
```

---

## Type Contracts(后续 task 共用,先固化)

```typescript
// src/skill-doctor/types.ts
export type FindingLevel = 'error' | 'warn' | 'info';

export interface Finding {
  rule: string;          // 规则 id,如 'dead-refs'
  level: FindingLevel;
  skill: string;         // skill 目录相对路径,如 'flow-codex-goal'
  file?: string;         // 具体文件相对路径
  line?: number;
  message: string;
}

export interface RuleContext {
  root: string;          // skills 仓库根目录绝对路径
  skills: SkillEntry[];  // 预扫描的 skill 列表
}

export interface SkillEntry {
  name: string;          // 目录名
  dir: string;           // 绝对路径
  skillMdPath: string;   // <dir>/SKILL.md
}

export interface Rule {
  id: string;
  description: string;
  run: (ctx: RuleContext) => Promise<Finding[]>;
}

export interface RunReport {
  root: string;
  startedAt: string;     // ISO 时间
  durationMs: number;
  rulesRun: string[];
  findings: Finding[];
  counts: { error: number; warn: number; info: number };
}
```

---

## Task 1: 项目骨架 + types + walk 工具

**Files:**
- Create: `src/skill-doctor/types.ts`
- Create: `src/skill-doctor/utils/walk.ts`
- Create: `src/skill-doctor/utils/frontmatter.ts`
- Test: `__tests__/skill-doctor/utils/walk.test.ts`
- Test: `__tests__/skill-doctor/utils/frontmatter.test.ts`

- [ ] **Step 1: 写 walk 的 failing test**

```typescript
// __tests__/skill-doctor/utils/walk.test.ts
import * as path from 'path';
import { findSkillMds, findShellScripts } from '../../../src/skill-doctor/utils/walk';

const FIXTURE = path.join(__dirname, '../fixtures/clean');

describe('walk', () => {
  it('finds all SKILL.md files under root', async () => {
    const files = await findSkillMds(FIXTURE);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.every((f) => f.endsWith('/SKILL.md'))).toBe(true);
  });

  it('finds shell scripts', async () => {
    const files = await findShellScripts(FIXTURE);
    expect(files.every((f) => f.endsWith('.sh') || f.endsWith('.bash'))).toBe(true);
  });
});
```

- [ ] **Step 2: 先建 fixture(clean)**

```bash
mkdir -p __tests__/skill-doctor/fixtures/clean/good-skill/references
```

```markdown
<!-- __tests__/skill-doctor/fixtures/clean/good-skill/SKILL.md -->
---
name: good-skill
description: when user asks foo, do bar
type: tool
---

# good-skill

See `references/helper.sh`.
```

```bash
# __tests__/skill-doctor/fixtures/clean/good-skill/references/helper.sh
#!/usr/bin/env bash
echo "hello"
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/utils/walk.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: 实现 walk**

```typescript
// src/skill-doctor/utils/walk.ts
import * as fs from 'fs/promises';
import * as path from 'path';

const IGNORED = new Set(['node_modules', '.git', '.claude', 'dist', '__tests__']);

async function walk(dir: string, predicate: (name: string) => boolean, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, predicate, out);
    } else if (e.isFile() && predicate(e.name)) {
      out.push(full);
    }
  }
}

export async function findSkillMds(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, (name) => name === 'SKILL.md', out);
  return out;
}

export async function findShellScripts(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, (name) => name.endsWith('.sh') || name.endsWith('.bash'), out);
  return out;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/utils/walk.test.ts`
Expected: PASS(注意:`__tests__` 也在 IGNORED 中,所以 walk fixture 时是从 fixture 目录开始而非根)

- [ ] **Step 6: 写 frontmatter parser 的 failing test**

```typescript
// __tests__/skill-doctor/utils/frontmatter.test.ts
import { parseFrontmatter } from '../../../src/skill-doctor/utils/frontmatter';

describe('parseFrontmatter', () => {
  it('parses well-formed frontmatter', () => {
    const src = `---\nname: foo\ndescription: a tool\n---\n\n# body`;
    const { data, body } = parseFrontmatter(src);
    expect(data).toEqual({ name: 'foo', description: 'a tool' });
    expect(body.trim()).toBe('# body');
  });

  it('returns empty data when no frontmatter', () => {
    const { data, body } = parseFrontmatter('# only body');
    expect(data).toEqual({});
    expect(body).toBe('# only body');
  });

  it('handles missing closing fence gracefully', () => {
    const { data } = parseFrontmatter('---\nname: foo\n# no fence');
    expect(data).toEqual({});
  });
});
```

- [ ] **Step 7: 实现 frontmatter parser**

```typescript
// src/skill-doctor/utils/frontmatter.ts
import { parse as parseYaml } from 'yaml';

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = '---';

export function parseFrontmatter(src: string): FrontmatterResult {
  if (!src.startsWith(`${FENCE}\n`) && !src.startsWith(`${FENCE}\r\n`)) {
    return { data: {}, body: src };
  }
  const rest = src.slice(FENCE.length).replace(/^\r?\n/, '');
  const closeIdx = rest.indexOf(`\n${FENCE}`);
  if (closeIdx === -1) return { data: {}, body: src };
  const yaml = rest.slice(0, closeIdx);
  const body = rest.slice(closeIdx + FENCE.length + 1).replace(/^\r?\n/, '');
  try {
    const data = parseYaml(yaml) as Record<string, unknown>;
    return { data: data ?? {}, body };
  } catch {
    return { data: {}, body: src };
  }
}
```

- [ ] **Step 8: 跑 frontmatter 测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/utils/frontmatter.test.ts`
Expected: PASS

- [ ] **Step 9: 写 types.ts(无测试,纯类型)**

按上面 "Type Contracts" 段落写入 `src/skill-doctor/types.ts`。

- [ ] **Step 10: 跑 typecheck**

Run: `pnpm run build`
Expected: 编译通过

- [ ] **Step 11: Commit**

```bash
git add src/skill-doctor/types.ts src/skill-doctor/utils __tests__/skill-doctor/utils __tests__/skill-doctor/fixtures/clean
git commit -m "feat(skill-doctor): add types and walk/frontmatter utilities"
```

---

## Task 2: Rule — dead-refs

**Files:**
- Create: `src/skill-doctor/rules/dead-refs.ts`
- Test: `__tests__/skill-doctor/rules/dead-refs.test.ts`
- Fixture: `__tests__/skill-doctor/fixtures/bad-refs/broken-skill/SKILL.md`

**Rule 契约:** 扫每个 SKILL.md 的 body,正则提取形如 `` `references/X` `` 或 `references/X.md` 的引用(行内代码 / 普通文本均算),逐个 stat 同级 `references/<相对路径>`,不存在 → emit `error`(level)。

- [ ] **Step 1: 建 bad-refs fixture**

```markdown
<!-- __tests__/skill-doctor/fixtures/bad-refs/broken-skill/SKILL.md -->
---
name: broken-skill
description: a skill with dead reference
---

See `references/missing.md` and references/also-missing.sh.
```

- [ ] **Step 2: 写 dead-refs failing test**

```typescript
// __tests__/skill-doctor/rules/dead-refs.test.ts
import * as path from 'path';
import { deadRefsRule } from '../../../src/skill-doctor/rules/dead-refs';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('dead-refs rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await deadRefsRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('flags missing references with error level', async () => {
    const ctx = await buildCtx('bad-refs');
    const findings = await deadRefsRule.run(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.level === 'error')).toBe(true);
    expect(findings.some((f) => f.message.includes('missing.md'))).toBe(true);
    expect(findings.some((f) => f.message.includes('also-missing.sh'))).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/rules/dead-refs.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: 实现 dead-refs**

```typescript
// src/skill-doctor/rules/dead-refs.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Finding, Rule } from '../types';

// 匹配:
//   `references/foo.md`      (inline code)
//   references/bar.sh        (plain text)
const REF_PATTERN = /(?:`)?references\/([A-Za-z0-9_\-./]+)(?:`)?/g;

export const deadRefsRule: Rule = {
  id: 'dead-refs',
  description: 'Detect SKILL.md references to non-existent references/* files',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }
      const seen = new Set<string>();
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        REF_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = REF_PATTERN.exec(line)) !== null) {
          const rel = m[1].replace(/[.,;:)]+$/, '');
          if (seen.has(rel)) continue;
          seen.add(rel);
          const abs = path.join(skill.dir, 'references', rel);
          try {
            await fs.access(abs);
          } catch {
            findings.push({
              rule: 'dead-refs',
              level: 'error',
              skill: skill.name,
              file: path.relative(ctx.root, skill.skillMdPath),
              line: i + 1,
              message: `references/${rel} not found at ${path.relative(ctx.root, abs)}`,
            });
          }
        }
      }
    }
    return findings;
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/rules/dead-refs.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skill-doctor/rules/dead-refs.ts __tests__/skill-doctor/rules/dead-refs.test.ts __tests__/skill-doctor/fixtures/bad-refs
git commit -m "feat(skill-doctor): add dead-refs rule"
```

---

## Task 3: Rule — frontmatter

**Files:**
- Create: `src/skill-doctor/rules/frontmatter.ts`
- Test: `__tests__/skill-doctor/rules/frontmatter.test.ts`
- Fixtures: `__tests__/skill-doctor/fixtures/bad-frontmatter/{no-name,desc-too-long}/SKILL.md`

**Rule 契约:**
- 缺 `name` → error
- 缺 `description` → error
- `description.length > 250` → warn(超过会被工具链截断)
- `name` 与所在目录名不一致 → warn
- 通过则不 emit

- [ ] **Step 1: 建 bad-frontmatter fixtures**

```markdown
<!-- __tests__/skill-doctor/fixtures/bad-frontmatter/no-name/SKILL.md -->
---
description: missing name field
---
# body
```

```markdown
<!-- __tests__/skill-doctor/fixtures/bad-frontmatter/desc-too-long/SKILL.md -->
---
name: desc-too-long
description: aaaaaaaaaa[REPEAT 300 'a' chars here, total > 250]
---
# body
```

实际 fixture 写时,description 用 300 个 `a` 字符。

- [ ] **Step 2: 写 frontmatter rule failing test**

```typescript
// __tests__/skill-doctor/rules/frontmatter.test.ts
import * as path from 'path';
import { frontmatterRule } from '../../../src/skill-doctor/rules/frontmatter';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('frontmatter rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await frontmatterRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('errors on missing name', async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(findings.some((f) => f.skill === 'no-name' && f.level === 'error' && f.message.includes('name'))).toBe(true);
  });

  it('warns on description > 250 chars', async () => {
    const ctx = await buildCtx('bad-frontmatter');
    const findings = await frontmatterRule.run(ctx);
    expect(findings.some((f) => f.skill === 'desc-too-long' && f.level === 'warn' && f.message.includes('250'))).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/rules/frontmatter.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 frontmatter rule**

```typescript
// src/skill-doctor/rules/frontmatter.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseFrontmatter } from '../utils/frontmatter';
import type { Finding, Rule } from '../types';

const DESCRIPTION_MAX = 250;

export const frontmatterRule: Rule = {
  id: 'frontmatter',
  description: 'Validate SKILL.md frontmatter quality',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      let src: string;
      try {
        src = await fs.readFile(skill.skillMdPath, 'utf8');
      } catch {
        continue;
      }
      const { data } = parseFrontmatter(src);
      const rel = path.relative(ctx.root, skill.skillMdPath);

      const name = typeof data.name === 'string' ? data.name : undefined;
      const desc = typeof data.description === 'string' ? data.description : undefined;

      if (!name) {
        findings.push({
          rule: 'frontmatter', level: 'error', skill: skill.name, file: rel,
          message: 'missing "name" field',
        });
      } else if (name !== skill.name) {
        findings.push({
          rule: 'frontmatter', level: 'warn', skill: skill.name, file: rel,
          message: `frontmatter name "${name}" does not match directory name "${skill.name}"`,
        });
      }

      if (!desc) {
        findings.push({
          rule: 'frontmatter', level: 'error', skill: skill.name, file: rel,
          message: 'missing "description" field',
        });
      } else if (desc.length > DESCRIPTION_MAX) {
        findings.push({
          rule: 'frontmatter', level: 'warn', skill: skill.name, file: rel,
          message: `description length ${desc.length} exceeds 250 (may be truncated)`,
        });
      }
    }
    return findings;
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/rules/frontmatter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skill-doctor/rules/frontmatter.ts __tests__/skill-doctor/rules/frontmatter.test.ts __tests__/skill-doctor/fixtures/bad-frontmatter
git commit -m "feat(skill-doctor): add frontmatter rule"
```

---

## Task 4: Rule — bsd-compat

**Files:**
- Create: `src/skill-doctor/rules/bsd-compat.ts`
- Test: `__tests__/skill-doctor/rules/bsd-compat.test.ts`
- Fixture: `__tests__/skill-doctor/fixtures/bad-bsd/broken-sh/scripts/with-pcre.sh`

**Rule 契约:** 扫每个 skill 下的 `.sh` / `.bash`,逐行检查(跳过注释行,即以可选缩进 + `#` 开头的行):
- 含 `\s` 或 `\d`(在 sed/awk/grep 参数里 BSD 不展开)→ warn
- 含 `grep -P` 或 `egrep -P`(BSD grep 无 PCRE)→ error

- [ ] **Step 1: 建 bad-bsd fixture**

```markdown
<!-- __tests__/skill-doctor/fixtures/bad-bsd/broken-sh/SKILL.md -->
---
name: broken-sh
description: a skill whose helper script uses BSD-incompatible regex
---
```

```bash
# __tests__/skill-doctor/fixtures/bad-bsd/broken-sh/scripts/with-pcre.sh
#!/usr/bin/env bash
# this comment has \s but should be ignored
grep -P '\d+' file.txt
sed 's/\s/_/g' file.txt
```

- [ ] **Step 2: 写 bsd-compat failing test**

```typescript
// __tests__/skill-doctor/rules/bsd-compat.test.ts
import * as path from 'path';
import { bsdCompatRule } from '../../../src/skill-doctor/rules/bsd-compat';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('bsd-compat rule', () => {
  it('passes clean fixture', async () => {
    const ctx = await buildCtx('clean');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('errors on grep -P', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings.some((f) => f.level === 'error' && /grep\s+-P/.test(f.message))).toBe(true);
  });

  it('warns on \\s usage', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    expect(findings.some((f) => f.level === 'warn' && f.message.includes('\\s'))).toBe(true);
  });

  it('skips comment lines', async () => {
    const ctx = await buildCtx('bad-bsd');
    const findings = await bsdCompatRule.run(ctx);
    // 注释行的 \s 不应被报
    const commentLine = findings.find((f) => f.line === 2);
    expect(commentLine).toBeUndefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/rules/bsd-compat.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 bsd-compat**

```typescript
// src/skill-doctor/rules/bsd-compat.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { findShellScripts } from '../utils/walk';
import type { Finding, Rule } from '../types';

const PCRE_PATTERN = /\b(?:grep|egrep)\s+-[a-zA-Z]*P/;
const SLASH_S = /\\s/;
const SLASH_D = /\\d/;
const COMMENT = /^\s*#/;

export const bsdCompatRule: Rule = {
  id: 'bsd-compat',
  description: 'Detect BSD-incompatible regex/grep flags in shell scripts',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const skill of ctx.skills) {
      const scripts = await findShellScripts(skill.dir);
      for (const script of scripts) {
        let src: string;
        try {
          src = await fs.readFile(script, 'utf8');
        } catch {
          continue;
        }
        const rel = path.relative(ctx.root, script);
        const lines = src.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (COMMENT.test(line)) continue;
          if (PCRE_PATTERN.test(line)) {
            findings.push({
              rule: 'bsd-compat', level: 'error', skill: skill.name, file: rel, line: i + 1,
              message: 'grep -P is not supported on BSD/macOS grep; use ERE or perl',
            });
          }
          if (SLASH_S.test(line)) {
            findings.push({
              rule: 'bsd-compat', level: 'warn', skill: skill.name, file: rel, line: i + 1,
              message: '\\s is not portable in BSD sed/awk/grep; use [[:space:]] instead',
            });
          }
          if (SLASH_D.test(line)) {
            findings.push({
              rule: 'bsd-compat', level: 'warn', skill: skill.name, file: rel, line: i + 1,
              message: '\\d is not portable in BSD sed/awk/grep; use [0-9] or [[:digit:]] instead',
            });
          }
        }
      }
    }
    return findings;
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/rules/bsd-compat.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skill-doctor/rules/bsd-compat.ts __tests__/skill-doctor/rules/bsd-compat.test.ts __tests__/skill-doctor/fixtures/bad-bsd
git commit -m "feat(skill-doctor): add bsd-compat rule"
```

---

## Task 5: Rule — shared-drift

**Files:**
- Create: `src/skill-doctor/rules/shared-drift.ts`
- Test: `__tests__/skill-doctor/rules/shared-drift.test.ts`
- Fixtures: `__tests__/skill-doctor/fixtures/drift/_shared/template.md` + `__tests__/skill-doctor/fixtures/drift/skill-a/references/template.md`

**Rule 契约:** 若 `<root>/_shared/X.md` 存在,则扫所有 `<skill>/references/X.md`,对比 sha256:
- 不一致 → warn(drift)
- skill 完全缺失对应 references/X.md → 不报(可能本来就不该有)

- [ ] **Step 1: 建 drift fixture**

```markdown
<!-- __tests__/skill-doctor/fixtures/drift/_shared/template.md -->
# Canonical Template

This is the source of truth (v2).
```

```markdown
<!-- __tests__/skill-doctor/fixtures/drift/skill-a/SKILL.md -->
---
name: skill-a
description: skill that references the shared template
---
See `references/template.md`.
```

```markdown
<!-- __tests__/skill-doctor/fixtures/drift/skill-a/references/template.md -->
# Canonical Template

This is the source of truth (v1).
```

注意:`drift/skill-a/references/template.md` 与 `drift/_shared/template.md` 内容不同(v1 vs v2)。

- [ ] **Step 2: 写 shared-drift failing test**

```typescript
// __tests__/skill-doctor/rules/shared-drift.test.ts
import * as path from 'path';
import { sharedDriftRule } from '../../../src/skill-doctor/rules/shared-drift';
import type { RuleContext } from '../../../src/skill-doctor/types';
import { findSkillMds } from '../../../src/skill-doctor/utils/walk';

async function buildCtx(fixture: string): Promise<RuleContext> {
  const root = path.join(__dirname, '../fixtures', fixture);
  const skillMds = await findSkillMds(root);
  const skills = skillMds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
  return { root, skills };
}

describe('shared-drift rule', () => {
  it('passes clean fixture (no _shared dir)', async () => {
    const ctx = await buildCtx('clean');
    const findings = await sharedDriftRule.run(ctx);
    expect(findings).toEqual([]);
  });

  it('warns when references/X.md hash differs from _shared/X.md', async () => {
    const ctx = await buildCtx('drift');
    const findings = await sharedDriftRule.run(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].level).toBe('warn');
    expect(findings[0].message).toContain('template.md');
    expect(findings[0].message.toLowerCase()).toContain('drift');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/rules/shared-drift.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 shared-drift**

```typescript
// src/skill-doctor/rules/shared-drift.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Finding, Rule } from '../types';

async function sha256OfFile(p: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(p);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

async function listSharedFiles(sharedDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sharedDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

export const sharedDriftRule: Rule = {
  id: 'shared-drift',
  description: 'Detect hash drift between _shared/X.md and <skill>/references/X.md',
  async run(ctx) {
    const findings: Finding[] = [];
    const sharedDir = path.join(ctx.root, '_shared');
    const sharedFiles = await listSharedFiles(sharedDir);
    if (sharedFiles.length === 0) return findings;

    for (const fname of sharedFiles) {
      const sharedHash = await sha256OfFile(path.join(sharedDir, fname));
      if (!sharedHash) continue;
      for (const skill of ctx.skills) {
        const refPath = path.join(skill.dir, 'references', fname);
        const refHash = await sha256OfFile(refPath);
        if (refHash === null) continue;
        if (refHash !== sharedHash) {
          findings.push({
            rule: 'shared-drift', level: 'warn', skill: skill.name,
            file: path.relative(ctx.root, refPath),
            message: `drift: ${fname} sha256 differs from _shared/${fname} (sync needed)`,
          });
        }
      }
    }
    return findings;
  },
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/rules/shared-drift.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/skill-doctor/rules/shared-drift.ts __tests__/skill-doctor/rules/shared-drift.test.ts __tests__/skill-doctor/fixtures/drift
git commit -m "feat(skill-doctor): add shared-drift rule"
```

---

## Task 6: Reporters(text + json)

**Files:**
- Create: `src/skill-doctor/reporters/text.ts`
- Create: `src/skill-doctor/reporters/json.ts`
- Test: `__tests__/skill-doctor/reporters.test.ts`

**契约:**
- `text`: stdout 输出,picocolors 着色;每个 finding 一行:`LEVEL  skill/file:line  rule  message`;末尾 summary `Errors: N · Warnings: M · Info: K`
- `json`: `JSON.stringify(report, null, 2)`,直接 stdout

- [ ] **Step 1: 写 reporters failing test**

```typescript
// __tests__/skill-doctor/reporters.test.ts
import { renderText } from '../../src/skill-doctor/reporters/text';
import { renderJson } from '../../src/skill-doctor/reporters/json';
import type { RunReport } from '../../src/skill-doctor/types';

const REPORT: RunReport = {
  root: '/tmp/skills',
  startedAt: '2026-05-16T10:00:00.000Z',
  durationMs: 123,
  rulesRun: ['dead-refs', 'frontmatter'],
  findings: [
    { rule: 'dead-refs', level: 'error', skill: 'foo', file: 'foo/SKILL.md', line: 5, message: 'missing.md not found' },
    { rule: 'frontmatter', level: 'warn', skill: 'bar', file: 'bar/SKILL.md', message: 'description too long' },
  ],
  counts: { error: 1, warn: 1, info: 0 },
};

describe('renderText', () => {
  it('includes findings and summary', () => {
    const out = renderText(REPORT, { color: false });
    expect(out).toContain('ERROR');
    expect(out).toContain('foo/SKILL.md:5');
    expect(out).toContain('dead-refs');
    expect(out).toContain('missing.md not found');
    expect(out).toContain('Errors: 1');
    expect(out).toContain('Warnings: 1');
  });
});

describe('renderJson', () => {
  it('returns valid JSON of the report', () => {
    const out = renderJson(REPORT);
    expect(JSON.parse(out)).toEqual(REPORT);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/reporters.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 reporters**

```typescript
// src/skill-doctor/reporters/json.ts
import type { RunReport } from '../types';
export function renderJson(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}
```

```typescript
// src/skill-doctor/reporters/text.ts
import pc from 'picocolors';
import type { Finding, FindingLevel, RunReport } from '../types';

export interface TextRenderOptions {
  color?: boolean;
}

function tag(level: FindingLevel, color: boolean): string {
  const txt = level.toUpperCase().padEnd(5);
  if (!color) return txt;
  if (level === 'error') return pc.red(txt);
  if (level === 'warn') return pc.yellow(txt);
  return pc.cyan(txt);
}

function fmtLine(f: Finding, color: boolean): string {
  const loc = f.line != null ? `${f.file ?? ''}:${f.line}` : f.file ?? '';
  return `${tag(f.level, color)}  ${f.skill}  ${loc}  [${f.rule}]  ${f.message}`;
}

export function renderText(report: RunReport, opts: TextRenderOptions = {}): string {
  const color = opts.color ?? false;
  const lines = report.findings.map((f) => fmtLine(f, color));
  lines.push('');
  lines.push(`Rules: ${report.rulesRun.join(', ')}`);
  lines.push(`Errors: ${report.counts.error} · Warnings: ${report.counts.warn} · Info: ${report.counts.info}`);
  lines.push(`Duration: ${report.durationMs}ms · Root: ${report.root}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/reporters.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-doctor/reporters __tests__/skill-doctor/reporters.test.ts
git commit -m "feat(skill-doctor): add text and json reporters"
```

---

## Task 7: Feishu notify wrapper

**Files:**
- Create: `src/skill-doctor/notify/feishu.ts`
- Test: `__tests__/skill-doctor/notify-feishu.test.ts`

**契约:**
- 入参:`RunReport` + `FeishuChannelConfig` + `mode: 'on-error' | 'always' | 'off'`
- `off` → 不发
- `on-error` 且 `report.counts.error === 0` → 不发
- 其他情况 → 调 `sendFeishuCard`,组装 NotifierMessage:
  - `level`: `'warn'` if errors>0 else `'info'`
  - `title`: `🩺 skill-doctor — N errors / M warnings`
  - `content`: lark_md 列前 5 条 error + 前 5 条 warn,超出加 `... and X more`

- [ ] **Step 1: 写 feishu failing test**

```typescript
// __tests__/skill-doctor/notify-feishu.test.ts
import { maybeSendFeishu } from '../../src/skill-doctor/notify/feishu';
import type { RunReport } from '../../src/skill-doctor/types';
import type { FeishuChannelConfig } from '../../src/shared/notifiers/types';

jest.mock('../../src/shared/notifiers/feishu', () => ({
  sendFeishuCard: jest.fn().mockResolvedValue(undefined),
}));

import { sendFeishuCard } from '../../src/shared/notifiers/feishu';

const FAKE_CONFIG: FeishuChannelConfig = {
  type: 'feishu', app_id: 'a', app_secret: 's', receive_id: 'r',
};

function makeReport(errors: number, warns = 0): RunReport {
  const findings = [
    ...Array.from({ length: errors }, (_, i) => ({
      rule: 'dead-refs', level: 'error' as const, skill: `s${i}`, file: `s${i}/SKILL.md`, message: `err ${i}`,
    })),
    ...Array.from({ length: warns }, (_, i) => ({
      rule: 'frontmatter', level: 'warn' as const, skill: `w${i}`, file: `w${i}/SKILL.md`, message: `warn ${i}`,
    })),
  ];
  return {
    root: '/tmp', startedAt: '2026-05-16T00:00:00.000Z', durationMs: 1,
    rulesRun: ['dead-refs'], findings,
    counts: { error: errors, warn: warns, info: 0 },
  };
}

beforeEach(() => (sendFeishuCard as jest.Mock).mockClear());

describe('maybeSendFeishu', () => {
  it('does nothing when mode=off', async () => {
    await maybeSendFeishu(makeReport(3), FAKE_CONFIG, 'off');
    expect(sendFeishuCard).not.toHaveBeenCalled();
  });

  it('does nothing on on-error when zero errors', async () => {
    await maybeSendFeishu(makeReport(0, 5), FAKE_CONFIG, 'on-error');
    expect(sendFeishuCard).not.toHaveBeenCalled();
  });

  it('sends on on-error when errors > 0', async () => {
    await maybeSendFeishu(makeReport(2, 1), FAKE_CONFIG, 'on-error');
    expect(sendFeishuCard).toHaveBeenCalledTimes(1);
    const [, msg] = (sendFeishuCard as jest.Mock).mock.calls[0];
    expect(msg.level).toBe('warn');
    expect(msg.title).toContain('2 errors');
    expect(msg.content).toContain('err 0');
  });

  it('always sends on always mode', async () => {
    await maybeSendFeishu(makeReport(0, 0), FAKE_CONFIG, 'always');
    expect(sendFeishuCard).toHaveBeenCalledTimes(1);
    const [, msg] = (sendFeishuCard as jest.Mock).mock.calls[0];
    expect(msg.level).toBe('info');
    expect(msg.title).toContain('0 errors');
  });

  it('truncates long lists', async () => {
    await maybeSendFeishu(makeReport(10), FAKE_CONFIG, 'on-error');
    const [, msg] = (sendFeishuCard as jest.Mock).mock.calls[0];
    expect(msg.content).toContain('and 5 more');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/notify-feishu.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 maybeSendFeishu**

```typescript
// src/skill-doctor/notify/feishu.ts
import { sendFeishuCard } from '../../shared/notifiers/feishu';
import type { FeishuChannelConfig, NotifierMessage } from '../../shared/notifiers/types';
import type { Finding, RunReport } from '../types';

export type NotifyMode = 'on-error' | 'always' | 'off';

const MAX_PER_BUCKET = 5;

function renderBucket(label: string, items: Finding[]): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_PER_BUCKET);
  const lines = shown.map((f) => {
    const loc = f.line != null ? `${f.file ?? ''}:${f.line}` : f.file ?? '';
    return `- \`${f.skill}\` ${loc} — [${f.rule}] ${f.message}`;
  });
  if (items.length > MAX_PER_BUCKET) {
    lines.push(`- ... and ${items.length - MAX_PER_BUCKET} more`);
  }
  return `**${label}**\n${lines.join('\n')}`;
}

export function shouldSend(report: RunReport, mode: NotifyMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return report.counts.error > 0;
}

export function buildMessage(report: RunReport): NotifierMessage {
  const errors = report.findings.filter((f) => f.level === 'error');
  const warns = report.findings.filter((f) => f.level === 'warn');
  const level: 'warn' | 'info' = errors.length > 0 ? 'warn' : 'info';
  const title = `🩺 skill-doctor — ${errors.length} errors / ${warns.length} warnings`;
  const parts = [
    `**Root**: ${report.root}`,
    `**Rules**: ${report.rulesRun.join(', ')}`,
    renderBucket('❌ Errors', errors),
    renderBucket('⚠️ Warnings', warns),
    `**Duration**: ${report.durationMs}ms`,
  ].filter(Boolean);
  return { title, content: parts.join('\n\n'), level };
}

export async function maybeSendFeishu(
  report: RunReport,
  config: FeishuChannelConfig,
  mode: NotifyMode,
): Promise<void> {
  if (!shouldSend(report, mode)) return;
  const msg = buildMessage(report);
  await sendFeishuCard(config, msg);
}
```

注意:`sendFeishuCard` 已存在于 `src/shared/notifiers/feishu.ts`,签名是 `(config, message) => Promise<void>`。任务 0 中已验证。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/notify-feishu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-doctor/notify __tests__/skill-doctor/notify-feishu.test.ts
git commit -m "feat(skill-doctor): add feishu on-error notifier"
```

---

## Task 8: Runner(聚合 rules、构造 RunReport)

**Files:**
- Create: `src/skill-doctor/runner.ts`
- Test: `__tests__/skill-doctor/runner.test.ts`

**契约:**
- 入参:`{ root: string, ruleIds?: string[] }`(不指定 ruleIds 跑全部)
- 输出 `RunReport`
- 跑 rule 时 try/catch 单条 rule,失败的 rule emit 一条 `error` finding(`rule: '<id>', message: 'rule crashed: ...'`)

- [ ] **Step 1: 写 runner failing test**

```typescript
// __tests__/skill-doctor/runner.test.ts
import * as path from 'path';
import { runDoctor } from '../../src/skill-doctor/runner';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('runDoctor', () => {
  it('returns 0 findings on clean fixture', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'clean') });
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ error: 0, warn: 0, info: 0 });
    expect(report.rulesRun).toEqual(expect.arrayContaining(['dead-refs', 'frontmatter', 'bsd-compat', 'shared-drift']));
  });

  it('flags errors on bad-refs fixture', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'bad-refs') });
    expect(report.counts.error).toBeGreaterThanOrEqual(2);
  });

  it('honors ruleIds filter', async () => {
    const report = await runDoctor({ root: path.join(FIXTURES, 'bad-refs'), ruleIds: ['frontmatter'] });
    expect(report.rulesRun).toEqual(['frontmatter']);
    expect(report.findings.every((f) => f.rule === 'frontmatter')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/runner.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 runner**

```typescript
// src/skill-doctor/runner.ts
import * as path from 'path';
import { findSkillMds } from './utils/walk';
import { deadRefsRule } from './rules/dead-refs';
import { frontmatterRule } from './rules/frontmatter';
import { bsdCompatRule } from './rules/bsd-compat';
import { sharedDriftRule } from './rules/shared-drift';
import type { Finding, Rule, RunReport, SkillEntry } from './types';

const ALL_RULES: Rule[] = [deadRefsRule, frontmatterRule, bsdCompatRule, sharedDriftRule];

export interface RunOptions {
  root: string;
  ruleIds?: string[];
}

async function buildSkills(root: string): Promise<SkillEntry[]> {
  const mds = await findSkillMds(root);
  return mds.map((p) => ({
    name: path.basename(path.dirname(p)),
    dir: path.dirname(p),
    skillMdPath: p,
  }));
}

export async function runDoctor(opts: RunOptions): Promise<RunReport> {
  const startedAt = new Date();
  const rules = opts.ruleIds
    ? ALL_RULES.filter((r) => opts.ruleIds!.includes(r.id))
    : ALL_RULES;
  const skills = await buildSkills(opts.root);
  const ctx = { root: opts.root, skills };
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      const out = await rule.run(ctx);
      findings.push(...out);
    } catch (err) {
      findings.push({
        rule: rule.id, level: 'error', skill: '<runner>',
        message: `rule crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  const counts = {
    error: findings.filter((f) => f.level === 'error').length,
    warn: findings.filter((f) => f.level === 'warn').length,
    info: findings.filter((f) => f.level === 'info').length,
  };
  return {
    root: opts.root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    rulesRun: rules.map((r) => r.id),
    findings,
    counts,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-doctor/runner.ts __tests__/skill-doctor/runner.test.ts
git commit -m "feat(skill-doctor): add runner aggregator"
```

---

## Task 9: Config loader

**Files:**
- Create: `src/skill-doctor/config.ts`
- Test: `__tests__/skill-doctor/config.test.ts`

**契约:**
- `loadFeishuConfig(cliPath?, envVar?, defaultPath?)`:按优先级 CLI > env > default,返回 `FeishuChannelConfig | null`
- 默认 path = `$HOME/.config/skill-doctor/feishu.json`
- 用 zod 校验 schema
- 不存在 → 返回 null;格式错误 → throw

- [ ] **Step 1: 写 config failing test**

```typescript
// __tests__/skill-doctor/config.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadFeishuConfig } from '../../src/skill-doctor/config';

describe('loadFeishuConfig', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-cfg-'));
  const cfgPath = path.join(tmp, 'feishu.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    type: 'feishu', app_id: 'a', app_secret: 's', receive_id: 'r',
  }));

  it('returns null when no path resolves', () => {
    expect(loadFeishuConfig(undefined, undefined, path.join(tmp, 'nope.json'))).toBeNull();
  });

  it('loads from explicit cliPath', () => {
    const cfg = loadFeishuConfig(cfgPath);
    expect(cfg?.app_id).toBe('a');
  });

  it('throws on schema mismatch', () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ type: 'feishu', app_id: 1 }));
    expect(() => loadFeishuConfig(bad)).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/config.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 config**

```typescript
// src/skill-doctor/config.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import type { FeishuChannelConfig } from '../shared/notifiers/types';

const FeishuSchema = z.object({
  type: z.literal('feishu'),
  app_id: z.string(),
  app_secret: z.string(),
  receive_id: z.string(),
  receive_id_type: z.enum(['chat_id', 'open_id', 'user_id', 'email']).optional(),
  domain: z.string().optional(),
});

export function defaultFeishuPath(): string {
  return path.join(os.homedir(), '.config', 'skill-doctor', 'feishu.json');
}

export function loadFeishuConfig(
  cliPath?: string,
  envVar = 'SKILL_DOCTOR_FEISHU_CONFIG',
  fallback = defaultFeishuPath(),
): FeishuChannelConfig | null {
  const candidates = [cliPath, process.env[envVar], fallback].filter(Boolean) as string[];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return FeishuSchema.parse(json);  // throws on schema mismatch
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- __tests__/skill-doctor/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-doctor/config.ts __tests__/skill-doctor/config.test.ts
git commit -m "feat(skill-doctor): add feishu config loader with zod"
```

---

## Task 10: CLI entry(commander wire-up)

**Files:**
- Create: `src/skill-doctor/index.ts`
- Modify: `package.json`(加 bin)
- Test: `__tests__/skill-doctor/cli.test.ts`(可选,smoke 测 main)

**契约:** CLI:
```
skill-doctor [--root <dir>] [--rules <ids,csv>] [--format text|json] [--notify on-error|always|off]
             [--feishu-config <path>] [--no-color]
```

- `--root`: default `~/Documents/projects/skills` 不存在时 throw 友好错误
- exit code: 0=clean,1=warn-only,2=any-error
- `--notify on-error` 是默认值

- [ ] **Step 1: 写 cli smoke test**

```typescript
// __tests__/skill-doctor/cli.test.ts
import * as path from 'path';
import { runMain } from '../../src/skill-doctor/index';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('cli runMain', () => {
  it('returns exit code 0 on clean fixture (json, notify off)', async () => {
    const { code, output } = await runMain([
      '--root', path.join(FIXTURES, 'clean'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(output);
    expect(report.counts).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('returns exit code 2 on bad-refs fixture', async () => {
    const { code } = await runMain([
      '--root', path.join(FIXTURES, 'bad-refs'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(2);
  });

  it('returns exit code 1 on warn-only fixture (drift)', async () => {
    const { code } = await runMain([
      '--root', path.join(FIXTURES, 'drift'),
      '--format', 'json',
      '--notify', 'off',
    ]);
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- __tests__/skill-doctor/cli.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 CLI**

```typescript
#!/usr/bin/env node
// src/skill-doctor/index.ts
import { Command } from 'commander';
import { runDoctor } from './runner';
import { renderText } from './reporters/text';
import { renderJson } from './reporters/json';
import { loadFeishuConfig } from './config';
import { maybeSendFeishu, type NotifyMode } from './notify/feishu';

export interface CliResult {
  code: number;
  output: string;
}

export async function runMain(argv: string[]): Promise<CliResult> {
  const program = new Command();
  program
    .name('skill-doctor')
    .description('Lint Claude skills directory')
    .option('--root <dir>', 'skills repo root', `${process.env.HOME}/Documents/projects/skills`)
    .option('--rules <ids>', 'comma-separated rule ids (default: all)')
    .option('--format <fmt>', 'output format: text|json', 'text')
    .option('--notify <mode>', 'feishu notify: on-error|always|off', 'on-error')
    .option('--feishu-config <path>', 'feishu config json path')
    .option('--no-color', 'disable color in text output')
    .allowExcessArguments(false)
    .exitOverride();

  let parsed;
  try {
    parsed = program.parse(argv, { from: 'user' });
  } catch (err: any) {
    return { code: 2, output: err.message ?? String(err) };
  }
  const opts = parsed.opts<{
    root: string; rules?: string; format: string; notify: NotifyMode;
    feishuConfig?: string; color: boolean;
  }>();

  const ruleIds = opts.rules ? opts.rules.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const report = await runDoctor({ root: opts.root, ruleIds });

  const output = opts.format === 'json'
    ? renderJson(report)
    : renderText(report, { color: opts.color !== false });

  // Notify (best-effort, swallow errors so they don't break the CLI exit code semantics)
  if (opts.notify !== 'off') {
    try {
      const cfg = loadFeishuConfig(opts.feishuConfig);
      if (cfg) await maybeSendFeishu(report, cfg, opts.notify);
    } catch (err) {
      process.stderr.write(`[skill-doctor] feishu notify failed: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  const code = report.counts.error > 0 ? 2 : report.counts.warn > 0 ? 1 : 0;
  return { code, output };
}

if (require.main === module) {
  runMain(process.argv.slice(2)).then(({ code, output }) => {
    process.stdout.write(output + '\n');
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(2);
  });
}
```

- [ ] **Step 4: 加 bin entry**

修改 `package.json`,在 `bin` 字段加:
```json
"skill-doctor": "dist/skill-doctor/index.js"
```

- [ ] **Step 5: 跑 cli 测试 + 全套测试 + build**

Run:
```bash
pnpm test -- __tests__/skill-doctor/cli.test.ts
pnpm test
pnpm run build
```
Expected: 全部 PASS,build 无错误

- [ ] **Step 6: 端到端 smoke(真实跑 skills 仓库)**

Run: `node dist/skill-doctor/index.js --root ~/Documents/projects/skills --format json --notify off | jq '.counts'`
Expected: 输出 JSON 含 `{error, warn, info}`,不崩溃

- [ ] **Step 7: Commit**

```bash
git add src/skill-doctor/index.ts package.json __tests__/skill-doctor/cli.test.ts
git commit -m "feat(skill-doctor): add CLI entry and bin registration"
```

---

## Self-Review 清单

**Spec coverage**:
- ✅ 4 rules: dead-refs (Task 2) / frontmatter (Task 3) / bsd-compat (Task 4) / shared-drift (Task 5)
- ✅ 2 reporters: text/json (Task 6)
- ✅ Feishu on-error 通知 (Task 7)
- ✅ Config loader (Task 9)
- ✅ CLI entry + bin (Task 10)
- ✅ Exit codes:0/1/2 (Task 10)
- ✅ 配置三层优先级:CLI > env > default `~/.config/skill-doctor/feishu.json` (Task 9)

**类型一致性**:
- `Finding`/`Rule`/`RunReport` 在 Task 1 定义,后续 Task 全部使用相同字段名
- `NotifyMode` 在 Task 7 定义,Task 10 复用
- `FeishuChannelConfig` 从 `src/shared/notifiers/types` 复用,不自定义

**Placeholder 扫**: 无 TODO/TBD/"similar to"

**验收 Hard Gates(Stage 7 delivery-gate 用)**:
1. `pnpm test` 全过
2. `pnpm run build` 无 type 错误
3. 端到端 `node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json` 输出有效 JSON
4. 包含 fixture 测试覆盖正反两面(clean + bad-*)

---

## 执行模式

按 flow-dev-task Stage 4 决定:**Codex 派工**(样板为主、可独立 SPEC、≥ 30 行、≥ 2 文件)。
Plan 写完后由 flow-dev-task 把本 plan 转译为 Codex SPEC,Codex 实施,Claude review。
