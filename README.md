# Scalpel

Precise, atomic file editing for code and text over MCP.

## Status

Working TypeScript MCP server with a tested `stdio` transport, 16 canonical tools plus `scalpel_*` aliases, MCP tool failures via `isError: true` plus `structuredContent.error`, large-file and binary guards, optional operation journaling, optimistic concurrency for mutating tools, and workspace-confined path policy.

## Implemented Tools

- `config`
- `stat`
- `read`
- `read_chunk`
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

Run the built package entry:

```bash
pnpm build
node dist/index.js
```

Codex CLI setup after building locally:

```bash
codex mcp add scalpel --env SCALPEL_ROOTS=/repo -- node /path/to/scalpel/dist/index.js
codex mcp list
```

Equivalent `config.toml` entry:

```toml
[mcp_servers.scalpel]
command = "node"
args = ["/path/to/scalpel/dist/index.js"]

[mcp_servers.scalpel.env]
SCALPEL_ROOTS = "/repo"
```

Verify:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:mcp-smoke
pnpm test:package-smoke
```

Full release validation:

```bash
pnpm validate
```

## Runtime Behavior

- Workspace access is confined to configured roots.
- If `SCALPEL_ROOTS` is unset, Scalpel defaults to the current working directory it was started in.
- `config` reports the live roots for the current MCP server process.
- Existing Codex/MCP client threads may need a server reload or new thread before newly added tool schemas appear.
- Existing symlinks in the traversed path are rejected.
- Hidden paths are blocked when `allowHiddenPaths` is disabled.
- Full-text tools reject files above `maxReadBytes` with `FILE_TOO_LARGE`; use `read_chunk` for bounded reads.
- Binary and invalid UTF-8 files fail with explicit text-tool errors.
- Mutating tools support `dry_run`; content tools return unified diffs and `move` returns a move plan.
- Operation journaling is optional and records metadata only, never file content.
- MCP failures are returned with `isError: true`, text containing the Scalpel error code, and `structuredContent.error`.
- Read-only MCP resources expose Scalpel safety, tool contract, testing, and live config context.

## Edit Semantics

- `patch` and `batch_edit` default to `occurrence: "unique"` and fail on ambiguity.
- `insert` is line-oriented. If inserted content lacks a trailing newline, Scalpel normalizes it to the file's native EOL before splicing.
- `replace_between_markers` preserves the original marker lines exactly once and rejects `new_content` that repeats either marker.
- `read` succeeds on empty files and returns `content: ""`, `lines: 0`, and `range: { start_line: 1, end_line: 0 }`.
- Mutating tools support hash and mtime preconditions where the target path exists; missing-file creation rejects supplied expectations.

## Configuration

`SCALPEL_ROOTS`

- Optional
- Path-delimited list of allowed workspace roots
- Defaults to the current working directory when unset

Example:

```bash
SCALPEL_ROOTS=/repo pnpm dev
```

`SCALPEL_JOURNAL_ENABLED`

- Optional
- Enable with `true` or `1`
- Default: disabled

`SCALPEL_JOURNAL_PATH`

- Optional JSONL journal path
- Defaults to `.scalpel-journal.jsonl` under the first root when journaling is enabled

`SCALPEL_DURABILITY`

- Optional
- Set to `strict` to flush temp-file content before rename and attempt parent-directory flush
- Default: best-effort atomic rename without explicit durability flush
- Parent-directory flush support is platform-dependent; unsupported flushes are reported as warnings

## Docs

- [SCALPEL_MASTER_HANDBOOK.md](./SCALPEL_MASTER_HANDBOOK.md)
- [SCALPEL_MASTER_HANDBOOK.pdf](./SCALPEL_MASTER_HANDBOOK.pdf)
- [DEVELOPER_ROADMAP.md](./DEVELOPER_ROADMAP.md)
- [DEVELOPER_ROADMAP.html](./DEVELOPER_ROADMAP.html)
- [SCALPEL_AGENT_CONTEXT.md](./SCALPEL_AGENT_CONTEXT.md)
- [SPEC.md](./SPEC.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/CURRENT_STATE.md](./docs/CURRENT_STATE.md)
- [docs/TOOL_CONTRACTS.md](./docs/TOOL_CONTRACTS.md)
- [docs/SAFETY_MODEL.md](./docs/SAFETY_MODEL.md)
- [docs/TESTING_AND_RELIABILITY.md](./docs/TESTING_AND_RELIABILITY.md)
- [docs/AUDIT.md](./docs/AUDIT.md)
- [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md)
- [docs/HARDENING.md](./docs/HARDENING.md)
- [docs/STACK.md](./docs/STACK.md)
- [evals/README.md](./evals/README.md)
