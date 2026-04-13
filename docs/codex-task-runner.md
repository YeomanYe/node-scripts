# codex-task-runner

基于 Codex CLI 的自动化任务调度工具。支持动态并行执行、Codex 用量自适应调度、飞书实时通知。

## 使用方式

```bash
# 执行任务文件
node dist/codex-task-runner/index.js run <taskfile>

# 指定自定义配置
node dist/codex-task-runner/index.js run tasks.yaml -c my-config.yaml

# 使用自定义百分比分段并发配置运行
node dist/codex-task-runner/index.js run tasks.yaml -c local/codex-task-runner-config.yaml
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
    model: gpt-5.4
    priority: 1
    on_failure: stop
```

## 配置文件

默认路径：`local/codex-task-runner-config.yaml`

```yaml
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"
  domain: "https://open.feishu.cn"
  receive_id: "chat_id_or_open_id"
  receive_id_type: "chat_id"

parallelism:
  - max_usage: 15
    concurrency: 4
  - max_usage: 35
    concurrency: 2
  - max_usage: 100
    concurrency: 0

defaults:
  model: gpt-5.4
  sandbox_mode: workspace-write
  dangerously_bypass_approvals_and_sandbox: false
  timeout_minutes: 30
  on_failure: continue
```

说明：
- `parallelism` 直接就是规则数组，按 `max_usage` 升序匹配
- 命中规则的条件是“当前用量 `<= max_usage`”
- 想在 80% 以上停止执行，可以把最后一条写成 `max_usage: 100, concurrency: 0`

## 说明

- 并发度基于 `codex-usage` 的主窗口用量动态调整
- 任务成功后会写入 `<taskfile>.state.json`，重复执行时自动跳过
- 当前费用统计优先从 `codex exec --json` 事件中提取；未命中时记为 `0`
