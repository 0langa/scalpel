# Scalpel MCP Server Specification

> Precise, atomic file editing for code and text.  
> Transport: `stdio`  
> Protocol: MCP

---

## Design Principles

1. **Fail loud, never guess**: exact-match edits and marker-based edits reject ambiguity by default.
2. **Workspace-confined**: all paths stay within configured roots and reject symlink traversal.
3. **Line-oriented where it matters**: range, marker, and insertion operations work on line structure rather than byte offsets.
4. **Structured MCP I/O**: successful tool calls return typed data; failures return `isError: true` plus structured error payloads.
5. **Preview before write**: mutating edit tools support `dry_run` and return unified diffs.

---

## Failure Shape

Tool-level failures are surfaced through MCP with `isError: true`.

Current implementation detail:

- success results return `structuredContent`
- failure results return text content formatted as `[ERROR_CODE] message`
- failure results do not currently return `structuredContent`

Target machine-readable payload for future failure results:

```json
{
  "ok": false,
  "error": {
    "code": "STRING_NOT_UNIQUE",
    "message": "old_string matched more than once",
    "path": "C:\\repo\\src\\main.ts",
    "details": {}
  }
}
```

Common error codes:

- `FILE_NOT_FOUND`
- `FILE_EXISTS`
- `PATH_OUTSIDE_ROOT`
- `SYMLINK_NOT_ALLOWED`
- `HIDDEN_PATH_NOT_ALLOWED`
- `STRING_NOT_FOUND`
- `STRING_NOT_UNIQUE`
- `MARKER_NOT_FOUND`
- `MARKER_NOT_ALLOWED_IN_REPLACEMENT`
- `INVALID_LINE_RANGE`
- `INVALID_PATTERN`
- `ATOMIC_FAILURE`
- `CONCURRENCY_CONFLICT`

---

## Core Safety Rules

### Path policy

- Relative paths resolve against the first configured root.
- Absolute paths are allowed only if they still remain under one of the configured roots.
- Existing path segments are checked with `lstat()` and rejected if they are symlinks.
- Hidden path segments are rejected when hidden-path access is disabled.

### Atomicity

- Content-replacement mutations use temp-file write then rename through the shared atomic write path.
- `batch_edit` validates every edit against one starting snapshot and writes only if all edits succeed.
- `dry_run` never writes.
- Current atomic writes do not call `fsync()` on the temp file or parent directory, so crash durability is not yet guaranteed.

### Concurrency

Existing-file mutations can require:

- `expected_sha256`
- `expected_mtime_ms`

If the current file snapshot does not match the caller's expectation, the mutation fails with `CONCURRENCY_CONFLICT`.

---

## Tool Surface

### Read-only tools

#### `stat`

Returns metadata for a file or directory:

- `absolutePath`
- `isDirectory`
- `sizeBytes`
- `lineCount`
- `sha256` for files
- `mtimeMs`

#### `read`

Reads a whole file or an inclusive 1-based line range.

Current behavior:

- empty files succeed
- empty-file contract is:

```json
{
  "content": "",
  "lines": 0,
  "range": {
    "start_line": 1,
    "end_line": 0
  }
}
```

- returns `sha256` and detected `eol`

#### `list_dir`

Lists direct children of a directory and returns:

- `name`
- `path`
- `relativePath`
- `isDirectory`
- `sizeBytes`

#### `grep`

Searches a file tree for a literal string or regex.

Current behavior:

- recursive
- best-effort on unreadable files
- enforces `maxReadBytes` before reading files
- invalid regex patterns fail with `INVALID_PATTERN`
- returns both `path` and `relativePath`
- does not currently expose before/after context lines

### Mutating tools

#### `create`

Creates a file with exact content.

- creates parent directories automatically
- fails with `FILE_EXISTS` unless `overwrite: true`
- writes through the shared atomic file path

#### `patch`

Replaces exact string matches in one file.

Input highlights:

- `old_string`
- `new_string`
- `occurrence?: "unique" | "first" | "all" | number`
- `dry_run?`
- `expected_sha256?`

Current behavior:

- default occurrence is `"unique"`
- ambiguity fails with `STRING_NOT_UNIQUE`
- success returns the post-write `sha256`

#### `batch_edit`

Applies multiple exact replacements atomically to one file.

Input highlights:

- `edits[]` with `old_string`, `new_string`, optional `occurrence`
- `dry_run?`
- `expected_sha256?`
- `expected_mtime_ms?`

Current behavior:

- validates and applies edits in order against one in-memory buffer
- any failed edit returns `ATOMIC_FAILURE`

#### `insert`

Inserts content:

- before a given `line`
- after a unique `after_marker`
- before a unique `before_marker`

Current behavior:

- exactly one insertion mode must be provided
- marker lookups must be unique
- inserted content is normalized to line fragments using the file's EOL
- if content lacks a trailing newline, one is added before splicing

#### `delete_range`

Deletes either:

- an inclusive line range
- a unique marker-bounded block, inclusive of the marker lines

Supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`.

#### `replace_between_markers`

Replaces only the content between two unique markers.

Current behavior:

- both markers must be unique
- `start_marker` must appear before `end_marker`
- original marker lines are preserved exactly once
- `new_content` must not contain either marker string
- inserted block content is normalized to the file's EOL
- supports `dry_run`, `expected_sha256`, and `expected_mtime_ms`

#### `append`

Appends content to a file and creates the file if needed.

Current behavior:

- supports `expected_sha256` and `expected_mtime_ms` for existing files
- existing-file appends are rewritten through the atomic write path
- returns `lines_added` and `new_total_lines`

#### `prepend`

Prepends content to a file and creates the file if needed.

Current behavior:

- supports `expected_sha256` and `expected_mtime_ms`
- writes through the atomic file path

#### `diff`

Returns a unified diff between the current file content and `proposed_content`.

#### `move`

Moves or renames a file or directory within configured roots.

- creates destination parents automatically
- fails with `FILE_NOT_FOUND` or `FILE_EXISTS` as appropriate

---

## Diff Format

All diffs use unified diff format.

```diff
--- C:\repo\src\main.ts
+++ C:\repo\src\main.ts
@@
-oldValue
+newValue
```

---

## Implementation Notes

1. Preserve existing file EOL style where possible.
2. Prefer one shared path-policy layer for root confinement, hidden path checks, and symlink rejection.
3. Keep the MCP SDK boundary thin; the editing core should remain reusable outside the SDK adapter.
4. Treat success payloads and failure payloads as machine-readable first.
