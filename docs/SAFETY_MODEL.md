# Safety Model

This document separates current guarantees from future safety requirements.
It is the source of truth for what Scalpel may claim in release notes.

## Safety Model Version

Safety model version: `scalpel-safety-model-v1`

Final `1.0.0` release notes must reference this document and must not use broad
terms such as "crash-safe", "race-proof", or "large-scale" unless the linked
release evidence proves the specific invariant described here.

## Current Security Boundary

Scalpel is local-first and workspace-confined. It is not a sandbox.

The server assumes:

- caller is allowed to modify files inside configured roots
- process user permissions are the operating-system enforcement layer
- MCP client may request destructive operations, so tool contracts must fail clearly

## Release Claim Terms

These terms are target requirements for `1.0.0`, not current guarantees unless
the current guarantees section explicitly says so.

### Crash-Safe

`Crash-safe` means that if the Scalpel server process exits, is killed, or
crashes at any instrumented point in a mutating operation, startup recovery
returns every affected path to one of these states before serving MCP calls:

- old complete content/state
- new complete content/state
- explicit unrecoverable state with no silent success claim

Crash-safe does not mean protection from arbitrary operating-system, disk,
controller, or filesystem bugs. Power-loss persistence is included only for the
platform/filesystem/durability combinations proven by final hardening reports.

### Race-Proof

`Race-proof` means Scalpel does not silently overwrite or misreport concurrent
changes inside the supported threat model. For supported mutations, the final
hardening report must prove:

- in-process mutators serialize conflicting path operations
- cooperative multi-process Scalpel servers serialize conflicting path
  operations through a shared lock protocol
- stale hash/mtime expectations are rejected
- external same-user replacement, deletion, directory replacement, or symlink
  replacement before commit fails closed
- external same-user modification after commit but before Scalpel reports
  success is detected and reported as a conflict

Race-proof does not cover malicious same-user changes after Scalpel has already
returned success to the client. After success, the file is normal workspace
state and can be changed by other local processes.

### Large-Scale

`Large-scale` means Scalpel can operate over large repositories and supported
large text files with bounded memory and explicit output limits. The final
hardening report must prove:

- large public corpora are traversed from pinned commits
- generated, vendored, binary, non-UTF-8, hidden, oversized, and unreadable
  files are counted or skipped with reasons
- supported large-file mutation paths do not require full-file memory snapshots
- unsupported large edits fail clearly before mutation
- reports include duration and peak/final RSS telemetry

### Recoverable

`Recoverable` means a transaction record contains enough metadata to reconcile
or explicitly classify the operation without file content. Recovery decisions
must be metadata-only and must not write file contents into journals or reports.

## Supported And Unsupported Environments

Target supported environments for the final `1.0.0` claim:

- local filesystems on Windows proven by the final Windows hardening report
- at least one Unix-like local filesystem proven by the final Unix-like
  hardening report
- Node.js versions allowed by `package.json`
- `stdio` MCP transport
- workspace roots configured through `SCALPEL_ROOTS` or the process working
  directory

Unsupported or not-yet-supported environments unless future evidence expands
the claim:

- network filesystems and sync folders with non-standard rename/fsync semantics
- cross-device moves unless explicitly implemented and proven
- malicious same-user edits after Scalpel reports success
- kernel, disk, controller, antivirus, or filesystem bugs
- binary byte-edit workflows
- parser-aware semantic edits
- permission revocation during an operation except as fail-closed error
  handling

If Scalpel detects an unsupported case before mutation, the final behavior
should be fail-closed with a clear error. If an unsupported case cannot be
reliably detected, release notes must exclude it from the safety claim.

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
MCP calls and classifies each one as `committed` (target content already
matches the intended post-write hash), `aborted` (the write or move never
completed; prior content is intact and any leftover temp file is removed), or
`unrecoverable` (on-disk evidence contradicts the record, or the record itself
is corrupted). Unrecoverable records are quarantined under
`config.transactionDir/quarantine` instead of being retried on every startup.
Transaction records include paths, hashes, sizes, and state where relevant, but
never file content. The startup recovery summary is logged to stderr.

Not guaranteed today:

- cross-platform persistence guarantees for every filesystem and power-loss scenario
- guaranteed parent-directory `fsync` on every platform
- protection against malicious same-user changes after success is reported

`move` detects a cross-device or cross-filesystem rename via the OS `EXDEV`
error and rejects it with `CROSS_DEVICE_MOVE_NOT_SUPPORTED` before any partial
copy is attempted. Scalpel does not implement a copy/fsync/rename/delete
fallback for cross-device moves; this is finalized as explicitly unsupported,
not a future gap.

## Target 1.0.0 Requirements

Before `1.0.0`, all release-blocking requirements below must have
machine-readable evidence:

- `pnpm validate` passes on the final commit.
- Expanded Windows hardening passes on the final commit.
- Release-blocking hardening lanes pass on at least one Unix-like filesystem.
- All release-blocking checks are `required`, not `advisory`.
- Streaming or bounded large-file mutation exists for supported large edits, or
  the release claim is narrowed so full-text large-file mutation is not claimed.
- Cross-device move behavior is finalized as supported, rejected, or explicitly
  unsupported.
- Recovery state machine classifies each pending transaction as completed,
  aborted, recovered, or unrecoverable without silent success.
- Final release artifacts include hardening reports, checksums, and release
  notes that link each claim to evidence.

## Current Risk Register

| Risk | Current State | Why It Matters |
| --- | --- | --- |
| Full-file memory loading | Most full-text mutators still require whole-file UTF-8 snapshots under `maxReadBytes`; `append` and `prepend` have oversized UTF-8 streaming paths, and `read_chunk` plus ranged `read` are bounded read paths | Large edit workloads still need broader streaming edit design |
| Failure payload compatibility | Failure keeps text plus `structuredContent.error` | Older clients still parse text; newer agents can use structured errors |
| Durability | Default mode uses rename without explicit `fsync`; strict mode flushes file content and attempts parent directory flush | Power loss can leave uncertain persistence, especially where directory flush is unsupported |
| Race windows | Path validation and write are separate steps | Files can change between validation and operation |
| Binary files | Text tools detect and reject binary/non-UTF-8 files; binary editing is unsupported | Prevents corruption but does not provide byte-edit workflows |
| Search traversal | Sequential recursive traversal | Slow for large trees |
| Native acceleration | None | Future performance targets require new layer |
| Audit logging | Optional metadata-only JSONL operation journal | Helps eval and rollback reasoning; crash recovery uses separate metadata-only transaction records |
| Recovery | Startup recovery classifies every record as `committed`, `aborted`, or `unrecoverable`, quarantines unrecoverable/corrupted records instead of retrying them forever, and the hardening crash lane injects killed-process failures around text writes, moves, and recovery cleanup | Platform-specific crash persistence still needs proof |
| Permission model | Root confinement only | No per-tool, per-path, or risk-tier policy |
| Parser awareness | No AST/structured formats | Small edits can still damage code/config semantics |

## Safety Documentation Rule

Do not document future safety goals as current guarantees. Use one of:

- "current guarantee"
- "current limitation"
- "target requirement"
- "open design question"
