# 智谱用量查询 + MiniMax 轻量化重构 设计

- 日期：2026-06-21
- 关联：参考 CodexBar（`steipete/CodexBar`）的 Z.ai / MiniMax provider 实现；对齐现有 `codex-usage` / `claude-usage` 的告警与通知模式

## 背景与目标

仓库已有 `claude-usage`、`codex-usage`、`minimax-usage` 三个"用量查询 + 飞书通知"工具，结构高度一致（`index.ts` / `config.ts` / `env.ts` / `quota.ts|usage.ts` / `format.ts` / `poll.ts` / `types.ts`），通知复用 `shared/notifiers`，告警复用 `shared/alert/prorated`。

本轮三件事：

1. **新增 `zai-usage`**：查询智谱（Z.ai）Coding Plan 用量并支持发布到飞书。
2. **重构 `minimax-usage` 为纯 HTTP**：移除 `mmx-cli` / `npx` 外部依赖。
3. **统一告警逻辑**：minimax 与 zai 都接入 `checkProrated`（线性预算告警），与 codex / claude 对齐。

关键调研结论（来自 CodexBar 源码）：

- **Z.ai**：`GET https://api.z.ai/api/monitor/usage/quota/limit`，`Authorization: Bearer <token>`，纯 HTTP，无需 cookie。响应 `{ code, msg, success, data: { planName, limits: [...] } }`。
- **MiniMax**：现在 `minimax-usage` 经 `mmx-cli` 拿到的 `model_remains` 数据，本质就是 HTTP 接口 `GET https://api.minimaxi.com/v1/token_plan/remains`（国内）返回的。`mmx-cli` 只是一层壳。纯 HTTP 即可替代。

## 实现顺序

按依赖与风险排序：**③ 新增 zai-usage（零回归）→ ② 重构 minimax HTTP → ① 告警统一**（① 实际穿插在 ②③ 中同步实现）。

---

## 第一部分：告警逻辑统一 —— 接入 `checkProrated`

### 现状问题

`minimax-usage/poll.ts` 当前用 `hasLowQuota`（任一窗口 `remainingPercent ≤ 20%` 才告警）——只在窗口快耗尽时才触发，无法在"用量节奏超前于时间进度"时预警。

### 目标

改用 `shared/alert/prorated.ts` 的 `checkProrated`，与 codex / claude 完全一致：

- `expected` = `(窗口已过时间 / 窗口总长) × 100`（线性预算）
- `overBy` = `实际用量% − expected`
- `breached` = `overBy > 0`

含义：窗口过半而用量已超 50%，即告警。

### 输入映射

`checkProrated` 需要 `utilization` / `resetsAtMs` / `windowMs` / `nowMs`：

- **minimax**：每个 model 的 `interval` / `weekly` 窗口
  - `utilization` = `usedPercent`
  - `resetsAtMs` = `endMs`
  - `windowMs` = `endMs − startMs`（若 ≤0 或缺失则跳过该窗口，照搬 codex 的 `windowMinutes 未知，跳过告警判定` 处理）
- **zai**：primary / secondary 窗口
  - `utilization` = `usedPercent`
  - `resetsAtMs` = `nextResetTime`（epoch ms）
  - `windowMs` = `windowMinutes × 60_000`（由 `unit + number` 算出）

### 报告格式（对齐 codex-usage）

每个窗口一行：

```
🚨 <标签>：<用量%> ｜线性预算 <expected%> ｜超 <overBy>pp ｜结束 <resetTime>
```

`breached` 用 `🚨` 前缀，否则两个空格缩进。任一窗口 breached → `level: 'warn'` + 标题 `🚨 <X> 用量告警`，否则 `info` + `📊 <X> 用量报告`。

### 配置变化

两个工具的 config 都加 `alert.windows`（可选，控制参与告警判定的窗口）：

- minimax（`local/minimax-usage-config.yaml` 沿用，或新建）：`alert.windows: [interval, weekly]`，默认两者都开
- zai（`local/zai-usage-config.yaml`）：`alert.windows: [primary, secondary]`，默认两者都开

> 注：codex 用 `alert.windows`，claude 用 `alert.windows`（`five_hour` / `seven_day` 等）。minimax / zai 沿用同样键名，保持家族一致。

---

## 第二部分：重构 `minimax-usage` 为纯 HTTP

### 目标

移除 `mmx-cli` / `npx` 依赖，改用全局 `fetch`。解析逻辑（`types.ts` / `format.ts`）基本不动，只换 `quota.ts` 数据获取层 + 调整响应包装解包。

### `quota.ts` 改造

照搬 CodexBar `MiniMaxUsageFetcher`：

- 移除 `spawn` / `DEFAULT_COMMAND` / `DEFAULT_COMMAND_ARGS`。
- `fetchMiniMaxQuota({ apiKey, apiHost? })`：用全局 `fetch`。
- 默认 host `https://api.minimaxi.com`（国内，对应用户的 coding plan `sk-cp-*` key），可通过 `--api-host` / `MINIMAX_HOST` 覆盖。
- **端点 fallback 链**：
  1. 先试 `{host}/v1/token_plan/remains`（token plan 新端点）
  2. 404 / 405 / 凭据失败 → fallback `{host}/v1/api/openplatform/coding_plan/remains`（coding plan 旧端点）
