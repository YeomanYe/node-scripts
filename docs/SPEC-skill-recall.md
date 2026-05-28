# SPEC: skill-recall — Agent 日志分析工具(用于 skill 调优)

> **状态**: 方案存档,未实现
> **创建**: 2026-05-26
> **修订**: 2026-05-28(v2 — 重大决策更新,见 §3)
> **目标位置**: `node-scripts/src/skill-recall/`
> **关联源资料**:
> - `~/Documents/projects/.cc-connect/attachments/harness-observability-discussion.md` (Day 1 讨论 + 原文摘录)
> - `~/Documents/projects/.cc-connect/attachments/harness-observability-cases.md` (Day 2 七个案例)
> **灵感来源**: 魔术师卡颂《Harness Engineering》"codex 自循环逆向 session 日志结构"(2026-04-08 推文)

---

## 1. 它是什么 / 不是什么

| 它是什么 | 它不是什么 |
|---|---|
| node-scripts 里的一个 CLI 工具 | 一个新 skill |
| 给现有 skill 体系**喂数据**的元层(只分析,不优化) | 替代 experience-summary / unblock-recipes |
| 持续运行的"agent 行为监控"基础设施 | 一次性脚本 |
| 跟 skill-doctor 形成姊妹工具(静态 lint vs 动态 lint) | 给 grafana / 复杂 dashboard |

**核心定位**: **只做日志分析**,把"哪些 skill 该召没召 / 哪些误触发 / 哪些 flow drop-off"从**体感**变成**数字**。
**优化部分不在脚本中**——脚本只输出报告,SKILL.md 的修改由人工触发对应 skill(experience-summary 等)落地。

## 2. 解决的真问题

来自 `harness-observability-discussion.md` line 102-105:
1. **skill 触发词自动反向优化**(看用户原话漏召)
2. **skill 误触发数据**(启动后被中断/否决,改 description)
3. **hat 选错率**(每次选 persona 后用户满不满意)
4. **flow-\* 链路 drop-off**(哪步常被中断)

## 3. 关键决策(v2 — 2026-05-28 大改)

### 3.1 跳过人工标注,程序化 + LLM 双路捕获

**初稿** Phase 0 推荐人工标注 50-100 条。
**最终决策**: **不做人工标注**,直接自动分析 + 监控,目标"尽可能多捕获错误"。

详细路径设计见 §6 / §7。

### 3.2 类型系统当 agent 的可验证记忆(借卡颂方法)

`tsc --noEmit` 当自动 verifier,unknown 计数当 KPI,禁 `any` / 过宽 union 的 lint 防作弊。
详见 `harness-observability-cases.md` Case 3-6。

### 3.3 不并入 skills 仓库

这是元层工具,跟 skill 平级关系,不该住进 `~/Documents/projects/skills/`。

### 3.4 工具的产出是「分析数据」, 不是「自动修改 skill」

工具只输出:
- 每次跑产生 `findings/<timestamp>.jsonl`(append-only 发现)
- 周报 `reports/weekly-YYYY-WW.md`

**最终落盘修改 SKILL.md 必须人工触发对应 skill**(experience-summary / unblock-recipes 等)。

### 3.5 站在 agent-sessions(-cli) 项目肩上,不重写 collector

`agent-sessions-cli`(`~/Documents/projects/agent-sessions-cli`)已经实现了 7 家 agent 的 session 解析、SQLite 索引、JSON 输出、search、stats。
我们通过 subprocess 调它的 CLI 拿数据,**不重写 collector**。

### 3.6 注册制 opt-in(**v2 新增**)

**不**自动扫所有 SKILL.md。在 `local/skill-recall-config.yaml` 显式注册想分析的 skill。
理由:
- 仓库 27 个 skill 全分析噪音太大,人工 review 不过来
- opt-in = 用户能精确控制"我现在关心哪 N 个"
- 加新 skill 进分析 = 在 config 加一行

