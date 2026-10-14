# Tool Contracts

This document records current behavior verified against `src/mcp/register-tools.ts`, `src/tools/*`, and tests.

## Result Shape

Success:

- returns MCP `content` with JSON text
- returns `structuredContent`

Failure:

- returns MCP `isError: true`
- returns text formatted as `[ERROR_CODE] message`
- may include path and JSON details in text
- returns `structuredContent.error` with `code`, `message`, optional `path`, and optional `details`
- unexpected operating-system errors (a read-only parent directory, a file locked by another process, a full disk) use the same shape: `FILE_NOT_FOUND`, `PERMISSION_DENIED`, or `INVALID_INPUT` when the OS error code says so, otherwise `IO_ERROR` (or `INTERNAL_ERROR` for non-OS exceptions), with the OS code in `details.cause_code`

## Shared Path Rules

All public tools resolve paths through `resolveWorkspacePath()`.

- relative paths resolve against the first configured root
- absolute paths are allowed only when inside a configured root
- path traversal outside roots fails with `PATH_OUTSIDE_ROOT`
- existing symlink path segments fail with `SYMLINK_NOT_ALLOWED`
- hidden segments fail with `HIDDEN_PATH_NOT_ALLOWED` only when `allowHiddenPaths` is `false`

## Read-Only Tools

### `config`

Returns live server configuration for the current MCP process, including configured roots, raw `SCALPEL_ROOTS` when present, path delimiter, current working directory, policy limits, durability mode, transaction directory, and journal settings.

### `stat`

Returns file or directory metadata. Files up to `config.maxReadBytes` include the `sha256` of their bytes whatever their content; larger files include it only when they are valid UTF-8; directories never do. `textKind` is `utf8`, `binary`, `non_utf8`, or `unknown`.

### `read`

Reads full UTF-8 file content or an inclusive 1-based line range. Full reads enforce `config.maxReadBytes`; oversized files fail with `FILE_TOO_LARGE` and suggest `read_chunk`. Ranged reads stream line content and can return bounded line slices from oversized UTF-8 files; the returned range itself must fit in `config.maxReadBytes` or the read fails with `FILE_TOO_LARGE`. A range that starts after the last line fails with `INVALID_LINE_RANGE`. A UTF-8 BOM is returned as `U+FEFF` at the start of line 1 by full and ranged reads (and by `read_chunk` at offset 0) alike.

Empty file contract:

```json
{
  "content": "",
  "lines": 0,
  "range": { "start_line": 1, "end_line": 0 }
}
```

Binary files fail with `BINARY_FILE_NOT_SUPPORTED`. Invalid UTF-8 fails with `UNSUPPORTED_ENCODING`.

### `read_chunk`

Reads a bounded UTF-8-safe byte chunk.

