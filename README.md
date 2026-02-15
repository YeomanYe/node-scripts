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
| `wait` | 数字或字符串（可选） | 命令间等待时间（秒），支持范围格式 |

## 配置文件格式

### JSON 格式

```json
{
  "time": ["10:00", "15:00", "20:00"],
  "mode": "once",
  "count": "2",
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

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
