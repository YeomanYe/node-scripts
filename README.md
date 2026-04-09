# Node Scripts

Node.js 命令行工具集，包含自动化命令调度、编辑器配置同步、递归执行命令等工具。

## 工具列表

| 工具 | 说明 |
|------|------|
| [auto-cmd](#auto-cmd) | 自动化命令执行调度器 |
| [sync-editor](#sync-editor) | VSCode / Cursor / Trae 配置同步 |
| [exec-recursive](#exec-recursive) | 递归执行命令 |
| [claude-usage](#claude-usage) | Claude API 用量查看 |
| [claude-task-runner](#claude-task-runner) | Claude 自动化任务调度 |

## 安装

```bash
pnpm install
pnpm run build
```

## Auto-Cmd

自动化命令执行调度器，支持按指定时间执行命令。

### 功能特性

- 支持按指定时间执行命令
- 支持 JSON 和 YAML 配置文件
- 控制台日志输出
- 跨平台支持（Windows、macOS、Linux）
- 支持单次执行和重复执行模式

### 使用方式

```bash
# 运行命令调度器
pnpm start

# 使用自定义配置文件
pnpm start -- --config config.yml

# 立即执行命令
pnpm execute -- --config config.json
```

### 配置参数说明

| 参数 | 类型 | 描述 |
|------|------|------|
| `time` | 字符串数组 | 指定执行时间，格式为 "HH:MM" |
| `mode` | 字符串 | 执行模式，可选值："once"（单次执行）或 "repeat"（重复执行） |
| `count` | 字符串 | 每次执行的命令数，支持两种格式：<br>- `n`：表示一次执行n条命令<br>- `m-n`：表示一次执行区间为m-n的命令 |
| `commands` | 对象数组 | 命令组列表 |
| `commands[].path` | 字符串 | 执行命令的工作目录 |
| `commands[].cmds` | 字符串数组 | 要执行的命令列表 |
| `commands[].count` | 数字（可选） | 命令组执行次数：<br>- 每次执行后 count 减 1<br>- count 变为 0 时保留命令（不再执行）<br>- 无此参数时执行后立即删除 |
| `wait` | 数字或字符串（可选） | 命令间等待时间（秒），支持范围格式。范围格式为 `m-n`，如 `1-3` 表示1到3秒之间随机等待 |

### 配置文件格式

**JSON 格式：**

```json
{
  "time": ["10:00", "15:00", "20:00"],
  "mode": "once",
  "count": "2",
  "wait": "1-3",
  "commands": [
    {
      "path": "/path/to/directory",
      "cmds": ["npm install", "npm run build"]
    }
  ]
}
```

**YAML 格式：**

```yaml
time:
  - '10:00'
  - '15:00'
  - '20:00'
mode: 'repeat'
count: '1-3'
wait: '0.5-1.5'
commands:
  - path: /path/to/directory
    cmds:
      - echo "Hello world"
      - ls -la
```

### 命令组 count 行为说明

- **count > 1**：每次执行后 count 减 1，命令保留
- **count = 1**：执行后 count 变为 0，命令保留（下次不再执行）
- **count = 0**：命令被跳过（不执行），但保留在配置中
- **无 count 参数**：执行后立即删除

---

## Sync-Editor

VSCode / Cursor / Trae 三方双向同步工具，支持同步：
- `settings.json`
- `keybindings.json`
- `extensions.json`（扩展清单文件）

当检测到冲突时，会生成冲突文件，用户编辑后再执行 `resolve`。

### 自动生成 editors-config（推荐）

```bash
# 自动探测编辑器路径并生成配置
node dist/sync-editor/index.js init

# 关闭扩展导出
node dist/sync-editor/index.js init --no-export-extensions
```

参数：
- `-o, --output <path>`：输出的配置文件路径
- `--extensions-dir <path>`：扩展列表输出目录

### 执行同步

```bash
node dist/sync-editor/index.js sync -c ./local/sync-editor/editors-config.json
```

参数：
- `-c, --editors-config <path>`：编辑器配置文件路径
- `-b, --baseline <path>`：baseline 文件路径
- `-o, --conflicts <path>`：冲突文件路径
- `-u, --use <editor>`：使用单一来源编辑器覆盖其余编辑器（`vscode|cursor|trae`）

### 单来源强制同步

```bash
node dist/sync-editor/index.js sync -u vscode
```

会用来源编辑器的配置覆盖其它编辑器，并自动安装缺失的扩展。

### 冲突处理

1. 执行 `sync`，若有冲突会生成 `conflicts.json`
2. 手动编辑冲突条目，设置 `status: "resolved"` 和 `chosen`
3. 执行 `resolve` 应用结果

```bash
node dist/sync-editor/index.js resolve
```

`chosen` 支持：`vscode`、`cursor`、`trae`、`custom`（需同时提供 `customValue`）

---

## Exec-Recursive

递归执行命令工具，支持深度控制和深度优先搜索。

### 功能特性

- 深度优先搜索（DFS），从最底层目录往上执行
- 支持设置递归深度 `-d n`
- 自动跳过隐藏目录（以 `.` 开头）和 `node_modules`
- 支持 dry-run 预演模式
- 支持命令失败后继续执行

### 使用方式

```bash
exec-recursive <command> [options]
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `<command>` | 要执行的命令 |
| `-d, --depth <number>` | 最大递归深度（默认 1，0 表示仅当前目录） |
| `--dry-run` | 预演模式，只显示将执行的命令 |
| `-c, --continue-on-error` | 命令失败后继续执行 |

### 示例

```bash
# 在当前目录和所有子目录执行 git status
exec-recursive 'git status' -d 3

# 预演模式查看将执行的操作
exec-recursive 'npm install' -d 2 --dry-run

# 在所有子目录执行命令，失败后继续
exec-recursive 'pnpm build' -d 1 -c

# 仅在当前目录执行
exec-recursive 'ls -la' -d 0
```

### 执行顺序示例

假设目录结构：
```
root/
├── a/
│   ├── a1/
│   └── a2/
└── b/
    └── b1/
```

执行 `exec-recursive 'pwd' -d 2` 时，执行顺序为：
1. `root/a/a1` (depth 2)
2. `root/a/a2` (depth 2)
3. `root/a` (depth 1)
4. `root/b/b1` (depth 2)
5. `root/b` (depth 1)
6. `root` (depth 0)

---

## Claude-Usage

查看 Claude API 用量的命令行工具，通过 Anthropic OAuth API 获取实时数据，彩色终端显示。

### 使用方式

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

### 显示内容

- **5 小时限额**：5 小时滑动窗口用量
- **7 天总限额**：7 天滑动窗口总用量
- **7 天 Sonnet / Opus**：各模型独立用量（有用量时显示）
- **Extra Usage**：额外购买额度使用情况

进度条颜色：🟢 < 50% → 🟡 50-80% → 🔴 > 80%

需要已登录 Claude Code，自动从 macOS 钥匙串或 `~/.claude/.credentials.json` 获取凭证。

详细文档：[docs/claude-usage.md](docs/claude-usage.md)

---

## Claude-Task-Runner

基于 Claude Code CLI 的自动化任务调度工具，支持动态并行执行、API 用量自适应调度、飞书实时通知。

### 使用方式

```bash
# 执行任务文件
node dist/claude-task-runner/index.js run <taskfile>

# 指定自定义配置
node dist/claude-task-runner/index.js run tasks.yaml -c my-config.yaml
```

### 任务文件

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
```

### 核心特性

- **动态并行**：根据 API 用量自动调整并发度（< 30% → 3 并发，< 50% → 2，< 80% → 1，≥ 80% → 停止）
- **飞书通知**：每个任务完成立刻通知，每批次发送总结，最终报告
- **用量保护**：每批次执行前重新检查用量，超限自动停止
- **失败策略**：支持 `continue`（继续）或 `stop`（停止）

### 配置文件

默认路径：`local/claude-task-runner-config.yaml`

```yaml
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"
  domain: "https://open.feishu.cn"
  receive_id: "chat_id_or_open_id"
  receive_id_type: "chat_id"

parallelism:
  below_30: 3
  below_50: 2
  below_80: 1
  above_80: 0

defaults:
  model: sonnet
  max_budget_usd: 1.0
  permission_mode: bypassPermissions
  timeout_minutes: 15
  on_failure: continue
```

详细文档：[docs/claude-task-runner.md](docs/claude-task-runner.md)

---

## 开发

```bash
# 监听文件变化并自动重新编译
pnpm run watch

# 运行测试
pnpm test
```

## 许可证

MIT License
