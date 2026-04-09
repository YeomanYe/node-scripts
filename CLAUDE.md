# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Compile TypeScript (tsc) → dist/
pnpm run watch        # Compile with --watch
pnpm test             # Run all tests (Jest)
pnpm test -- __tests__/auto-cmd/config.test.ts   # Run a single test file
pnpm test -- --testNamePattern="pattern"          # Run tests matching name
```

## Architecture

Monorepo of independent CLI tools, each under `src/<tool>/`, compiled to `dist/<tool>/` and exposed via `bin` in package.json. All tools are CommonJS TypeScript (`"type": "commonjs"`, target ES2022).

### Tools

| Tool | Entry | Purpose |
|------|-------|---------|
| **auto-cmd** | `src/auto-cmd/index.ts` | Scheduled command execution (JSON/YAML config, time-based triggers, once/repeat modes) |
| **sync-editor** | `src/sync-editor/index.ts` | Bidirectional settings sync across VSCode/Cursor/Trae (settings, keybindings, extensions) |
| **exec-recursive** | `src/exec-recursive/index.ts` | DFS recursive command execution with depth control |
| **claude-usage** | `src/claude-usage/index.ts` | Claude API usage reporting |
| **claude-task-runner** | `src/claude-task-runner/index.ts` | Automated Claude task execution with Feishu integration |

### Key patterns

- CLI tools use **commander** for argument parsing
- Config files support both JSON and YAML (via `yaml` package)
- Tests live in `__tests__/<tool>/` mirroring `src/<tool>/` structure
- Jest uses `ts-jest` preset with `@/` path alias mapped to `src/`
- Language: Chinese (README, comments, commit messages are in Chinese)
