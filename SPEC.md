# Scalpel MCP Server Specification

> Precise, atomic file editing for code and text.
> Transport: stdio  
> Protocol: MCP (Model Context Protocol)

---

## Design Principles

1. **Fail loud, never guess** — Every tool validates before mutating. If an exact string isn't found, the operation fails with a clear error, not a silent no-op.
2. **Atomic by default** — `batch_edit` applies all changes or none. Single-patch tools mutate one file at a time.
3. **Line-oriented** — All range and position operations use line numbers or exact string markers, never byte offsets.
4. **Structured I/O only** — Inputs and outputs are JSON. No prose summaries, no human-readable tables.
5. **Diff-first safety** — Every mutating tool supports `dry_run`. Preview first, commit second.

---

## Error Schema

Every tool returns either a success object or an error object with this shape:

```json
{
  "success": false,
  "error": {
    "code": "STRING_NOT_FOUND",
    "message": "old_string 'def foo()' not found in /repo/src/main.py",
    "path": "/repo/src/main.py",
    "details": {}
  }
}
```

Common error codes:
- `FILE_NOT_FOUND` — Path does not exist
- `FILE_EXISTS` — `create` called with `overwrite: false` on existing file
- `STRING_NOT_FOUND` — `old_string` not found (patch, batch_edit)
- `STRING_NOT_UNIQUE` — `old_string` found more than once when `occurrence` requires uniqueness
- `MARKER_NOT_FOUND` — Start or end marker missing (replace_between_markers, delete_range)
- `INVALID_LINE_RANGE` — Line number out of bounds (insert, delete_range, read_range)
- `ATOMIC_FAILURE` — One edit in batch_edit failed validation; nothing was applied
- `PERMISSION_DENIED` — Cannot read/write path

---

## Tool Specifications

---

### 1. `read`

Read file content. Optionally return only a line range.

**When to use:** Inspect a file before editing, or read a specific section of a large file without loading it all into context.

**Behavior:**
- Returns full file content by default.
- If `start_line` and/or `end_line` are provided, returns only that inclusive range (1-indexed).
- Returns line count and file size even for ranged reads.
- Fails with `FILE_NOT_FOUND` if path does not exist.

**Input Schema:**
```json
{
  "path": "string",
  "start_line": "number?",
  "end_line": "number?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "content": "string",
  "lines": "number",
  "size_bytes": "number",
  "range": {
    "start_line": "number",
    "end_line": "number"
  }
}
```

**Example:**
```json
{"path": "/repo/src/main.py", "start_line": 45, "end_line": 80}
```

---

### 2. `create`

Create a new file with the given content.

**When to use:** Scaffold new files. Never use this when you intend to edit an existing file — use `patch` or `batch_edit` instead.

**Behavior:**
- Creates parent directories automatically if they don't exist.
- Fails with `FILE_EXISTS` if the file already exists and `overwrite` is `false` (default).
- Returns the absolute path of the created file.

**Input Schema:**
```json
{
  "path": "string",
  "content": "string",
  "overwrite": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "lines": "number",
  "size_bytes": "number"
}
```

**Example:**
```json
{"path": "/repo/src/new_module.py", "content": "def hello():\n    pass\n"}
```

---

### 3. `patch`

Replace an exact string with another exact string.

**When to use:** 80% of all file edits. Single targeted replacements.

**Behavior:**
- `old_string` must match exactly, including whitespace and line breaks.
- `occurrence` controls which match to replace:
  - `"first"` (default) — replace the first occurrence only. Fails if not found.
  - `"all"` — replace every occurrence.
  - `number` (e.g., `3`) — replace the Nth occurrence (1-indexed). Fails if fewer than N occurrences exist.
- Supports `dry_run`: returns the diff without writing.

**Input Schema:**
```json
{
  "path": "string",
  "old_string": "string",
  "new_string": "string",
  "occurrence": "string | number?",
  "dry_run": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "replacements": "number",
  "diff": "string",
  "applied": "boolean"
}
```

**Example:**
```json
{
  "path": "/repo/src/main.py",
  "old_string": "def launch_prompt(",
  "new_string": "def launch_prompt_v2("
}
```

---

### 4. `batch_edit`

Apply multiple patches to one file atomically.

**When to use:** Refactoring a single file with multiple related changes. If any individual patch is invalid, the entire batch is rejected and the file is left untouched.

