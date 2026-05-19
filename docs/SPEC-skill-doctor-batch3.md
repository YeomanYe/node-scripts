# SPEC: skill-doctor Batch 3 — `--fix` 自动修复模式

## 目标

给 `skill-doctor` 加自动修复能力,**只修能确定性 transform 的问题**(语义不变),需 Claude 判断的不修。

## 范围

**涉及文件(新增)**:
- `src/skill-doctor/fix/types.ts`(`Fixer` interface + `FixResult`)
- `src/skill-doctor/fix/bsd-compat-fix.ts`(`\s`→`[[:space:]]` + `\d`→`[0-9]`)
- `src/skill-doctor/fix/shared-drift-fix.ts`(包装 `sync-shared.sh`,wrapper 模式)
- `src/skill-doctor/fix/runner.ts`(`ALL_FIXERS` 数组 + `runFixers(opts)`)
- `__tests__/skill-doctor/fix/bsd-compat-fix.test.ts`
- `__tests__/skill-doctor/fix/shared-drift-fix.test.ts`
- `__tests__/skill-doctor/fixtures/fix/bsd-compat/`(含 before/ 和 expected/ 对照)
- `__tests__/skill-doctor/fixtures/fix/shared-drift/`(mock script + before/expected)

**涉及文件(修改)**:
- `src/skill-doctor/index.ts`(加 `--fix` / `--apply` / `--dry-run` 参数,以及 fix mode 分支)
- `src/skill-doctor/types.ts`(加 `Fix` / `FixerContext` 等类型,不删现有)
- `src/skill-doctor/reporters/json.ts` 和 `reporters/text.ts`(支持渲染 `fixes_applied` / `fixes_pending` 字段)
- `README.md`(加 `--fix` 用法段)

**不涉及(明确排除,严禁动)**:
- 现有 8 个 rule(`src/skill-doctor/rules/*.ts`)— 一字不动
- 现有 rule 的 jest test — 一字不动
- `src/skill-doctor/runner.ts`(rule runner)— 一字不动
- `src/skill-doctor/{config,notify}.ts` / `utils/*` — 一字不动
- `package.json` / `tsconfig.json` / `jest.config.cjs`
- 其他 `src/<tool>/` 目录

## 设计契约

### 1. Fixer interface

```typescript
// src/skill-doctor/fix/types.ts
export interface FixerContext {
  root: string;                  // skills repo 根路径
  skills: SkillEntry[];          // 已扫描出的 skill 列表(复用 runner.ts 探测)
}

export interface FixAction {
  file: string;                  // 改的文件相对路径
  description: string;           // 一句话说明改了啥(如 "replace \s with [[:space:]] at line 42")
  before?: string;               // 改前内容片段(可选,用于 diff 显示)
  after?: string;                // 改后内容片段
}

export interface FixResult {
  fixer: string;                 // fixer id
  actions: FixAction[];          // 这个 fixer 产出的所有修复动作
  errors: string[];              // 修复过程中的非致命错误(如某文件被锁)
}

export interface Fixer {
  id: string;                    // 跟对应 rule 同名(如 'bsd-compat' / 'shared-drift')
  description: string;
  /**
   * dryRun=true 时只产 actions,不动磁盘
   * dryRun=false 时真改文件
   */
  fix: (ctx: FixerContext, dryRun: boolean) => Promise<FixResult>;
}
```

### 2. CLI 参数

```
skill-doctor --fix                # 默认 dry-run,打印 actions 不动文件
skill-doctor --fix --apply        # 真改
skill-doctor --rules bsd-compat --fix --apply  # 只跑指定 rule 的 fix
```

**互斥校验**:
- `--apply` 必须跟 `--fix` 一起出现,单独 `--apply` 报错
- `--fix` + `--notify` 互斥(fix 模式不推送 IM)

### 3. 安全护栏

`--apply` 模式(真改),进入前必须:
1. `git status --short` 返回空(工作区干净) — 否则 refuse + exit 2,message:`Working tree not clean; commit or stash first`
2. 改前打印 plan(每个 fixer 的 actions 列表)
3. 任何 fixer 改文件失败 → 整体 abort,不留半改半未改状态(但已 fix 过的文件**不**自动回滚 — 让 git diff 给用户决定)

### 4. 输出契约

JSON reporter 新增字段:

```json
{
  "root": "...",
  "rulesRun": [],          // fix 模式下空(不跑 rule)
  "findings": [],          // fix 模式下空
  "counts": { "error": 0, "warn": 0, "info": 0 },
  "fix_mode": "dry-run" | "apply",
  "fixers_ran": ["bsd-compat", "shared-drift"],
  "fixes_pending": [        // 仅 dry-run
    {"fixer": "bsd-compat", "file": "skill-x/scripts/foo.sh", "description": "..."}
  ],
  "fixes_applied": []       // 仅 apply 模式
}
```

