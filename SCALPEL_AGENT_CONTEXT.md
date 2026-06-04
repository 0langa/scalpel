# Scalpel Agent Context

Purpose: compressed context for coding agents.

## Current Code

Scalpel is currently a TypeScript MCP server over stdio.

Entrypoints:

- `src/index.ts`: bootstrap, `SCALPEL_ROOTS`, stdio transport
- `src/mcp/register-tools.ts`: current MCP tools and schemas
- `src/mcp/result.ts`: MCP success/failure adaptation
- `src/tools/*`: tool handlers
- `src/core/*`: shared config, path policy, metadata, text, diff, mutation, atomic write

Current tools:

- read-only: `stat`, `read`, `list_dir`, `grep`, `diff`
- mutating: `create`, `patch`, `batch_edit`, `insert`, `delete_range`, `replace_between_markers`, `append`, `prepend`, `move`

Current limitations:

- no Rust core yet
- no CLI yet
- no journal/undo/recovery yet
- no plan/apply tokens yet
- no persistent index yet
- no streaming huge-file edit yet
- no parser-aware edit yet
- failure `structuredContent` is currently absent
- `pnpm lint` currently fails until fixture lint scope is fixed

## Target Product

Apache-2.0 Rust-core local operations engine with MCP and CLI surfaces.

Default mode: workspace scoped.

Explicit opt-in mode: volume/filesystem operations for cataloging, dedupe, bulk moves, archive inspection, and large transformations.

## Non-Negotiable Invariants

- no mutation outside resolved root scope
- destructive or large ops require prepare/apply
- apply only exact hash-bound plan
- journal entry before mutation
- supported mutations undoable until retention limit
- irreversible operations marked before apply
- stale index never drives destructive commit
- secrets redacted by default
- parser edits preserve formatting unless formatter requested
- no symlink/archive path escape
- no partial write reported as success

## Target Architecture

Rust crates:

- `scalpel-core`: errors, root descriptors, risk, manifests
- `scalpel-fs`: path policy, traversal, metadata, streaming, atomic writes
- `scalpel-plan`: prepare/apply, risk, validation
- `scalpel-journal`: journal, snapshots, undo, recovery
- `scalpel-index`: SQLite WAL index, stale handling, queries
- `scalpel-parse`: Tree-sitter and structured edits
- `scalpel-policy`: static config and hooks
- `scalpel-secrets`: detection and redaction
- `scalpel-watch`: daemon and watcher
- `scalpel-cli`: human control plane

Surfaces:

- CLI: `scalpel index`, `scan`, `plan`, `apply`, `undo`, `journal`, `doctor`, `mcp`, `daemon`
- MCP: many narrow tools plus orchestration tools like `index_workspace`, `prepare_operation`, `apply_operation`, `semantic_patch`, `recover_operation`

## Workspace State

Default:

```text
.scalpel/
  config.toml
  journal/
  plans/
  snapshots/
  index/
  locks/
  tmp/
```

Retention defaults:

- 30 days
- 20 GB
- 200 operations

## Build Order

1. Fix current docs and lint truth.
2. Add structured MCP failures.
3. Normalize current mutator dry-run/precondition behavior.
4. Add Rust workspace.
5. Add safe Rust filesystem layer.
6. Add plan/apply, journal, snapshot, undo.
7. Add CLI control plane.
8. Port current tools to Rust and bridge MCP.
9. Add persistent index.
10. Add secrets redaction.
11. Add parser-aware edits.
12. Add policy engine and infrastructure validation.
13. Add volume mode, bulk ops, archive safety, huge-file streaming.
14. Add daemon/watcher.
15. Package and release.

## Verification Commands

Current TypeScript:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Rust target:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
```

Known current issue:

```bash
pnpm lint
```

fails because ESLint scans TypeScript fixture files outside `tsconfig.json`.

## Docs

- `SCALPEL_MASTER_HANDBOOK.md`: public product reference
- `DEVELOPER_ROADMAP.md`: execution roadmap
- `docs/CURRENT_STATE.md`: current implementation truth
- `docs/TOOL_CONTRACTS.md`: current tool contracts
- `docs/SAFETY_MODEL.md`: current and target safety notes
- `docs/AUDIT.md`: current audit

