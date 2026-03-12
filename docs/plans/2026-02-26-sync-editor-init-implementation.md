# Sync-Code Init Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 `sync-editor init`，自动探测编辑器配置路径、导出扩展列表并生成 `editors-config.json`。

**Architecture:** 将实现拆为路径探测、扩展导出、命令编排三层；探测与导出逻辑保持纯函数化和可注入依赖，便于单元测试。

**Tech Stack:** TypeScript, Node.js fs/promises, child_process, commander, jest(ts-jest)

---

### Task 1: 路径探测测试与实现

**Files:**
- Create: `__tests__/sync-editor/detect.test.ts`
- Create: `src/sync-editor/detect.ts`

1. 写失败测试：macOS/Linux 的 vscode/cursor/trae 候选路径
2. 运行测试确认失败
3. 实现最小探测逻辑
4. 运行测试确认通过

### Task 2: 扩展导出测试与实现

**Files:**
- Create: `__tests__/sync-editor/extensions.test.ts`
- Create: `src/sync-editor/extensions.ts`

1. 写失败测试：CLI 成功导出、失败时 warning
2. 运行测试确认失败
3. 实现 `--list-extensions` 调用与 JSON 写入
4. 运行测试确认通过

### Task 3: init 流程测试与实现

**Files:**
- Create: `__tests__/sync-editor/init.test.ts`
- Create: `src/sync-editor/init.ts`
- Modify: `src/sync-editor/index.ts`

1. 写失败测试：生成 editors-config、可选导出扩展
2. 运行测试确认失败
3. 实现 `runInitCommand`
4. 注册 commander 子命令 `init`
5. 运行测试确认通过

### Task 4: 文档与回归验证

**Files:**
- Modify: `README.md`

1. 增加 init 命令用法与示例
2. 运行 `pnpm test`
3. 运行 `pnpm build`
