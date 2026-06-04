# system-monitor

监控本机系统资源（CPU / 内存 / Load / 磁盘），越阈值时通过飞书卡片发告警，恢复后再发一条恢复消息。

## 使用方式

```bash
# 1) 看一次当前指标，不发飞书（适合排查）
node dist/system-monitor/index.js --once

# JSON 输出
node dist/system-monitor/index.js --once --json

# 2) 临时常驻轮询；间隔从配置文件取
node dist/system-monitor/index.js --poll --config ./local/system-monitor-config.yaml

# 自定义间隔（覆盖配置文件）
node dist/system-monitor/index.js --poll 30 --config ./local/system-monitor-config.yaml

# 3) PM2 托管（推荐生产用法）
pnpm run build
pm2 reload local/pm2.config.js
pm2 save
```

`--once` 模式下，如果当前指标已经越限会把组装好的飞书卡片消息**打印到 stdout** 而不发送，方便预览。

## 监控指标

| 指标 | 默认阈值 | 计算方式 |
|------|--------|---------|
| `cpu_percent` | 85% | 一次 tick 内取两次 `os.cpus()` 快照（间隔 ~800ms），按 idle/total 差分得出跨核平均使用率 |
| `memory_percent` | 90% | **macOS** 用 `vm_stat`：`(wired + active + compressor) / total`，对齐 Activity Monitor；其他平台用 `os.freemem` |
| `load1m_per_core` | 2.0 | `os.loadavg()[0] / os.cpus().length`，>1 表示满载 |
| `disk_percent` | 90% | 解析 `df -kP`，按挂载点独立判定 |

阈值设为 `0` 或负数即跳过该项。

## 配置文件

默认路径 `./local/system-monitor-config.yaml`，支持 `-c / --config <path>` 覆盖。

```yaml
poll:
  interval_seconds: 60          # 轮询间隔

thresholds:
  cpu_percent: 85
  memory_percent: 90
  load1m_per_core: 2.0
  disk_percent: 90

disks:
  - /                           # 要监控的挂载点；[] 表示所有非伪 fs 挂载点

alert:
  consecutive_breaches: 2       # 连续 N 次越限才告警（防抖）
  cooldown_minutes: 30          # 同一指标重复告警的最小间隔
  send_recovery: true           # 指标回落到阈值以下时发恢复消息
  heartbeat: false              # true 表示每次轮询都发一次（即便没告警）

channels:
  - type: feishu
    app_id: "cli_xxx"
    app_secret: "xxx"
    domain: "https://open.feishu.cn"
    receive_id: "oc_xxx"
    receive_id_type: chat_id    # chat_id | open_id | user_id | email
```

`channels` 为空数组时只在 stdout 打日志、不发任何通知，等于"本地静默运行"。

## 告警逻辑（状态机）

每条指标独立维护一个小状态机：

1. **越限**：当前值 ≥ 阈值时累计 `consecutiveBreaches`
2. **触发告警**：累计达到 `consecutive_breaches` 次时发首次告警（红色卡片）
3. **节流**：已告警状态下，距离上次告警不足 `cooldown_minutes` 分钟则不再重复发，但状态保留
4. **恢复**：当前值 < 阈值且之前是告警状态 → 若 `send_recovery=true` 发恢复消息（蓝色卡片）→ 清空状态
5. **心跳**：`heartbeat=true` 时即使没告警也每轮发一次，适合配 `interval_seconds: 3600` 做每小时巡检

实现见 `src/system-monitor/state.ts` 的 `MetricStateMachine`，是纯逻辑、可单测。

## 输出示例

每次 tick 在 stdout 打一行：
```
2026-06-03 14:45:01 cpu=51.1% mem=80.2% load1m/core=0.52 /=2.5% breaches=0
```

触发告警时发送飞书卡片：

```
🚨 系统资源告警 (falcomdeMac-mini.local)

新告警:
- 内存: 92.3% (阈值 90.0%)
- 磁盘 /: 91.5% (阈值 90.0%)

主机: falcomdeMac-mini.local ｜ 当前: 2026-06-03 14:45:01 ｜ uptime: 5天 1小时 47分

  CPU: 51.1% ｜阈值 85.0%
🚨 内存: 92.3% ｜阈值 90.0% (22.1GB / 24.0GB)
  1m load/核(10核): 0.52 ｜阈值 2.00 (1m=5.2, 5m=4.8, 15m=4.1)
🚨 磁盘 /: 91.5% ｜阈值 90.0% (424.0GB / 463.4GB)
```

## PM2 托管

`local/pm2.config.js` 已包含 `system-monitor` 进程：

```js
{
  name: 'system-monitor',
  script: 'dist/system-monitor/index.js',
  args: '--poll --config ./local/system-monitor-config.yaml',
  cwd: root,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 5000,
  out_file: './local/logs/system-monitor.out.log',
  err_file: './local/logs/system-monitor.err.log',
  time: true,
}
```

```bash
pnpm run build
pm2 reload local/pm2.config.js    # 加载/更新所有进程
pm2 logs system-monitor           # 查看实时日志
pm2 save                           # 持久化
pm2 startup                        # 开机自启（按提示 sudo 一次）
```

## 跨平台说明

| 平台 | CPU | 内存 | Load | 磁盘 |
|------|-----|------|------|------|
| macOS | ✅ | ✅（vm_stat 修正） | ✅ | ✅（df -kP） |
| Linux | ✅ | ✅（os.freemem，语义已接近 available） | ✅ | ✅ |
| Windows | ⚠️ 未验证 | ⚠️ 未验证 | ❌（loadavg 在 Windows 上为 0） | ❌（df 不通用） |

macOS 上若发现内存数值与 Activity Monitor 偏差大，看 `vm_stat` 输出确认 `Pages wired down`、`Pages active`、`Pages occupied by compressor` 三个字段是否被正确解析（实现见 `src/system-monitor/metrics.ts` 的 `sampleMemoryDarwin`）。

## 架构

```
index.ts          CLI 入口（commander）
  ├─ once         → metrics.collectSample → 打印
  └─ runPoll      → 定时 collectSample → buildTickMessage → 通道分发

config.ts         YAML 加载 + 校验
metrics.ts        采样：sampleCpuPercent / sampleMemory / sampleDisks
state.ts          MetricStateMachine（防抖 + cooldown + recovery）
poll.ts           buildChecks / buildTickMessage 纯函数 + runPoll 调度
types.ts          SystemSample / DiskSample / MetricKey / BreachInfo
```

通知通道复用 `src/shared/notifiers/feishu.ts`，底层调用 `lark-cli` 发送 interactive 卡片，**不引入任何新依赖**。

## 故障排查

- **"配置文件不存在"** —— 检查 `--config` 路径，默认相对当前工作目录
- **"lark-cli 发送失败"** —— 确认 `lark-cli profile` 中存在配置的 app_id；可手动跑 `lark-cli profile list` 检查
- **macOS 内存仍 ~99%** —— 确认运行平台是 darwin（`process.platform`），且 `vm_stat` 可执行
- **磁盘列表为空** —— 检查 `disks:` 是否填了实际存在的挂载点；可先用 `disks: []` 让程序自动发现，再从输出里挑
- **告警被节流，但你想立即重发** —— 重启进程会清空内存状态机
