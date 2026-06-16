# Current State

This document describes the code that exists now. It is not a roadmap.

## Project Purpose

Scalpel is a local-first MCP server for precise file operations over `stdio`.

Current implementation focuses on:

- exact text edits
- line and marker edits
- workspace-root confinement
- best-effort atomic replacement writes
- dry-run previews for mutating tools
- structured tool errors
- explicit large-file and binary/encoding guards for text tools
- optimistic concurrency checks for mutating tools
- optional operation journaling
- simple recursive search
- package smoke coverage for the built `scalpel` bin path
- read-only MCP resources for core Scalpel docs and live config

Current implementation does not yet provide:

- binary byte editing
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
| `pnpm test:mcp-smoke` | Run built-server MCP smoke harness and write a report |
| `pnpm validate` | Run lint, typecheck, test, build, and smoke |
| `pnpm inspector` | Launch MCP inspector |

## Tool Surface

Read-only tools:

- `config`
- `stat`
- `read`
- `read_chunk`
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

Each canonical tool is also registered as `scalpel_<tool>` for multi-MCP environments.

## Configuration

`SCALPEL_ROOTS` is an optional path-delimited list of allowed workspace roots. If unset or empty, the server uses the process working directory.

The `config` tool returns the live roots and raw `SCALPEL_ROOTS` value for the current MCP process.

Other config values are code defaults in `src/core/config.ts`:

| Field | Default |
| --- | --- |
| `allowHiddenPaths` | `true` |
| `maxReadBytes` | `2097152` |
| `maxDiffBytes` | `2097152` |
| `maxGrepResults` | `200` |
| `durability` | `"default"` |
| `journalEnabled` | `false` |
| `journalPath` | unset |
| `logLevel` | `"error"` |

`SCALPEL_JOURNAL_ENABLED=true` or `1` enables JSONL operation journaling. `SCALPEL_JOURNAL_PATH` sets the journal path; otherwise it defaults under the first root. Journal records contain metadata only, not file content.

`SCALPEL_DURABILITY=strict` enables strict content-write durability. Strict mode fsyncs the temp file before rename and attempts a parent-directory fsync after rename. Parent-directory fsync support depends on the host platform; unsupported flushes are returned as warnings.

`maxDiffBytes` and `logLevel` exist in config but are not widely enforced or wired into runtime behavior yet.

## MCP Resources

Scalpel exposes read-only MCP resources for agent context:

- `scalpel://docs/safety`
- `scalpel://docs/tool-contracts`
- `scalpel://docs/testing`
- `scalpel://config/current`

## Test Layout

| Path | Purpose |
| --- | --- |
| `tests/unit/core/*` | Core path and metadata contracts |
| `tests/unit/tools/*` | Tool behavior and regression tests |
| `tests/integration/stdio-server.test.ts` | Real MCP stdio client/server smoke tests |
| `scripts/mcp-smoke.ts` | Durable built-server MCP smoke harness |
| `scalpel-reliability-suite/*` | Manual reliability fixtures and checklist |