**第一版 starter**(本次决策):
- `unblock-recipes` — lookup 类(该查没查)
- `hat` — routing 类(戴对帽没)
- `experience-summary` — sink 类(该写没写)
- `flow-dev-task` — pipeline 类(走完没)

正好覆盖 4 种典型场景,后续按需扩展。

### 3.7 全量 + 增量双模式(**v2 新增**)

| 模式 | 命令 | 用途 |
|---|---|---|
| 增量(默认) | `skill-recall run` | 日常 cron 跑,只看上次跑后新出现的 session |
| 全量 | `skill-recall run --full` | 改了 detector 规则后人工触发,重建所有结果 |

增量机制:**hybrid (cache + 时间窗双保险)**:
- 主路:`processed.json` cache 记 session_id 已处理
- 兜底:`--since <last_run_ts>` 时间窗
- 两者并用,即使 cache 损坏也能从时间窗恢复

### 3.8 原始日志可选存储 + **append-only 不动旧**(**v2 新增**)

存储路径:`~/Documents/projects/skill-recall-data/sessions/<agent>/<yyyy>/<mm>/<dd>/<session-id>.jsonl`

**关键纪律**:
- `sessions/` = **唯一不可变区**(用户日志 = 真相,append-only,**永不编辑 永不删除**)
- 没有"保留期"概念 — 用户拒绝自动清理
- 磁盘代价预估:30 天 ~100-500MB / 1 年 ~1-5GB(可接受)

存不存储**可配置**(`storage.enabled: false` 关掉只做分析不落原始日志)。

### 3.9 程序化 + LLM 双路提取 SKILL.md 关注点(**v2 新增**)

详见 §6。简言之:
- 程序层抓 frontmatter 触发短语 / Do NOT use / Red Flags / Workflow steps(regex 能搞定的)
- LLM 层抓**散文里的隐含约束**(regex 抓不到的语义,如 director-design 的「没视觉证据不下视觉结论」)

LLM 提取结果**缓存到** `extracted/<skill>.json`,SKILL.md git hash 变了才重跑。

### 3.10 LLM 兜底用 MiniMax-2.7(**v2 新增**)

通过 Anthropic-compatible API 调:
- baseUrl: `https://api.minimaxi.com/anthropic`
- model: `MiniMax-2.7`
- key: **从环境变量 `${MINIMAX_API_KEY}` 读取,绝不写进 SPEC / config 文件 / commit**

详见 §11 安全规范。

## 4. 目录结构

```
node-scripts/src/skill-recall/
├── index.ts                    # CLI 入口(commander)
├── types/
│   ├── session.ts              # 跟 agent-sessions JSON schema 对齐
│   ├── extracted-points.ts     # SKILL.md 提取出的关注点结构
│   ├── finding.ts              # 检测出的 issue 结构
│   └── config.ts               # 配置文件 schema
├── loader/
│   ├── config-loader.ts        # 读 local/skill-recall-config.yaml
│   └── skill-md-loader.ts      # 读 ~/Documents/projects/skills/<skill>/SKILL.md
├── source/
│   ├── agent-sessions-cli.ts   # subprocess 调 `agent-sessions session list --json`
│   └── git-collector.ts        # 跨 session join 用(查 24h 内 git revert)
├── cache/
│   └── processed-tracker.ts    # processed.json 读写(增量用)
├── storage/
│   └── session-archiver.ts     # append-only 落原始 jsonl 到 sessions/
├── extractors/
│   ├── static-extractor.ts     # 规则提取(触发短语 / Do NOT use / Red Flags / steps)
│   ├── llm-extractor.ts        # LLM 提取(隐含约束 / hidden patterns)
│   └── cache-tracker.ts        # 按 SKILL.md git hash 决定要不要重跑 LLM
├── detectors/
│   ├── trigger-miss.ts         # 漏召检测
│   ├── false-trigger.ts        # 误触发检测
│   ├── wrong-skill.ts          # 选错 skill
│   ├── red-flag-hit.ts         # Red Flag 命中
│   ├── user-aborted.ts         # 用户中断
│   ├── silent-retry.ts         # 静默重试
│   ├── manual-revert.ts        # 手工 revert
│   ├── step-skip.ts            # workflow step 漏跳
│   └── llm-fallback.ts         # 模糊失败信号 → LLM 推断
├── llm/
│   ├── minimax-client.ts       # Anthropic SDK + MiniMax baseUrl
│   └── budget-guard.ts         # 单次跑 LLM 调用上限
├── reports/
│   ├── findings-writer.ts      # append-only 写 findings/<ts>.jsonl
│   └── weekly-md.ts            # 生成 weekly-YYYY-WW.md
└── unknown-tracker.ts          # 未识别事件计数(卡颂方法核心)
```