**Behavior:**
- Validates every `old_string` in the edits array against the current file content before applying any change.
- If validation passes, applies all edits in order.
- Each edit in the array supports its own `occurrence` setting.
- Supports `dry_run`: returns the combined diff without writing.
- Fails with `ATOMIC_FAILURE` if any edit fails validation. The `details` field lists which edit index failed and why.

**Input Schema:**
```json
{
  "path": "string",
  "edits": [
    {
      "old_string": "string",
      "new_string": "string",
      "occurrence": "string | number?"
    }
  ],
  "dry_run": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "edit_count": "number",
  "replacements_total": "number",
  "diff": "string",
  "applied": "boolean"
}
```

**Example:**
```json
{
  "path": "/repo/src/launcher.py",
  "edits": [
    {"old_string": "def launch_prompt(", "new_string": "def launch_prompt_v2("},
    {"old_string": "output_format: str = \"stream-json\"", "new_string": "output_format: str = \"stream-json\",\n    dry_run: bool = False"}
  ]
}
```

---

### 5. `insert`

Insert content at a specific position.

**When to use:** Add a new function, import, or config entry without replacing existing text.

**Behavior:**
- Exactly one of `line`, `after_marker`, or `before_marker` must be provided.
- `line` (1-indexed): Insert *before* the given line number. Use `line: 1` to prepend, or `line: N+1` (where N is total lines) to append.
- `after_marker`: Find the exact marker string, insert *after* the line containing it.
- `before_marker`: Find the exact marker string, insert *before* the line containing it.
- If marker is not found, fails with `MARKER_NOT_FOUND`.
- If `line` is out of bounds (e.g., `line: 0` or `line > lines + 1`), fails with `INVALID_LINE_RANGE`.
- Supports `dry_run`.

**Input Schema:**
```json
{
  "path": "string",
  "content": "string",
  "line": "number?",
  "after_marker": "string?",
  "before_marker": "string?",
  "dry_run": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "inserted_at_line": "number",
  "diff": "string",
  "applied": "boolean"
}
```

**Example:**
```json
{
  "path": "/repo/src/main.py",
  "content": "import os\n",
  "after_marker": "import sys"
}
```

---

### 6. `delete_range`

Delete content by line range or between markers.

**When to use:** Remove dead code, deprecated sections, or boilerplate blocks.

**Behavior:**
- Exactly one of `start_line`+`end_line` or `start_marker`+`end_marker` must be provided.
- Line range: Deletes lines `start_line` through `end_line` inclusive (1-indexed).
- Marker range: Deletes everything from the line containing `start_marker` through the line containing `end_marker`, inclusive.
- If markers are not found, fails with `MARKER_NOT_FOUND`.
- If line range is invalid, fails with `INVALID_LINE_RANGE`.
- Supports `dry_run`.

**Input Schema:**
```json
{
  "path": "string",
  "start_line": "number?",
  "end_line": "number?",
  "start_marker": "string?",
  "end_marker": "string?",
  "dry_run": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "deleted_lines": "number",
  "diff": "string",
  "applied": "boolean"
}
```

**Example:**
```json
{
  "path": "/repo/src/main.py",
  "start_marker": "// BEGIN DEPRECATED",
  "end_marker": "// END DEPRECATED"
}
```

---

### 7. `replace_between_markers`

Replace everything between two markers while keeping the markers themselves.

**When to use:** Update a config block, a function body, or a generated section that is bounded by known sentinel strings.

**Behavior:**
- Finds `start_marker` and `end_marker` in the file.
- Replaces all content between them (exclusive of the markers) with `new_content`.
- If either marker is missing, fails with `MARKER_NOT_FOUND`.
- If markers appear multiple times, uses the first pair (start_marker at position N, end_marker at position > N).
- Supports `dry_run`.

**Input Schema:**
```json
{
  "path": "string",
  "start_marker": "string",
  "end_marker": "string",
  "new_content": "string",
  "dry_run": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "replaced_lines": "number",
  "diff": "string",
  "applied": "boolean"
}
```

**Example:**
```json
{
  "path": "/repo/.kicola/config.toml",
  "start_marker": "[[hooks]]",
  "end_marker": "# END HOOKS",
  "new_content": "event = \"SessionStart\"\nmatcher = \".*\"\n"
}
```

---

### 8. `append`

Append content to the end of a file.

**When to use:** Log entries, generated output, adding items to the end of a list. This is the preferred tool for append-only files like activity logs.

**Behavior:**
- Opens the file, seeks to EOF, writes content.
- Does **not** read existing content into memory. O(1) relative to file size.
- Creates the file (and parent directories) if it does not exist.
- Does not add an automatic newline; include `\n` in `content` if you want one.

