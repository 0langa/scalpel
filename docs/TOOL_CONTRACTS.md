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

## Shared Path Rules

All public tools resolve paths through `resolveWorkspacePath()`.

- relative paths resolve against the first configured root
- absolute paths are allowed only when inside a configured root
- path traversal outside roots fails with `PATH_OUTSIDE_ROOT`
- existing symlink path segments fail with `SYMLINK_NOT_ALLOWED`
- hidden segments fail with `HIDDEN_PATH_NOT_ALLOWED` only when `allowHiddenPaths` is `false`

## Read-Only Tools

### `config`

Returns live server configuration for the current MCP process, including configured roots, raw `SCALPEL_ROOTS` when present, path delimiter, current working directory, policy limits, and journal settings.

### `stat`

Returns file or directory metadata. Files include `sha256` when small enough to hash through the text path; directories do not. `textKind` is `utf8`, `binary`, `non_utf8`, or `unknown`.

### `read`

Reads full UTF-8 file content or an inclusive 1-based line range. Full reads enforce `config.maxReadBytes`; oversized files fail with `FILE_TOO_LARGE` and suggest `read_chunk`. Ranged reads stream line content and can return bounded line slices from oversized UTF-8 files.

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
- returns `sha256` when the whole file is small enough to hash through the read limit
- binary files fail with `BINARY_FILE_NOT_SUPPORTED`

### `list_dir`

Lists direct children only. It does not recurse.

### `grep`

Recursively searches files under a path.

- literal search by default
- regex search when `regex: true`
- invalid regex fails with `INVALID_PATTERN`
- files larger than `config.maxReadBytes` are reported in `skipped_files` as `too_large`
- binary, invalid UTF-8, and unreadable files are reported in `skipped_files`
- no context-line support yet
- no streaming or parallel traversal yet

### `diff`

Computes a unified diff between current file content and `proposed_content`.

`diff` enforces `config.maxReadBytes` for the current file and fails clearly for binary, invalid UTF-8, or oversized files.

## Namespaced Aliases

Every public tool is also registered as `scalpel_<tool>`, for example `scalpel_read` and `scalpel_patch`. Aliases call the same implementation and exist only to reduce ambiguity in multi-MCP clients.

## Operation Journal

When `journalEnabled` is true, mutating tools append JSONL operation records. Records include timestamp, tool, paths, dry-run/applied status, error code when logged, and before/after hash/mtime/size metadata where available. Journal records never include file content. Journal write failures do not fail the mutation; successful tool results include `warnings` when journal writing fails.

## Mutating Tools

All full-text mutators reject oversized, binary, or invalid UTF-8 existing files before mutation. Oversized files fail with `FILE_TOO_LARGE`; binary and non-UTF-8 files fail with explicit encoding errors.

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

### `prepend`

Prepends content to a file.

- creates missing file
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`
- fails if expectations are supplied for a missing file
- rewrites existing files through atomic replacement

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
- uses Node `rename()`