## 5. 数据 / 配置存储路径

```
~/Documents/projects/skill-recall-data/      # 工具自己的数据目录(用户级别)
├── sessions/                                  # 原始日志,append-only,永不删
│   ├── claude/2026/05/28/<id>.jsonl
│   └── codex/2026/05/28/<id>.jsonl
├── extracted/                                 # SKILL.md 提取的关注点(可重建)
│   ├── unblock-recipes.json
│   ├── hat.json
│   ├── experience-summary.json
│   └── flow-dev-task.json
├── findings/                                  # 每次分析的发现,append-only
│   ├── 2026-05-28T14-00-00.jsonl
│   └── 2026-05-28T22-00-00.jsonl
├── reports/                                   # markdown 报告(可覆盖)
│   └── weekly-2026-W22.md
└── .cache/
    └── processed.json                         # 增量 cache,可重建
```

配置文件:`node-scripts/local/skill-recall-config.yaml`(local/ 是 git-ignored)
环境变量:`node-scripts/.env`(git-ignored,放 `MINIMAX_API_KEY`)

## 6. SKILL.md 关注点提取 — 4 维 + LLM 兜底

### 6.1 程序化提取(快 / 免费 / 一定先跑)

| 提取点 | 来源段 | 提取方法 | 用来检测什么 |
|---|---|---|---|
| **触发短语** | frontmatter description 里 "触发短语:..." / "Trigger phrases:..." | regex 抓引号片段 | 漏召(`trigger-miss`) |
| **Do NOT use** | frontmatter description "Do NOT use for:..." + SKILL.md `## When NOT to Use` 段 | regex + section parser | 误触发(`false-trigger`) |
| **Red Flags** | SKILL.md `## Red Flags - STOP` 段 bullets | section parser | 踩线(`red-flag-hit`) |
| **Workflow steps** | SKILL.md `## Required Workflow` 段 `### Step N` 标题 + 流程图 Stage | section + code block parser | 漏步骤(`step-skip`) |

### 6.2 LLM 提取(规则没覆盖的语义)

LLM 读完整 SKILL.md,输出**结构化关注点**:

```json
{
  "implicit_constraints": [
    {
      "description": "audit mode 不能凭代码下视觉结论,必须有截图 evidence",
      "detection_hint": "look for evidence: code-only + verdict: pass 组合"
    }
  ],
  "hidden_anti_patterns": [
    {
      "description": "skill 启动后超过 30 分钟没 task_complete = 卡了",
      "detection_hint": "session 时长 > 1800s 且无 task_complete 事件"
    }
  ],
  "downstream_handoff_required": [
    {
      "description": "调用完 director-design 后必须 handoff 到 frontend-design",
      "detection_hint": "skill_call director-design 后没有跟随的 frontend-design call"
    }
  ]
}
```

### 6.3 LLM 提取触发时机(避免每次都跑)

**触发**:
- 首次纳入分析时跑一次
- SKILL.md 改动(git hash 变了)时重跑
- 用户手动 `skill-recall extract <skill-name> --rerun`

**缓存**:`~/Documents/projects/skill-recall-data/extracted/<skill>.json`
缓存内容含 `skill_md_git_hash` 字段,用于失效判定

