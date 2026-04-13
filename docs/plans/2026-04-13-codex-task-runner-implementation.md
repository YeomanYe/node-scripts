# Codex Task Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone `codex-task-runner` CLI that mirrors the batch scheduling behavior of `claude-task-runner` but executes tasks through `codex exec` and adapts concurrency using local Codex usage data.

**Architecture:** Copy the `claude-task-runner` module structure into a new `src/codex-task-runner/` namespace, keeping task file parsing, state persistence, Feishu notifications, and batch orchestration. Replace usage lookup with `codex-usage` auth/API helpers and replace the executor with a `codex exec` wrapper that captures the final message to a temp file.

**Tech Stack:** TypeScript, Commander, Jest with ts-jest, YAML, child_process, existing `codex-usage` module, existing Feishu notification helper

---

### Task 1: Add failing tests for the new runner

**Files:**
- Create: `__tests__/codex-task-runner/config.test.ts`
- Create: `__tests__/codex-task-runner/usage.test.ts`
- Create: `__tests__/codex-task-runner/executor.test.ts`
- Create: `__tests__/codex-task-runner/state.test.ts`

**Step 1: Write the failing tests**

Cover:
- config merge defaults and task-file validation
- usage-driven parallelism from Codex primary window
- `codex exec` argument construction and JSONL parsing helper behavior
- state file path, load, save, and completion checks

**Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/codex-task-runner`
Expected: FAIL because `src/codex-task-runner/*` does not exist yet

### Task 2: Implement the new module tree

**Files:**
- Create: `src/codex-task-runner/index.ts`
- Create: `src/codex-task-runner/config.ts`
- Create: `src/codex-task-runner/types.ts`
- Create: `src/codex-task-runner/usage.ts`
- Create: `src/codex-task-runner/executor.ts`
- Create: `src/codex-task-runner/runner.ts`
- Create: `src/codex-task-runner/state.ts`
- Create: `src/codex-task-runner/log.ts`

**Step 1: Write minimal implementation**

Implement:
- YAML config and task loading with Codex-specific defaults
- parallelism resolution using `codex-usage` primary window percentage
- `codex exec` process execution with timeout handling
- final-message capture, summary truncation, and result normalization
- batch orchestration and Feishu notifications

**Step 2: Run targeted tests**

Run: `pnpm test -- __tests__/codex-task-runner`
Expected: PASS

### Task 3: Wire the CLI into the repository

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/codex-task-runner.md`

**Step 1: Register binary**

Add `codex-task-runner` to the `bin` map.

**Step 2: Document usage**

Add a short README section plus a dedicated doc that mirrors the current `claude-task-runner` guide but reflects Codex-specific config.

### Task 4: Verify repository integration

**Files:**
- Verify existing files only

**Step 1: Run focused and full verification**

Run:
- `pnpm test -- __tests__/codex-task-runner`
- `pnpm test`
- `pnpm run build`

Expected: all pass and `dist/codex-task-runner/index.js` is generated