**Input Schema:**
```json
{
  "path": "string",
  "content": "string"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "lines_added": "number",
  "new_total_lines": "number"
}
```

**Example:**
```json
{"path": "/repo/docs/agent_activity_log.md", "content": "\n## 2026-06-03 12:00 - Deploy complete\n- Deployed v1.2.3 to production\n"}
```

---

### 9. `prepend`

Prepend content to the beginning of a file.

**When to use:** Add a shebang, license header, or insert an import at the top of a file.

**Behavior:**
- Reads the entire file, prepends content, writes back. O(n) in file size.
- Creates the file (and parent directories) if it does not exist.

**Input Schema:**
```json
{
  "path": "string",
  "content": "string"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "lines_added": "number",
  "new_total_lines": "number"
}
```

**Example:**
```json
{"path": "/repo/src/main.py", "content": "#!/usr/bin/env python3\n"}
```

---

### 10. `diff`

Preview changes without applying them.

**When to use:** Review a complex `batch_edit`, `replace_between_markers`, or any mutating operation before committing. Can also be used standalone to show the current diff between file content and proposed content.

**Behavior:**
- Computes a unified diff between the current file content and what the proposed change would produce.
- Does not modify the file.
- When used standalone, `proposed_content` is the full replacement content.
- When used as `dry_run: true` on other tools, the diff is returned automatically.

**Input Schema:**
```json
{
  "path": "string",
  "proposed_content": "string?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "path": "string",
  "diff": "string",
  "lines_added": "number",
  "lines_removed": "number"
}
```

**Example:**
```json
{"path": "/repo/src/main.py"}
```

---

### 11. `move` *(bonus — file-level operation)*

Move or rename a file or directory.

**When to use:** Refactoring — renaming modules, moving files to new directories.

**Behavior:**
- Moves `source` to `destination`.
- Creates parent directories for `destination` if they don't exist.
- Fails with `FILE_NOT_FOUND` if `source` does not exist.
- Fails with `FILE_EXISTS` if `destination` already exists and `overwrite` is `false`.

**Input Schema:**
```json
{
  "source": "string",
  "destination": "string",
  "overwrite": "boolean?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "source": "string",
  "destination": "string"
}
```

**Example:**
```json
{"source": "/repo/src/old_name.py", "destination": "/repo/src/new_name.py"}
```

---

### 12. `grep` *(bonus — search operation)*

Search for a pattern within a file or directory.

**When to use:** Find where a function is defined, locate all occurrences of a string before batch-editing, or discover files matching a pattern.

**Behavior:**
- Searches `path` (file or directory) for `pattern`.
- `pattern` is a literal string by default. If `regex: true`, it is a regex.
- Returns an array of matches with file path, line number, and matched line content.
- Respects `max_results` to avoid overwhelming context.

**Input Schema:**
```json
{
  "path": "string",
  "pattern": "string",
  "regex": "boolean?",
  "max_results": "number?"
}
```

**Output Schema:**
```json
{
  "success": true,
  "matches": [
    {
      "path": "string",
      "line": "number",
      "content": "string"
    }
  ],
  "total_matches": "number"
}
```

**Example:**
```json
{"path": "/repo/src", "pattern": "def launch_prompt", "max_results": 10}
```

---

## Diff Format

All diff fields returned by mutating tools (and `diff`) use **unified diff** format:

```
--- /repo/src/main.py
+++ /repo/src/main.py
@@ -45,7 +45,8 @@
 def old_function():
     pass
 
-def new_function():
+def new_function_v2():
+    """Updated docstring."""
     pass
```

This is machine-parseable and human-readable. I can read it to verify correctness before a non-dry-run commit.

---

## Implementation Notes for the Builder

1. **Line endings:** Detect and preserve CRLF vs LF. Do not convert unless explicitly requested.
2. **Atomic writes:** For all mutating tools, write to a temp file and rename into place. If the process crashes mid-write, the original file must remain intact.
3. **Stdio flush:** After every JSON-RPC response, flush stdout immediately. I may be waiting for the result before sending the next request.
4. **Large files:** `read` with `start_line`/`end_line` should not load the entire file into memory. Stream to the requested range.
5. **Directory creation:** `create`, `append`, and `prepend` should automatically create parent directories (`mkdir -p` behavior).
6. **No symlinks:** Fail cleanly if asked to operate on a symlink. Do not follow them.
7. **Path normalization:** Accept both `/` and `\` separators on Windows, but normalize internally and return absolute paths with the platform's native separator in responses.
