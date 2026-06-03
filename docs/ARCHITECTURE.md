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

The key design rule remains: the MCP adapter layer should stay thin enough that a future SDK migration mostly touches `src/mcp/*`.

## Implemented Tool Surface

### Read-only

- `stat`
- `read`
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

This is intentionally a little narrower than a full crash-durability claim.

### MCP result shape

The server returns:

- typed success payloads
- tool-level failures with `isError: true`
- structured error payloads under:

```json
{
  "ok": false,
  "error": {
    "code": "STRING_NOT_UNIQUE",
    "message": "old_string matched more than once"
  }
}
```

That shape is generated centrally in `src/mcp/result.ts`.

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

### Regression coverage

Regression tests now cover:

- empty-file `read`
- structured MCP failures
- intermediate symlink traversal rejection
- invalid regex handling in `grep`
- concurrency conflict detection in non-patch mutators
- `insert` newline normalization
- `replace_between_markers` marker-safety behavior

### Real-client validation

Kimi Code is the main real-client smoke path for now:

- project-local MCP config in `.kimi-code/mcp.json`
- reusable validation prompt in `docs/KIMI_TEST_PROMPT.md`
- canonical human-readable test report in `tmp/scalpel-mcp-test-report.md`

## Near-Term Priorities

The current implementation is production-usable for local testing, but these are still the most likely follow-up areas:

- strengthen or document any remaining durability limits in atomic writes
- decide whether `patch` should also accept `expected_mtime_ms` for full symmetry
- expand Kimi regression coverage as new edge cases are found
