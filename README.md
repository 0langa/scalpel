# Scalpel

[![CI](https://github.com/0langa/scalpel/actions/workflows/ci.yml/badge.svg)](https://github.com/0langa/scalpel/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0langa/scalpel)](https://github.com/0langa/scalpel/releases/latest)

Precise, atomic file editing for code and text over MCP.

## Status

`1.0.0` stable. Expanded hardening (public-corpus stress, race/interference coverage, and the killed-process fault matrix) passes on Windows and on Linux. Streaming mutation for oversized `patch`/`append`/`prepend` targets, an explicit transaction recovery state machine, and commit-time revalidation for `move` are all implemented and proven.

See [the release notes](./docs/releases/2026-07-03-v1.0.0.md) for the full safety claim, evidence summary, supported platforms, unsupported cases, and migration notes from the alpha.

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

Install from the GitHub release tarball:

```bash
npm install https://github.com/0langa/scalpel/releases/download/v1.0.0/scalpel-1.0.0.tgz
node node_modules/scalpel/dist/index.js
```

Scalpel is not published to the npm registry for this release; install from
the release tarball or from source.

Install dependencies for local development:

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

## Safety Model Summary

Full definitions live in [docs/SAFETY_MODEL.md](./docs/SAFETY_MODEL.md) (safety model version `scalpel-safety-model-v1`). Final release notes only use terms like "crash-safe" or "race-proof" when linked to that document and backed by hardening evidence.

- **Crash-safe**: startup recovery classifies every pending transaction as `committed`, `aborted`, or `unrecoverable` from on-disk evidence, and never silently accepts unknown partial state.
- **Race-proof**: mutations serialize on their target paths in-process and across cooperative Scalpel processes; external interference before or after commit fails closed or is reported as a conflict; `move` revalidates source, destination, and destination parent directory immediately before renaming.
- **Large-scale**: `patch`, `append`, and `prepend` stream oversized existing UTF-8 files above `maxReadBytes` with bounded memory; expanded public-corpus traversal is proven on Windows and Linux.
- **Recoverable**: transaction and recovery records are metadata-only and never contain file content.

### Known Unsupported Cases

- Malicious same-user modification after Scalpel reports success.
- Cross-device moves: detected via `EXDEV` and rejected with `CROSS_DEVICE_MOVE_NOT_SUPPORTED`; no copy/delete fallback.
- Network filesystems and sync folders with non-standard rename/fsync semantics.
- Binary byte-edit workflows and parser-aware semantic edits.
- `batch_edit`, `insert`, `delete_range`, and `replace_between_markers` still require the full file to fit within `maxReadBytes`.

## Docs

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/CURRENT_STATE.md](./docs/CURRENT_STATE.md)
- [docs/TOOL_CONTRACTS.md](./docs/TOOL_CONTRACTS.md)
- [docs/SAFETY_MODEL.md](./docs/SAFETY_MODEL.md)
- [docs/TESTING_AND_RELIABILITY.md](./docs/TESTING_AND_RELIABILITY.md)
- [docs/AUDIT.md](./docs/AUDIT.md)
- [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md)
- [docs/HARDENING.md](./docs/HARDENING.md)
- [docs/STACK.md](./docs/STACK.md)
- [docs/releases/2026-07-03-v1.0.0.md](./docs/releases/2026-07-03-v1.0.0.md)
- [docs/releases/2026-07-03-v1.0.0-audit.md](./docs/releases/2026-07-03-v1.0.0-audit.md)
- [evals/README.md](./evals/README.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [SUPPORT.md](./SUPPORT.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

Internal/project-history reference (handbook, roadmap, spec, sprint plan):

- [docs/project/SCALPEL_MASTER_HANDBOOK.md](./docs/project/SCALPEL_MASTER_HANDBOOK.md)
- [docs/project/DEVELOPER_ROADMAP.md](./docs/project/DEVELOPER_ROADMAP.md)
- [docs/project/SCALPEL_AGENT_CONTEXT.md](./docs/project/SCALPEL_AGENT_CONTEXT.md)
- [docs/project/SPEC.md](./docs/project/SPEC.md)
- [docs/project/FINAL_RELEASE_SPRINT.md](./docs/project/FINAL_RELEASE_SPRINT.md)
