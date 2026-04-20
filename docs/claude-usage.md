# claude-usage

查看 Claude API 用量的命令行工具。通过 Anthropic OAuth API 获取实时用量数据，彩色终端显示。

## 使用方式

```bash
# 查看当前用量
node dist/claude-usage/index.js

# 监视模式（默认每 30 秒刷新）
node dist/claude-usage/index.js --watch

# 自定义刷新间隔（10 秒）
node dist/claude-usage/index.js -w 10

# JSON 格式输出
node dist/claude-usage/index.js --json
```

## 显示内容

| 指标 | 说明 |
|------|------|
| 5 小时限额 | 5 小时滑动窗口的用量百分比 |
| 7 天总限额 | 7 天滑动窗口的总用量百分比 |
| 7 天 Sonnet | Sonnet 模型的 7 天用量（有用量时显示） |
| 7 天 Opus | Opus 模型的 7 天用量（有用量时显示） |
| Extra Usage | 额外购买额度的使用情况 |

进度条颜色：
- 绿色：< 50%
- 黄色：50% - 80%
- 红色：> 80%

## 凭证获取

自动按以下优先级获取 OAuth 凭证：
1. macOS 钥匙串（`Claude Code-credentials`）
2. 文件（`~/.claude/.credentials.json`）

需要已登录 Claude Code。

## 模块结构

```
src/claude-usage/
├── index.ts          CLI 入口
├── types.ts          类型定义
├── credentials.ts    OAuth 凭证读取
├── api.ts            用量 API 调用
└── display.ts        彩色终端显示
```

## 轮询 + 通知 + PM2 自启

除交互式 `--watch` 外，`claude-usage` 支持 headless 轮询模式，按间隔抓取用量并把结果（含"线性预算"告警判定）推送到配置的通道。

### 配置

复制 `local/claude-usage-config.yaml`（仓库内已提供样例），填入飞书凭据：

```yaml
poll:
  interval_seconds: 300
alert:
  windows: [five_hour, seven_day]     # 可选: five_hour | seven_day | seven_day_sonnet | seven_day_opus
channels:
  - type: feishu
    app_id: "cli_..."
    app_secret: "..."
    receive_id: "oc_..."
    receive_id_type: chat_id           # chat_id | open_id | user_id | email
```

### 命令行

```bash
claude-usage --poll 300 --config ./local/claude-usage-config.yaml
```

- `--poll [seconds]`：间隔秒数（不传则用配置文件里的 `poll.interval_seconds`，默认 300）。
- `--config <path>`：配置文件路径（默认 `./local/claude-usage-config.yaml`）。
- 与 `--watch` 互斥。

### 线性预算告警

对配置中的每个窗口计算 `expected = 已过去时间 / 窗口总长 × 100`；若 `utilization > expected`，视为超标。消息 header 变红，超标行前缀 🚨。示例：用到第 1 天（7 天窗口）实际 15%，线性预算 ≈ 14.3%，触发告警。

### PM2 后台运行

仓库已在 `local/pm2.config.js` 提供 ecosystem 文件：

```bash
pnpm install -g pm2      # 或 pnpm add -g pm2
pnpm run build
pm2 start local/pm2.config.js
pm2 save
pm2 startup              # 按提示执行 sudo 命令以启用开机自启
```

日志位于 `local/logs/claude-usage.{out,err}.log`。停止：`pm2 stop claude-usage-poll`。
