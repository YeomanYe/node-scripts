# llm-window-runner —— 设计文档

**日期**: 2026-06-27
**作者**: Claude（按用户 brainstorm 落地）

## 背景

`llm-gated-run` 现状是「轮询 + headroom 够就跑」(`src/llm-gated-run/loop.ts:175`)，固定 15 分钟扫一次，只关心「当前窗口里还有没有余量」，不关心「窗口刚开还是快结束」。

用户的新诉求与 gated-run **正交**：

> 怕到了运行任务的时间点，对应 LLM 窗口里的额度已经被别人 / 之前的任务吃光。希望把任务的目标时间**吸附到「最近的窗口起点」**——窗口刚开就跑，确保额度够用。

例：任务定 6 点跑，对应 provider 的窗口起点是 5 点和 10 点 → 选 5 点（距离更近）→ 任务在 5 点跑。

## 设计决策（含选项与选择理由）

### D1 — 算法：「最近的」语义

**选项** A1: 不区分前后方向，绝对距离最近的胜出  ／  B1: 同上  ／  C: 不限距离阈值
**选择**: A1 + B1 + C（用户明确选定）

伪代码：
```
candidates = upcomingWindowStarts(provider, horizon=±48h)
             .filter(start => start >= now)   // 不能时间穿越回过去
target     = nextConfiguredTrigger(task, now) // 今天的 HH:MM 若还没过，否则明天
pick       = candidates.minBy(c => abs(c - target))
             // 并列：取更早的（保守，避免额度被吃光）
```

如果 `candidates` 为空（窗口数据失效），fallback 到 `target` 本身。

### D2 — 「窗口起点」如何枚举

各 provider 抽象成同一个 anchor:
```ts
interface WindowAnchor {
  startMs: number       // 一个已知的窗口起点时间戳
  durationMs: number    // 窗口周期
}
```
然后用 `startMs + k * durationMs (k ∈ ℤ)` 在 `[from, to]` 内枚举。

| Provider | 类型 | anchor 来源 |
|---|---|---|
| `minimax` | 固定时钟 | `MiniMaxQuotaWindow.startMs / endMs`（`interval` 或 `weekly`）→ duration = endMs - startMs |
| `zai` | 滚动 | `ZaiLimitWindow.resetsAtMs`（下个窗口起点）+ `windowMinutes` |
| `claude` | 滚动 | `ResetInfo.resetsAt`（ISO）+ 硬编码 5h / 7d duration |
| `codex` | 滚动 | `UsageWindow.resetsAt`（epoch 秒）+ `windowMinutes` |

### D3 — 形态：新 tool vs 扩 `llm-gated-run`

**选择**: **新 tool `llm-window-runner`**。理由：
1. `llm-gated-run` 现仅支持 minimax provider（`ProviderType = 'minimax'`），新增 zai/claude/codex 会大动那套 config schema
2. 「窗口对齐调度」与「headroom 闸门」是两套心智模型，混在一起 config 字段会冲突
3. 复用：`runRegisteredTask`（`src/llm-gated-run/runner.ts`）可直接 import 来执行 task

### D4 — Config schema

默认路径 `local/llm-window-runner.config.yaml`：
```yaml
providers:
  zai-coding:
    type: zai
    window: primary           # primary | secondary
    apiKeyEnv: Z_API_KEY      # optional, default Z_API_KEY
    envFile: ~/.env           # optional
  claude:
    type: claude
    window: fiveHour          # fiveHour | sevenDay
  codex:
    type: codex
    window: primary
  minimax-text:
    type: minimax
    model: M2                 # 指定 model；缺省取首个
    window: interval          # interval | weekly
    apiKeyEnv: MINIMAX_API_KEY

tasks:
  daily-summary:
    provider: zai-coding
    scheduledTime: "06:00"    # 24h 本地时区
    cmd: "node ~/scripts/summary.js"
  cleanup:
    provider: minimax-text
    scheduledTime: "22:00"
    command: pnpm
    args: ["clean"]
```

### D5 — CLI 子命令

- `llm-window-runner list` — 列任务和它们的下一次 fire 计划（含原始 target、最终选定时间、距离）
- `llm-window-runner next <task>` — 单 task 的下一次 fire 详情
- `llm-window-runner loop` — daemon，串行跑（最简策略：每轮重新计算 + 睡到最早 fire 点 + 执行 + 重算）

### D6 — Daemon 调度策略

每轮：
1. 重新拉所有 provider snapshot
2. 给每个 task 算下一次 fire 时间
3. 睡到最早那个 fire（用 `setTimeout`，封顶 10 分钟避免错过 provider 数据变化）
4. 醒来，对到点的 task 执行 `runRegisteredTask`
5. 记录 `lastRunAt[task]`（内存）避免同周期重复 fire
6. 回 1

边界：
- 收 SIGINT/SIGTERM 优雅退出
- provider 拉取失败时该 task 这轮 skip 但不中断 daemon
- task 执行失败不影响其他 task

### D7 — 范围内 vs 范围外

**In scope**:
- 4 provider 的窗口起点发现
- HH:MM 每日触发
- 最近窗口吸附
- daemon loop + list/next 子命令

**Out of scope (YAGNI)**:
- cron 表达式 / 多时段 / 工作日过滤（用户没要求）
- 持久化 `lastRunAt`（restart 可能重跑一次，可接受）
- 并行 task 执行（串行简单先用）
- headroom 二次确认（如果窗口刚开就跑，理论上一定够；后续可加）
- 通知集成（用户没要求）

## 文件清单

```
src/llm-window-runner/
  index.ts           # CLI 入口
  config.ts          # 类型 + YAML 加载
  windows.ts         # 4 provider 各自 fetchWindowAnchor 函数
  schedule.ts        # 纯函数：enumerateStarts / nextConfiguredTrigger / findNearestStart
  loop.ts            # daemon 主循环

__tests__/llm-window-runner/
  schedule.test.ts   # 纯函数单测（覆盖 4 个边界 case）
  windows.test.ts    # 各 provider snapshot → anchor 的映射
  config.test.ts     # YAML 解析 + 校验错误信息

docs/llm-window-runner.md  # 用户文档（简版）
```

## 测试要点

- nearest 算法：5h/-5h/0h/无候选 fallback 各一个 case
- 并列时取更早
- 候选全在 now 之前 → fallback 到 target
- minimax interval anchor 推导（current+5h / current-5h 都能枚举出）
- claude 5h / 7d duration 硬编码正确
- zai/codex 缺 windowMinutes 时报错