text reporter 输出格式:

```
[FIX dry-run] bsd-compat
  ↻ flow-codex-goal/references/watcher.sh:160  \s → [[:space:]]
  ↻ flow-codex-goal/references/watcher.sh:350  \s → [[:space:]]
  ↻ flow-codex-goal/references/write-audit.sh:40 \s → [[:space:]]

[FIX dry-run] shared-drift
  ↻ wrap sync-shared.sh (5 files in _shared/)

Plan: 4 fixes / 1 fixer would write
Run with --apply to commit changes
```

## Fixer 详细规格

### Fixer 1: bsd-compat-fix

**只修**:
- `\s`(在 `.sh` / `.bash` 文件,非 comment 行内) → `[[:space:]]`
- `\d`(同上) → `[0-9]`

**不修**(留人手改):
- `grep -P`(PCRE → ERE 不等价)
- comment 行(`^\s*#`)— 跟 rule 的 skip 一致

**实现**:扫所有 skill 目录下的 `.sh`/`.bash`,逐行 regex replace。

### Fixer 2: shared-drift-fix

**做什么**:
- 在 `<root>` 下找 `scripts/sync-shared.sh`
- 若存在 + 可执行 → `bash scripts/sync-shared.sh`(dry-run 时只打印 `would run`)
- 若不存在 → emit error("no sync-shared.sh found")

**为何 wrapper**:让 doctor 成为唯一入口,用户不用记多个命令。

## 测试要求(TDD 强制)

**顺序**:每个 fixer 必须先写 failing test → commit → 写 impl → commit。
**git log 应能看到 2 对 test/feat + 1 个 cli 接通 commit + 1 个 README**。

**框架**:jest + ts-jest(已配)
**跑命令**:`pnpm test -- __tests__/skill-doctor`

**必须覆盖**:
- [ ] bsd-compat-fix: dry-run 不动文件(对比 stat mtime 或 content)
- [ ] bsd-compat-fix: --apply 真改 + 改后内容含 `[[:space:]]`
- [ ] bsd-compat-fix: comment 行的 `\s` 不被改
- [ ] bsd-compat-fix: 不动 `grep -P`(留 finding 给 rule)
- [ ] shared-drift-fix: 找不到 sync-shared.sh 时返回 error
- [ ] shared-drift-fix: dry-run 不真跑 script(检查 mock 没被 spawn)
- [ ] CLI: `--apply` 单独无 `--fix` 报错 + exit code 2
- [ ] CLI: working tree dirty + --apply → refuse + exit code 2

## 验收 Hard Gates

- [ ] 功能:`node dist/skill-doctor/index.js --fix --dry-run --root ~/Documents/projects/skills --notify off --format json | jq '.fix_mode, .fixers_ran, (.fixes_pending|length)'` 输出合法
- [ ] 类型检查 pass:`pnpm run build`
- [ ] 测试 pass:`pnpm test`(应 308+ tests,从 304 增加 4-6 个)
- [ ] 没 `TODO` / `FIXME` / `any` / `@ts-ignore` 在新增文件
- [ ] 没改 SPEC 范围外文件
- [ ] 没引入新依赖(`git diff origin/master..HEAD -- package.json pnpm-lock.yaml` 空)
- [ ] **不破坏现有功能**:`node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json | jq '.counts'` 仍输出 `{error: 0, warn: 32, info: 0}`(跟 Batch 2 完全一致)

## 报告要求

完成后输出 JSON 块(独立块,不在 markdown fence):

```json
{
  "files_changed": [
    {"path": "...", "action": "added|modified", "lines_added": 0, "lines_deleted": 0}
  ],
  "deviations": [],
  "todos_left": [],
  "new_deps": [],
  "tests_written_first": true,
  "tests_passed": true,
  "test_command": "pnpm test",
  "test_output_tail": "...",
  "build_passed": true,
  "e2e_dry_run": {
    "command": "node dist/skill-doctor/index.js --fix --dry-run --root ~/Documents/projects/skills",
    "fix_mode": "dry-run",
    "fixers_ran": ["bsd-compat", "shared-drift"],
    "fixes_pending_count": "N"
  },
  "e2e_existing_rules_intact": {
    "command": "node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json",
    "counts": { "error": 0, "warn": 32, "info": 0 }
  },
  "spec_compliance": "full",
  "self_assessment": "..."
}
```
