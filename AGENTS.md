# Repository Guidelines

## Project Structure & Module Organization
Source code lives under `src/`, split by CLI tool: `auto-cmd`, `sync-editor`, `exec-recursive`, `claude-usage`, and `claude-task-runner`. Tests mirror that structure under `__tests__/` (for example, `src/auto-cmd/*` maps to `__tests__/auto-cmd/*.test.ts`). Build output is generated in `dist/` and should not be edited by hand. Supporting docs belong in `docs/`; temporary or machine-local files belong in `local/`.

## Build, Test, and Development Commands
Install dependencies with `pnpm install`.

- `pnpm run build` compiles TypeScript from `src/` to `dist/` with declarations and source maps.
- `pnpm run watch` runs the TypeScript compiler in watch mode during development.
- `pnpm test` runs the Jest suite through `ts-jest`.
- `pnpm start` starts the default `auto-cmd` CLI from `dist/auto-cmd/index.js`.
- `pnpm run execute` runs the one-shot `auto-cmd execute` flow.

If you add a new CLI entrypoint, update both `src/<tool>/index.ts` and the `bin` map in `package.json`.

## Coding Style & Naming Conventions
This repository uses TypeScript with `strict` mode and CommonJS output. Match the existing style: 2-space indentation, semicolons, single quotes, and explicit imports. Keep modules focused by tool directory instead of mixing features across packages. Use `kebab-case` for folder names, `camelCase` for functions and variables, and `PascalCase` only for types, interfaces, and classes. There is no dedicated lint or formatter config here, so keep changes consistent with nearby files.

## Testing Guidelines
Place tests in `__tests__/<tool>/` and name them `*.test.ts`. Jest is configured to run only `__tests__/**/*.(test|spec).ts`, so follow that pattern exactly. Add or update tests with each behavior change, especially for config parsing, filesystem effects, and CLI execution paths. Run `pnpm test` before opening a PR.

## Commit & Pull Request Guidelines
Recent history follows short conventional prefixes such as `feat:`, `fix:`, and `chore:`. Keep commit subjects imperative and specific, for example `feat: add sync-editor init flag`. Pull requests should summarize the affected tool, describe behavior changes, list verification steps, and link related issues. Screenshots are usually unnecessary unless output formatting changed.