**预估成本**:
- 每个 SKILL.md ~5K token 输入 + ~500 token 输出
- 4 个 starter skill 首次提取 = ~22K input + 2K output ≈ 几毛钱(MiniMax 定价)
- 后续除非 SKILL.md 改,否则不重复扣费

## 7. Detectors — 程序化 + LLM 兜底分层

### 7.1 程序化层(规则,deterministic)

| Detector | 检测什么 | 检测逻辑 |
|---|---|---|
| `trigger-miss` | 用户原话命中 trigger 但 skill 没启动 | 关键词匹配 user_msg vs extracted.trigger_phrases |
| `false-trigger` | skill 启动了但 user_msg 命中 Do NOT use | 关键词匹配 vs extracted.do_not_use |
| `wrong-skill` | 调用了 skill A 但用户原话明显是 skill B 的 trigger | 多 skill 优先级匹配 |
| `red-flag-hit` | session 里出现 SKILL.md Red Flags 描述的现象 | 关键词 / 事件模式扫 |
| `user-aborted` | task_aborted 事件 + 用户后续含"不对/算了/stop" | 事件 + regex |
| `silent-retry` | skill 跑完用户立刻重复同样意图 | 短时间窗 user_msg 相似度 |
| `manual-revert` | 24h 内 git revert 了 skill 改的文件 | 跨 session + git log join |
| `step-skip` | Required Workflow 关键 step 在事件流里没出现 | step name 匹配 tool_call name |
| `implicit-constraint-violation` | LLM extracted 的 implicit_constraints 触发 | 按 detection_hint 字段写规则匹配 |

### 7.2 LLM 兜底层(规则没命中但有模糊失败信号)

**触发条件**(满足任一):
1. 用户在 skill 后说了点什么,但 regex 没命中明确否决词
2. session 持续 ≥30 分钟但没有 commit / 没有 task_complete
3. 同一 skill 在同一 session 被调了 ≥2 次

**LLM prompt**(限定 enum 输出):

```
任务:判断这次 skill 调用是否成功 / 失败 / 不确定

skill: {skill_name}
用户原话: {user_msg}
skill 调用入参: {trigger_or_args}
skill 后续 N 条事件: {follow_up_events}
用户后续发言: {user_followup}

只输出 JSON:
{
  "verdict": "success" | "fail" | "unclear",
  "failure_type": "tool/agent/ctx/user/sys 之一 + 子类",
  "confidence": 0-1,
  "reasoning_brief": "20 字内"
}
```

**预算控制**:
- 单次跑 LLM 调用 ≤ 100 次(`llm_fallback.budget_per_run` 配置)
- 超出预算后剩余的 unclear case 标 `llm-budget-exceeded`,等下次跑

### 7.3 失败模式分类(Case 7 5 大类 15 子类)

```ts
type FailureCategory =
  // A. 工具执行失败 → 修工具描述/sandbox 配置
  | 'tool/not-found' | 'tool/permission-denied' | 'tool/timeout' | 'tool/output-truncated'
  // B. agent 决策失败 → 修 system prompt / skill 选择逻辑
  | 'agent/loop' | 'agent/spin-no-action' | 'agent/wrong-tool' | 'agent/off-topic'
  // C. 上下文问题 → 修 context 管理策略
  | 'ctx/compacted' | 'ctx/lost-after-compact' | 'ctx/cross-session-amnesia'
  // D. 用户否决 → ground truth(必须重视)
  | 'user/explicit-stop' | 'user/silent-retry' | 'user/manual-revert'
  // E. 系统限制 → 基础设施扩容
  | 'sys/rate-limit' | 'sys/quota'
```

## 8. 配置文件 schema(`local/skill-recall-config.yaml`)

