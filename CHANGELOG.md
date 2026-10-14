# Changelog

All notable changes to Scalpel are documented here.

## [Unreleased]

### Security

- Startup recovery no longer trusts records in the in-workspace transaction directory: it only deletes `.scalpel-*.tmp` files beside the record's target (a crafted record could delete any file before) and does not scan a symlinked or junctioned transaction directory (which could move or delete unrelated `*.json` files). Records that name paths outside the configured roots, directly or through a link, are left untouched, and records are never quarantined through a linked `quarantine` directory.
- `grep` no longer follows symlinks or junctions out of the configured roots; links are reported in `skipped_files` with reason `symlink` (a configured root that is itself a link is still searched).
- The operation journal is never appended through a symlink.
- Writes and moves now re-resolve their directories when they commit and recheck the target's and parent's identity right before the rename: a directory created as, or swapped for, a junction after validation could make `create` and `move` write outside the roots (or pull an outside file in) while reporting success.
- `@modelcontextprotocol/sdk` 1.32.1 and patched transitive dependencies (`pnpm audit` was reporting 32 advisories, all through the SDK).

### Fixed

- Streaming `patch` on oversized files could split a UTF-16 surrogate pair across output chunks and write astral characters (emoji, ...) as two U+FFFD while reporting success.
- An edit another process made while Scalpel was writing a replacement (seconds on the streaming paths, or during Windows rename retries) was silently overwritten; it now fails with `CONCURRENCY_CONFLICT`.
- Names that merely start with two dots (`..cache`, `..notes.txt`) were rejected as outside the root.
- A UTF-8 BOM was dropped by streaming `patch` and `delete_range` of line 1, and pushed mid-file by `prepend` and `insert` at line 1; ranged reads and `read_chunk` stripped it while full reads kept it; `grep` could not anchor `^` on line 1.
- `insert` after a final line without a newline glued the text onto that line.
- Every edit replaced the file's mode (scripts lost the executable bit); modes are now kept on POSIX, and read-only files fail with `PERMISSION_DENIED` instead of being replaced.
- On Windows, edits and moves failed with a raw `EPERM` whenever antivirus, the indexer, a sync client or an editor briefly held the file; the rename is now retried (`SCALPEL_RENAME_RETRY_MS`, default 5000).
- `list_dir` failed for any directory containing a binary or non-UTF-8 file and read every file in full; `stat` and `move` failed on small binary files.
- Ranged `read` ignored `maxReadBytes`, reported `lines: 0` for a range past the end, and took quadratic time on long lines.
- Unexpected exceptions (EACCES, EEXIST, ENOSPC, ...) reached MCP clients without a Scalpel error code; they now map to `PERMISSION_DENIED`, `FILE_NOT_FOUND`, `INVALID_INPUT`, or the new `IO_ERROR`/`INTERNAL_ERROR` codes with `details.cause_code`.
- Path locks did not serialize paths differing only by case on Windows/macOS, and a lock released mid-check threw an unstructured error.
- Failed writes and moves left transaction records behind (with `overwrite`, a failed move was later quarantined as unrecoverable); moving a directory into itself created stray directories; `read_chunk` threw for missing paths; `diff` ignored `allowHiddenPaths` and miscounted `+`/`-` content lines.

### Added

- Property-based tests (fast-check) for the streaming replace, ranged reads, `insert`, and `delete_range`.

## [1.0.0] - 2026-07-03

### Added

- Streaming exact-replacement, append, and prepend for existing UTF-8 files above `maxReadBytes`, through a bounded temp-file rewrite, including exact matches that span read-chunk boundaries.
- Explicit transaction recovery state machine: startup recovery classifies every scanned record as `committed`, `aborted`, or `unrecoverable`; corrupted or ambiguous records are quarantined under `config.transactionDir/quarantine` instead of being retried on every startup, and the recovery summary is logged to stderr.
- Commit-time revalidation for `move` (source, destination, and destination parent directory) immediately before `rename()`.
- Cross-device move detection: `EXDEV` failures are rejected with a dedicated `CROSS_DEVICE_MOVE_NOT_SUPPORTED` error instead of a copy fallback.
- A structured `LOCK_TIMEOUT` error for path-lock contention with a live owner, instead of an unstructured thrown error.
- Platform metadata in hardening reports: OS, OS release/version, architecture, Node version, a live parent-directory-fsync support probe, and which durability mode was exercised.
- A mutating MCP eval track (`evals/mutating/scalpel-mutating-workflow.xml`) covering inspect, dry run, apply, verify hash/content, and recover-from-stale-precondition workflows.
- CI workflows for Windows/Linux `pnpm validate`, an automatic starter hardening lane on push/PR, a manually dispatched expanded hardening lane, and release-asset building.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, issue/PR templates, and Dependabot configuration.

### Changed

- The safety model is finalized (no longer a draft) with testable definitions for crash-safe, race-proof, large-scale, recoverable, and unsupported environments. Hardening reports map every release claim to proof lanes and current status through `safety_model_version` and `claim_map`.
- All release-blocking hardening checks are `required`, not `advisory`.

### Fixed

- A logger that defaulted to writing to stdout, which would have corrupted the MCP stdio protocol once wired up for startup recovery logging; it now writes to stderr.
- CI, hardening, and release workflows failed immediately on every run: `actions/setup-node`'s `cache: pnpm` shelled out to `pnpm` before `corepack enable` had run, and the hardening workflow referenced the `runner` context from an invalid job-level `env:` position.
- A large-file RSS-growth hardening check used a single absolute threshold that failed in two different real environments from ordinary GC/allocator noise, not a real streaming regression; replaced with a relative comparison across two file sizes.

### Verification

- `pnpm validate` and `pnpm audit` pass on the final commit.
- Expanded hardening (public corpora: Express, Lodash, TypeScript, Kubernetes, LLVM) passed with 96/96 required checks on Windows and on Linux (`ubuntu-latest`, via GitHub Actions).

### Known Gaps

- Malicious same-user modification after Scalpel reports success remains outside the safety claim by design, not as an unproven gap.
- Parent-directory `fsync` support remains platform-dependent; the hardening report now records a live probe result per platform (unsupported/`EPERM` on Windows, supported on Linux) instead of only a narrative note.
- `batch_edit`, `insert`, `delete_range`, and `replace_between_markers` still require the full file to fit within `maxReadBytes`; only `patch`, `append`, and `prepend` stream oversized files.

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

[1.0.0]: https://github.com/0langa/scalpel/releases/tag/v1.0.0
[1.0.0-alpha.1]: https://github.com/0langa/scalpel/releases/tag/v1.0.0-alpha.1
