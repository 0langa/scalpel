# Scalpel Developer Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this roadmap task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build Scalpel from the current TypeScript MCP MVP into an Apache-2.0 Rust-core local operations engine with CLI and MCP surfaces, token-gated destructive commits, persistent indexing, journaled recovery, parser-aware edits, and terabyte-scale performance.

**Architecture:** Stabilize the current TypeScript server as the contract baseline, then introduce a Rust workspace that becomes the source of truth for filesystem operations. The MCP and CLI surfaces must call the same engine contracts so agent behavior and human workflows stay consistent.

**Tech Stack:** Rust, TypeScript, Node.js, MCP SDK, SQLite WAL, optional RocksDB later, Tree-sitter, Vitest, cargo test, proptest, criterion, cross-platform CI, local reliability fixtures.

---

## 1. Ground Rules

This roadmap is execution guidance, not marketing copy.

Use the current code as truth for what exists today:

- `src/index.ts`
- `src/mcp/*`
- `src/tools/*`
- `src/core/*`
- `tests/*`
- `scalpel-reliability-suite/*`

Do not document future capabilities as shipped behavior. Every phase below has acceptance criteria.

## 2. Current Repository Map

Current files:

| Path | Current responsibility |
| --- | --- |
| `src/index.ts` | Node process bootstrap and `stdio` transport |
| `src/mcp/server.ts` | MCP server creation |
| `src/mcp/register-tools.ts` | Tool schemas and SDK registration |
| `src/mcp/result.ts` | MCP success/failure adaptation |
| `src/core/config.ts` | Runtime defaults |
| `src/core/path-policy.ts` | Root confinement, hidden path, symlink traversal policy |
| `src/core/file-metadata.ts` | File stat, content snapshot, SHA-256 |
| `src/core/mutation.ts` | Optimistic mutation precondition helper |
| `src/core/write-file-atomic.ts` | Temp-file plus rename write helper |
| `src/core/text.ts` | Exact replacement and line helpers |
| `src/core/diff.ts` | Unified diff helper |
| `src/tools/*` | One handler per current MCP tool |
| `tests/unit/*` | Core and tool tests |
| `tests/integration/stdio-server.test.ts` | Real MCP stdio test |
| `scalpel-reliability-suite/*` | Manual fixtures and future benchmark seed |

Near-term target files:

| Path | Responsibility |
| --- | --- |
| `LICENSE` | Apache-2.0 license |
| `scalpel.toml` | Example project config |
| `.scalpel/config.toml` | Local internal workspace config sample, not committed by default |
| `crates/scalpel-core/` | Shared domain types, errors, paths, risk, manifests |
| `crates/scalpel-fs/` | Filesystem primitives, streaming IO, atomic writes, safe traversal |
| `crates/scalpel-plan/` | Prepare/apply manifests and risk planning |
| `crates/scalpel-journal/` | Journal, snapshots, undo, recovery |
| `crates/scalpel-index/` | SQLite-backed metadata and search index |
| `crates/scalpel-parse/` | Tree-sitter and structured edit helpers |
| `crates/scalpel-policy/` | Static policy and sandboxed hooks |
| `crates/scalpel-secrets/` | Secret detection and redaction |
| `crates/scalpel-watch/` | Watcher and daemon indexing support |
| `crates/scalpel-cli/` | Human CLI |
| `packages/scalpel-mcp/` | MCP package wrapping Rust engine |
| `packages/scalpel-npm/` | npm binary distribution wrapper |
| `docs/adr/` | Architecture decision records |
| `docs/superpowers/plans/` | Implementation plans for specific phases |

### Core Module Boundaries And Ownership

Ownership here means responsibility boundary, not a person.

| Module | Owns | Must not own |
| --- | --- | --- |
| `scalpel-core` | Shared types, errors, risk, manifests, root descriptors | Filesystem side effects |
| `scalpel-fs` | Path resolution, traversal, metadata, streaming IO, atomic writes | Policy decisions unrelated to filesystem safety |
| `scalpel-plan` | Prepare/apply graph, preconditions, validation orchestration, risk assembly | Raw file mutation implementation |
| `scalpel-journal` | Journal persistence, snapshots, undo, recovery | Deciding whether an operation is allowed |
| `scalpel-index` | Index schema, ingest, query, stale state, migrations | Destructive authority |
| `scalpel-parse` | Parser registry, syntax trees, structured edit spans | Global formatting unless explicitly requested |
| `scalpel-policy` | Static policy, hooks, risk thresholds, allow/deny decisions | Direct filesystem mutation |
| `scalpel-secrets` | Detection, spans, redaction, raw-content gates | Operation planning |
| `scalpel-watch` | Daemon, watcher events, incremental refresh | Applying destructive operations from events |
| `scalpel-cli` | Human command surface, output rendering, exit codes | Alternate business logic |
| MCP package | MCP schemas, transport, adapter mapping | Alternate business logic |

The CLI and MCP layers call the same Rust engine contracts. If behavior differs, the engine contract is wrong or one surface has a bug.

### What Not To Build Yet

These are intentionally delayed:

- cloud-hosted Scalpel
- embeddings before Tier 0 to Tier 3 indexing is stable
- daemon before index correctness is stable
- N-API/native Node binding before subprocess JSON protocol proves contracts
- organization policy sync before local policy is deterministic
- GUI before CLI recovery workflows are reliable
- formatter-backed parser edits as default behavior
- cross-root destructive operations before workspace-root safety is mature
- RocksDB before SQLite WAL benchmarks prove a need

Delay is not rejection. It keeps the foundation from becoming fog.

## 3. Version Gates