```yaml
# === 全局配置 ===
storage:
  enabled: true   # 是否保留原始日志副本到 sessions/
  base_path: ~/Documents/projects/skill-recall-data
  # 注意: append-only, 永不编辑/删除

incremental:
  cache_path: ${storage.base_path}/.cache/processed.json
  fallback_window: 7d  # cache miss 时回退到这个时间窗

llm_fallback:
  enabled: true
  provider: minimax-anthropic
  base_url: https://api.minimaxi.com/anthropic
  model: MiniMax-2.7
  # key 从环境变量读取, 绝不写明文
  api_key_env: MINIMAX_API_KEY
  budget_per_run: 100  # 单次跑最多 LLM 调用次数

reporting:
  weekly_output: ${storage.base_path}/reports/weekly-{week}.md
  push_to_im: true  # 通过 cc-connect 推 IM(若 CC_SESSION_KEY 非空)

# === 注册要分析的 skill ===
registered_skills:
  - name: unblock-recipes
    enabled: true
    extract_from_skill_md: true
    use_llm_extraction: true

  - name: hat
    enabled: true
    extract_from_skill_md: true
    use_llm_extraction: true

  - name: experience-summary
    enabled: true
    extract_from_skill_md: true
    use_llm_extraction: true

  - name: flow-dev-task
    enabled: true
    extract_from_skill_md: true
    use_llm_extraction: true
    # 长 pipeline skill,关注 stage drop-off
    extra_focus:
      - Stage 1 brainstorm 是否在新功能 task 跑了
      - Stage 5 是否做了 TDD
      - Stage 6 verification 是否真跑
```

## 9. CLI 接口

```bash
# 增量分析(默认)
skill-recall run

# 全量重建
skill-recall run --full

# 只对指定 skill 跑
skill-recall run --skill hat

# 手动重新提取 SKILL.md 关注点
skill-recall extract <skill-name> [--rerun]

# 看上次跑的发现
skill-recall findings list [--skill hat] [--type trigger-miss]

# 生成周报
skill-recall report weekly

# 健康检查(配置 / 依赖 / agent-sessions-cli 可用性)
skill-recall doctor

# 重置 cache(慎用)
skill-recall reset-cache
```

## 10. 工程纪律(来自 Case 2 + v2 新增)

### 来自 `harness-observability-cases.md` Case 2

1. **永远先存 raw JSONL 再 parse** — raw 进 sessions/ 永不动
2. **classify 用规则优先,LLM 兜底** — 规则便宜 deterministic
3. **unknown 数当 KPI** — 报告头一行 `unknown events: 23 (↓5)`
4. **Phase 1 不写 web UI** — markdown + cc-connect 推送够用
5. **死线 30 天** — 跑 1 月不见改善,问题大概率不在召回率

### v2 新增 5 条

6. **跟现有 skill 体系的接口要"分析数据"不要"自动修改"** — 工具只输出 findings + report, **绝不**自动改 SKILL.md
7. **不并入 skills 仓库** — 元层工具不住 skill 目录
8. **类型定义跟着 agent 版本走** — `types/session.ts` 加 git tag 标记针对 agent-sessions vN 验证
9. **sessions/ append-only** — 用户日志是真相,不动
10. **LLM key 从环境变量读** — 永不写进 SPEC / config / commit

## 11. 安全规范(LLM key 处理)

**铁律**:**API key 永不出现在**:
- SPEC 文档(本文件)
- config 文件(`skill-recall-config.yaml`)
- 代码注释 / 测试 fixture
- git commit 历史 / log 输出

**正确做法**:

```bash
# 1. 在 node-scripts/.env (git-ignored) 设置
echo "MINIMAX_API_KEY=sk-xxxxx" >> ~/Documents/projects/node-scripts/.env

# 2. config yaml 用环境变量名
llm_fallback:
  api_key_env: MINIMAX_API_KEY

# 3. 代码读取
const apiKey = process.env[config.llm_fallback.api_key_env]
if (!apiKey) throw new Error(`Missing env: ${config.llm_fallback.api_key_env}`)
```

**`.gitignore` 必须包含**:
- `local/`
- `.env`
- `~/Documents/projects/skill-recall-data/sessions/` (原始日志含用户数据,不该进任何仓库)

