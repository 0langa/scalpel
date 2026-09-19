# Scalpel — Status & Roadmap
_Portfolio audit: 2026-07-11_

## What this is
A local-first MCP server for precise, atomic file editing over stdio, aimed at coding agents that
need predictable edits and explicit failure behavior. Sixteen tools (`config`, `stat`, `read`,
`read_chunk`, `list_dir`, `grep`, `create`, `patch`, `batch_edit`, `insert`, `delete_range`,
`replace_between_markers`, `append`, `prepend`, `diff`, `move`) registered with a `scalpel_`
prefix in `src/mcp/register-tools.ts`. Stack: TypeScript ESM on Node >= 22, pnpm,
`@modelcontextprotocol/sdk`, zod, pino; vitest + fast-check + memfs; Biome + ESLint; CI in
`ci.yml`, `hardening.yml`, `release.yml`, with Dependabot active.

## Current state
This is the portfolio's flagship: released, audited, governed, and in daily use as an installed
MCP server on this machine.

What works:
- `v1.0.0` released 2026-07-03 (superseding `v1.0.0-alpha.1`) with full release notes and a
  point-in-time audit under `docs/releases/`. Working tree clean; post-release governance already
  landed (repo-surface cleanup, packaging-leak fix, five Dependabot bumps, PR #8 findings).
- Safety claims are versioned (`scalpel-safety-model-v1` in `docs/SAFETY_MODEL.md`) and backed by
  evidence: streaming mutation for oversized targets, an explicit transaction recovery state
  machine, commit-time revalidation for `move` with `EXDEV` rejection, and hardening lanes
  (corpus/race/crash via `scripts/hardening.ts`) passing on Windows and Linux.
- 12 vitest suites plus MCP smoke, packed-tarball smoke, agent evals under `evals/`, and the
  tracked `scalpel-reliability-suite/` fixture tree. Zero TODO/FIXME in `src/`.

Gaps and loose ends (mostly self-documented in `docs/AUDIT.md`):
- Not on the npm registry — install is GitHub release tarball or source only, which limits reach.
- `maxDiffBytes` and `logLevel` are accepted config fields without complete runtime enforcement
  (audit item 7: "become real policy or be documented as reserved").
- The manual reliability checklist still references behaviors that do not exist (context grep,
  cross-file batch edit, duplicate-marker target selection).
- Search (`src/tools/grep.ts`) is deliberately sequential; fine for v1, a known ceiling.
- `docs/AUDIT.md` closes with "No future roadmap has been written yet" — this file is that roadmap.
- Companion folder `..\scalpel_functionality` (~292k files) holds hardening corpora, mutation
  copies, reports, and the 1.0.0 release staging area; it is regenerable via
  `pnpm hardening:setup` and safe to prune for disk space.

## Definition of "finished"
v1.0.0 already meets a defensible "finished" bar. The next milestone (call it v1.1) is done when:
the npm distribution decision is executed (published — likely scoped, e.g. `@0langa/scalpel` —
or README states GitHub-only as policy); audit items 7 and 8 are closed (config fields enforced or
marked reserved; reliability checklist trimmed to implemented behavior); and a public roadmap doc
exists so `docs/AUDIT.md`'s closing gap is resolved.

## Roadmap

### Phase 1 — Now (next 1–2 weeks)
- Decide and execute npm publishing: check name availability, prefer a scoped package, add a
  `release.yml` publish step with provenance; otherwise document tarball-only distribution in
  `README.md` as deliberate.
- Close audit item 7: enforce `maxDiffBytes` in `src/core/diff.ts` / `src/core/config.ts` and wire
  `logLevel` through the pino setup in `src/index.ts`, or mark both reserved in
  `docs/TOOL_CONTRACTS.md`.
- Trim `scalpel-reliability-suite/RELIABILITY_CHECKLIST.md` to behaviors that exist (audit item 8),
  and promote this file's content into `docs/` as the roadmap of record.

### Phase 2 — Next (2–6 weeks)
- v1.1 quality pass: make the `operation: "read" | "write"` distinction in
  `src/core/path-policy.ts` meaningful or remove it (audit item 11); keep merging Dependabot PRs.
- Extend the mutating eval track (`evals/mutating/scalpel-mutating-workflow.xml`) with cases drawn
  from real agent sessions; re-run expanded hardening and refresh evidence in
  `docs/TESTING_AND_RELIABILITY.md`.
- Light performance work on `grep`/traversal (bounded concurrency) without abandoning the
  "easy to inspect" stance in `docs/CURRENT_STATE.md`.

### Phase 3 — Later (optional/stretch)
- The explicitly out-of-scope v1 items, if demand appears: AST-aware structured edits, binary byte
  editing, large-scale indexing, parallel traversal.
- Registry presence beyond npm: MCP server directories/marketplaces, plus a `npx`-runnable entry
  to lower adoption friction.

## Effort to "finished"
**S (<1 week part-time)** for the v1.1 bar above — publish decision, two audit items, one doc.
The Phase 3 ambitions are L and should only start with a concrete user need.
