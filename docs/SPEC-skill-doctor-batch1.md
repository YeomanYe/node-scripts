# SPEC: skill-doctor Batch 1

## 目标
在 node-scripts monorepo 下新增 CLI `skill-doctor`,跑 4 条 lint 规则对 Claude skills 仓库做"体检",支持 text/json 输出与飞书 on-error 通知。

## 范围

**涉及文件(新增)**:
- `src/skill-doctor/index.ts`
- `src/skill-doctor/config.ts`
- `src/skill-doctor/types.ts`
- `src/skill-doctor/runner.ts`
- `src/skill-doctor/rules/dead-refs.ts`
- `src/skill-doctor/rules/frontmatter.ts`
- `src/skill-doctor/rules/bsd-compat.ts`
- `src/skill-doctor/rules/shared-drift.ts`
- `src/skill-doctor/reporters/text.ts`
- `src/skill-doctor/reporters/json.ts`
- `src/skill-doctor/notify/feishu.ts`
- `src/skill-doctor/utils/walk.ts`
- `src/skill-doctor/utils/frontmatter.ts`
- `__tests__/skill-doctor/utils/walk.test.ts`
- `__tests__/skill-doctor/utils/frontmatter.test.ts`
- `__tests__/skill-doctor/rules/dead-refs.test.ts`
- `__tests__/skill-doctor/rules/frontmatter.test.ts`
- `__tests__/skill-doctor/rules/bsd-compat.test.ts`
- `__tests__/skill-doctor/rules/shared-drift.test.ts`
- `__tests__/skill-doctor/reporters.test.ts`
- `__tests__/skill-doctor/notify-feishu.test.ts`
- `__tests__/skill-doctor/runner.test.ts`
- `__tests__/skill-doctor/config.test.ts`
- `__tests__/skill-doctor/cli.test.ts`
- `__tests__/skill-doctor/fixtures/clean/good-skill/SKILL.md`
- `__tests__/skill-doctor/fixtures/clean/good-skill/references/helper.sh`
- `__tests__/skill-doctor/fixtures/bad-refs/broken-skill/SKILL.md`
- `__tests__/skill-doctor/fixtures/bad-frontmatter/no-name/SKILL.md`
- `__tests__/skill-doctor/fixtures/bad-frontmatter/desc-too-long/SKILL.md`
- `__tests__/skill-doctor/fixtures/bad-bsd/broken-sh/SKILL.md`
- `__tests__/skill-doctor/fixtures/bad-bsd/broken-sh/scripts/with-pcre.sh`
- `__tests__/skill-doctor/fixtures/drift/_shared/template.md`
- `__tests__/skill-doctor/fixtures/drift/skill-a/SKILL.md`
- `__tests__/skill-doctor/fixtures/drift/skill-a/references/template.md`

**涉及文件(修改)**:
- `package.json`(仅在 `bin` 字段新增一行 `"skill-doctor": "dist/skill-doctor/index.js"`,**不得**改 dependencies / scripts / 其他字段)

**不涉及(明确排除,严禁改动)**:
- `src/shared/notifiers/**`(只读复用)
- `src/auto-cmd/**` / `src/sync-editor/**` / `src/exec-recursive/**` / `src/claude-*/**` / `src/codex-*/**` / `src/git-pull-poll/**` / `src/skillshare-sync-notify/**`
- `tsconfig.json` / `jest.config.cjs`
- `pnpm-lock.yaml`(不许 pnpm install 新包)
- `dist/` / `node_modules/`

## 输入 / 输出 / 行为

### CLI

```
skill-doctor [--root <dir>] [--rules <ids,csv>] [--format text|json]
             [--notify on-error|always|off] [--feishu-config <path>] [--no-color]
```

| Flag | Default | 说明 |
|---|---|---|
| `--root` | `$HOME/Documents/projects/skills` | skills 仓库根 |
| `--rules` | (空,跑全部) | 逗号分隔 rule id |
| `--format` | `text` | `text` 或 `json` |
| `--notify` | `on-error` | `on-error` / `always` / `off` |
| `--feishu-config` | (空) | 飞书配置 JSON 路径 |
| `--no-color` | false | text 输出禁用颜色 |

**Exit code**:
- `0` — `counts.error === 0 && counts.warn === 0`
- `1` — `counts.error === 0 && counts.warn > 0`
- `2` — `counts.error > 0` 或 CLI 解析错误

### Rule 契约

每条 rule 暴露 `Rule` 对象(id / description / run(ctx))。

**dead-refs**: 扫每个 SKILL.md 的 body,正则提取 `` `references/X` `` 或 `references/X.md` 引用,逐个检查同级 `references/<rel>` 存在;不存在 → `level: 'error'`。

**frontmatter**:
- 缺 `name` → `error`
- 缺 `description` → `error`
- `description.length > 250` → `warn`(消息含 "250")
- `name !== <目录名>` → `warn`

**bsd-compat**: 扫 skill 下 `.sh` / `.bash`,跳过 `^\s*#` 开头注释行:
- `grep -P` / `egrep -P` → `error`(含 `grep -P`)
- `\s` 字面 → `warn`(消息含 `\s`)
- `\d` 字面 → `warn`(消息含 `\d`)

**shared-drift**: 若 `<root>/_shared/X.md` 存在,对所有 `<skill>/references/X.md` 比 sha256;不一致 → `warn`(消息含 `drift` 关键字)。

### Notifier 契约

`maybeSendFeishu(report, config, mode)`:
- `off` → 不发
- `on-error` 且 `counts.error === 0` → 不发
- 其他 → 调 `src/shared/notifiers/feishu` 的 `sendFeishuCard(config, message)`