## 12. 跟 skill 体系的接口图

```
~/.claude/* + ~/.codex/* + ~/.gemini/* + ~/.copilot/* + ...
                       ↓
            ┌──────────────────────┐
            │  agent-sessions-cli  │  ← 现成轮子,统一 7 家 schema
            └──────┬───────────────┘
                   ↓ JSON via `agent-sessions session list --json`
            ┌──────────────────────────────────────┐
            │  skill-recall(本工具)                  │
            │  - opt-in 注册 4 个 starter skill     │
            │  - 程序化 + LLM 双路提取关注点         │
            │  - 9 个 detector + LLM 兜底           │
            │  - findings/<ts>.jsonl(append-only)  │
            │  - sessions/(永不动)                  │
            │  - reports/weekly-WW.md               │
            └──────┬───────────────────────────────┘
                   ↓ IM 推送(cc-connect)
                   ↓ 报告候选段(给人工触发)
       ┌───────────┴────────────────────────┐
       ↓                                    ↓
   experience-summary (人工分诊)      unblock-recipes (候选录入)
```

**重要**: 工具**不直接调用**其他 skill。报告里只给"建议人工触发某 skill"的提示,真触发由用户决定。

## 13. 跟 skill-doctor 的姊妹关系

| 层 | 形态 | 已有 | skill-recall 新增 |
|---|---|---|---|
| **预防规则** | SKILL.md / Red Flags / 角色信条 | ✅ huashu-design / director-* 等 | 不动 |
| **离线 lint** | 静态扫 SKILL.md / references / 引用 | ✅ skill-doctor | 不动 |
| **运行时观测** | 看实际 agent 行为日志 | ❌ | ✅ **新增** |
| **失败沉淀** | 人工触发分诊 → 写错题本 / 反例库 | ✅ experience-summary / unblock-recipes(人工)| ✅ **自动列候选** |

**三层闭环**: 写规则(预防)→ lint(静态验证)→ 跑 agent(运行)→ 日志分析(运行时验证)→ 沉淀(experience-summary)→ 改规则。

## 14. 报告样例

```md
# Skill Recall Report 2026-W22

## 总览
- Period: 2026-05-22 ~ 2026-05-28
- Sessions analyzed: 142
- Registered skills: 4
- Unknown events: 23 (↓5 vs last week)
- LLM fallback calls: 47 (under budget 100)

## hat
- trigger-miss: 8 次 (用户说"严格点"但没自动戴帽)
- false-trigger: 2 次 (任务收尾还戴严帽)
- wrong-hat: 5 次 (该戴"钻"实际戴了"严")

## flow-dev-task
- step-skip: Stage 6 verification 跳了 4 次 → 3 次后续被用户发现 fail
- silent-retry: 用户在 Stage 8 commit 后立刻 retry 同 task 2 次
- implicit-constraint-violation: "问题预算 ≤ 3" 被打破 6 次(实际问了 5 个)

## unblock-recipes
- trigger-miss: 11 次 (用户说"反复改不对"但没查错题本)
- 关键词漏覆盖: "stuck on X" / "rebuild loop"

## experience-summary
- trigger-miss: 18 次 (用户说"这次踩了个坑"但没分诊)
- 这个数偏高,可能 experience-summary 的 trigger 短语覆盖不够

## 给人工的建议候选(注意:工具不自动改)
- 建议给 unblock-recipes 加 trigger: "stuck on", "rebuild loop"
- 建议给 experience-summary 加 trigger: "踩了个坑", "这次遇到"
- 建议 /exp-sum 分诊: "flow-dev-task Stage 6 跳过率高"
```

## 15. Phase 落地

### Phase 1: MVP(2-3 周, ~500-700 行 TS)