| Version | Gate |
| --- | --- |
| v0.2 | Current TypeScript MCP contract is internally consistent and documented |
| v0.3 | Rust workspace exists with domain model, CLI shell, and test harness |
| v0.4 | Plan/apply, journal, snapshots, and undo work for narrow file ops |
| v0.5 | CLI is usable as human control plane |
| v0.6 | Rust native core reaches parity for current file tools |
| v0.7 | Persistent workspace index tier 0 to tier 2 works |
| v0.8 | Parser-aware edits work for first language/config set |
| v0.9 | Volume mode, bulk planning, archive safety, and streaming large-file ops work |
| v1.0 | Stable safety, recovery, packaging, docs, benchmarks, and cross-platform matrix |

## 4. Non-Negotiable Invariants

- All public mutations resolve an explicit root scope.
- Destructive and large operations require prepare/apply.
- Apply refuses any manifest hash mismatch.
- Supported mutations write a journal entry before touching disk.
- Supported mutations are undoable until retention limits.
- Irreversible operations are marked before apply.
- No success result is emitted after partial failure.
- Stale index data is never authoritative for destructive apply.
- Secret redaction applies to logs, journals, previews, indexes, and MCP by default.
- Parser-backed edits preserve formatting unless formatting is explicitly enabled.
- Archive extraction cannot write outside planned destination.
- Symlinks, junctions, hardlinks, reparse points, and mount boundaries have explicit policy.

## 5. Data Models

### Engine Error

```rust
pub enum ScalpelErrorCode {
    FileNotFound,
    FileExists,
    PathOutsideRoot,
    SymlinkNotAllowed,
    HiddenPathNotAllowed,
    PermissionDenied,
    InvalidLineRange,
    InvalidPattern,
    StringNotFound,
    StringNotUnique,
    MarkerNotFound,
    MarkerNotAllowedInReplacement,
    ConcurrencyConflict,
    AtomicFailure,
    PlanMismatch,
    JournalUnavailable,
    IrreversibleOperation,
    PolicyDenied,
    ValidationFailed,
}

pub struct ScalpelError {
    pub code: ScalpelErrorCode,
    pub message: String,
    pub path: Option<PathBuf>,
    pub details: serde_json::Value,
}
```

### Operation Plan Manifest

```rust
pub struct PlanManifest {
    pub schema_version: u32,
    pub plan_id: String,
    pub created_at: String,
    pub root: RootDescriptor,
    pub operation: OperationKind,
    pub risk: RiskAssessment,
    pub steps: Vec<PlanStep>,
    pub preconditions: Vec<Precondition>,
    pub validations: Vec<ValidationPlan>,
    pub rollback: RollbackPlan,
    pub hash_manifest: HashManifest,
    pub plan_hash: String,
    pub commit_token_hash: String,
}
```

### Risk Assessment

```rust
pub enum RiskTier {
    Low,
    Medium,
    High,
    Critical,
}

pub struct RiskAssessment {
    pub tier: RiskTier,
    pub score: u8,
    pub reasons: Vec<String>,
    pub mitigations: Vec<String>,
    pub irreversible: bool,
}
```

### Journal Entry

```rust
pub struct JournalEntry {
    pub schema_version: u32,
    pub journal_id: String,
    pub plan_id: Option<String>,
    pub operation: OperationKind,
    pub state: JournalState,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub root: RootDescriptor,
    pub touched_paths: Vec<PathImpact>,
    pub snapshots: Vec<SnapshotRef>,
    pub before_hashes: Vec<FileHash>,
    pub after_hashes: Vec<FileHash>,
    pub errors: Vec<ScalpelError>,
}
```

### Index Records

```rust
pub struct FileRecord {
    pub file_id: String,
    pub root_id: String,
    pub relative_path: String,
    pub file_type: FileType,
    pub size_bytes: u64,
    pub mtime_ns: i128,
    pub ctime_ns: Option<i128>,
    pub device: Option<u64>,
    pub inode: Option<u64>,
    pub content_hash: Option<String>,
    pub language: Option<String>,
    pub indexed_tier: u8,
    pub stale: bool,
}
```

### Storage Formats

#### Plan Files

Location: `.scalpel/plans/<plan_id>.json`.

Properties:

- JSON
- schema-versioned
- hash-bound
- stable enough for human inspection and CI artifacts
- never stores raw secrets unless raw-content opt-in is active and recorded

Human companion: `.scalpel/plans/<plan_id>.human.md`.

#### Journal Files

Location: `.scalpel/journal/<yyyy>/<mm>/<journal_id>.jsonl`.

Properties:

- append-oriented records
- schema-versioned
- flushed before mutation begins
- recoverable after interruption
- redacted by default

#### Snapshots

Location: `.scalpel/snapshots/<journal_id>/`.

Properties:

- content-addressed where practical
- manifest records original path, file identity, metadata, and content hash
- retention controlled per workspace root

#### Index

Location: `.scalpel/index/`.

Default database: SQLite WAL.

Properties:

- migrations under engine control
- stale state stored explicitly
- read queries can continue during writes
- destructive apply must revalidate against live filesystem

#### Locks

Location: `.scalpel/locks/`.

Properties:

- one operation lock per root for destructive apply
- index writer lock separate from read/query access
- stale locks must be recoverable through `scalpel doctor` or `scalpel journal recover`

## 6. Phase 0: Repository Hygiene And Baseline Truth

Purpose: make the existing repo a reliable base before major architecture work.

**Files:**

- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `docs/*`
- Modify: `eslint.config.mjs`
- Create: `LICENSE`
- Create: `docs/adr/0001-rust-core.md`
- Create: `docs/adr/0002-plan-apply.md`

**Steps:**

