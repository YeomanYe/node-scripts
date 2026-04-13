# claude-task-runner

基于 Claude Code CLI 的自动化任务调度工具。支持动态并行执行、API 用量自适应调度、飞书实时通知。

## 使用方式

```bash
# 执行任务文件
node dist/claude-task-runner/index.js run <taskfile>

# 指定自定义配置
node dist/claude-task-runner/index.js run tasks.yaml -c my-config.yaml

# 使用自定义百分比分段并发配置运行
node dist/claude-task-runner/index.js run tasks.yaml -c local/claude-task-runner-config.yaml
```

## 任务文件格式

YAML 格式，只有 `name` 和 `prompt` 是必填项：

```yaml
tasks:
  - name: "检查依赖更新"
    prompt: "检查当前项目有哪些依赖可以更新"

  - name: "代码质量检查"
    prompt: "对 src 目录下的代码进行质量检查"
    workdir: /path/to/project
    model: sonnet
    max_budget: 1.0
    priority: 1
    on_failure: stop
```

### 任务字段

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | 是 | - | 任务名称 |
| `prompt` | 是 | - | 发送给 Claude 的提示词 |
| `workdir` | 否 | 当前目录 | 工作目录 |
| `model` | 否 | 配置文件中的 `defaults.model` | 模型选择（sonnet/opus/haiku） |
| `max_budget` | 否 | 配置文件中的 `defaults.max_budget_usd` | 单任务最大花费（美元） |
| `priority` | 否 | 100 | 优先级，数字越小越先执行 |
| `on_failure` | 否 | 配置文件中的 `defaults.on_failure` | 失败策略（continue/stop） |

## 配置文件

默认路径：`local/claude-task-runner-config.yaml`

```yaml
# 飞书通知配置
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"
  domain: "https://open.feishu.cn"
  receive_id: "chat_id_or_open_id"
  receive_id_type: "chat_id"    # chat_id 或 open_id

# 并行策略（基于 5 小时窗口 API 用量）
parallelism:
  rules:
    - max_usage: 20
      concurrency: 4
    - max_usage: 50
      concurrency: 2
    - max_usage: 100
      concurrency: 0

# 默认值
defaults:
  model: sonnet
  max_budget_usd: 1.0
  permission_mode: bypassPermissions   # auto | acceptEdits | bypassPermissions
  timeout_minutes: 15
  on_failure: continue                  # continue | stop
```

说明：
- `rules` 是唯一的并发配置来源，按 `max_usage` 升序匹配
- 命中规则的条件是“当前用量 `<= max_usage`”
- 想在 80% 以上停止执行，可以把最后一条写成 `max_usage: 100, concurrency: 0`

## 执行流程

```
1. 加载配置和任务文件
2. 查询 API 用量 → 确定并行度
3. 发送飞书通知：开始执行（用量、并行度、任务列表）
4. 按优先级排序，分批执行：
   ├── 每个任务完成 → 立刻发送飞书通知（结果、耗时、费用）
   ├── 每批完成 → 重新查询用量，发送批次总结
   ├── 用量 >= 80% → 停止执行剩余任务
   └── on_failure: stop → 失败时停止
5. 发送飞书通知：最终报告（成功/失败数、总费用、总耗时）
```

## 飞书通知

支持两种接收方式：
- **群聊**：`receive_id_type: "chat_id"`，`receive_id` 填群 ID
- **单聊**：`receive_id_type: "open_id"`，`receive_id` 填用户 open_id

通知以飞书互动卡片形式发送，包含 Markdown 格式的任务结果。

## 模块结构

```
src/claude-task-runner/
├── index.ts          CLI 入口
├── types.ts          类型定义
├── config.ts         YAML 配置加载
├── usage.ts          API 用量查询 + 并行度计算
├── executor.ts       Claude CLI 任务执行
├── feishu.ts         飞书通知
├── runner.ts         核心调度逻辑
└── log.ts            日志工具
```

## 依赖

- `claude` CLI（需已安装并登录 Claude Code）
- `yaml` npm 包（解析 YAML 配置）
- 飞书自建应用（用于发送通知）
