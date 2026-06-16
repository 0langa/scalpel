# Scalpel Server Architecture

This document maps the current Scalpel implementation to the original design and records the contract we want future changes to preserve.

## Goal

Scalpel is a local-first MCP server for deterministic file editing over `stdio`. It is designed for coding agents that need precise edits, predictable failures, and strong workspace-safety defaults.

## Current Shape

### Runtime model

- local subprocess
- `stdio` transport
- one process
- no persistent background state
- workspace-root fallback to the process working directory when `SCALPEL_ROOTS` is unset

### Layering

- `src/index.ts`: process bootstrap and transport wiring
- `src/mcp/*`: SDK-specific registration, schema wiring, and MCP result adaptation
- `src/tools/*`: one thin handler per public tool
- `src/core/*`: file metadata, path policy, mutation preconditions, text operations, diff generation, and atomic writes
- `scripts/mcp-smoke.ts`: built-server MCP smoke harness

The key design rule remains: the MCP adapter layer should stay thin enough that a future SDK migration mostly touches `src/mcp/*`.

## Implemented Tool Surface

### Read-only

- `config`
- `stat`
- `read`
- `read_chunk`
- `list_dir`
- `grep`
- `diff`

### Mutating

- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `prepend`
- `move`

Every public tool also has a `scalpel_<tool>` alias for multi-MCP environments.

## Contract Highlights

### Path safety

All tool entrypoints resolve paths through shared policy code.

Current guarantees:

- target paths must remain under configured roots
- absolute paths are allowed only when still contained by a configured root
- existing intermediate path segments are checked with `lstat()`
- symlink traversal is rejected
- hidden paths can be denied centrally

This logic lives primarily in `src/core/path-policy.ts`.

### Mutation preconditions

Existing-file mutators share a common precondition helper in `src/core/mutation.ts`.

Current guarantees:

- optional `expected_sha256`
- optional `expected_mtime_ms`
- failure with `CONCURRENCY_CONFLICT` when caller expectations do not match the current snapshot

This keeps concurrency checks consistent across tools instead of hand-rolling them per handler.

### Atomic writes

Content-replacement mutations route through the shared atomic write helper.

Current guarantee:

- best-effort atomic replace on the local filesystem through temp-file write plus rename
- optional strict content-write durability with temp-file flush and best-effort parent-directory flush

This is intentionally a little narrower than a full crash-durability claim.

### MCP result shape

The server returns:

- typed success payloads
- tool-level failures with `isError: true`
- failure text formatted as `[ERROR_CODE] message`
- failure `structuredContent.error` with `code`, `message`, optional `path`, and optional `details`

This shape is generated centrally in `src/mcp/result.ts`.

SDK note: MCP TypeScript SDK `1.29.0` validates `structuredContent` against each registered `outputSchema`. Strict success/error output-schema unions currently fail inside the SDK, so Scalpel returns runtime structured errors while advertising permissive output schemas.

### Large-file and encoding guards

`src/core/file-metadata.ts` owns UTF-8 classification, binary detection, large-file errors, chunk reads, and ranged streaming reads. Full-text mutators still operate on bounded whole-file snapshots; large edit streaming is future work.

### Operation journal

`src/core/journal.ts` owns optional JSONL operation records. Tool handlers pass metadata only; file content is never logged.

## Text Operation Semantics

### Exact replacement tools

`patch` and `batch_edit` use exact string replacement planning from shared core logic.

Current rule:

- default occurrence is `"unique"`
- ambiguous matches fail instead of guessing

### Line insertion

`insert` is line-oriented rather than raw-string concatenation.

Current rule:

- inserted content is normalized to the file's EOL before splicing
- content without a trailing newline is promoted into a full inserted line

### Marker-bounded tools

Marker-based operations use unique line-marker lookup.

Current rules:

- marker matches must be unique
- `delete_range` removes marker lines inclusively
- `replace_between_markers` preserves marker lines exactly once
- `replace_between_markers.new_content` must not repeat either marker

### Empty-file reads

`read` explicitly succeeds on empty files and returns a stable empty-file range contract.

## Testing Strategy

### Automated verification

The current baseline is:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:mcp-smoke`
- `pnpm validate`

### Regression coverage

Regression tests now cover:

- empty-file `read`
- structured MCP failures
- live `config` reporting
- `read_chunk` and large-file errors
- binary and non-UTF-8 rejection
- optional operation journal
- namespaced tool aliases
- intermediate symlink traversal rejection
- invalid regex handling in `grep`
- concurrency conflict detection across mutators
- dry-run behavior across mutators
- create and move overwrite preconditions
- `insert` newline normalization
- `replace_between_markers` marker-safety behavior

### Real-client validation

The durable repo smoke path is `pnpm test:mcp-smoke`, which starts the built stdio server and writes JSON/Markdown reports under `tmp/mcp-smoke/<timestamp>`.

Kimi Code remains a useful external-client smoke path:

- project-local MCP config in `.kimi-code/mcp.json`
- reusable validation prompt in `docs/KIMI_TEST_PROMPT.md`
- canonical human-readable test report in `tmp/scalpel-mcp-test-report.md`

## Near-Term Priorities

The current implementation is production-usable for local testing, but these are still the most likely follow-up areas:

- strengthen or document any remaining durability limits in atomic writes
- expand Kimi regression coverage as new edge cases are found
- expand smoke coverage as new edge cases are found
- design streaming edit paths before attempting large mutation workloads