- Headers：`Authorization: Bearer <key>`、`accept: application/json`。
- 响应校验：
  - `response.ok === false`：401/403 → 凭据错；其他 → apiError
  - `base_resp.status_code !== 0`：`status_code === 1004` 或 msg 含 login/cookie → 凭据错；否则 apiError
  - `data.model_remains` 为空 → parseFailed
- **移除** `mmx-cli` 相关代码与测试（`commandFailedMessage` / `DEFAULT_COMMAND` 等）。

### 响应包装解包

`mmx-cli` 直接吐顶层 `model_remains`；HTTP 接口包在 `{ base_resp, data: { model_remains, plan_name, points_balance } }` 里。

- `extractJsonPayload`：改为从 JSON 中取 `data.model_remains`（兼容：若顶层无 `data` 键则回退到顶层，保留对旧 mmx 输出的兼容性以防回滚）。
- 额外提取 `plan_name`（→ snapshot 新增 `planName`）、`points_balance`（→ `pointsBalance`，可选展示）。

### CLI 变化

`index.ts`：

- `--api-key-env` 默认仍 `MINIMAX_API_KEY`（不变）。
- 新增 `--api-host <url>`，默认 `https://api.minimaxi.com`。
- 移除 `command` / `commandArgs` 相关 option（原本未暴露给 CLI，仅内部 `FetchQuotaOptions`）。

### 收益

去掉每次轮询的 `npx` / `mmx-cli` 冷启动（省 1–3s + 避免网络版本检查），去掉对外部 npm 包的运行时依赖。`mmx-cli` **不保留作为 fallback**（HTTP 已覆盖且更轻）。

### 测试

- `quota.test.ts`：重写。用 CodexBar `MiniMaxProviderTests.swift` 的真实响应样例测：
  - token_plan 成功路径（`status_code === 0` + `model_remains`）
  - 旧 coding_plan fallback 路径（token_plan 返回 404 → coding_plan 成功）
  - 凭据错（`status_code === 1004`、HTTP 401/403）
  - `data.model_remains` 解包 + 归一化（复用现有 `normalizeModel` 断言）
- 用注入的 stub fetcher（不实际发请求），与现有 `fetchMiniMaxQuota` 注入式测试一致。
- 其余测试（`config` / `format` / `poll` / `env` / `index`）适配新的告警格式与 `planName` 字段。

---

## 第三部分：新增 `zai-usage`

### 结构（1:1 对齐 minimax-usage HTTP 版）

```
src/zai-usage/
├── index.ts     # commander: 默认打印 / --notify / --poll / --json，复用 shared/notifiers
├── config.ts    # local/zai-usage-config.yaml: poll.interval + alert.windows + channels
├── env.ts       # dotenv 读 Z_API_KEY（复用 minimax 同款 parseDotEnv / expandHome）
├── quota.ts     # fetch GET /api/monitor/usage/quota/limit @ api.z.ai
├── format.ts    # 终端/卡片格式化（每窗口：类型/用量%/线性预算%/剩余/重置）
├── poll.ts      # buildPollReport(checkProrated) + runOnce + runPoll
└── types.ts     # ZaiRawQuota + 归一化 ZaiUsageSnapshot
```

### 数据获取（`quota.ts`，来自 CodexBar `ZaiUsageStats.swift`）

- `fetchZaiUsage({ apiKey, apiHost? })`：GET `{host}/api/monitor/usage/quota/limit`
- 默认 host `https://api.z.ai`（国际站），可 `--api-host` / `Z_API_HOST` 覆盖。
- Headers：`Authorization: Bearer <key>`、`accept: application/json`。
- 校验：`response.ok` + `body.code === 200 && body.success`；防御 HTTP 200 空 body（抛错提示检查 region / token，照搬 CodexBar）。
- 响应：`{ code, msg, success, data: { planName, limits: [...] } }`。

### 数据模型（`types.ts`）

智谱 `data.limits[]` 每项是一个用量窗口，归一化为：

```typescript
type ZaiLimitType = 'TOKENS_LIMIT' | 'TIME_LIMIT';

interface ZaiLimitWindow {
  type: ZaiLimitType;
  windowMinutes: number | null;   // 由 unit+number 算出（minutes/hours/days/weeks）
  windowLabel: string | null;     // "5 hour window" 人类可读
  usage: number | null;
  remaining: number | null;
  currentValue: number | null;
  usedPercent: number | null;     // 优先 (usage-remaining)/usage，回退 percentage
  resetsAtMs: number | null;      // nextResetTime (epoch ms)
  usageDetails: { modelCode: string; usage: number }[];
}

interface ZaiUsageSnapshot {
  planName: string | null;
  primary: ZaiLimitWindow | null;    // TOKENS_LIMIT（若有多个，取最长窗口为主）
  secondary: ZaiLimitWindow | null;  // TIME_LIMIT
  raw: ZaiRawQuotaResponse;
}
```

