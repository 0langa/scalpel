# Scalpel

Precise, atomic file editing for code and text over MCP.

## Status

Working TypeScript MCP server with a tested `stdio` transport, 14 tools, structured MCP failures, optimistic concurrency for existing-file mutations, and workspace-confined path policy.

## Implemented Tools

- `stat`
- `read`
- `list_dir`
- `grep`
- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `prepend`
- `diff`
- `move`

## Run

Install dependencies:

```bash
pnpm install
```

Start the stdio server:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Verify:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Runtime Behavior

- Workspace access is confined to configured roots.
- If `SCALPEL_ROOTS` is unset, Scalpel defaults to the current working directory it was started in.
- Existing symlinks in the traversed path are rejected.
- Hidden paths are blocked when `allowHiddenPaths` is disabled.
- Mutating tools return unified diffs for `dry_run` previews.
- MCP failures are returned with `isError: true` and structured error payloads.

## Edit Semantics

- `patch` and `batch_edit` default to `occurrence: "unique"` and fail on ambiguity.
- `insert` is line-oriented. If inserted content lacks a trailing newline, Scalpel normalizes it to the file's native EOL before splicing.
- `replace_between_markers` preserves the original marker lines exactly once and rejects `new_content` that repeats either marker.
- `read` succeeds on empty files and returns `content: ""`, `lines: 0`, and `range: { start_line: 1, end_line: 0 }`.
- Existing-file mutations support `expected_sha256` and, for most mutators, optional `expected_mtime_ms`.

## Configuration

`SCALPEL_ROOTS`

- Optional
- Path-delimited list of allowed workspace roots
- Defaults to the current working directory when unset

Example:

```bash
SCALPEL_ROOTS=/repo pnpm dev
```

## Docs

- [SPEC.md](./SPEC.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/STACK.md](./docs/STACK.md)
- [docs/KIMI_TEST_PROMPT.md](./docs/KIMI_TEST_PROMPT.md)

## Kimi Code

An example project-local Kimi MCP config lives at [.kimi-code/mcp.json](./.kimi-code/mcp.json).

```json
{
  "mcpServers": {
    "scalpel": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

This relies on Kimi starting the subprocess in the workspace root. Because `SCALPEL_ROOTS` is optional in Scalpel, the server will confine itself to that working directory when the variable is not set.
