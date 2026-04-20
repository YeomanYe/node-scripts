# 用量查询轮询 + 通知通道 + PM2 自启 设计

日期：2026-04-20
影响工具：`claude-usage`、`codex-usage`（复用抽出的 `claude-task-runner/feishu.ts`）

## 背景

`claude-usage` 与 `codex-usage` 目前只支持一次性查询或交互式 `--watch`（清屏重绘，面向人眼）。需求：

1. 增加 headless 间隔轮询（`--poll <seconds>`），行为适合后台守护。
2. 每轮查询后通过可配置通道推送（当前实现飞书，接口可扩展）。
3. 在查询结果基础上加入"线性预算告警"：若当前周期用量百分比超过"已过去时间 / 窗口总时长 × 100%"，视为超标并在消息中标红提示。
4. 用 PM2 托管两个轮询进程，配置文件放在 `local/`，支持开机自启。

## 非目标

- 不做其他通道（Webhook / Slack / 钉钉）。接口预留即可。
- 不做跨阈值去抖（每轮都推送，由用户决定轮询间隔）。
- 不改现有 `--watch` 行为。
- 不自动执行 `pm2 startup` 的 sudo 步骤；文档里说明。

## 架构

### 新增目录

```
src/shared/
  notifiers/
    types.ts      Notifier 接口 + ChannelConfig 联合类型
    feishu.ts     从 claude-task-runner 抽出；新增 level: 'info' | 'warn' → 卡片 header 蓝/红
    index.ts      buildNotifiers(channels: ChannelConfig[]): Notifier[]
  alert/
    prorated.ts   纯函数 checkProrated({ utilization, resetsAtMs, windowMs, nowMs? })

src/claude-usage/
  config.ts       加载 local/claude-usage-config.yaml，支持默认值合并
  poll.ts         headless 轮询循环 + 告警拼装 + 通知分发

src/codex-usage/
  config.ts       同上
  poll.ts         同上

local/
  claude-usage-config.yaml
  codex-usage-config.yaml
  pm2.config.js
  logs/           PM2 输出目录（运行时创建）
```

`src/claude-task-runner/feishu.ts` 改为从 `src/shared/notifiers/feishu.ts` re-export，保持现有导入路径不变。

### 模块职责

- **`shared/notifiers/types.ts`**：定义 `Notifier`（`name`, `send(msg)`）、`NotifierMessage`（`title`, `content`, `level`）、`ChannelConfig`（当前仅 `feishu` variant）。
- **`shared/notifiers/feishu.ts`**：持有 `FeishuNotifier` class，封装 tenant token 缓存 + 交互卡片 POST。`level: 'warn'` 时 header template 用 `red`，否则 `blue`。
- **`shared/notifiers/index.ts`**：`buildNotifiers(channels)` 按 `type` 构造 notifier 数组。
- **`shared/alert/prorated.ts`**：`checkProrated({ utilization, resetsAtMs, windowMs, nowMs = Date.now() })` 返回 `{ expected, breached, overBy }`。`windowMs` 为 null/undefined/0 时抛错（调用方负责过滤）。
- **`<tool>/config.ts`**：YAML 解析，结构：`poll.interval_seconds`、`alert.windows`、`channels[]`。默认值就地 merge。
- **`<tool>/poll.ts`**：入口 `runPoll({ intervalSec, config })`。内部循环：取快照 → 对配置里的每个窗口跑 `checkProrated` → 组装 title/content/level → `Promise.allSettled` 发到所有 notifier → 下一轮。捕获内部错误并走 `stderr`，不抛出。

### 数据流

```
每 intervalSec 秒：
  snapshot ← getUsage...()
  alerts ← config.alert.windows.map(w => checkProrated(snapshot[w]))
  level ← alerts.some(a => a.breached) ? 'warn' : 'info'
  msg ← buildMessage(snapshot, alerts, level)
  for notifier of notifiers: await notifier.send(msg).catch(log)
  log line to stdout: [ISO] win1=X% exp=Y% win2=... alert=bool
```

## 配置 schema

### claude-usage

```yaml
poll:
  interval_seconds: 300       # 默认 300；CLI --poll 覆盖
alert:
  windows:                     # 对哪些窗口做线性预算告警
    - five_hour                # 枚举: five_hour | seven_day | seven_day_sonnet | seven_day_opus
    - seven_day
channels:
  - type: feishu
    app_id: cli_xxx
    app_secret: xxx
    domain: https://open.feishu.cn    # 默认
    receive_id: oc_xxx
    receive_id_type: chat_id           # chat_id | open_id | user_id | email
```

### codex-usage

```yaml
poll:
  interval_seconds: 300
alert:
  windows:
    - primary                  # 枚举: primary | secondary
    - secondary
channels:
  - type: feishu
    ...（同上）
```

## 窗口参数表

| 来源 | 窗口 | `windowMs` 来源 |
|---|---|---|
| claude | `five_hour` | 常量 `5 * 3600 * 1000` |
| claude | `seven_day` / `seven_day_sonnet` / `seven_day_opus` | 常量 `7 * 24 * 3600 * 1000` |
| codex  | `primary` / `secondary` | `UsageWindow.windowMinutes * 60000`（null → 跳过告警并 log warn） |

