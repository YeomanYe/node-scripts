# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two Node.js CLI tools built with TypeScript:

- **auto-cmd**: Automated command execution scheduler - runs commands at specified times, supports JSON/YAML configs, `once` and `repeat` modes
- **sync-editor**: Bi-directional sync for VSCode/Cursor/Trae settings, keybindings, and extensions

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript to JavaScript
pnpm watch            # Watch mode for development
pnpm start            # Run auto-cmd scheduler
pnpm execute          # Execute commands immediately (checks time config)
pnpm test             # Run all tests
pnpm test -- <pattern>  # Run tests matching pattern (e.g., parsers.test.ts)
```

## Architecture

### auto-cmd (Command Scheduler)

```
src/auto-cmd/
├── index.ts              # CLI entry with Commander.js
├── types.ts              # TypeScript interfaces
├── config.ts             # Config read/write (JSON/YAML)
├── parsers.ts            # Config file parsers
├── executor.ts           # Command execution logic
├── command-executor.ts   # Command executor interface
├── state.ts              # Execution state persistence
├── time.ts               # Time parsing and scheduling
├── constants.ts          # Constants
└── utils.ts              # Utilities
```

### sync-editor (Editor Config Sync)

```
src/sync-editor/
├── index.ts          # CLI entry
├── init.ts          # Auto-detect editor paths
├── detect.ts        # Detect editor config paths
├── sync.ts          # Main sync logic
├── merge.ts         # Merge conflict resolution
├── resolve.ts       # Apply resolved conflicts
├── io.ts            # File I/O operations
├── install.ts       # Extension install
├── extensions.ts    # Extension list handling
├── types.ts         # TypeScript interfaces
└── resolve.ts       # Resolve conflicts
```

## Test Structure

Tests mirror src structure:

```
__tests__/
├── auto-cmd/
│   ├── config.test.ts
│   ├── executor.test.ts
│   └── ...
└── sync-editor/
    ├── detect.test.ts
    ├── init.test.ts
    └── ...
```

## Key Design Patterns

- **Modular Design**: Single responsibility per module
- **Async/Await**: All file operations use promises
- **State Persistence**: `local/auto-cmd-state.json` for execution state
- **Time-based Scheduling**: Uses `setTimeout` with millisecond calculations
- **Config Formats**: JSON, YAML support via dedicated parsers

## Important Paths

- Default config: `local/auto-cmd-config.json`
- State file: `local/auto-cmd-state.json`
- Logs: `logs/YYYY-MM-DD.log`
- Sync editors config: `local/sync-editor/editors-config.json`
- Sync baseline: `local/sync-editor/last-sync-state.json`
- Sync conflicts: `local/sync-editor/conflicts.json`

## Count Parameter (auto-cmd)

Two formats:
- `"n"`: Execute n commands (starting from first)
- `"m-n"`: Execute a range of commands

## Behavioral Constraints

- **NEVER modify or delete files in the `local/` directory** - Runtime data managed by the application