窗口归类（照搬 CodexBar `parseUsageSnapshot`）：

- `TOKENS_LIMIT` → 若 ≥2 个，最短窗口归 `secondary`（session）、最长归 `primary`；仅 1 个则归 `primary`。
- `TIME_LIMIT` → `secondary`（若 primary 已占，则按 CodexBar：token 限为 primary，time 限为 secondary）。

`windowMinutes` 映射（CodexBar `ZaiLimitUnit`）：`1=minutes, 3=hours, 5=days, 6=weeks, 0=unknown`。

已用% 计算（照搬 CodexBar 防御逻辑，避免缺字段误判 100%）：

1. 优先：`usage > 0` 时 `used = max(usage - remaining, currentValue ?? -∞)`，`usedPercent = used / usage × 100`
2. 缺失则回退 `percentage` 字段

### CLI（`index.ts`，对齐 minimax-usage 选项）

```
zai-usage                    # 打印当前用量（终端文本）
zai-usage --json             # 打印归一化 JSON
zai-usage --notify           # 发一次飞书卡片
zai-usage --poll [seconds]   # 轮询，间隔默认读 config
  --config <path>      默认 local/zai-usage-config.yaml
  --env-file <path>    默认 ~/Documents/knowledge/local/.env
  --api-key-env <name> 默认 Z_API_KEY
  --api-host <url>     默认 https://api.z.ai
```

`--poll` 与 `--notify` 互斥（照搬 minimax 逻辑）。`Z_API_KEY` 为用户 `.env` 中实际变量名（非 `Z_AI_API_KEY`）。

### 告警（`poll.ts`）

用 `checkProrated`，`windowMs = windowMinutes × 60_000`，`resetsAtMs = nextResetTime`，对齐 codex 报告格式与 `summaryLine`（`primary=<用量>%(exp<expected>%) ... alert=<bool>`）。

### 配置文件（`local/zai-usage-config.yaml`）

```yaml
poll:
  interval_seconds: 900
alert:
  windows: [primary, secondary]
channels:
  - type: feishu
    app_id: "..."        # 复用 claude-usage 同一飞书应用
    app_secret: "..."
    receive_id: "..."
    receive_id_type: chat_id
```

提供示例文件 `local/zai-usage-config.example.yaml`（不含真实凭据），飞书应用凭据复用 `local/claude-usage-config.yaml` 同一套。

### 测试（5 个，对齐 minimax-usage）

- `quota.test.ts`：用 CodexBar `ZaiProviderTests.swift` 真实响应样例测归一化（primary/secondary 归类、百分比计算优先级、空 body 防御、缺字段处理、多 TOKENS_LIMIT 窗口排序）。
- `config.test.ts`：YAML 加载、channel 校验、`alert.windows` 默认值。
- `format.test.ts`：窗口文本格式化。
- `poll.test.ts`：`buildPollReport` 的 breached/info 判定、`summaryLine`。
- `env.test.ts`：复用 `parseDotEnv`（与 minimax 一致）。
- `index.test.ts`：CLI 选项互斥、默认 host。
- 全部用 stub fetcher（注入，不实际发请求）。

### `package.json`

注册 `"zai-usage": "dist/zai-usage/index.js"`。

---

## 复用与差异对照

| 维度 | minimax-usage（重构后） | zai-usage（新） |
|---|---|---|
| fetch 方式 | 全局 `fetch` | 全局 `fetch` |
| 默认 host | `https://api.minimaxi.com`（国内） | `https://api.z.ai`（国际） |
| 端点 | `/v1/token_plan/remains` (+ coding_plan fallback) | `/api/monitor/usage/quota/limit` |
| 鉴权 | `Bearer` header | `Bearer` header |
| 窗口模型 | 固定 interval(5h) + weekly（来自 `model_remains`） | 动态 `limits[]` → primary/secondary |
| 告警 | `checkProrated` | `checkProrated` |
| 其余（config/env/poll/notify） | — | 完全复用同款模式 |

## 风险与回滚

- **minimax HTTP 端点风险**：若用户 API key 权限不足或国内端点变更，可能导致查询失败。缓解：端点 fallback 链（token_plan → coding_plan）；测试覆盖两种响应样例。回滚：保留 git 历史，`quota.ts` 旧 spawn 版本可一键恢复。
- **zai 响应字段差异**：不同套餐返回的 `limits` 数量/类型可能不同。缓解：归一化对缺字段一律 `null`，`checkProrated` 对 `windowMs ≤ 0` 跳过判定。
- **告警阈值变化**：从"剩余≤20%"改为"超线性预算"，告警会更早更频繁。这是预期改进（与 codex/claude 一致）。

## 非目标（YAGNI）

- 不做每模型每小时用量明细（zai 的 `model-usage` 端点）——用户明确只要配额。
- 不做 minimax 多服务（multi-service）解析 ——保持现有 `model_remains` 单模型维度。
- 不做账单历史（minimax `account/amount`）。
- 不为 minimax 保留 `mmx-cli` fallback。
