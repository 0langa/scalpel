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
- does not currently return failure `structuredContent`

## Shared Path Rules

All public tools resolve paths through `resolveWorkspacePath()`.

- relative paths resolve against the first configured root
- absolute paths are allowed only when inside a configured root
- path traversal outside roots fails with `PATH_OUTSIDE_ROOT`
- existing symlink path segments fail with `SYMLINK_NOT_ALLOWED`
- hidden segments fail with `HIDDEN_PATH_NOT_ALLOWED` only when `allowHiddenPaths` is `false`

## Read-Only Tools

### `stat`

Returns file or directory metadata. Files include `sha256`; directories do not.

### `read`

Reads full UTF-8 file content or an inclusive 1-based line range.

Empty file contract:

```json
{
  "content": "",
  "lines": 0,
  "range": { "start_line": 1, "end_line": 0 }
}
```

Current limit note: `read` does not enforce `config.maxReadBytes`; it loads the full file into memory.

### `list_dir`

Lists direct children only. It does not recurse.

### `grep`

Recursively searches files under a path.

- literal search by default
- regex search when `regex: true`
- invalid regex fails with `INVALID_PATTERN`
- files larger than `config.maxReadBytes` are skipped
- unreadable or binary-like files are skipped best-effort
- no context-line support yet
- no streaming or parallel traversal yet

### `diff`

Computes a unified diff between current file content and `proposed_content`.

Current limit note: `diff` reads the full current file and proposed content into memory.

## Mutating Tools

### `create`

Creates a file with exact UTF-8 content.

- creates parent directories
- fails with `FILE_EXISTS` unless `overwrite: true`
- writes through `writeFileAtomic()`

### `patch`

Exact string replacement in one file.

- default `occurrence` is `"unique"`
- supports `"unique"`, `"first"`, `"all"`, or positive occurrence number
- supports `dry_run`
- supports `expected_sha256`
- does not currently support `expected_mtime_ms`

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
- supports `expected_sha256` and `expected_mtime_ms` only for existing files
- rewrites existing files through atomic replacement

### `prepend`

Prepends content to a file.

- creates missing file
- supports `expected_sha256` and `expected_mtime_ms` only for existing files
- rewrites existing files through atomic replacement

### `move`

Moves or renames a file or directory.

- source and destination must both resolve inside configured roots
- creates destination parent directories
- fails if source is missing
- fails if destination exists unless `overwrite: true`
- uses Node `rename()`

