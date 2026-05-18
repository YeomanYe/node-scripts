# SPEC: skill-doctor Batch 2

## 目标

为 `src/skill-doctor/` 新增 4 个 lint rule(Batch 2),沿用 Batch 1 模式:
- `readme-index`(error)— README.md 含死链(指向不存在目录)
- `director-meta-spec`(error)— director-* SKILL.md 缺元规范段
- `router-coverage`(warn)— flow-codex-goal role-router.md 漏推 director-*
- `file-size`(warn)— SKILL.md > 500 行

## 范围

**涉及文件(新增)**:
- `src/skill-doctor/rules/readme-index.ts`
- `src/skill-doctor/rules/director-meta-spec.ts`
- `src/skill-doctor/rules/router-coverage.ts`
- `src/skill-doctor/rules/file-size.ts`
- `__tests__/skill-doctor/rules/readme-index.test.ts`
- `__tests__/skill-doctor/rules/director-meta-spec.test.ts`
- `__tests__/skill-doctor/rules/router-coverage.test.ts`
- `__tests__/skill-doctor/rules/file-size.test.ts`
- `__tests__/skill-doctor/fixtures/readme-index/` 含 good/ 和 bad/(链接到不存在目录)
- `__tests__/skill-doctor/fixtures/director-meta-spec/` 含 director-good/ 和 director-bad-no-verdict/ 等
- `__tests__/skill-doctor/fixtures/router-coverage/` 含 good/ 和 missing-architect/
- `__tests__/skill-doctor/fixtures/file-size/` 含 small/(< 500 行) 和 huge/(> 500 行)

**涉及文件(修改)**:
- `src/skill-doctor/runner.ts`(`ALL_RULES` 数组追加 4 个 rule 导入)

**不涉及(明确排除,严禁改动)**:
- 现有 4 rule(dead-refs / frontmatter / bsd-compat / shared-drift)— 不动
- `src/skill-doctor/{index,config,types,reporters/*,notify/*,utils/*}.ts` — 不动
- 任何 Batch 1 fixture — 不动
- `package.json` / `tsconfig.json` / `jest.config.cjs` — 不动
- 其他 `src/<tool>/` 目录

## Rule 契约

### rule 1: readme-index(error)

**检查**:扫所有 `*.md`(顶层 + skill 目录)中的 markdown 链接 `[text](path)`,若 path 是相对目录链接(以 `./` 或 `../` 或 `#anchor` 之外的相对路径)且目录不存在 → emit `error`。

**只查"链接到 skill 目录"的死链**:link 文本含 `<word>` 且 path 形如 `./skill-name/`、`#skill-name`(README 内的目录 ref),不查外部 URL(http/https)、不查文件链接(只查目录链接)。

**简化匹配**:
- 顶层 `README.md` 中 `(#word-with-dash)` 形式的 anchor link(`[skill-name](#skill-name)`),若对应 anchor 段 `## Skill-Name` 不存在 → error
- 任何 `*.md` 中 markdown 链接 `[text](./<dir>/)` 或 `[text](<dir>/...)`,若 `<dir>/` 不存在 → error

**fixture**:
- `readme-index/good/`: README.md 含 `[good-skill](./good-skill/)` + 含 `good-skill/SKILL.md` → 0 finding
- `readme-index/bad-dead-dir/`: README.md 含 `[gone-skill](./gone-skill/)` 但无 `gone-skill/` 目录 → 1 error

### rule 2: director-meta-spec(error)

**检查**:目录名以 `director-` 开头的 SKILL.md 必须含以下 marker(grep regex):

| Section | Marker(任一命中即视为存在) |
|---|---|
| Step 0 Question Gate | `Step 0.*Question Gate` |
| N-dim Audit | `## .*维.*[Aa]udit\|## .*Quality Audit` |
| Aggregate → Verdict mapping | `Aggregate.*Verdict` |
| Output Contract | `^## Output Contract`(multiline) |
| Red Flags | `^## Red Flags`(multiline) |
| Parallelization Plan | `^## Parallelization Plan`(multiline) |
| Subagent Dispatch Template | `必须调用.*skill\|必须显式 invoke` |
| Codex Delegation Hook | `^## Codex Delegation Hook`(multiline) |
| Relationship to Other Skills | `^## Relationship`(multiline) |

**目标 skill 识别**:`skill.name.startsWith('director-')`。

**finding** per missing section: level=error, message=`Missing required section: <name>. See _shared/director-template.md for spec`.

**fixture**:
- `director-meta-spec/director-good/SKILL.md`: 含全部 9 个 marker → 0 finding
- `director-meta-spec/director-bad-no-verdict/SKILL.md`: 缺 Aggregate→Verdict → 1 error
- `director-meta-spec/director-bad-no-qgate/SKILL.md`: 缺 Step 0 Q Gate → 1 error
- 非 director-* 的 SKILL.md 不该被这条 rule 检查(skip)

### rule 3: router-coverage(warn)

**检查**:若 ctx.root 含 `flow-codex-goal/references/role-router.md`,则扫 ctx.skills 中所有 `name.startsWith('director-')` 的目录,**每一个**都必须在 role-router.md 中至少被提及 1 次(grep `director-<name>`);未提及的 emit `warn`,message `director-<name> not found in flow-codex-goal/references/role-router.md (router coverage gap)`。

