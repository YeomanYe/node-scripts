# Codex Usage CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone `codex-usage` CLI to this repository by porting the behavior from `codex-usage-cli` without merging it into `claude-usage`.

**Architecture:** Create a new `src/codex-usage/` module tree with separate auth, API, formatting, types, and CLI entrypoint files. Adapt the source project from ESM/Vitest to this repository's CommonJS/TypeScript/Jest setup, then register the new binary and document usage in the main README.

**Tech Stack:** TypeScript, Commander, Jest with ts-jest, Node.js fetch, `zod`, `cli-table3`, `dayjs`, `picocolors`, `jwt-decode`

---

### Task 1: Add failing tests for migrated behavior

**Files:**
- Create: `__tests__/codex-usage/auth.test.ts`
- Create: `__tests__/codex-usage/usage.test.ts`
- Create: `__tests__/codex-usage/format.test.ts`

**Step 1: Write the failing tests**

Cover:
- loading ChatGPT auth from `auth.json`
- rejecting API key auth
- requesting `/backend-api/wham/usage` with bearer token and account header
- formatting a readable table summary

**Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/codex-usage`
Expected: FAIL because `src/codex-usage/*` does not exist yet

### Task 2: Implement the new CLI module

**Files:**
- Create: `src/codex-usage/index.ts`
- Create: `src/codex-usage/auth.ts`
- Create: `src/codex-usage/usage.ts`
- Create: `src/codex-usage/format.ts`
- Create: `src/codex-usage/types.ts`

**Step 1: Write minimal implementation**

Implement:
- auth file loading from `~/.codex/auth.json`
- account id extraction from token payload or explicit field
- usage fetch + normalized mapping
- human-readable table output and `--json`
- Commander entrypoint compatible with this repo

**Step 2: Run targeted tests**

Run: `pnpm test -- __tests__/codex-usage`
Expected: PASS

### Task 3: Wire the CLI into the repository

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Register binary and dependencies**

Add the new `codex-usage` entry under `bin` and add runtime dependencies required by the migrated implementation.

**Step 2: Document usage**

Add the new tool to the README tool list and include basic usage examples.

### Task 4: Verify repository integration

**Files:**
- Verify existing files only

**Step 1: Run focused and full verification**

Run:
- `pnpm test -- __tests__/codex-usage`
- `pnpm test`
- `pnpm run build`

Expected: all pass and `dist/codex-usage/index.js` is generated