- [ ] Add Apache-2.0 `LICENSE`.
- [ ] Add ADR for Rust core as mandatory architecture.
- [ ] Add ADR for prepare/apply manifests.
- [ ] Fix `pnpm lint` by excluding fixture TS files or adding a dedicated fixture tsconfig.
- [ ] Keep `pnpm typecheck`, `pnpm test`, and `pnpm build` green.
- [ ] Update `README.md` so verification commands reflect reality.
- [ ] Commit docs and hygiene changes.

**Acceptance criteria:**

- `pnpm lint` exits 0.
- `pnpm typecheck` exits 0.
- `pnpm test` exits 0.
- `pnpm build` exits 0.
- Docs distinguish current behavior from target behavior.

**Risks:**

- Over-fixing fixtures may weaken reliability-suite value.
- License addition should not imply published package readiness.

## 7. Phase 1: Stabilize TypeScript MCP Contract

Purpose: make the current MCP server safe and predictable while Rust core is being built.

**Files:**

- Modify: `src/mcp/result.ts`
- Modify: `src/mcp/register-tools.ts`
- Modify: `src/tools/patch.ts`
- Modify: `src/tools/create.ts`
- Modify: `src/tools/append.ts`
- Modify: `src/tools/prepend.ts`
- Modify: `src/tools/move.ts`
- Modify: `src/core/write-file-atomic.ts`
- Modify: `tests/integration/stdio-server.test.ts`
- Modify: `tests/unit/tools/*`

**Steps:**

- [ ] Add failure `structuredContent` with shape `{ ok: false, error }`.
- [ ] Keep legacy text failure content for compatibility.
- [ ] Add `expected_mtime_ms` to `patch`.
- [ ] Add dry-run support to `create`, `append`, `prepend`, and `move`, or document why any command cannot preview.
- [ ] Standardize concurrency preconditions for existing-file mutations.
- [ ] Strengthen `writeFileAtomic()` naming and docs: current implementation is atomic replacement, not crash-durable persistence.
- [ ] Add tests for structured failure payloads.
- [ ] Add tests for dry-run behavior across all mutators.
- [ ] Add tests for stale SHA and stale mtime conflicts.
- [ ] Add reliability-suite checklist entries for every stabilized contract.

**Acceptance criteria:**

- Every public tool has documented input, output, error, and safety behavior.
- Agents can recover from failures without parsing text.
- Every mutating operation has a preview or an explicit irreversible marker.
- Existing-file stale writes fail deterministically.

**Version gate:** v0.2.

## 8. Phase 2: Rust Workspace Skeleton

Purpose: introduce the native core without disrupting the working MCP MVP.

**Files:**

- Create: `Cargo.toml`
- Create: `crates/scalpel-core/Cargo.toml`
- Create: `crates/scalpel-core/src/lib.rs`
- Create: `crates/scalpel-core/src/error.rs`
- Create: `crates/scalpel-core/src/path.rs`
- Create: `crates/scalpel-core/src/risk.rs`
- Create: `crates/scalpel-core/src/manifest.rs`
- Create: `crates/scalpel-cli/Cargo.toml`
- Create: `crates/scalpel-cli/src/main.rs`
- Create: `tests/rust-golden/`

**Steps:**

- [ ] Create Cargo workspace.
- [ ] Implement shared `ScalpelError`, `ScalpelResult<T>`, and JSON serialization.
- [ ] Implement `RootDescriptor`.
- [ ] Implement `RiskTier` and `RiskAssessment`.
- [ ] Implement manifest structs without apply logic.
- [ ] Add CLI shell with `scalpel --version` and `scalpel doctor`.
- [ ] Add golden JSON output tests for error and risk structures.
- [ ] Add CI command docs for `cargo test --workspace`.

**Acceptance criteria:**

- `cargo test --workspace` passes.
- `cargo run -p scalpel-cli -- doctor` prints machine-readable diagnostics with `--json`.
- Rust data model can serialize and deserialize plan-like structs.

**Version gate:** v0.3 entry.

## 9. Phase 3: Rust Filesystem Primitives

Purpose: create the safe low-level foundation before porting tools.

**Files:**

- Create: `crates/scalpel-fs/Cargo.toml`
- Create: `crates/scalpel-fs/src/lib.rs`
- Create: `crates/scalpel-fs/src/resolve.rs`
- Create: `crates/scalpel-fs/src/traverse.rs`
- Create: `crates/scalpel-fs/src/metadata.rs`
- Create: `crates/scalpel-fs/src/atomic_write.rs`
- Create: `crates/scalpel-fs/src/stream.rs`
- Create: `crates/scalpel-fs/src/link_policy.rs`
- Test: `crates/scalpel-fs/tests/path_policy.rs`
- Test: `crates/scalpel-fs/tests/atomic_write.rs`

**Steps:**

- [ ] Implement root confinement using canonical root identity.
- [ ] Implement existing-segment symlink and reparse-point checks.
- [ ] Implement hidden path policy.
- [ ] Implement safe recursive walker with permission-denied reporting.
- [ ] Implement file metadata with platform-specific IDs where available.
- [ ] Implement best-effort atomic replace.
- [ ] Add crash-durable write mode with temp file flush and parent directory flush where platform supports it.
- [ ] Implement chunked reader for huge files.
- [ ] Add property tests for path normalization and root escape attempts.
- [ ] Add Windows junction tests.

**Acceptance criteria:**

- Path escape tests pass on Windows and Linux.
- Symlink and junction traversal is denied by default.
- Permission-denied files do not abort whole-tree scans.
- Huge-file reads can stream without loading full content.

## 10. Phase 4: Plan, Apply, Journal, Snapshot, Undo

Purpose: implement the safety spine before high-power operations.

