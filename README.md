# Auto-Cmd

自动化命令执行调度器

## 介绍

Auto-Cmd 是一个基于 Node.js 的自动化命令执行调度器，支持按指定时间执行命令，支持多种配置文件格式。

## 功能特性

- ✅ 支持按指定时间执行命令
- ✅ 支持 JSON、YAML 和 JavaScript 配置文件
- ✅ 详细的日志记录
- ✅ 跨平台支持（Windows、macOS、Linux）
- ✅ 支持单次执行和重复执行模式

## 安装

```bash
# 安装依赖
pnpm install

# 编译 TypeScript 文件
pnpm run build
```

## 目录结构

```
├── src/
│   ├── auto-cmd.ts        # 主程序，处理命令调度和执行
│   └── babel-types.d.ts   # Babel 类型声明文件
├── dist/                  # 编译后的 JavaScript 文件
├── logs/                  # 日志目录
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 配置
└── README.md             # 项目说明
```

## 脚本说明

### auto-cmd.js

主程序脚本，负责命令的调度和执行。

#### 命令格式

```bash
node dist/auto-cmd.js [command] [options]
```

#### 命令列表

| 命令 | 描述 |
|------|------|
| `run` | 运行命令调度器 |
| `execute` | 立即执行命令（会检查时间配置） |
| `--help` | 查看帮助信息 |

#### 选项

| 选项 | 描述 |
|------|------|
| `-c, --config <path>` | 指定自定义配置文件路径 |
| `-l, --log-dir <path>` | 指定自定义日志目录 |
| `-h, --help` | 查看命令帮助 |

#### 配置文件格式

##### JSON 格式

```json
{
  "time": ["10:00", "15:00", "20:00"],
  "mode": "once",
  "count": "2",
  "commands": [
    {
      "path": "/path/to/directory",
      "cmds": [
        "npm install",
        "npm run build"
      ]
    }
  ]
}
```

##### YAML 格式

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

##### JavaScript 格式

```javascript
// 支持变量和函数
const basePath = '/path/to/directory';
const getTime = () => ['10:00', '15:00'];

export default {
  time: getTime(),
  mode: 'once',
  count: '3',
  commands: [
    {
      path: basePath,
      cmds: [
        'echo "From JS config"',
        'pwd'
      ]
    }
  ]
};
```

## 使用示例

### 1. 运行命令调度器

```bash
# 使用默认配置文件（config.json）
node dist/auto-cmd.js run

# 使用自定义配置文件
node dist/auto-cmd.js run --config config.yml

# 使用自定义日志目录
node dist/auto-cmd.js run --log-dir my-logs
```

### 2. 立即执行命令

```bash
# 立即执行命令（会检查时间配置）
node dist/auto-cmd.js execute --config config.json
```

## 配置参数说明

| 参数 | 类型 | 描述 |
|------|------|------|
| `time` | 字符串数组 | 指定执行时间，格式为 "HH:MM" |
| `mode` | 字符串 | 执行模式，可选值："once"（单次执行）或 "repeat"（重复执行） |
| `count` | 字符串 | 每次执行的命令数，支持两种格式：<br>- `n`：表示一次执行n条命令（从第1条开始）<br>- `m-n`：表示一次执行区间为m-n的命令 |
| `commands` | 对象数组 | 命令组列表 |
| `commands[].path` | 字符串 | 执行命令的工作目录 |
| `commands[].cmds` | 字符串数组 | 要执行的命令列表 |

## 日志说明

日志文件保存在 `logs` 目录下，按日期命名，格式为 `YYYY-MM-DD.log`。日志内容包括：

- 脚本启动时间
- 命令执行时间
- 命令执行结果
- 错误信息
- 下次执行时间

## 开发

```bash
# 监听文件变化并自动重新编译
pnpm run watch

# 运行项目
pnpm start
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
