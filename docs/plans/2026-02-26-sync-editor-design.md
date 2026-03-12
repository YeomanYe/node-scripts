# Sync-Code Design

## Goal
在 `src/sync-editor` 提供一个 CLI，同步 VSCode/Cursor/Trae 的 `settings`、`keybindings`、`extensions`，采用 baseline 驱动的双向三方合并；冲突写入报告，由用户编辑后执行 `resolve`。

## Architecture
- `sync` 命令：读取三端当前状态 + baseline，执行三方合并；无冲突则全量写回并更新 baseline；有冲突则写冲突文件并保留冲突项原值，仅同步非冲突项。
- `resolve` 命令：读取冲突文件中的用户决议，统一写回三端并更新 baseline。
- 通过 `commander` 提供 CLI。

## Data Model
- editors-config: 三端文件路径配置
- baseline: `local/sync-editor/last-sync-state.json`
- conflicts: `local/sync-editor/conflicts.json`

## Merge Semantics
- 单端变化：自动传播
- 多端同值变化：自动传播
- 多端异值变化：记录冲突，等待 resolve

## Conflict Format
每个冲突条目包含：
- `type`: `settings | keybindings | extensions`
- `id`: 条目标识
- `candidates`: 三端候选值
- `status`: `pending | resolved`
- `chosen`: `vscode | cursor | trae | custom`
- `customValue`: `chosen=custom` 时使用