**Files:**

- Create: `crates/scalpel-plan/src/lib.rs`
- Create: `crates/scalpel-plan/src/prepare.rs`
- Create: `crates/scalpel-plan/src/apply.rs`
- Create: `crates/scalpel-plan/src/token.rs`
- Create: `crates/scalpel-journal/src/lib.rs`
- Create: `crates/scalpel-journal/src/store.rs`
- Create: `crates/scalpel-journal/src/snapshot.rs`
- Create: `crates/scalpel-journal/src/undo.rs`
- Create: `crates/scalpel-journal/src/recover.rs`
- Test: `crates/scalpel-journal/tests/crash_recovery.rs`

**Steps:**

- [ ] Implement plan manifest writer under `.scalpel/plans/`.
- [ ] Generate local commit tokens.
- [ ] Hash-bind token to exact manifest.
- [ ] Implement journal entry creation before mutation.
- [ ] Implement snapshot storage for supported file mutations.
- [ ] Implement undo for file create, replace, append, prepend, delete, and move.
- [ ] Implement recovery scanner for interrupted journal states.
- [ ] Add crash tests that kill process between journal creation and mutation.
- [ ] Add crash tests that kill process during mutation.
- [ ] Add retention policy enforcement.

**Acceptance criteria:**

- Supported mutation cannot run without journal write.
- Apply fails if manifest hash changes.
- Undo restores original content and metadata where supported.
- Recovery command reports interrupted operation state.

**Version gate:** v0.4.

## 11. Phase 5: CLI Control Plane

Purpose: make the CLI the human-facing control plane.

**Files:**

- Modify: `crates/scalpel-cli/src/main.rs`
- Create: `crates/scalpel-cli/src/commands/index.rs`
- Create: `crates/scalpel-cli/src/commands/scan.rs`
- Create: `crates/scalpel-cli/src/commands/plan.rs`
- Create: `crates/scalpel-cli/src/commands/apply.rs`
- Create: `crates/scalpel-cli/src/commands/undo.rs`
- Create: `crates/scalpel-cli/src/commands/journal.rs`
- Create: `crates/scalpel-cli/src/commands/doctor.rs`
- Create: `crates/scalpel-cli/src/commands/mcp.rs`
- Create: `crates/scalpel-cli/tests/golden.rs`

**Steps:**

- [ ] Add Git-style subcommands.
- [ ] Support `--json` for every command.
- [ ] Support human-readable output for every command.
- [ ] Implement `doctor` checks for config, roots, journal, index, external tools, and platform warnings.
- [ ] Implement `journal list`, `journal show`, and `journal recover`.
- [ ] Implement `plan` and `apply` for narrow file operations.
- [ ] Implement `undo <journal_id>`.
- [ ] Add golden tests for CLI output.
- [ ] Add shell completion generation after command surface stabilizes.

**Acceptance criteria:**

- A human can inspect, plan, apply, undo, and recover without using MCP.
- Every command that emits structured data supports `--json`.
- CLI output never leaks secrets by default.

**Version gate:** v0.5.

## 12. Phase 6: Native Tool Parity And MCP Bridge

Purpose: move current file operations into Rust and make MCP use the same contracts.

**Files:**

- Create: `crates/scalpel-core/src/tools.rs`
- Create: `crates/scalpel-fs/src/read.rs`
- Create: `crates/scalpel-fs/src/write_ops.rs`
- Create: `crates/scalpel-fs/src/diff.rs`
- Create: `crates/scalpel-fs/src/search.rs`
- Modify: `packages/scalpel-mcp/` or current `src/mcp/*`
- Test: `tests/integration/stdio-server.test.ts`
- Test: `crates/scalpel-fs/tests/tool_parity.rs`

**Steps:**

- [ ] Port `stat`.
- [ ] Port `read`.
- [ ] Port `list_dir`.
- [ ] Port `grep`.
- [ ] Port `diff`.
- [ ] Port `create`.
- [ ] Port `patch`.
- [ ] Port `batch_edit`.
- [ ] Port `insert`.
- [ ] Port `delete_range`.
- [ ] Port `replace_between_markers`.
- [ ] Port `append`.
- [ ] Port `prepend`.
- [ ] Port `move`.
- [ ] Add parity tests using the current TypeScript test fixtures.
- [ ] Make MCP call Rust engine through a stable JSON protocol.
- [ ] Keep TypeScript implementation behind a temporary compatibility flag until parity is proven.

**Acceptance criteria:**

- Rust and current TypeScript outputs match for supported cases.
- MCP tools use Rust core by default.
- Current 14-tool MCP integration tests pass.
- Rust handles larger files without full-memory reads where the operation supports streaming.

**Version gate:** v0.6.

## 13. Phase 7: Persistent Index

Purpose: build workspace intelligence without compromising destructive safety.

**Files:**

- Create: `crates/scalpel-index/src/lib.rs`
- Create: `crates/scalpel-index/src/sqlite.rs`
- Create: `crates/scalpel-index/src/schema.rs`
- Create: `crates/scalpel-index/src/indexer.rs`
- Create: `crates/scalpel-index/src/query.rs`
- Create: `crates/scalpel-index/src/staleness.rs`
- Create: `crates/scalpel-index/migrations/0001_initial.sql`
- Test: `crates/scalpel-index/tests/index_workspace.rs`

**Steps:**

- [ ] Implement SQLite WAL store.
- [ ] Add migrations table.
- [ ] Implement Tier 0 records.
- [ ] Implement Tier 1 hashes and type detection.
- [ ] Implement Tier 2 snippets and symbol seed records.
- [ ] Add stale marker logic.
- [ ] Add index rebuild and incremental refresh commands.
- [ ] Add query APIs for path, type, language, hash, size, and stale status.
- [ ] Add index corruption detection and rebuild guidance.
- [ ] Add benchmark for 1 million file metadata ingest.