按 §4 目录结构搭框架,实现:
- config-loader + skill-md-loader + static-extractor
- agent-sessions-cli 对接 + processed-tracker
- 9 个 detector 中的简单 5 个(trigger-miss / false-trigger / wrong-skill / step-skip / user-aborted)
- findings-writer + weekly-md
- IM 推送
- 4 个 starter skill 的 yaml 配置完整跑通

### Phase 2: LLM 增强(1 周, +200 行)

- llm-extractor + extract cache
- llm-fallback detector
- implicit-constraint-violation detector(用 LLM extracted 的 hint)
- budget guard

### Phase 3: 高级 detector(2 周, +200 行,仅 Phase 1+2 见效后)

- manual-revert(跨 session + git log join)
- silent-retry(短时间窗相似度)
- red-flag-hit(SKILL.md Red Flags 文本模式扫)
- failure mode 分类(5 大类 15 子类)

## 16. 警觉的陷阱

- **假收敛**: LLM 为降 unknown 把类型放宽到 `any` → 需 lint 禁过度宽松
- **样本偏差**: starter 4 skill 不代表全部 — 报告头部声明"仅 4 个 skill 数据"
- **观察者效应**: 工具产出 feed 回 prompt → 自我强化偏差
- **LLM 幻觉**: LLM extracted 的 implicit_constraints 需要采样人工抽查
- **key 泄漏**: §11 已严格规范

## 17. 待决策 / TODO(开干前)

1. 跑一遍 `agent-sessions session show <id> --json` 看真实输出,确认能从 `tool_call` 拿到 skill 调用信息
2. `types/session.ts` 起手版按真实输出写
3. 4 个 starter skill 的 SKILL.md 实测 static-extractor 能否正确抓 trigger / Do-NOT-use / Red Flags
4. LLM 抽取 prompt 测试:跑 hat / unblock-recipes / experience-summary / flow-dev-task 看 implicit_constraints 抓得准不准
5. 跟 agent-sessions 的 SessionEvent.kind 对齐:`tool_call` 里怎么识别"调用了哪个 Skill"(claude-code transcript 的 Skill 调用应该有特定 tool_name)

## 18. 第一周该跑的具体命令(开干时执行)

```bash
# 1. 验证 agent-sessions-cli 能跑
cd ~/Documents/projects/agent-sessions-cli && pip install -e .
agent-sessions doctor
agent-sessions session list --agent claude --limit 5 --json

# 2. 看真实 session 含哪些事件
agent-sessions session show $(agent-sessions session list --agent claude --json --limit 1 | jq -r '.data[0].id') --json | jq '.data.events | map(.kind) | unique'

# 3. 看 4 个 starter skill 现有 trigger 短语提取效果(快速验证)
for skill in unblock-recipes hat experience-summary flow-dev-task; do
  echo "=== $skill ==="
  grep -E "触发短语|Trigger phrases|Do NOT use" ~/Documents/projects/skills/$skill/SKILL.md | head -5
done

# 4. 起 src/skill-recall/ 目录骨架
mkdir -p ~/Documents/projects/node-scripts/src/skill-recall/{types,loader,source,cache,storage,extractors,detectors,llm,reports}

# 5. 起 config 示例
mkdir -p ~/Documents/projects/node-scripts/local
# 写 skill-recall-config.yaml(从本 SPEC §8 复制)

# 6. 环境变量
echo "MINIMAX_API_KEY=" >> ~/Documents/projects/node-scripts/.env  # 然后手填真 key
```

## 19. 不再做的事(v1 计划过的 v2 删除)

- ~~Phase 0 人工标注 50-100 条~~ → 程序化 + LLM 双路捕获代替
- ~~自动 PR 草稿~~ → 工具只输出报告,不自动改 SKILL.md
- ~~自动喂候选到 unblock-recipes / experience-summary~~ → 只列候选,人工触发
- ~~回归 fixture 自动跑 skill-behavior-test~~ → 移到 Phase 3+ 再说
- ~~Phase 1 / Phase 2 分阶段做规则/LLM~~ → v2 合并到同一阶段,程序优先 LLM 兜底
