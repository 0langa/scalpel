# Safety Model

This document separates current guarantees from future safety requirements.

## Current Security Boundary

Scalpel is local-first and workspace-confined. It is not a sandbox.

The server assumes:

- caller is allowed to modify files inside configured roots
- process user permissions are the operating-system enforcement layer
- MCP client may request destructive operations, so tool contracts must fail clearly

## Current Guarantees

### Root Confinement

All public tools call `resolveWorkspacePath()`.

Guaranteed today:

- no relative escape outside configured roots
- no absolute path use outside configured roots
- no traversal through existing symlink path segments

### Hidden Paths

Hidden paths are allowed by default because `createConfig()` sets `allowHiddenPaths: true`.

If a future caller sets `allowHiddenPaths: false`, hidden path segments beginning with `.` are rejected.

### Ambiguity Rejection

Exact and marker-based edits default toward rejecting ambiguity.

Examples:

- `patch` defaults to `occurrence: "unique"`
- marker helpers fail when a marker appears more than once
- `replace_between_markers` rejects replacement content that repeats marker strings

### Preview

Most edit tools expose `dry_run` and return unified diffs.

Tools with `dry_run` today:

- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`

Tools without `dry_run` today:

- `create`
- `append`
- `prepend`
- `move`

### Optimistic Concurrency

Existing-file mutators can reject stale writes with `expected_sha256` and/or `expected_mtime_ms`.

Current asymmetry:

- `patch` supports `expected_sha256` but not `expected_mtime_ms`
- most other existing-file mutators support both
- `create`, missing-file `append`, missing-file `prepend`, and `move` do not have full precondition semantics

### Atomic Replacement

`writeFileAtomic()` writes a temp file in the destination directory and renames it over the target.

This gives best-effort local filesystem replacement atomicity.

Not guaranteed today:

- crash durability
- temp-file cleanup after interrupted writes
- parent-directory `fsync`
- protection against all race windows between validation and rename
- cross-device move semantics

## Current Risk Register

| Risk | Current State | Why It Matters |
| --- | --- | --- |
| Full-file memory loading | Most file operations read whole UTF-8 content | Blocks large files and terabyte-scale workloads |
| Failure payload structure | Failure has text only, no `structuredContent` | Agents must parse text for error codes |
| Durability | Rename without `fsync` | Power loss can leave uncertain persistence |
| Race windows | Path validation and write are separate steps | Files can change between validation and operation |
| Binary files | UTF-8 assumptions throughout | Binary reads/edits can corrupt data |
| Search traversal | Sequential recursive traversal | Slow for large trees |
| Native acceleration | None | Future performance targets require new layer |
| Audit logging | No durable operation journal | Hard to prove or roll back critical operations |
| Permission model | Root confinement only | No per-tool, per-path, or risk-tier policy |
| Parser awareness | No AST/structured formats | Small edits can still damage code/config semantics |

## Safety Documentation Rule

Do not document future safety goals as current guarantees. Use one of:

- "current guarantee"
- "current limitation"
- "target requirement"
- "open design question"