**Acceptance criteria:**

- `scalpel index .` creates `.scalpel/index/`.
- Querying stale records marks stale state clearly.
- Destructive apply never trusts stale index records as authority.
- Indexing permission-denied paths records warnings and continues.

**Version gate:** v0.7.

## 14. Phase 8: Secrets And Redaction

Purpose: prevent the engine from leaking sensitive content.

**Files:**

- Create: `crates/scalpel-secrets/src/lib.rs`
- Create: `crates/scalpel-secrets/src/detect.rs`
- Create: `crates/scalpel-secrets/src/redact.rs`
- Create: `crates/scalpel-secrets/src/policy.rs`
- Test: `crates/scalpel-secrets/tests/redaction.rs`

**Steps:**

- [ ] Implement pattern-based secret detectors for common keys and tokens.
- [ ] Implement entropy-based detector for suspicious high-entropy strings.
- [ ] Implement redaction spans.
- [ ] Apply redaction to logs, diffs, previews, MCP output, journal text, and index snippets.
- [ ] Add explicit raw-content opt-in.
- [ ] Add tests proving secrets do not appear in default outputs.

**Acceptance criteria:**

- Default CLI and MCP outputs redact detected secrets.
- Journal and index do not store unredacted secret snippets by default.
- Raw content opt-in is explicit and auditable.

## 15. Phase 9: Parser-Aware Editing

Purpose: make small code and config edits semantically safer.

**Files:**

- Create: `crates/scalpel-parse/src/lib.rs`
- Create: `crates/scalpel-parse/src/tree_sitter.rs`
- Create: `crates/scalpel-parse/src/languages/typescript.rs`
- Create: `crates/scalpel-parse/src/languages/javascript.rs`
- Create: `crates/scalpel-parse/src/languages/python.rs`
- Create: `crates/scalpel-parse/src/languages/json.rs`
- Create: `crates/scalpel-parse/src/languages/yaml.rs`
- Create: `crates/scalpel-parse/src/languages/toml.rs`
- Create: `crates/scalpel-parse/src/languages/markdown.rs`
- Create: `crates/scalpel-parse/src/languages/hcl.rs`
- Test: `crates/scalpel-parse/tests/*`

**Steps:**

- [ ] Add parser registry.
- [ ] Add syntax tree parse for TS/JS.
- [ ] Add syntax tree parse for Python.
- [ ] Add structured JSON/JSONC edits.
- [ ] Add YAML and Kubernetes document targeting.
- [ ] Add TOML key edits.
- [ ] Add Markdown section edits.
- [ ] Add Terraform/HCL block parsing.
- [ ] Add minimal-diff rewrite engine.
- [ ] Add explicit formatter opt-in.
- [ ] Add semantic validation hooks after edits.

**Acceptance criteria:**

- Parser edits preserve formatting by default.
- Structured key edits do not rewrite whole files.
- Kubernetes and Terraform files can be validated when tools are available.
- Parser failures degrade to explicit errors, not unsafe fallback mutations.

**Version gate:** v0.8.

## 16. Phase 10: Policy Engine

Purpose: allow users and organizations to constrain power safely.

**Files:**

- Create: `crates/scalpel-policy/src/lib.rs`
- Create: `crates/scalpel-policy/src/static_policy.rs`
- Create: `crates/scalpel-policy/src/hooks.rs`
- Create: `crates/scalpel-policy/src/evaluator.rs`
- Test: `crates/scalpel-policy/tests/policy_eval.rs`

**Steps:**

- [ ] Implement static TOML policy loading.
- [ ] Implement policy precedence.
- [ ] Implement risk threshold rules.
- [ ] Implement path allow/deny rules.
- [ ] Implement operation allow/deny rules.
- [ ] Implement sandboxed programmable hook prototype.
- [ ] Capture policy decisions in plan manifests.
- [ ] Capture policy version in journal entries.

**Acceptance criteria:**

- Policy can deny a risky operation before plan creation.
- Policy can require critical confirmation for selected operations.
- Policy hooks cannot silently expand planned scope.

## 17. Phase 11: Infrastructure Validation

Purpose: make critical infra edits safer before apply.

**Files:**

- Create: `crates/scalpel-plan/src/validation.rs`
- Create: `crates/scalpel-plan/src/external_tools.rs`
- Test: `crates/scalpel-plan/tests/validation.rs`

**Steps:**

- [ ] Detect available external tools.
- [ ] Add `terraform validate` and plan-aware checks where possible.
- [ ] Add Kubernetes schema validation and optional server-side dry run.
- [ ] Add Docker Compose validation.
- [ ] Add GitHub Actions YAML validation where feasible.
- [ ] Add package manager checks for JS/Rust/Python projects.
- [ ] Add graceful missing-tool reporting.
- [ ] Store validation results in plan manifest.

**Acceptance criteria:**

- Missing tools do not crash planning.
- Available tools produce machine-readable validation results.
- Critical validation failures block apply unless policy explicitly allows override.

## 18. Phase 12: Volume Mode, Bulk Ops, Archives, Huge Files

Purpose: expand from codebase editor to filesystem operations engine.

**Files:**

- Create: `crates/scalpel-fs/src/volume.rs`
- Create: `crates/scalpel-fs/src/archive.rs`
- Create: `crates/scalpel-plan/src/bulk.rs`
- Create: `crates/scalpel-index/src/dedupe.rs`
- Test: `crates/scalpel-fs/tests/archive_safety.rs`
- Test: `crates/scalpel-plan/tests/bulk_ops.rs`