- input: `path`, optional `offset_bytes`, optional `max_bytes`
- `max_bytes` is capped by `config.maxReadBytes`
- trims split UTF-8 boundaries instead of returning invalid text
- returns `offset_bytes`, `start_offset_bytes`, `next_offset_bytes`, `size_bytes`, and `truncated`
- returns `sha256` (of the file's bytes) when the whole file is small enough to hash through the read limit
- binary files fail with `BINARY_FILE_NOT_SUPPORTED`
- missing paths fail with `FILE_NOT_FOUND`; directories fail with `INVALID_INPUT`

### `list_dir`

Lists direct children only. It does not recurse.

- entries come from `lstat()` only: file contents are never read, so binary and oversized files are listed like any other
- symlinks and junctions are reported with `isSymlink: true` (and `isDirectory: false`) and are not followed
- hidden children are omitted when `allowHiddenPaths` is `false`
- a file path fails with `INVALID_INPUT`

### `grep`

Recursively searches files under a path.

- literal search by default
- regex search when `regex: true`
- optional `include_globs` and `exclude_globs` filters against slash-normalized relative paths
- optional `before_context` and `after_context` line arrays on each match
- `has_more` is true when the result limit was reached before traversal finished
- invalid regex fails with `INVALID_PATTERN`
- files larger than `config.maxReadBytes` are reported in `skipped_files` as `too_large`
- binary, invalid UTF-8, and unreadable files (and unreadable directories) are reported in `skipped_files`
- symlinks and junctions are never followed, because their targets can lie outside the configured roots; they are reported in `skipped_files` with reason `symlink` unless an exclude glob matches them
- FIFOs, sockets, and device files are skipped
- a missing search path fails with `FILE_NOT_FOUND`
- line 1 of a file with a UTF-8 BOM is matched and returned without the BOM, so `^pattern` works there
- no streaming or parallel traversal yet

### `diff`

Computes a unified diff between current file content and `proposed_content`.

`diff` enforces `config.maxReadBytes` for the current file and fails clearly for binary, invalid UTF-8, or oversized files. It applies the same hidden-path policy as every other tool. `lines_added` and `lines_removed` count the changed lines inside the diff hunks.

## Namespaced Aliases

Every public tool is also registered as `scalpel_<tool>`, for example `scalpel_read` and `scalpel_patch`. Aliases call the same implementation and exist only to reduce ambiguity in multi-MCP clients.

## Operation Journal

When `journalEnabled` is true, mutating tools append JSONL operation records. Records include timestamp, tool, paths, dry-run/applied status, error code when logged, and before/after hash/mtime/size metadata where available. Journal records never include file content. Journal write failures do not fail the mutation; successful tool results include `warnings` when journal writing fails. A journal path that is a symlink is never appended to (`JOURNAL_WRITE_FAILED: journal path is a symlink`).

## Write Transactions

Text-write mutators and `move` use metadata-only transaction records in
`config.transactionDir`. Records include paths, intended output hash/size for
text writes, state (`started`, `temp_written`, `renamed`), and timestamp, but
never file content.

Startup recovery runs before the MCP server accepts calls and classifies every
scanned record into one of three terminal decisions:

- `committed`: the target file's actual content matches the transaction's
  intended hash/size, regardless of which state was last persisted. The record
  is removed.
- `aborted`: the rename never completed and the target still holds its prior
  content (or, for `move`, the source still exists and the destination does
  not). Any leftover temp file is removed. The record is removed.
- `unrecoverable`: the on-disk evidence contradicts the record (for example a
  record marked `renamed` whose target content does not match, or a move where
  both source and destination exist, or neither does), or the record itself is
  corrupted and cannot be parsed. The record is moved into
  `config.transactionDir/quarantine` instead of being retried on every
  startup, and a `TRANSACTION_RECOVERY_UNRECOVERABLE` warning is logged.
  Quarantined records require manual inspection; recovery never guesses at an
  unknown partial state.

The default transaction directory lives inside the workspace, so recovery does
not trust record contents: it only deletes temp files named `.scalpel-*.tmp`
that sit in the same directory as the record's target, and quarantines a record
naming any other temp path without touching that path. A transaction directory
that is a symlink, a junction, or not a directory is not scanned at all
(`TRANSACTION_RECOVERY_SKIPPED`). A write or move that fails before its rename
removes its own record, since nothing on disk changed.

Recovery never writes file content into transaction records, warnings, or logs.
The startup recovery summary (`scanned`, `committed`, `aborted`,
`unrecoverable`, `cleanedTemps`, `quarantined`, `warnings`) is logged to stderr
via the configured `logLevel`; recovery runs with `unrecoverable` results or
warnings are always logged regardless of `logLevel`.

## MCP Resources

The server exposes read-only resources for agent context:

- `scalpel://docs/safety`
- `scalpel://docs/tool-contracts`
- `scalpel://docs/testing`
- `scalpel://config/current`

Resources are informational only and do not mutate workspace files.

## Mutating Tools

Most full-text mutators reject oversized, binary, or invalid UTF-8 existing files before mutation. Oversized unsupported files fail with `FILE_TOO_LARGE`; binary and non-UTF-8 files fail with explicit encoding errors. `patch`, `append`, and `prepend` support streaming paths for oversized existing UTF-8 files and omit unified diff output for those paths. `batch_edit`, `insert`, `delete_range`, and `replace_between_markers` still require the full file to fit within `maxReadBytes`.

Shared write behavior:

- an existing target must be writable by the Scalpel process; read-only files fail with `PERMISSION_DENIED` instead of being replaced through the directory
- the target's identity (device, inode, size, mtime) and its parent directory's identity are checked again immediately before the rename (and before every Windows retry), so a file that another process modifies or replaces while the replacement is being written (which can take seconds on the streaming paths), or a parent directory swapped for a symlink or junction, fails with `CONCURRENCY_CONFLICT` instead of losing that change or writing outside the roots
- replacing a file keeps its permission bits (for example the executable bit) on POSIX; if that `chmod` is refused the write still succeeds with a `FILE_MODE_NOT_PRESERVED` warning
- on Windows, a rename blocked because another process holds the target open (antivirus, the search indexer, backup or sync clients, editors) is retried with a short backoff for up to `SCALPEL_RENAME_RETRY_MS` (default `5000`) before failing
- a UTF-8 BOM stays at offset 0: `insert` and `prepend` add text after it, `delete_range` keeps it, and the streaming paths preserve it

### `create`

Creates a file with exact UTF-8 content.

- creates parent directories
- fails with `FILE_EXISTS` unless `overwrite: true`
- supports `dry_run`
- supports `expected_sha256` and `expected_mtime_ms` when overwriting an existing file
- fails if expectations are supplied for a missing file
- writes through `writeFileAtomic()`

### `patch`

Exact string replacement in one file.

- default `occurrence` is `"unique"`
- supports `"unique"`, `"first"`, `"all"`, or positive occurrence number
- supports `dry_run`
- supports `expected_sha256` and `expected_mtime_ms`
- streams oversized existing UTF-8 files without loading full content into memory, including matches that span read-chunk boundaries
- omits `diff` for the oversized streaming path
- ambiguity rejection (`STRING_NOT_UNIQUE`) still applies on the streaming path

### `batch_edit`

Applies multiple exact replacements to one file.

- validates each edit against one evolving in-memory buffer
- writes once after every edit validates
- failed validation returns `ATOMIC_FAILURE`
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`
- does not edit multiple files in one call

### `insert`

Inserts content before a line, after a marker, or before a marker.

- exactly one insertion mode is allowed
- marker match must be unique
- content is normalized into full inserted lines using file EOL
- inserting after a final line that has no line ending first terminates that line with the file EOL
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`

### `delete_range`

Deletes either an inclusive line range or a marker-bounded block.

- marker-bounded deletion includes marker lines
- marker matches must be unique
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`

### `replace_between_markers`

Replaces content between two marker lines while preserving the marker lines.

- both marker matches must be unique
- start marker must appear before end marker
- `new_content` must not contain either marker string
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`

### `append`

Appends content to a file.

- creates missing file
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`
- fails if expectations are supplied for a missing file
- rewrites existing files through atomic replacement
- streams oversized existing UTF-8 files without loading full content into memory
- omits `diff` for the oversized streaming path

### `prepend`

Prepends content to a file.

- creates missing file
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`
- fails if expectations are supplied for a missing file
- rewrites existing files through atomic replacement
- streams oversized existing UTF-8 files without loading full content into memory
- omits `diff` for the oversized streaming path

### `move`

Moves or renames a file or directory.

- source and destination must both resolve inside configured roots
- creates destination parent directories
- fails if source is missing
- fails if destination exists unless `overwrite: true`
- supports `dry_run`
- supports source preconditions with `expected_source_sha256` and `expected_source_mtime_ms`
- supports destination overwrite preconditions with `expected_destination_sha256` and `expected_destination_mtime_ms`
- rejects SHA preconditions for directories with `INVALID_INPUT`
- uses Node `rename()`, with the same Windows lock retry as text writes
- moving a directory into its own subtree fails with `INVALID_INPUT` before anything is created
- revalidates source, destination, and the destination parent directory immediately before the rename; external replacement of any of them fails with `CONCURRENCY_CONFLICT` instead of silently overwriting or renaming into a replaced parent
- a failed `rename()` itself (for example a parent directory that changed type between the revalidation check and the syscall) also fails with `CONCURRENCY_CONFLICT` instead of an unstructured error; a rename the OS refuses with `EACCES`/`EPERM` (permissions, or a file still held open on Windows after the retries) fails with `PERMISSION_DENIED`, and `details.cause_code` carries the OS code
- cross-device or cross-filesystem moves are detected via the OS `EXDEV` error and rejected with `CROSS_DEVICE_MOVE_NOT_SUPPORTED` before any partial copy is attempted; Scalpel does not implement a copy/delete fallback

## Locking

Every mutating tool serializes on its target path(s) through an in-process lock and a cooperative cross-process file lock. Waiting longer than `SCALPEL_LOCK_TIMEOUT_MS` (default `30000`) for a lock held by another live process fails with `LOCK_TIMEOUT` instead of an unstructured error or an indefinite hang. Locks held by a dead process are recovered automatically after `SCALPEL_LOCK_STALE_MS` (default `300000`). On Windows and macOS, whose filesystems are case-insensitive by default, lock keys are case-folded so paths that differ only by case share one lock.
