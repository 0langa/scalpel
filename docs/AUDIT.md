# Current Audit

Audit date: 2026-06-04.

Scope: current TypeScript MCP server in this repository.

## Executive Summary

Scalpel already has a solid first-day foundation: thin MCP adapter, shared path policy, exact edit semantics, dry-run diffs for main edit tools, and real stdio integration tests.

It is not yet close to the long-term goal of being the only file-operations MCP server needed for coding and general disk management. The biggest missing categories are streaming, indexing, durability, recovery, permission policy, binary safety, parser-aware edits, and high-throughput native execution.

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

1. Failure payload docs were overstated.

Current `src/mcp/result.ts` failure results contain text and `isError: true`, but not failure `structuredContent`. Docs now reflect this. Long-term agents should not need text parsing for error recovery.

2. Atomic write is not crash-durable.

`writeFileAtomic()` writes temp content then renames. It does not `fsync` temp file or parent directory. This is acceptable for first local tests, but not for critical infrastructure edits.

3. Large-file and terabyte-scale operations are not architected yet.

Core operations generally read full files into memory as UTF-8 strings. `grep` skips files over `maxReadBytes`, but `read`, `diff`, and mutators do not provide streaming or chunked behavior.

4. Binary and encoding safety are undefined.

`readFile(..., "utf8")` is the default file path. This can corrupt or misrepresent binary files and non-UTF-8 text.

### Medium

5. Concurrency semantics are asymmetric.

`patch` supports `expected_sha256` but not `expected_mtime_ms`; `move`, `create`, and missing-file append/prepend have limited precondition semantics.

6. Race windows remain around path validation and writes.

Path validation, snapshot read, and final write are separate operations. A file can change between those phases.

7. `maxDiffBytes` and `logLevel` are config fields without complete enforcement.

They should either become real runtime policy or be documented as reserved.

8. Manual reliability checklist includes unimplemented behaviors.

The suite docs referenced context grep, cross-file batch edit, duplicate-marker target selection, and log fixtures that do not exist.

9. Lint configuration currently includes fixture TypeScript outside `tsconfig.json`.

`pnpm lint` fails on files under `scalpel-reliability-suite/`. Typecheck, tests, and build pass.

### Low

10. `operation: "read" | "write"` is accepted by path policy but not used for different behavior.

This is harmless now, but future policy code should make the distinction meaningful or remove it.

11. Search is sequential and simple.

This keeps behavior easy to inspect, but it will not meet future throughput goals.

## Near-Term Documentation Outcome

The docs now separate:

- current implementation
- current contracts
- current safety guarantees
- known limitations
- reliability test posture

No future roadmap has been written yet.
