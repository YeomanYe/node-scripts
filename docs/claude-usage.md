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
