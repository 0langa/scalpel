# Scalpel Hardening Suite

The hardening suite is the first step toward the `1.0.0` bar: crash-safe,
race-proof, large-scale file operations within an explicit safety model.

It writes all cloned public corpora, synthetic workspaces, journals, and reports
outside the repo by default:

```text
C:\Users\Julius\source\repos\scalpel_functionality\scalpel-hardening
```

## Commands

Build Scalpel first:

```powershell
pnpm build
```

Clone starter public corpora:

```powershell
pnpm hardening:setup
```

Run the starter suite:

```powershell
pnpm hardening:all
```

Run individual lanes:

```powershell
pnpm hardening:corpus
pnpm hardening:race
pnpm hardening:crash
```

Use the larger corpus set when you are ready for slower runs:

```powershell
pnpm hardening:setup -- --expanded
pnpm hardening:all -- --expanded
```

## Lock Configuration

Mutating tools acquire path locks in memory and through an atomic lock directory
so cooperative Scalpel server processes serialize commits to the same target.

- `SCALPEL_LOCK_DIR` overrides the shared lock directory. The hardening harness
  sets this to a per-report directory so concurrent clients use the same lock
  namespace.
- `SCALPEL_LOCK_TIMEOUT_MS` controls how long a process waits for an existing
  path lock before failing. The default is `30000`.
- `SCALPEL_LOCK_STALE_MS` controls when a lock owned by a dead process can be
  recovered. The default is `300000`; set `0` to disable stale-lock recovery.

## What V0 Proves

- Scalpel can run over public code corpora through MCP.
- Basic corpus traversal, bounded reads, grep, root confinement, and path escape rejection work.
- Synthetic stale-write checks reject stale SHA preconditions.
- In-process mutations are path-serialized for the current mutator set:
  `patch`, `create`, `append`, `prepend`, `batch_edit`, `insert`,
  `delete_range`, `replace_between_markers`, and `move`.
- The MCP race lane proves concurrent same-SHA calls on those mutators allow at
  most one successful commit.
- Cooperative multi-process Scalpel mutations are serialized through shared
  lock directories, and the MCP race lane now runs the same same-SHA mutator
  checks across two independent stdio server processes.
- Text-file mutators revalidate the planned target immediately before commit,
  and the MCP race lane proves externally modified, created, deleted, or
  directory-replaced targets are rejected instead of silently overwritten.
- Stale path locks owned by dead processes are recovered after the configured
  stale threshold.
- A first crash-interruption probe checks for absent-or-complete output and leftover temp files.

## What V0 Does Not Prove Yet

- Full transactional crash recovery.
- Race-proof final commit under malicious same-user filesystem interference
  after the pre-commit revalidation point, or for symlink-swap interference not
  yet represented in the hardening lane.
- Recovery from a process crash while holding a path lock before the configured
  stale threshold elapses.
- Large-file streaming mutation.
- Cross-platform fsync guarantees.

Advisory checks are allowed to reveal these gaps without failing the required
suite. They should become required only after the implementation is hardened.

## Release Goal Proof Map

The `1.0.0` release target is a fully crash-safe, race-proof, large-scale
file-operations MCP platform within an explicit safety model. That claim is only
allowed when every proof lane below has machine-readable evidence.

### 1. Explicit Safety Model

Required implementation:

- Define the threat model for accidental concurrency, hostile same-user local
  filesystem interference, OS/filesystem crash semantics, symlink replacement,
  cross-device moves, network mounts, and permission failures.
- Distinguish current guarantees from unsupported environments.
- Define the terms `crash-safe`, `race-proof`, `large-scale`, and
  `recoverable` as testable invariants.

Required proof:

- `docs/SAFETY_MODEL.md` contains those definitions.
- A hardening report links each claim to at least one test lane.
- Unsupported cases fail closed or are explicitly outside the `1.0.0` claim.

### 2. Race-Proof Mutation Commit

Required implementation:

- Serialize in-process mutations for every path they can modify.
- Serialize cooperative multi-process Scalpel mutations with a shared lock
  protocol.
- Revalidate target and parent path state as close to commit as possible.
- Reject stale hash/mtime expectations after any intervening write.
- Lock multi-path operations such as `move` in deterministic path order.
- Add external-interference tests where another process edits, deletes,
  replaces, or symlinks paths during validation/commit.

Required proof:

- Unit tests for concurrent same-SHA calls on every mutator.
- Hardening race lane over MCP for in-process and multi-process server calls.
- Hardening race lane over MCP for non-cooperative external modification,
  creation, deletion, and replacement before commit.
- Reports show zero unexpected double-writes or silent overwrites.

### 3. Crash Safety And Recovery

Required implementation:

- Durable transaction records for pending writes and moves.
- Startup recovery scanner with deterministic states:
  `pending`, `written`, `renamed`, `committed`, `aborted`.
- Fault injection hooks around transaction write, temp write, file sync, rename,
  parent-directory sync, journal write, and recovery cleanup.
- Recovery must return each target to old content or new content, never partial
  or unknown content.

Required proof:

- Crash/fault matrix for every mutation tool.
- Hardening crash lane launches child Scalpel processes, kills them at injected
  points, restarts, runs recovery, and checks invariants.
- Reports include before/after hashes, transaction IDs, and recovery decisions
  without recording file content.

### 4. Large-Scale File Operations

Required implementation:

- Streaming read/search paths with bounded memory.
- Streaming exact replacement or bounded edit plans for large files.
- Explicit diff/output size limits.
- Cancellation or timeout handling for long traversal.
- Include/exclude policy for generated, vendored, hidden, binary, and oversized
  files.

Required proof:

- Public corpus stress over pinned commits in large repositories.
- Synthetic huge-file tests for multi-GB-shaped workloads where practical.
- Reports include file counts, skipped-file reasons, max RSS, duration, and
  result limits.

### 5. Public Corpus Stress

Starter corpora are intentionally small for fast iteration:

- `expressjs/express`
- `lodash/lodash`

Expanded `1.0.0` corpora must include larger and more diverse projects:

- `microsoft/TypeScript`
- `kubernetes/kubernetes`
- at least one very large C/C++ tree, such as `llvm/llvm-project`
- at least one repository with many generated/vendor/binary files

Required proof:

- All clones are pinned by commit hash in the report.
- Mutation tests run only on disposable copies.
- Read-only corpus lanes prove no fixture mutation.
- Corpus reports live outside the repo under `scalpel_functionality`.

### 6. Machine-Readable Release Evidence

Required implementation:

- Every hardening command writes `report.json` and `report.md`.
- Required and advisory checks are separated.
- `1.0.0` release requires all release-blocking checks to be required, not
  advisory.

Required proof:

- `pnpm validate` passes.
- `pnpm hardening:all -- --expanded` passes with zero required failures.
- Crash/race/fault lanes pass on Windows and at least one Unix-like OS.
- Release notes link the exact hardening report paths and corpus commits.

## Current Highest-Value Gaps

1. Extend external-interference probes around commit for non-cooperative
   symlink swaps and changes after pre-commit revalidation.
2. Add transaction/recovery architecture before claiming crash recovery.
3. Expand corpus lanes to TypeScript, Kubernetes, LLVM, and disposable mutation
   copies.
4. Add memory/time telemetry to corpus reports.
5. Add streaming mutation architecture for files larger than the configured
   full-read limit.
