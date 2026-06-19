# Changelog

All notable changes to Scalpel are documented here.

## [1.0.0-alpha.1] - 2026-06-19

### Added

- Publishable `scalpel` command for local Codex and MCP installation.
- MCP resources for the safety model, tool contracts, testing guidance, and live configuration.
- Metadata-only write and move transaction records with startup recovery.
- Strict durability mode with temp-file sync and best-effort parent-directory sync.
- Cooperative multi-process path locks with stale-lock recovery.
- Hardening lanes for public corpora, races, process crashes, and fault injection.
- Expanded corpus telemetry and disposable mutation-copy checks for TypeScript, Kubernetes, and LLVM.

### Changed

- Text mutators revalidate immediately before commit and verify committed content before reporting success.
- Recursive grep supports include/exclude globs, context lines, bounded results, and excluded-directory pruning.
- Package and Codex installation documentation now describes the built `scalpel` binary.

### Fixed

- Pin vulnerable transitive `hono` and development-only `esbuild` dependencies to patched versions.
- Reject symlink swaps and non-cooperative filesystem interference around mutation commit.
- Reject concurrent same-precondition mutations instead of silently overwriting another result.
- Recover interrupted text writes, completed moves, stale locks, and repeated recovery cleanup after process crashes.
- Handle Windows long paths in expanded Git corpus setup.

### Known Gaps

- Full-text mutation still requires files to fit within `maxReadBytes`; streaming large-file mutation is not implemented.
- Crash and durability hardening has been proven on Windows, but Unix-like and cross-filesystem persistence evidence remains open.
- The safety claim does not cover malicious same-user modification after Scalpel has already reported success.
- Cross-device move recovery and guaranteed parent-directory sync on every platform are not provided.

[1.0.0-alpha.1]: https://github.com/0langa/scalpel/releases/tag/v1.0.0-alpha.1
