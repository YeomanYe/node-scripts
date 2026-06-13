# minimax-usage

查看 MiniMax Token Plan 用量的命令行工具。它通过官方 `mmx-cli quota show --output json` 获取 quota 数据，再把报告发送到已有的 Claude 飞书通道。

## 使用方式

```bash
# 查看当前用量
node dist/minimax-usage/index.js

# JSON 格式输出
node dist/minimax-usage/index.js --json

# 发送一次报告到 Claude 飞书通道
node dist/minimax-usage/index.js --notify

# 轮询并发送报告；未指定秒数时读取 config.poll.interval_seconds
node dist/minimax-usage/index.js --poll

# 指定轮询间隔
node dist/minimax-usage/index.js --poll 900
```

## 默认配置

- MiniMax key：`~/Documents/knowledge/local/.env` 里的 `MINIMAX_API_KEY`
- 通知配置：`./local/claude-usage-config.yaml`
- 查询工具：`npx -y mmx-cli`

可通过参数覆盖：

```bash
node dist/minimax-usage/index.js \
  --env-file ~/Documents/knowledge/local/.env \
  --api-key-env MINIMAX_API_KEY \
  --config ./local/claude-usage-config.yaml \
  --notify
```

## 输出内容

每个模型会展示：

- 5 小时窗口剩余百分比与已用百分比
- 周窗口剩余百分比与已用百分比
- 5 小时窗口结束时间
- 周窗口结束时间
- 若服务端返回调用次数，也会显示次数

当任一窗口剩余额度低于或等于 20% 时，飞书卡片会使用告警样式。

## 注意

`mmx-cli` 当前要求通过 `--api-key` 传入 key。脚本不会打印 key，也不会把 key 写入仓库；但运行时 key 会短暂出现在子进程参数中。
