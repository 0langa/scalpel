# Current Audit

Audit date: 2026-06-04.

Scope: current TypeScript MCP server in this repository.

## Executive Summary

Scalpel already has a solid first-day foundation: thin MCP adapter, shared path policy, exact edit semantics, dry-run previews for mutators, structured tool errors, and real stdio integration tests.

It is still not the only file-operations MCP server needed for every coding and disk-management task. Remaining big categories are streaming edits, indexing, crash durability, recovery, permission policy, binary byte editing, parser-aware edits, and high-throughput native execution.

## Strengths

- Tool surface is small enough to reason about.
- Most tools share central path confinement.
- Exact edits reject ambiguity by default.
- Existing-file mutation preconditions exist.
- `batch_edit` validates before writing.
- MCP SDK code is isolated in `src/mcp/*`.
- Tests include real stdio client/server coverage.

## Findings

### High

1. Failure payload structure has been improved since the original audit.

Current `src/mcp/result.ts` failure results keep text and `isError: true` while also returning `structuredContent.error` for agent recovery.

2. Atomic write is not crash-durable.

`writeFileAtomic()` writes temp content then renames. It does not `fsync` temp file or parent directory. This is acceptable for first local tests, but not for critical infrastructure edits.

3. Large-file and terabyte-scale operations are not architected yet.

Full-text mutators still use bounded whole-file UTF-8 snapshots. Current improvements add `FILE_TOO_LARGE`, `read_chunk`, ranged streaming reads, and explicit grep skip reporting, but streaming edit/search architecture remains future work.

4. Binary and encoding safety has been improved.

Text tools now reject binary files and invalid UTF-8 with explicit error codes. Binary byte editing remains unsupported.

### Medium

5. Concurrency semantics have been strengthened since the original audit.

Content mutators support hash and mtime expectations for existing files. `create` supports overwrite expectations, `append` and `prepend` reject expectations for missing-file creation, and `move` supports source and overwrite-destination expectations.

6. Race windows remain around path validation and writes.

Path validation, snapshot read, and final write are separate operations. A file can change between those phases.

7. `maxDiffBytes` and `logLevel` are config fields without complete enforcement.

They should either become real runtime policy or be documented as reserved.

8. Manual reliability checklist includes unimplemented behaviors.

The suite docs referenced context grep, cross-file batch edit, duplicate-marker target selection, and log fixtures that do not exist.

9. Lint fixture handling has been corrected since the original audit.

ESLint ignores `scalpel-reliability-suite/`, which is a fixture tree outside `tsconfig.json`.

10. Operation journaling is now available.

Mutating tools can write metadata-only JSONL records when `SCALPEL_JOURNAL_ENABLED` is set. This helps eval and rollback reasoning but is not a transactional recovery mechanism.

### Low

11. `operation: "read" | "write"` is accepted by path policy but not used for different behavior.

This is harmless now, but future policy code should make the distinction meaningful or remove it.

12. Search is sequential and simple.

This keeps behavior easy to inspect, but it will not meet future throughput goals.

## Near-Term Documentation Outcome

The docs now separate:

- current implementation
- current contracts
- current safety guarantees
- known limitations
- reliability test posture

No future roadmap has been written yet.
