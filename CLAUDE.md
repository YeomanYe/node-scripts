# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**auto-cmd** is an automated command execution scheduler built with Node.js and TypeScript. It schedules and executes commands at specified times, supporting multiple config formats (JSON, YAML, JS) and two execution modes (`once` and `repeat`).

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript to JavaScript
pnpm watch            # Watch mode for development
pnpm start            # Run the scheduler
pnpm execute          # Execute commands immediately (checks time config)
pnpm test             # Run test suite
```

## Architecture

```
src/auto-cmd/
├── index.ts       # Main entry point, CLI setup with Commander.js
├── types.ts       # TypeScript interfaces (Config, CommandGroup, Options, ExecutionState)
├── config.ts      # Config file reading/writing (JSON/YAML/JS support)
├── config-lock.ts # File locking mechanism for concurrent access
├── executor.ts    # Command execution logic, count parameter parsing
├── log.ts         # Logging with timestamped files
├── time.ts        # Time parsing and scheduling calculations
├── state.ts       # Execution state persistence
└── utils.ts       # Utility functions
```

### Key Design Patterns

- **Modular Design**: Each module has a single responsibility (time, log, config, executor)
- **Async/Await**: All file operations use promises API
- **File-based Locking**: `config-lock.ts` prevents concurrent config access
- **State Persistence**: Execution state stored in `local/auto-cmd-state.json`
- **Time-based Scheduling**: Uses `setTimeout` with millisecond calculations

### Important Paths

- Default config: `local/auto-cmd-config.json`
- State file: `local/auto-cmd-state.json`
- Logs: `logs/YYYY-MM-DD.log` with format `[YYYY-MM-DD HH:mm:ss.ssss] message`

### Count Parameter

Supports two formats:
- `"n"`: Execute n commands (starting from first)
- `"m-n"`: Execute a range of commands

## Behavioral Constraints

- **NEVER modify or delete files in the `local/` directory** - This folder contains runtime data (config, state)
- The `local/` folder stores auto-cmd-config.json and auto-cmd-state.json which are managed by the application

## Development Workflow

- **Always run tests after code changes** - Execute `pnpm test` to verify changes don't break existing functionality
- **Update README for user-facing changes** - Document new features, configuration options, or behavioral changes
- **Log error causes** - When encountering errors, document the root cause and solution to prevent recurrence