所有 `resetsAtMs` 直接来自 snapshot。Claude: `Date.parse(resetsAt)`；Codex: `resetsAt * 1000`（已是毫秒请对照 `types.ts`，实现时再核）。

## 告警消息格式

**非告警**（蓝色 header，所有被告警窗口均在预算内）：
```
📊 Claude 用量报告
---
账号：pro / tier: default
5 小时：20.0% ｜线性预算 25.0% ｜差 -5.0pp ✓
7 天：  18.5% ｜线性预算 22.1% ｜差 -3.6pp ✓
重置： 2026-04-20 14:00（约 58 分钟后）
```

**告警**（红色 header，超标窗口前缀 🚨）：
```
🚨 Claude 用量告警
---
账号：pro / tier: default
🚨 5 小时：32.0% ｜线性预算 25.0% ｜超 7.0pp
   7 天：  18.5% ｜线性预算 22.1% ｜差 -3.6pp
重置： 2026-04-20 14:00（约 58 分钟后）
```

Codex 对应换成 primary / secondary。

## CLI

```bash
claude-usage --poll <sec> [--config <path>]   # 默认 ./local/claude-usage-config.yaml
codex-usage  --poll <sec> [--config <path>]   # 默认 ./local/codex-usage-config.yaml
```

- `--poll` 与 `--watch` 互斥；`--poll` 时不清屏，每轮 stdout 一行摘要。
- `--config` 未传且默认路径不存在 → 明确报错，建议从样例复制。
- SIGINT / SIGTERM：清 interval，`exit(0)`。
- 单次错误不退出，便于 PM2 不重启风暴。

## PM2 配置

`local/pm2.config.js`：

```js
const path = require('path');
const root = path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: 'claude-usage-poll',
      script: 'dist/claude-usage/index.js',
      args: '--poll 300 --config ./local/claude-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/claude-usage.out.log',
      err_file: './local/logs/claude-usage.err.log',
      time: true,
    },
    {
      name: 'codex-usage-poll',
      script: 'dist/codex-usage/index.js',
      args: '--poll 300 --config ./local/codex-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/codex-usage.out.log',
      err_file: './local/logs/codex-usage.err.log',
      time: true,
    },
  ],
};
```

不加入 `.gitignore`（不含秘密）。凭据只在 yaml 里，`local/*-config.yaml` 已经被 `local/` 目录管理（按项目约定该目录是本地/机器相关）。

启用步骤（写进 `docs/claude-usage.md` / `docs/codex-usage.md` 的 "后台运行" 小节）：

```bash
pnpm install -g pm2        # 或 pnpm add -g pm2
pnpm run build
pm2 start local/pm2.config.js
pm2 save
pm2 startup                # 按提示粘贴 sudo 命令
```

## 测试

- `__tests__/shared/alert/prorated.test.ts`
  - 窗口刚开始（elapsed≈0）→ expected≈0
  - 过半 → expected≈50
  - 快重置 → expected≈100
  - utilization > expected → breached=true
  - utilization == expected → breached=false
- `__tests__/shared/notifiers/feishu.test.ts`
  - mock `fetch`：token 缓存命中不再请求 token
  - `level: 'warn'` → payload header.template = 'red'
  - HTTP 非 2xx / `code != 0` → 抛出（由调用方捕获）
- `__tests__/claude-usage/poll.test.ts` / `codex-usage/poll.test.ts`
  - mock usage API + mock notifier：告警触发时 level=warn
  - mock usage 抛错 → poll 不抛，错误写 stderr，下一轮继续
- `__tests__/claude-usage/config.test.ts` / `codex-usage/config.test.ts`
  - 缺失文件 → 明确错误
  - 部分字段 → 默认值合并
  - `channels` 里未知 `type` → 明确错误

## 兼容性

- `src/claude-task-runner/feishu.ts` 保持原导出签名，内部改为调用 `src/shared/notifiers/feishu.ts`。无行为变化。
- `claude-usage --watch` / `codex-usage --watch` 不变。
- `package.json` `bin` 不变。

## 风险与降级

- Codex primary/secondary 的 `windowMinutes` 为 null → 仅跳过该窗口告警，日志 warn；消息里仍展示用量百分比。
- 飞书 token 网络失败 → 本轮该 notifier 失败，其他 notifier 独立 settle；下一轮自然重试。
- 配置凭据泄漏：`local/` 约定为机器本地文件，提醒用户按需加到 `.gitignore`（README 已经说明 local/ 定位）。

## 实施顺序

1. 抽 `shared/notifiers/feishu.ts` + `types.ts`，改 task-runner 为 re-export，跑现有测试。
2. 加 `shared/alert/prorated.ts` + 测试。
3. `claude-usage`：`config.ts` + `poll.ts` + CLI `--poll` + 测试。
4. `codex-usage`：同上。
5. 加 `local/*-config.yaml` 样例（占位值）、`local/pm2.config.js`。
6. 更新 `docs/claude-usage.md` / `docs/codex-usage.md`：轮询 + PM2 小节。