**Steps:**

- [ ] Add explicit volume mode.
- [ ] Require separate confirmation for volume root enrollment.
- [ ] Add catalog command for 5 TB class directory trees.
- [ ] Add bulk move planning.
- [ ] Add bulk delete planning.
- [ ] Add dedupe candidate planning.
- [ ] Add archive inspection without extraction.
- [ ] Add safe archive extraction plan with path escape detection.
- [ ] Add streaming patch for 10 GB text/log files.
- [ ] Add permission and symlink-loop tests.

**Acceptance criteria:**

- Volume mode cannot be entered accidentally.
- Archive extraction cannot write outside destination.
- Bulk operations show exact path and byte impact before apply.
- Huge-file patch does not require loading full file into memory.

**Version gate:** v0.9.

## 19. Phase 13: Daemon And Watcher

Purpose: make persistent workspace intelligence incremental.

**Files:**

- Create: `crates/scalpel-watch/src/lib.rs`
- Create: `crates/scalpel-watch/src/daemon.rs`
- Create: `crates/scalpel-watch/src/events.rs`
- Create: `crates/scalpel-watch/src/supervisor.rs`
- Modify: `crates/scalpel-cli/src/commands/daemon.rs`
- Test: `crates/scalpel-watch/tests/watch_events.rs`

**Steps:**

- [ ] Implement one daemon per active indexed root.
- [ ] Add optional global supervisor.
- [ ] Add recursive watching.
- [ ] Record changes over time.
- [ ] Refresh index incrementally.
- [ ] Expose daemon status through CLI.
- [ ] Add safe trigger hooks constrained by policy.
- [ ] Add tests for rename, delete, permission changes, and burst events.

**Acceptance criteria:**

- Daemon can start, stop, report status, and recover.
- Index updates after filesystem changes.
- Watcher failures degrade to stale index warnings.

## 20. Phase 14: Packaging And Release

Purpose: distribute the product without compromising trust.

**Files:**

- Create: `.github/workflows/release.yml`
- Create: `packages/scalpel-npm/package.json`
- Create: `packages/scalpel-npm/bin/scalpel.js`
- Create: `Dockerfile`
- Create: `docs/RELEASE.md`
- Create: `docs/SECURITY.md`

**Steps:**

- [ ] Build Windows, Linux, and macOS binaries.
- [ ] Generate checksums.
- [ ] Sign release artifacts.
- [ ] Publish cargo package after API review.
- [ ] Publish npm package that wraps native binary.
- [ ] Publish Docker image.
- [ ] Prepare winget manifest.
- [ ] Add release verification guide.
- [ ] Add dependency license report.

**Acceptance criteria:**

- Users can verify artifact integrity.
- npm package does not reimplement core behavior.
- Docker image runs CLI and MCP entrypoints.
- Release can be reproduced from tagged source.

**Version gate:** v1.0 candidate.

## Required Test Environments

### Local Developer Windows

Purpose:

- primary development environment
- NTFS behavior
- long paths
- junctions and reparse points
- PowerShell CLI behavior

Required checks:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `cargo test --workspace`
- path policy tests
- junction tests

### Linux

Purpose:

- production CI baseline
- POSIX permissions
- symlinks
- container filesystem behavior

Required checks:

- full Rust test suite
- CLI golden tests
- permission-denied traversal tests
- symlink-loop tests

### WSL

Purpose:

- boundary behavior between Windows and Linux workflows
- path translation risks
- mixed toolchain usage

Required checks:

- workspace-root resolution
- file identity behavior
- CLI output path normalization

### Containers

Purpose:

- CI and automation use
- read-only mounts
- volume mounts
- permission mismatch behavior

Required checks:

- Docker image smoke test
- mounted workspace index test
- journal directory override test

### Large Storage Host

Purpose:

- 100 GB search
- 1 million file index
- 5 TB catalog
- 10 GB streaming patch

Required checks:

- benchmark harness
- crash recovery tests
- memory ceiling monitoring

## Coverage Targets

Coverage targets are quality bars, not vanity metrics.

| Phase | Target |
| --- | --- |
| v0.2 | Current TypeScript contracts covered by unit or integration tests |
| v0.4 | Journal, plan/apply, and undo have crash-path tests for every supported operation |
| v0.6 | Rust parity tests cover all current MCP tools |
| v0.7 | Index migrations, stale state, and rebuild paths covered |
| v0.8 | Parser fixtures cover valid, malformed, and formatting-sensitive files |
| v0.9 | Volume, archive, symlink-loop, permission, and huge-file tests covered |
| v1.0 | Cross-platform matrix green for release targets |

Minimum stable-release expectation:

- high-risk logic has branch coverage through targeted tests
- every bug fix adds a regression fixture or test
- every data-loss class has at least one failure-mode test

## 21. Testing Strategy By Subsystem

### Filesystem

- path escape tests
- symlink and junction tests
- hardlink tests
- permission-denied tests
- mount boundary tests
- Unicode and case-sensitivity tests
- long path tests on Windows

### Plan/Apply

- manifest hash mismatch tests
- stale precondition tests
- token mismatch tests
- policy-denied tests
- irreversible operation tests
- dry-run parity tests

### Journal/Recovery

- process-kill tests before mutation
- process-kill tests during mutation
- partial snapshot tests
- undo idempotence tests
- retention cleanup tests

### Index

- 1 million file metadata ingest
- stale state detection
- permission-denied continuation
- index corruption recovery
- migration tests

### Parser

- golden minimal diff tests
- malformed syntax tests
- formatting preservation tests
- language-specific fixture suites
- fallback refusal tests

### Secrets

