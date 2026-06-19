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

### Live Configuration

The read-only `config` tool reports the live roots and policy values for the current MCP server process. This helps clients verify whether a restarted server has picked up changed `SCALPEL_ROOTS` values.

### Preview

All mutating tools expose `dry_run`.

Content-editing tools return unified diffs:

- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `prepend`

`move` returns a move plan with source/destination existence and overwrite metadata.

### Optimistic Concurrency

Existing-file mutators can reject stale writes with `expected_sha256` and/or `expected_mtime_ms`.

Current guarantees:

- content mutators support both hash and mtime expectations for existing files
- `create` supports expectations when overwriting an existing file
- `append` and `prepend` reject expectations for missing-file creation
- `move` supports source and overwrite-destination expectations
- directory moves support mtime expectations and reject SHA expectations

### Large Files And Encoding

Full-text tools stat before reading and reject files larger than `maxReadBytes` with `FILE_TOO_LARGE`. `read_chunk` provides bounded UTF-8-safe byte reads for large files. Text tools reject binary files with `BINARY_FILE_NOT_SUPPORTED` and invalid UTF-8 with `UNSUPPORTED_ENCODING`.

### Operation Journal

When enabled with `SCALPEL_JOURNAL_ENABLED`, mutating tools append JSONL records with operation metadata: timestamp, tool, path list, dry-run/applied status, error code when logged, and before/after hash/mtime/size where available. Journal records do not include file content. Journal write failures are reported as warnings and do not corrupt the primary operation.

### Atomic Replacement

`writeFileAtomic()` writes a temp file in the destination directory and renames it over the target.

This gives best-effort local filesystem replacement atomicity.

When `SCALPEL_DURABILITY=strict` is set, content writes also flush the temp file before rename and attempt to flush the parent directory after rename. Parent-directory flush support is platform-dependent, especially on Windows. Unsupported parent flushes are reported as non-fatal warnings.

Text writes and `move` also create metadata-only transaction records under
`config.transactionDir`. On startup, Scalpel scans those records before serving
MCP calls. Recovery removes leftover temp files for interrupted writes, clears
records for renamed writes whose target content already matches the intended
post-write hash, and accepts completed move records. Transaction records include
paths, hashes, sizes, and state where relevant, but never file content.

Not guaranteed today:

- cross-platform persistence guarantees for every filesystem and power-loss scenario
- guaranteed parent-directory `fsync` on every platform
- protection against all race windows between validation and rename
- cross-device move semantics

## Current Risk Register

| Risk | Current State | Why It Matters |
| --- | --- | --- |
| Full-file memory loading | Full-text mutators still require whole-file UTF-8 snapshots under `maxReadBytes`; `read_chunk` and ranged `read` are bounded read paths | Large edit workloads still need future streaming edit design |
| Failure payload compatibility | Failure keeps text plus `structuredContent.error` | Older clients still parse text; newer agents can use structured errors |
| Durability | Default mode uses rename without explicit `fsync`; strict mode flushes file content and attempts parent directory flush | Power loss can leave uncertain persistence, especially where directory flush is unsupported |
| Race windows | Path validation and write are separate steps | Files can change between validation and operation |
| Binary files | Text tools detect and reject binary/non-UTF-8 files; binary editing is unsupported | Prevents corruption but does not provide byte-edit workflows |
| Search traversal | Sequential recursive traversal | Slow for large trees |
| Native acceleration | None | Future performance targets require new layer |
| Audit logging | Optional metadata-only JSONL operation journal | Helps eval and rollback reasoning; crash recovery uses separate metadata-only transaction records |
| Recovery | Startup recovery cleans interrupted text-write records, accepts completed move records, and the hardening crash lane injects killed-process failures around text writes, moves, and recovery cleanup | Platform-specific crash persistence still needs proof |
| Permission model | Root confinement only | No per-tool, per-path, or risk-tier policy |
| Parser awareness | No AST/structured formats | Small edits can still damage code/config semantics |

## Safety Documentation Rule

Do not document future safety goals as current guarantees. Use one of:

- "current guarantee"
- "current limitation"
- "target requirement"
- "open design question"
