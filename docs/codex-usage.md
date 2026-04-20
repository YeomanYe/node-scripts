# codex-usage

查看 Codex API 用量的命令行工具。通过 Anthropic API 获取实时用量数据，彩色终端显示。

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
```

## 显示内容

| 指标 | 说明 |
|------|------|
| Primary | Primary 窗口的用量百分比 |
| Secondary | Secondary 窗口的用量百分比 |
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
src/codex-usage/
├── index.ts          CLI 入口
├── types.ts          类型定义
├── credentials.ts    OAuth 凭证读取
├── api.ts            用量 API 调用
└── display.ts        彩色终端显示
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
