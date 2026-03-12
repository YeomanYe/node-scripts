# Sync-Code Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `src/sync-editor` 实现基于 commander 的三方双向同步 CLI，支持冲突报告和 `resolve`。

**Architecture:** 将实现拆为数据读写层、合并引擎、命令执行层。命令层仅做参数和流程编排；合并逻辑在纯函数中便于单元测试。

**Tech Stack:** TypeScript, Node.js fs/promises, commander, jest(ts-jest)

---

### Task 1: 编写合并引擎失败测试

**Files:**
- Create: `__tests__/sync-editor/merge.test.ts`
- Create: `src/sync-editor/merge.ts`

1. 写单端变化自动传播测试
2. 运行测试确认失败
3. 实现最小合并逻辑
4. 运行测试确认通过

### Task 2: 编写命令流程失败测试

**Files:**
- Create: `__tests__/sync-editor/commands.test.ts`
- Create: `src/sync-editor/sync.ts`
- Create: `src/sync-editor/resolve.ts`
- Create: `src/sync-editor/types.ts`
- Create: `src/sync-editor/io.ts`

1. 写 `sync` 产生冲突文件的失败测试
2. 写 `resolve` 应用用户决议的失败测试
3. 运行测试确认失败
4. 实现最小代码使测试通过
5. 再次运行测试

### Task 3: CLI 入口与集成

**Files:**
- Create: `src/sync-editor/index.ts`
- Modify: `package.json`

1. 用 commander 暴露 `sync` / `resolve`
2. 更新 bin 输出入口
3. 增加参数校验与退出码
4. 运行目标测试

### Task 4: 回归验证

**Files:**
- Verify only

1. 运行 `pnpm test`
2. 运行 `pnpm build`
3. 记录结果并确认无回归