- known secret corpus
- false-positive control corpus
- redaction span tests
- MCP output leak tests
- journal/index leak tests

### MCP

- tool listing tests
- structured success tests
- structured failure tests
- cancellation behavior
- large output truncation or pagination behavior

### CLI

- golden output tests
- JSON schema tests
- exit code tests
- shell completion tests
- recovery workflow tests

## 22. Benchmark Harness

Required benchmark scenarios:

- index 1 million files
- search 100 GB text corpus
- parse and vectorize 500,000 LOC workspace
- patch 10 GB log through streaming
- catalog 5 TB directory tree
- recover from killed mutating operation
- detect symlink loops
- handle permission-denied paths during scan

Benchmark rules:

- fixtures must be generated reproducibly
- results must record machine, OS, filesystem, CPU, RAM, disk type, and commit hash
- benchmark failures block version gates that depend on them
- benchmark output should be stored under `scalpel-reliability-suite/results/`

## Threat Model

Threats:

- malicious workspace file paths
- symlink, junction, reparse-point, hardlink, or mount boundary confusion
- archive path traversal
- malicious or broken policy hook
- stale index used as authority
- external validator output trusted too much
- race between plan and apply
- raw secret leakage
- interrupted process during mutation
- dependency or release artifact compromise

Mitigations:

- root descriptors and path policy
- plan/apply manifests
- hash-bound commit tokens
- journal before mutation
- live precondition revalidation
- redaction by default
- sandboxed hooks
- signed releases
- recovery scanner
- cross-platform filesystem tests

## Compatibility Policy

Before v1.0:

- CLI flags may change with changelog notes.
- Plan and journal schema versions may change with migrations.
- MCP tool names should be stable once Rust parity begins.

After v1.0:

- plan manifests are schema-versioned
- journal schemas are migratable or permanently readable
- CLI breaking changes require major version bump
- MCP breaking schema changes require compatibility window
- index schemas require migration tests

## Dependency Policy

Dependency rules:

- prefer Rust standard library where sufficient
- prefer mature crates with active maintenance
- record license compatibility
- avoid network-required runtime dependencies for core flows
- avoid parser dependencies that cannot be packaged cross-platform
- avoid native C/C++ dependencies unless they are worth the supply-chain and build complexity
- pin release-critical dependencies
- run dependency audit before releases

SQLite is the first index store. RocksDB is a later decision, not a default.

## Observability And Logging Policy

Logging must be useful without leaking.

Rules:

- structured logs
- redaction before emission
- operation IDs in every log tied to mutation, plan, apply, journal, and recovery
- no raw file content in logs by default
- trace logs require explicit opt-in
- CLI `--json` output is separate from diagnostic logs
- MCP responses are bounded, structured, and redacted

Events to record:

- plan created
- apply started
- journal entry created
- snapshot created
- precondition failed
- validation failed
- recovery required
- undo started
- undo completed
- index marked stale

## Local Development Setup

Initial TypeScript setup:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Future Rust setup:

```bash
rustup update stable
cargo test --workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

MCP smoke:

```bash
pnpm dev
```

Future CLI smoke:

```bash
cargo run -p scalpel-cli -- doctor --json
```

## Security And Supply-Chain Checks

Release-blocking checks:

- dependency audit
- license inventory
- secret scan
- artifact checksums
- artifact signing
- reproducible release notes
- Docker image scan
- npm package contents audit
- no generated binary committed accidentally
- no unredacted secrets in test fixtures

## Architecture Decision Records

Create ADRs under `docs/adr/`.

Required ADRs:

- Rust core is mandatory
- CLI and MCP are peer surfaces
- workspace default plus explicit volume mode
- prepare/apply manifests
- journal-before-mutation
- SQLite WAL as first index store
- Tree-sitter parser substrate
- redaction by default
- daemon delayed until index correctness

ADR format:

```markdown
# ADR-NNNN: Title

## Status

Accepted

## Context

Why this decision exists.

## Decision

What is decided.

## Consequences

What this enables and costs.
```

## 23. Quality Bars

### v0.2 Bar

- TypeScript MCP docs match implementation.
- All current tests pass.
- Lint passes.
- Structured MCP failures exist.

### v0.4 Bar

- Journal-before-mutation invariant is enforced.
- Narrow undo works.
- Crash recovery tests exist.

### v0.7 Bar

- Index can be rebuilt.
- Index marks stale records.
- Index never drives destructive apply without fresh validation.

### v1.0 Bar

- Windows and Linux are first-class.
- WSL and containers are tested.
- macOS package exists or is explicitly marked preview.
- Plan/apply and recovery are stable.
- Release artifacts are signed.
- Public docs and developer docs are current.
- Benchmarks meet published targets or document measured limits honestly.

## 24. Debugging Guide

When behavior is wrong:

1. Reproduce with CLI using `--json`.
2. Capture root, config, command, plan manifest, and journal entry.
3. Run `scalpel doctor`.
4. Check `.scalpel/journal/`.
5. Check `.scalpel/plans/`.
6. Check index stale state.
7. Re-run with trace logging only after redaction is verified.
8. Add a fixture to `scalpel-reliability-suite/`.
9. Add a regression test.

Never debug destructive apply by running a broader destructive operation.

## 25. Contributor Rules

- Write tests before or with behavior changes.
- Keep docs synchronized with code.
- Do not weaken safety defaults for convenience.
- Do not add hidden network requirements to core flows.
- Do not add parser fallback that mutates when parse fails.
- Do not log raw secrets by default.
- Do not add dependencies without checking license, maintenance, and supply-chain risk.
- Prefer small focused crates and modules.
- Keep public data models versioned.

## Code Review Expectations

Reviewers prioritize:

- data-loss risk
- wrong-path risk
- stale precondition risk
- secret leakage
- incomplete recovery
- missing tests
- misleading docs
- cross-platform assumptions
- performance cliffs for large files or trees

Every risky mutation PR must answer:

- What exact paths can it touch?
- What journal entry is created before mutation?
- How is undo guaranteed or marked impossible?
- What happens if the process dies halfway?
- Which tests prove the failure path?

## 26. Implementation Walkthrough

This is the start-to-finish build order.

### Step 0: Make Current Repo Honest

- [ ] Add license and ADRs.
- [ ] Fix lint scope.
- [ ] Verify `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- [ ] Commit.

