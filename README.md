# Auto-Cmd

自动化命令执行调度器

## 介绍

Auto-Cmd 是一个基于 Node.js 的自动化命令执行调度器，支持按指定时间执行命令，支持多种配置文件格式。

## 功能特性

- 支持按指定时间执行命令
- 支持 JSON 和 YAML 配置文件
- 控制台日志输出
- 跨平台支持（Windows、macOS、Linux）
- 支持单次执行和重复执行模式

## 安装

```bash
# 安装依赖
pnpm install

# 编译 TypeScript 文件
pnpm run build
```

## 目录结构

```
├── src/auto-cmd/
│   ├── index.ts           # CLI 入口
│   ├── config.ts          # 配置读写
│   ├── parsers.ts        # 配置解析器
│   ├── executor.ts        # 命令执行
│   ├── command-executor.ts # 命令执行器接口
│   ├── state.ts           # 执行状态管理
│   ├── time.ts            # 时间计算
│   ├── types.ts           # 类型定义
│   └── constants.ts       # 常量定义
├── dist/auto-cmd/         # 编译后的 JavaScript 文件
├── local/                 # 本地数据目录
│   ├── auto-cmd-config.json
│   └── auto-cmd-state.json
├── __tests__/             # 测试文件
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
└── README.md              # 项目说明
```

## 使用

### 运行命令调度器

```bash
# 使用默认配置文件
pnpm start

# 使用自定义配置文件
pnpm start -- --config config.yml
```

### 立即执行命令

```bash
pnpm execute -- --config config.json
```

## Sync-Code（VSCode / Cursor / Trae 同步）

`sync-editor` 用于三方双向同步以下内容：
- `settings.json`
- `keybindings.json`
- `extensions.json`（扩展清单文件）

当检测到冲突时，会生成冲突文件，用户编辑后再执行 `resolve`。

### 准备 editors-config 文件

创建一个 JSON 文件（例如 `local/sync-editor/editors-config.json`）：

```json
{
  "vscode": {
    "settings": "/path/to/vscode/settings.json",
    "keybindings": "/path/to/vscode/keybindings.json",
    "extensions": "/path/to/vscode/extensions.json"
  },
  "cursor": {
    "settings": "/path/to/cursor/settings.json",
    "keybindings": "/path/to/cursor/keybindings.json",
    "extensions": "/path/to/cursor/extensions.json"
  },
  "trae": {
    "settings": "/path/to/trae/settings.json",
    "keybindings": "/path/to/trae/keybindings.json",
    "extensions": "/path/to/trae/extensions.json"
  }
}
```

### 执行同步

```bash
pnpm run build
node dist/sync-editor/index.js sync -c ./local/sync-editor/editors-config.json
```

### 自动生成 editors-config（推荐）

```bash
# 自动探测 code/cursor/trae 的 settings/keybindings 路径并生成 editors-config.json
node dist/sync-editor/index.js init

# 默认会自动导出扩展列表（调用 code/cursor/trae --list-extensions）
node dist/sync-editor/index.js init

# 如需关闭扩展导出
node dist/sync-editor/index.js init --no-export-extensions
```

可选参数：
- `-o, --output <path>`：输出的 editors-config 文件路径（默认 `local/sync-editor/editors-config.json`）
- `--extensions-dir <path>`：扩展列表输出目录（默认 `local/sync-editor/extensions`）

可选参数：
- `-c, --editors-config <path>`：编辑器配置文件路径（默认 `local/sync-editor/editors-config.json`）
- `-b, --baseline <path>`：baseline 文件路径（默认 `local/sync-editor/last-sync-state.json`）
- `-o, --conflicts <path>`：冲突文件路径（默认 `local/sync-editor/conflicts.json`）
- `-u, --use <editor>`：使用单一来源编辑器覆盖其余编辑器（`vscode|cursor|trae`）

### 单来源强制同步（自动安装缺失扩展）

```bash
node dist/sync-editor/index.js sync -c ./local/sync-editor/editors-config.json -u vscode
```

说明：
- 会用来源编辑器的 `settings/keybindings/extensions` 覆盖其它编辑器
- 对目标编辑器缺失的扩展，自动调用对应命令安装：
  - VSCode: `code --install-extension <id>`
  - Cursor: `cursor --install-extension <id>`
  - Trae: `trae --install-extension <id>`

### 冲突处理

1. 先执行 `sync`，若有冲突会生成 `conflicts.json`
2. 手动编辑冲突条目，设置 `status: "resolved"` 和 `chosen`
3. 再执行 `resolve` 应用结果

```bash
node dist/sync-editor/index.js resolve
```

`resolve` 中 `-c, --editors-config` 和 `-f, --file` 都可省略：  
- `--editors-config` 默认 `local/sync-editor/editors-config.json`  
- `--file` 默认 `local/sync-editor/conflicts.json`

`chosen` 支持：
- `vscode`
- `cursor`
- `trae`
- `custom`（需同时提供 `customValue`）

## 配置参数说明

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

## 配置文件格式

### JSON 格式

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

### YAML 格式

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

## 命令组 count 行为说明

当命令组设置了 `count` 参数时：

- **count > 1**：每次执行后 count 减 1，命令保留
- **count = 1**：执行后 count 变为 0，命令保留（下次不再执行）
- **count = 0**：命令被跳过（不执行），但保留在配置中
- **无 count 参数**：执行后立即删除

## 开发

```bash
# 监听文件变化并自动重新编译
pnpm run watch

# 运行测试
pnpm test

# 运行项目
pnpm start
```

## Exec-Recursive（递归执行命令）

`exec-recursive` 用于在当前目录及其子目录中递归执行命令，支持深度控制和深度优先搜索。

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

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