Card message:
- `level`: `'warn'` if errors>0 else `'info'`
- `title`: ``🩺 skill-doctor — <N> errors / <M> warnings``
- `content`: lark_md,含 `**Root**` / `**Rules**` / `❌ Errors` 段(前 5 + `... and X more`)/ `⚠️ Warnings` 段(同上)/ `**Duration**`

## 技术约束

- **必须用**:TypeScript strict + CommonJS(沿用 tsconfig.json) / commander(已装 14.x) / yaml(已装 2.x) / zod(已装 4.x) / picocolors(已装 1.x) / jest+ts-jest(已配)
- **必须遵守**项目根 `AGENTS.md`:
  - kebab-case 目录,camelCase 函数,PascalCase 类型
  - 2 空格缩进,单引号,分号
  - `__tests__/<tool>/*.test.ts` 命名
  - 添加 bin entry 必须更新 `package.json` 的 `bin` 字段
- **不得**:
  - 引入新依赖(所有需要的库已在 package.json,不许 pnpm install)
  - 用 `any`(strict 模式)
  - 用 `@ts-ignore` / `@ts-expect-error`
  - 写入 SPEC 范围外文件
  - 改 jest.config.cjs / tsconfig.json
- **架构强约束**:
  - 所有文件 I/O 必须用 `fs/promises`(异步)
  - 所有路径必须用 `path.join` / `path.relative`(不要拼字符串)
  - 不得 fork shell 子进程做 grep/find(纯 Node 跨平台)
  - Rule 不得 console.log;findings 通过返回值传递
  - CLI 的 `runMain` 必须返回 `{code, output}` 对象(便于测试),不直接 process.exit;仅在 `require.main === module` 分支才退出

## 测试要求(TDD 强制)

- 顺序:**每个文件必须先写 failing test → commit → 再写实现 → commit**。git log 应能看到 `test:` 与 `feat:` 交替出现的 commit 序列。
- 框架:jest + ts-jest(已配置)
- 必须覆盖:
  - [ ] 每个 rule 的 clean fixture(应 0 findings)
  - [ ] 每个 rule 的 bad fixture(应有对应级别 findings)
  - [ ] runner 的 ruleIds 过滤
  - [ ] notifier 的 4 种 mode 行为(off / on-error 无 error / on-error 有 error / always)
  - [ ] notifier truncation(>5 条 → `and X more`)
  - [ ] reporter text 输出含 LEVEL / loc / rule / message / summary
  - [ ] reporter json 输出可 `JSON.parse` 回原 report
  - [ ] CLI exit code 0/1/2 三种场景
- 跑命令:`pnpm test -- __tests__/skill-doctor`

## 验收 Hard Gates(必须全部满足才能通过 Claude review)

- [ ] 功能:`node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json | jq '.counts'` 输出合法 JSON,不崩溃
- [ ] 类型检查 pass:`pnpm run build`(整个仓库 typecheck,不能让 skill-doctor 引入的代码污染其他模块)
- [ ] 测试 pass:`pnpm test`(整套,不只 skill-doctor)
- [ ] 没有 `TODO` / `FIXME` / `any` / `@ts-ignore` 残留(在新增文件里)
- [ ] 没改 SPEC「范围」之外的文件:`git diff --stat origin/master..HEAD` 显示的文件路径必须全部命中 SPEC「涉及文件」清单
- [ ] 没引入新依赖:`git diff origin/master..HEAD -- package.json` 仅 `bin` 字段新增一行,**不得**碰 `dependencies` / `devDependencies` / `scripts`
- [ ] pnpm-lock.yaml 未变更
- [ ] 端到端:`node dist/skill-doctor/index.js --root <fixture>/clean --notify off --format json` exit code = 0
- [ ] 端到端:`node dist/skill-doctor/index.js --root <fixture>/bad-refs --notify off --format json` exit code = 2

## 详细实施步骤

完整 task-by-task 步骤、代码示例、fixture 内容详见:

**`docs/superpowers/plans/2026-05-16-skill-doctor-batch1.md`**

按 plan 的 Task 1 → Task 10 顺序执行。每个 Task 包含完整的:
- failing test 代码
- 实现代码
- 跑命令 + 期望输出
- commit message

**plan 是 SPEC 的延伸,不是"参考",必须按其顺序与代码字面实施。** 若 plan 与本 SPEC 出现冲突,以本 SPEC 为准并在 deviations 中说明。

## 报告要求

完成后必须输出 JSON 块(独立块,不要包在 markdown fence 里):

```json
{
  "files_changed": [
    {"path": "...", "action": "added|modified|deleted", "lines_added": 0, "lines_deleted": 0}
  ],
  "deviations": [
    {"location": "...", "from_spec": "...", "actual": "...", "reason": "..."}
  ],
  "todos_left": [],
  "new_deps": [],
  "tests_written_first": true,
  "tests_passed": true,
  "test_command": "pnpm test",
  "test_output_tail": "... last 30 lines of pnpm test output ...",
  "build_passed": true,
  "build_command": "pnpm run build",
  "e2e_clean_exit_code": 0,
  "e2e_bad_refs_exit_code": 2,
  "spec_compliance": "full",
  "self_assessment": "..."
}
```

字段说明:
- `tests_written_first` 必须为 true,git log 可验证(`git log --oneline | grep -E '^[a-f0-9]+ test:'` 应有多条)
- `spec_compliance`:
  - `full` — 完全按 SPEC 与 plan,deviations 为空
  - `partial` — 有 deviations 但整体功能可用,Claude 决定是否接受
  - `broken` — 偏离过大或无法实现
- 如有 deviations,每条必须含 `location` / `from_spec` / `actual` / `reason`