Definition of done: current TypeScript MVP is documented and verifiable.

### Step 1: Make MCP Errors Machine-Readable

- [ ] Update `src/mcp/result.ts`.
- [ ] Add stdio integration assertion for failure `structuredContent`.
- [ ] Update `SPEC.md` and `docs/TOOL_CONTRACTS.md`.
- [ ] Verify.
- [ ] Commit.

Definition of done: agents never need text parsing for Scalpel error codes.

### Step 2: Normalize Current Mutator Contracts

- [ ] Add missing preconditions.
- [ ] Add dry-run or irreversible preview semantics.
- [ ] Add tests.
- [ ] Verify.
- [ ] Commit.

Definition of done: every mutator has predictable preview, precondition, and error behavior.

### Step 3: Add Rust Workspace

- [ ] Create Cargo workspace.
- [ ] Add `scalpel-core`.
- [ ] Add `scalpel-cli`.
- [ ] Add basic JSON output.
- [ ] Verify `cargo test --workspace`.
- [ ] Commit.

Definition of done: Rust code exists but does not replace MCP yet.

### Step 4: Implement Safe Rust Filesystem Layer

- [ ] Add `scalpel-fs`.
- [ ] Implement path policy.
- [ ] Implement traversal.
- [ ] Implement metadata.
- [ ] Implement atomic write modes.
- [ ] Add platform tests.
- [ ] Commit.

Definition of done: filesystem core can be trusted before it mutates important data.

### Step 5: Build Plan/Apply Spine

- [ ] Add plan manifest.
- [ ] Add commit token.
- [ ] Add journal entry writer.
- [ ] Add snapshot writer.
- [ ] Add apply for one narrow operation.
- [ ] Add undo.
- [ ] Add crash tests.
- [ ] Commit.

Definition of done: one operation proves the safety model end to end.

### Step 6: Expand CLI

- [ ] Add plan/apply/undo/journal/doctor commands.
- [ ] Add human output.
- [ ] Add `--json`.
- [ ] Add golden tests.
- [ ] Commit.

Definition of done: human control plane exists.

### Step 7: Port Current Tools To Rust

- [ ] Port read-only tools.
- [ ] Port exact edit tools.
- [ ] Port line/marker tools.
- [ ] Port move.
- [ ] Add parity tests.
- [ ] Switch MCP to Rust engine.
- [ ] Commit.

Definition of done: current MCP surface uses native core.

### Step 8: Add Persistent Index

- [ ] Add SQLite store.
- [ ] Add tier 0 to tier 2 indexing.
- [ ] Add stale markers.
- [ ] Add query commands.
- [ ] Add 1 million file benchmark.
- [ ] Commit.

Definition of done: workspace intelligence exists and is safe around stale data.

### Step 9: Add Secrets Layer

- [ ] Add detection.
- [ ] Add redaction.
- [ ] Wire redaction into outputs.
- [ ] Add leak tests.
- [ ] Commit.

Definition of done: default output does not leak detected secrets.

### Step 10: Add Parser-Aware Edits

- [ ] Add parser registry.
- [ ] Add first TS/JS operations.
- [ ] Add JSON/YAML/TOML structured edits.
- [ ] Add Markdown section edits.
- [ ] Add Terraform/Kubernetes validation hooks.
- [ ] Commit.

Definition of done: semantic edits preserve formatting and refuse unsafe fallback.

### Step 11: Add Volume Mode And Bulk Plans

- [ ] Add explicit volume enrollment.
- [ ] Add cataloging.
- [ ] Add bulk move/delete plans.
- [ ] Add archive inspection.
- [ ] Add huge-file streaming patch.
- [ ] Commit.

Definition of done: Scalpel can operate beyond repos without weakening defaults.

### Step 12: Add Daemon And Watcher

- [ ] Add one daemon per active indexed root.
- [ ] Add supervisor.
- [ ] Add watcher events.
- [ ] Add incremental index refresh.
- [ ] Commit.

Definition of done: index can stay fresh over time.

### Step 13: Package And Release

- [ ] Add release workflow.
- [ ] Add artifact signing.
- [ ] Add npm wrapper.
- [ ] Add Docker image.
- [ ] Add winget preparation.
- [ ] Commit.

Definition of done: users can install and verify Scalpel.

## 27. Release Checklist

- [ ] License present.
- [ ] Changelog updated.
- [ ] Public handbook updated.
- [ ] Developer roadmap updated.
- [ ] Agent context updated.
- [ ] CLI help output reviewed.
- [ ] MCP schemas reviewed.
- [ ] All tests pass.
- [ ] Benchmarks recorded.
- [ ] Artifacts signed.
- [ ] Checksums published.
- [ ] Dependency licenses reviewed.
- [ ] Security notes reviewed.

## 28. Maintenance Model

After v1.0:

- keep a stable data model compatibility policy
- version plan manifests and journals
- keep migration tests for index schemas
- maintain Windows and Linux as first-class platforms
- keep docs honest after every contract change
- treat safety regressions as release blockers
- expand reliability suite with every bug fix