**只检查 flow-codex-goal 自身**:不递归到其他 skill。

**fixture**:
- `router-coverage/good/`: 含 `flow-codex-goal/references/role-router.md`(提及全部 director-*)+ 2 个 `director-*/` 目录(均被提及)→ 0 finding
- `router-coverage/missing-architect/`: 含 `flow-codex-goal/references/role-router.md`(只提 director-design)+ `director-design/` + `director-architect/`(未提) → 1 warn
- 项目无 `flow-codex-goal/` 时此 rule **直接 skip**(不报错)

### rule 4: file-size(warn)

**检查**:所有 SKILL.md,行数 > 500 → emit `warn`,message `SKILL.md is <N> lines (>500); consider splitting into references/`。
- < 500 → 不报
- 阈值常量 `MAX_LINES = 500`,用 `const` 暴露便于以后调整

**fixture**:
- `file-size/small/skill-a/SKILL.md`: 100 行 → 0 finding
- `file-size/huge/skill-b/SKILL.md`: 600 行(每行用 `# heading N` 拼) → 1 warn (含 "600 lines")

## 技术约束

- **必须用**: TypeScript strict + CommonJS / jest+ts-jest(已配)
- **必须遵守** `AGENTS.md`: kebab-case 目录 / camelCase 函数 / 2 空格缩进 / 单引号 / 分号 / `__tests__/<tool>/*.test.ts`
- **不得**:
  - 引入新依赖(全部需要的库已有: `fs/promises` / `path`)
  - 用 `any` / `@ts-ignore` / `@ts-expect-error`
  - 改 SPEC 范围外文件(尤其不动 Batch 1 rules / runner core / reporters / config)
- **复用现有契约**: `Rule` / `Finding` / `RuleContext` interface 在 `src/skill-doctor/types.ts`,导入即用
- **runner.ts 修改方式**:仅在 `ALL_RULES` 数组追加 4 个新 rule,**保持原有 4 个顺序不变**
- 所有文件 I/O 用 `fs/promises`,跨平台无 shell 依赖

## 测试要求(TDD 强制)

**顺序**:每个 rule 必须先写 failing test → `git commit "test: cover <rule>"` → 再写实现 → `git commit "feat(skill-doctor): add <rule> rule"`。
**git log 应能看到 4 对 test/feat commit + 1 个 cli reg commit**。

**框架**: jest + ts-jest(已配置)
**跑命令**: `pnpm test -- __tests__/skill-doctor`

**必须覆盖**:
- [ ] 每个 rule 的 good fixture(应 0 findings)
- [ ] 每个 rule 的 bad fixture(应有对应级别 findings)
- [ ] readme-index: 对外部 URL `http://`/`https://` 链接不报(白名单)
- [ ] director-meta-spec: 非 director-* skill 不被检查
- [ ] router-coverage: 项目无 flow-codex-goal 时 0 finding(skip)
- [ ] file-size: 边界(正好 500 行不报,501 行报)

## 验收 Hard Gates

- [ ] 功能:`node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json | jq '.counts'` 返回合法 JSON,不崩溃
- [ ] 4 个新 rule 都能被 `--rules <name>` 单独跑(`node dist/skill-doctor/index.js --rules readme-index --root <fixture/good> --notify off --format json` 应返回 0 findings)
- [ ] 类型检查 pass: `pnpm run build` 无错
- [ ] 测试 pass: `pnpm test`(全套,不只 skill-doctor)
- [ ] 没 `TODO` / `FIXME` / `any` / `@ts-ignore` 在新增文件
- [ ] 没改 SPEC 范围外文件(`git diff --stat origin/master..HEAD` 全在涉及文件清单)
- [ ] 没引入新依赖(`git diff origin/master..HEAD -- package.json pnpm-lock.yaml` 无变更)
- [ ] 实战回归:跑 `node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json`,期望:
  - **error 仍为 0**(因为 P0/P1 全修了)
  - **warn 增加 N**(新 router-coverage / file-size 命中,具体数字以实际为准)

## 报告要求

完成后输出 JSON 块(独立块,不要包在 markdown fence 里):

```json
{
  "files_changed": [
    {"path": "...", "action": "added|modified|deleted", "lines_added": 0, "lines_deleted": 0}
  ],
  "deviations": [],
  "todos_left": [],
  "new_deps": [],
  "tests_written_first": true,
  "tests_passed": true,
  "test_command": "pnpm test",
  "test_output_tail": "... last 30 lines ...",
  "build_passed": true,
  "build_command": "pnpm run build",
  "e2e_skills_repo": {
    "command": "node dist/skill-doctor/index.js --root ~/Documents/projects/skills --notify off --format json",
    "error": 0,
    "warn_increased": true
  },
  "spec_compliance": "full | partial | broken",
  "self_assessment": "..."
}
```

字段规则:
- `tests_written_first` MUST 为 true,git log 应有 4 个 `test: cover <rule>` commit 在 4 个 `feat(skill-doctor): add <rule> rule` 之前
- `spec_compliance: "full"` 要求 zero deviations + all hard gates passed
- 如有 deviations,每条含 `location` / `from_spec` / `actual` / `reason`
