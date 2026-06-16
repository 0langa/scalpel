# Testing And Reliability

This document describes how to verify current behavior and where the reliability suite fits.

## Automated Baseline

Run before claiming a code or contract change is complete:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:mcp-smoke
```

Or run the full gate:

```bash
pnpm validate
```

Current baseline: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:mcp-smoke` pass.

## Current Automated Coverage

Unit tests cover:

- path confinement
- symlink rejection
- empty-file metadata and reads
- exact replacement semantics
- line and marker mutations
- invalid regex failure
- optimistic concurrency failures
- large-file failures and chunked reads
- binary and invalid UTF-8 rejection
- grep skipped-file reasons
- optional operation journal records
- atomic validation behavior for `batch_edit`

Integration tests cover:

- real MCP stdio client/server connection
- tool listing
- `read` over MCP
- `patch` over MCP
- `read_chunk` over MCP
- namespaced aliases over MCP
- failure `isError: true`
- failure `structuredContent.error`
- `config` over MCP
- mutating dry-run behavior over MCP

## MCP Smoke Harness

`pnpm test:mcp-smoke` runs `scripts/mcp-smoke.ts` against built `dist/index.js`.

It verifies:

- canonical tool listing
- `scalpel_*` alias listing
- representative calls for every canonical tool
- structured errors
- large-file and binary guards
- metadata-only operation journal

Reports are written to `tmp/mcp-smoke/<timestamp>/report.md` and `report.json` unless `SCALPEL_SMOKE_OUT` is set.

## Reliability Suite Role

`scalpel-reliability-suite/` is a fixture project for manual and future automated checks.

It is useful for:

- repeated strings
- duplicate markers
- mixed line endings
- long lines
- nested paths
- config-like JSON/YAML/TOML/INI files
- generated-region edit scenarios

It is not currently a terabyte-scale benchmark suite. Existing files are small enough for laptop iteration.

## Manual Checklist Caveat

`scalpel-reliability-suite/RELIABILITY_CHECKLIST.md` was created early and contains some desired behaviors that are not implemented yet.

Known mismatches:

- `grep` does not support before/after context lines
- `batch_edit` is single-file only
- duplicate marker operations fail instead of choosing first/last
- `logs/app.log` and `logs/error.log` are referenced but not present in the current fixture tree

Treat that checklist as a test-design backlog until it is rewritten into executable tests.

## Reliability Bar For New Tools

Every new mutating tool should define:

- exact path policy
- dry-run behavior or reason it cannot preview
- concurrency preconditions
- atomicity level
- failure codes
- rollback or recovery behavior
- tests for ambiguity, missing files, hidden paths, symlinks, and stale metadata

Every new read/search/index tool should define:

- memory bound
- file-size behavior
- encoding behavior
- binary behavior
- cancellation behavior
- traversal order
- result limit semantics
- error handling for unreadable paths
