# knowledge-sync

把 `~/Documents/knowledge` 单向同步进 LLM Wiki 的 `raw/sources/knowledge`，并在写入后请求 LLM Wiki 重新扫描（rescan）。基于 sha256 内容指纹做增量：新增/变更的文件复制过去，源端删除的文件在目标端删除，未变更的跳过。

## 命令

### once（默认）

跑一遍同步。默认 dry-run（只打印计划，不写文件），加 `--apply` 才真正复制/删除并更新状态。

```bash
# 预览将要发生的变更
node dist/knowledge-sync/index.js once

# 实际执行同步并触发 rescan
node dist/knowledge-sync/index.js once --apply

# 不触发 rescan
node dist/knowledge-sync/index.js once --apply --no-rescan
```

### watch（监控模式）

常驻前台进程，监控源目录，一旦内容变化就**自动 apply 同步 + rescan**。`watch` 隐含 `--apply`（监控的意义就是自动同步），rescan 仍由 `--no-rescan` 控制。

```bash
# 默认参数启动监控
node dist/knowledge-sync/index.js watch

# 自定义防抖与兜底轮询间隔
node dist/knowledge-sync/index.js watch --debounce 3000 --interval 60

# 监控但不触发 rescan
node dist/knowledge-sync/index.js watch --no-rescan
```

工作机制：

- 启动时先立即收敛一次（initial sync），再开始监控。
- 用原生 `fs.watch(sourceRoot, { recursive: true })` 即时响应（macOS 支持 recursive）。
- 另配一个 `setInterval` **兜底轮询**：`fs.watch` 可能丢事件，且 `~/Documents/knowledge` 是 Syncthing 同步目录（注意内置忽略 `.stfolder`），外部 sync 落下的变更未必触发 fs 事件，轮询保证最终一致。
- 文件事件与轮询都汇入**同一个防抖运行器**：突发事件被合并成一次同步；正在执行时再来的触发只会在当前同步结束后**补跑一次**，永不并发；单次同步失败只记日志、不会让进程退出。
- 收到 SIGINT/SIGTERM 时停止 watcher 与定时器、等待 in-flight 同步收尾后退出 0。

## 选项

| 选项 | 适用 | 说明 |
|------|------|------|
| `--source <path>` | once / watch | 源知识目录，默认 `~/Documents/knowledge` |
| `--target <path>` | once / watch | 目标 LLM Wiki raw source 目录 |
| `--state <path>` | once / watch | 同步状态 JSON，默认 `<source>/.llm-wiki-sync-state.json` |
| `--ignore <path>` | once / watch | 额外忽略文件，默认 `<source>/.llm-wiki-syncignore` |
| `--apply` | once | 实际写文件并更新状态（watch 隐含开启） |
| `--no-rescan` | once / watch | 同步后不调用 LLM Wiki rescan |
| `--api-base <url>` | once / watch | LLM Wiki API base，默认 `http://127.0.0.1:19828/api/v1` |
| `--project-id <id>` | once / watch | LLM Wiki 项目 id，默认读目标项目 `.llm-wiki/project.json` |
| `--debounce <ms>` | watch | 合并突发 fs 事件的防抖窗口，默认 `2000` |
| `--interval <sec>` | watch | 兜底轮询间隔，默认 `30` |

## 模块结构

```
src/knowledge-sync/
├── index.ts   CLI 入口（once / watch 两个子命令）
├── sync.ts    同步引擎（plan/apply、忽略规则、状态文件）
└── watch.ts   防抖运行器 DebouncedRunner（合并触发、禁止并发、可停止，可注入时钟便于测试）
```

## PM2 自启

`local/pm2.config.js` 含 `knowledge-sync-watch` 条目，跑 `index.js watch`。`pm2 start local/pm2.config.js` 会一并拉起。
