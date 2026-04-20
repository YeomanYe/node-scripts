# codex-usage

查看 Codex / ChatGPT 用量的命令行工具。复用本地 ChatGPT 登录态访问 `chatgpt.com/backend-api/wham/usage`，表格形式显示。

## 使用方式

```bash
# 查看当前用量
node dist/codex-usage/index.js

# 监视模式（默认每 30 秒刷新）
node dist/codex-usage/index.js --watch

# 自定义刷新间隔（10 秒）
node dist/codex-usage/index.js -w 10

# JSON 格式输出
node dist/codex-usage/index.js --json

# 指定 auth 文件或 base URL
node dist/codex-usage/index.js --auth-file ~/.codex/auth.json
node dist/codex-usage/index.js --base-url https://chatgpt.com/backend-api
```

## 显示内容

| 指标 | 说明 |
|------|------|
| Plan | ChatGPT 订阅类型 |
| Primary | 主窗口的用量百分比与重置时间 |
| Secondary | 次窗口的用量百分比与重置时间 |
| Credits | 额外额度余额 |
| Additional | 其他按 feature 计量的限额 |

## 凭证获取

默认从 `~/.codex/auth.json` 读取已登录的 ChatGPT OAuth 凭证（可通过 `--auth-file` 覆盖）。需要已完成 `codex` CLI 登录。

## 模块结构

```
src/codex-usage/
├── index.ts     CLI 入口
├── types.ts     类型定义
├── auth.ts      auth.json 读取
├── usage.ts     用量 API 调用
└── format.ts    表格格式化
```

## 轮询 + 通知 + PM2 自启

`codex-usage` 也支持 headless 轮询模式；行为与 `claude-usage` 一致，仅窗口名不同。

### 配置

复制 `local/codex-usage-config.yaml`，填入飞书凭据：

```yaml
poll:
  interval_seconds: 300
alert:
  windows: [primary, secondary]
channels:
  - type: feishu
    app_id: "cli_..."
    app_secret: "..."
    receive_id: "oc_..."
    receive_id_type: chat_id
```

注：若 `primary.windowMinutes` 为 `null`（服务端未返回窗口长度），该窗口的告警判定会被跳过，但用量百分比仍然会出现在消息中。

### 命令行

```bash
codex-usage --poll 300 --config ./local/codex-usage-config.yaml
```

### PM2

和 `claude-usage` 共用 `local/pm2.config.js`（`codex-usage-poll` 条目）；`pm2 start local/pm2.config.js` 会同时启动两个进程。
