# Current State

This document describes the code that exists now. It is not a roadmap.

## Project Purpose

Scalpel is a local-first MCP server for precise file operations over `stdio`.

Current implementation focuses on:

- exact text edits
- line and marker edits
- workspace-root confinement
- best-effort atomic replacement writes
- optimistic concurrency checks for existing-file mutations
- simple recursive search

Current implementation does not yet provide:

- streaming reads
- binary-safe editing
- durable journaling
- crash recovery
- large-scale indexing
- parallel traversal
- structured parsing or AST-aware edits
- low-level native acceleration
- cloud or remote execution

## Entrypoints

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Process bootstrap, `SCALPEL_ROOTS` parsing, stdio transport setup |
| `src/mcp/server.ts` | MCP server creation and instructions |
| `src/mcp/register-tools.ts` | Public tool registration and Zod schemas |
| `src/tools/*` | Tool handlers |
| `src/core/*` | Shared filesystem, path, text, diff, metadata, and mutation helpers |

## Runtime

- Node.js `>=22`
- ESM TypeScript
- MCP SDK `@modelcontextprotocol/sdk`
- Transport: `stdio`
- Package manager: `pnpm`
- Default root: `process.cwd()` when `SCALPEL_ROOTS` is unset

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run server from TypeScript via `tsx` |
| `pnpm build` | Delete `dist`, then compile with `tsc -p tsconfig.build.json` |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format with Biome |
| `pnpm test` | Run Vitest tests |
| `pnpm inspector` | Launch MCP inspector |

## Tool Surface

Read-only tools:

- `stat`
- `read`
- `list_dir`
- `grep`
- `diff`

Mutating tools:

- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `prepend`
- `move`

## Configuration

`SCALPEL_ROOTS` is an optional path-delimited list of allowed workspace roots. If unset or empty, the server uses the process working directory.

Other config values are code defaults in `src/core/config.ts`:

| Field | Default |
| --- | --- |
| `allowHiddenPaths` | `true` |
| `maxReadBytes` | `2097152` |
| `maxDiffBytes` | `2097152` |
| `maxGrepResults` | `200` |
| `logLevel` | `"error"` |

`maxDiffBytes` and `logLevel` exist in config but are not widely enforced or wired into runtime behavior yet.

## Test Layout

| Path | Purpose |
| --- | --- |
| `tests/unit/core/*` | Core path and metadata contracts |
| `tests/unit/tools/*` | Tool behavior and regression tests |
| `tests/integration/stdio-server.test.ts` | Real MCP stdio client/server smoke tests |
| `scalpel-reliability-suite/*` | Manual reliability fixtures and checklist |

