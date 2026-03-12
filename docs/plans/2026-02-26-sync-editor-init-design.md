# Sync-Code Init Design

## Goal
新增 `sync-editor init` 命令，自动探测 code/cursor/trae 的配置路径，自动导出扩展列表并生成可直接用于同步流程的 `editors-config.json`。

## Scope
- 平台：macOS + Linux
- 能力：
  - 自动探测 `settings.json` / `keybindings.json`
  - 可选自动导出扩展（`--export-extensions`）
  - 生成 `editors-config.json`

## Command
- `sync-editor init -o <output> [--export-extensions] [--extensions-dir <path>]`

## Detection Rules
- VSCode
  - macOS: `~/Library/Application Support/Code/User`
  - Linux: `~/.config/Code/User`
- Cursor
  - macOS: `~/Library/Application Support/Cursor/User`
  - Linux: `~/.config/Cursor/User`
- Trae
  - macOS: `~/Library/Application Support/Trae/User` -> fallback `~/Library/Application Support/trae/User`
  - Linux: `~/.config/Trae/User` -> fallback `~/.config/trae/User`

## Extensions Export
- 调用：`<editor-cli> --list-extensions`
- 写入：`<extensions-dir>/<editor>-extensions.json`
- CLI 不存在或失败：记录 warning，不中断 init

## Output
生成 `editors-config.json`：
- `vscode.settings`
- `vscode.keybindings`
- `vscode.extensions`
- `cursor.*`
- `trae.*`

## Error Handling
- 输出文件无法写入：失败（exit 1）
- 单编辑器探测失败：warning + 保留占位路径，便于用户手工修正
