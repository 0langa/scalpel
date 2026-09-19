# Scalpel Final Release Sprint

This document is the execution plan for moving Scalpel from `1.0.0-alpha.1`
to a defensible, completed `1.0.0` GitHub release.

The release bar is intentionally high: Scalpel `1.0.0` must be proven
crash-safe, race-proof, and large-scale within an explicit safety model. If a
case is not implemented and proven, it must be outside the final safety claim
or fail closed.

## Current Baseline

- Current version: `1.0.0-alpha.1`
- Current branch/tag baseline: `main`, `v1.0.0-alpha.1`
- Current local completion gate: `pnpm validate`
- Current public prerelease:
  `https://github.com/0langa/scalpel/releases/tag/v1.0.0-alpha.1`
- Current status: strong alpha, not final `1.0.0`

Verified alpha capabilities:

- Installable `scalpel` stdio MCP package entry.
- Root-confined read and mutation tools.
- Dry-run support for mutators.
- Metadata-only journal records.
- Metadata-only transaction records for text writes and moves.
- Startup transaction recovery.
- Optional strict durability mode.
- In-process and cooperative multi-process path locks.
- Stale-lock recovery.
- Commit-time revalidation.
- Post-commit content verification before success.
- Symlink-swap rejection around text mutation commit.
- MCP smoke, package smoke, unit, integration, and hardening harnesses.
- Windows alpha evidence for public-corpus, race, crash, and fault lanes.

Known blockers before final `1.0.0`:

- Streaming mutation for files larger than `maxReadBytes` is not implemented.
- Cross-platform crash, durability, and fsync evidence is incomplete.
- Cross-device move semantics are not final.
- Parent-directory flush remains platform-dependent.
- Malicious same-user mutation after Scalpel reports success is not covered.
- Final release evidence must be generated from the final commit, not reused
  from the alpha.

## Definition Of Done

Scalpel is releasable as `1.0.0` only when all of these are true:

- `pnpm validate` passes on the final commit.
- `pnpm audit` reports no known production vulnerability requiring action.
- `pnpm hardening:all -- --expanded` passes on Windows from the final commit.
- The release-blocking hardening lanes pass on at least one Unix-like
  filesystem from the final commit.
- All release-blocking hardening checks are marked `required`, not `advisory`.
- Each final safety claim maps to machine-readable evidence in `report.json`.
- Release evidence includes corpus commit hashes, tracked file counts, duration,
  peak/final RSS, per-check duration, and failure details if any.
- Documentation distinguishes current guarantees, limitations, and unsupported
  environments.
- Package install smoke proves the published package path users will configure.
- GitHub release contains source tag, release notes, npm tarball, evidence zip,
  and checksum file.
- GitHub repository has the normal completed-product surface: README, license,
  changelog, security policy, contribution guide, code of conduct, issue
  templates, PR template, CI badges, release workflow, and support/contact
  guidance.

## Sprint Structure

Run `pnpm validate` after each implementation phase. If the phase changes
release-blocking behavior, also run the relevant hardening lane before moving
on.

Recommended branch:

```powershell
git switch -c cdx/final-release-sprint
```

External hardening workspace:

```powershell
C:\Users\Julius\source\repos\sandbox\scalpel_functionality\scalpel-hardening
```

## Phase 1: Freeze The 1.0 Safety Contract

Goal: make the release claim precise enough to test.

Implementation tasks:

- Update `docs/SAFETY_MODEL.md` with testable definitions for:
  - `crash-safe`
  - `race-proof`
  - `large-scale`
  - `recoverable`
  - `unsupported environment`
- Define supported filesystem classes for `1.0.0`.
- Define the boundary for malicious same-user changes after Scalpel reports
  success.
- Decide whether cross-device moves are supported, rejected, or explicitly
  outside scope.
- Define how strict durability differs from default durability.
- Define how platform-dependent parent-directory flush warnings affect the
  safety claim.
- Update `docs/HARDENING.md` so every final claim has a proof lane.
- Update `docs/TOOL_CONTRACTS.md` where user-visible behavior changes.

Proof tasks:

- Add a safety-contract test or lint check that fails if final release notes
  contain broad terms such as "fully crash-safe" without linking to the safety
  model.
- Add hardening report fields for `safety_model_version` and `claim_map`.

Gate:

```powershell
pnpm validate
```

Exit criteria:

- Final safety terms are documented.
- Unsupported cases are explicit.
- Every release claim has a planned proof lane.

## Phase 2: Streaming Large-File Mutation

Goal: remove the current large-scale blocker where full-text mutation requires
files to fit within `maxReadBytes`.

Implementation tasks:

- Add streaming SHA-256 and size helpers.
- Add bounded UTF-8 streaming readers for mutation planning.
- Add streaming exact replacement for `patch` where `old_string` is unique.
- Add streaming append and prepend paths that do not require a full-file read.
- Add bounded temp-file rewrite for large exact edits.
- Preserve current binary and invalid UTF-8 rejection behavior.
- Preserve current diff/output size limits.
- Add clear errors when an edit cannot be streamed safely.
- Keep existing small-file behavior backward compatible.

Expected files:

- `src/core/file-metadata.ts`
- `src/core/mutation.ts`
- `src/core/write-file-atomic.ts`
- `src/tools/patch.ts`
- `src/tools/append.ts`
- `src/tools/prepend.ts`
- `src/tools/diff.ts`
- `tests/unit`
- `scripts/hardening.ts`

Proof tasks:

- Add synthetic large-file tests above `maxReadBytes`.
- Add streaming mutation hardening checks with bounded RSS assertions.
- Add generated-file and long-line fixtures.
- Add tests for uniqueness detection across chunk boundaries.
- Add tests that large binary/non-UTF-8 files still fail closed.

Gate:

```powershell
pnpm validate
pnpm hardening:corpus -- --expanded
```

Exit criteria:

- Large text files can be edited with bounded memory for supported operations.
- Unsupported large edits fail clearly without mutation.
- Hardening reports include skipped/streamed/edited large-file counts.

## Phase 3: Transaction And Recovery State Machine

Goal: make crash recovery deterministic and auditable.

Implementation tasks:

- Refactor transaction records into explicit states:
  - `started`
  - `temp_written`
  - `renamed`
  - `committed`
  - `aborted`
  - `unrecoverable`
- Record recovery decisions without file content.
- Ensure transaction record writes are themselves durable enough for the final
  safety model.
- Add deterministic cleanup for stale temp files.
- Add structured recovery warnings.
- Add startup recovery summary logging.
- Add corrupted-record handling that fails closed or quarantines records.
- Add final behavior for cross-device moves:
  - preferred: detect and reject with a clear unsupported error before mutation
  - optional later: copy/fsync/rename/delete with transaction recovery

Expected files:

- `src/core/write-transaction.ts`
- `src/core/write-file-atomic.ts`
- `src/tools/move.ts`
- `src/index.ts`
- `tests/unit/core/write-file-atomic.test.ts`
- `scripts/hardening.ts`

Proof tasks:

- Add recovery tests for every transaction state.
- Add tests for missing temp, missing target, both source and destination
  present, corrupted record, and repeated cleanup crash.
- Add hardening fault points around transaction record creation, update, fsync,
  rename, cleanup, and startup recovery.

Gate:

```powershell
pnpm validate
pnpm hardening:crash
```

Exit criteria:

- Recovery produces old content, new content, or an explicit unrecoverable
  state. It never silently accepts unknown partial state.
- Recovery reports are metadata-only.

## Phase 4: Race-Proofing And Interference Coverage

Goal: prove mutation commits do not silently overwrite concurrent or hostile
local changes within the final safety model.

Implementation tasks:

- Revalidate target and parent path state as close to commit as possible.
- Revalidate move source, destination, and parent directories.
- Ensure deterministic lock ordering for every multi-path operation.
- Ensure lock release is robust after callback failure.
- Decide whether lock files should be inside root, temp, or configured lock
  directory for final recommended deployment.
- Add clearer error codes for lock timeout and stale-lock recovery.

Proof tasks:

- Add hardening interference cases for:
  - external write before commit
  - external delete before commit
  - external directory replacement before commit
  - external symlink replacement before commit
  - external write after commit but before success
  - source replacement during move
  - destination replacement during move
  - parent directory replacement during move
  - stale lock from killed process
  - live lock timeout
- Confirm all current mutators are covered:
  - `create`
  - `patch`
  - `batch_edit`
  - `insert`
  - `delete_range`
  - `replace_between_markers`
  - `append`
  - `prepend`
  - `move`

Gate:

```powershell
pnpm validate
pnpm hardening:race
```

Exit criteria:

- No release-blocking race case allows silent overwrite.
- Reports show zero unexpected double-writes.
- Unsupported hostile interference cases are documented and fail closed where
  possible.

## Phase 5: Cross-Platform Durability Evidence

Goal: prove the final safety claim on Windows and a Unix-like filesystem.

Implementation tasks:

- Add CI or script support for Linux hardening runs.
- Make hardening output portable across Windows and Linux paths.
- Add platform fields to `report.json`:
  - OS
  - kernel/version
  - Node version
  - filesystem probe results
  - parent-directory sync support
  - strict/default durability mode
- Add explicit detection/reporting for unsupported fsync behavior.

Proof tasks:

- Run final expanded hardening on Windows.
- Run final release-blocking lanes on Linux or another Unix-like filesystem.
- Preserve reports as release artifacts.

Windows gate:

```powershell
pnpm build
pnpm hardening:setup -- --expanded
pnpm hardening:all -- --expanded
```

Unix-like gate:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm hardening:setup -- --expanded
pnpm hardening:all -- --expanded
```

Exit criteria:

- Final reports exist for Windows and Unix-like environments.
- Any platform-specific limitation is documented in the final release notes.

## Phase 6: MCP Effectiveness And Agent Evals

Goal: prove agents can use Scalpel effectively, not only that individual tools
return correct results.

Implementation tasks:

- Keep MCP smoke tests as correctness coverage.
- Add read-only eval runner documentation if not already sufficient.
- Add a mutating eval track for exact edit workflows against disposable
  workspaces.
- Add task reports under ignored `tmp/` or hardening report paths.
- Keep eval fixtures stable and deterministic.

Proof tasks:

- Run 10 read-only eval questions over `scalpel-reliability-suite`.
- Run mutating evals for realistic agent workflows:
  - inspect file
  - dry run
  - apply exact edit
  - verify hash/content
  - recover from stale precondition
- Verify all generated reports are content-safe and do not leak file contents
  into journals.

Gate:

```powershell
pnpm validate
```

Exit criteria:

- Eval results support the claim that Scalpel is usable by coding agents, not
  only manually callable.

## Phase 7: CI, Automation, And Release Gates

Goal: make the GitHub repository look and behave like a completed maintained
product.

Implementation tasks:

- Add `.github/workflows/ci.yml`.
- Add `.github/workflows/hardening.yml`.
- Add `.github/workflows/release.yml` or documented manual release workflow.
- Add branch protection recommendations in docs.
- Add cache configuration for pnpm.
- Upload hardening reports as workflow artifacts.
- Ensure CI runs on pull requests and pushes to `main`.
- Ensure release workflow can build tarball, checksums, and evidence assets.

Minimum CI jobs:

- Windows `pnpm validate`.
- Linux `pnpm validate`.
- Package smoke from packed tarball.
- Starter hardening lane.
- Manual expanded hardening workflow.

Release-blocking local gate:

```powershell
pnpm validate
pnpm audit
pnpm build
pnpm test:mcp-smoke
pnpm test:package-smoke
pnpm hardening:all -- --expanded
pnpm pack
```

Exit criteria:

- A clean GitHub Actions run exists for the final commit.
- Release artifacts can be produced without manual file surgery.

## Phase 8: GitHub Product Completeness

Goal: make the repository complete for public users, maintainers, and security
reviewers.

Required repository files:

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/hardening.yml`
- `.github/workflows/release.yml` or `docs/RELEASE_PROCESS.md`

README completion checklist:

- Status badge for CI.
- Current stable version badge after release.
- Clear MCP purpose statement.
- Install instructions for package/tarball/local build.
- Codex CLI setup example.
- `config.toml` setup example.
- Tool list.
- Safety model summary.
- Known unsupported cases.
- Validation commands.
- Link to final release notes and evidence.

Documentation completion checklist:

- Architecture overview is current.
- Tool contracts match implemented behavior.
- Safety model does not overclaim.
- Testing/reliability docs match actual commands.
- Hardening docs explain report interpretation.
- Release process is documented.
- Security policy describes supported versions and disclosure path.
- Contributing guide describes development setup, test gates, and coding rules.

GitHub settings checklist:

- Repository description is accurate.
- Repository topics include relevant terms such as `mcp`, `codex`,
  `file-editing`, `typescript`.
- Default branch is `main`.
- Issues are enabled if public feedback is wanted.
- Discussions are enabled only if someone will monitor them.
- Branch protection is enabled for `main`.
- Required CI checks are configured.
- Releases are visible and prerelease state is correct.

Exit criteria:

- A new user can understand, install, run, test, and safely evaluate Scalpel
  from GitHub without private thread context.

## Phase 9: Final Version And Release Artifacts

Goal: prepare the actual `1.0.0` release commit.

Implementation tasks:

- Update `package.json` version to `1.0.0`.
- Update `src/version.ts` to `1.0.0`.
- Update `CHANGELOG.md` with `1.0.0`.
- Add `docs/releases/YYYY-MM-DD-v1.0.0.md`.
- Add `docs/releases/YYYY-MM-DD-v1.0.0-audit.md`.
- Ensure release notes link to final evidence assets.
- Ensure alpha known gaps are removed only if fixed or moved to unsupported
  scope.
- Ensure npm package file list includes all intended docs.
- Verify package tarball contents.

Commands:

```powershell
pnpm install --frozen-lockfile
pnpm validate
pnpm audit
pnpm build
pnpm hardening:all -- --expanded
pnpm pack
```

Package inspection:

```powershell
pnpm pack --json
tar -tf scalpel-1.0.0.tgz
```

Evidence packaging:

```powershell
Compress-Archive `
  -Path C:\Users\Julius\source\repos\sandbox\scalpel_functionality\scalpel-hardening\reports\FINAL_REPORT_DIR\* `
  -DestinationPath C:\Users\Julius\source\repos\sandbox\scalpel_functionality\scalpel-release\1.0.0\scalpel-1.0.0-evidence.zip
```

Checksum generation:

```powershell
Get-FileHash scalpel-1.0.0.tgz -Algorithm SHA256
Get-FileHash scalpel-1.0.0-evidence.zip -Algorithm SHA256
```

Exit criteria:

- Final release commit contains version, docs, changelog, and release notes.
- Final evidence assets are generated from that exact commit.

## Phase 10: GitHub Release

Goal: create the actual public GitHub `v1.0.0` release.

Pre-release checks:

```powershell
git status -sb
git log --oneline -5 --decorate
pnpm validate
pnpm audit
pnpm hardening:all -- --expanded
```

Commit:

```powershell
git add .
git commit -m "Release v1.0.0"
git push origin main
```

Tag:

```powershell
git tag -a v1.0.0 -m "Scalpel v1.0.0"
git push origin v1.0.0
```

Create GitHub release:

```powershell
gh release create v1.0.0 `
  --title "Scalpel v1.0.0" `
  --notes-file docs/releases/YYYY-MM-DD-v1.0.0.md `
  scalpel-1.0.0.tgz `
  scalpel-1.0.0-evidence.zip `
  SHA256SUMS.txt
```

Verify release:

```powershell
gh release view v1.0.0 --json tagName,isDraft,isPrerelease,url,assets
```

Final release checklist:

- Release is not draft.
- Release is not prerelease.
- Tag points to the final release commit.
- Assets are uploaded.
- Asset checksums match local checksums.
- Release notes include:
  - summary
  - installation
  - safety claim
  - evidence summary
  - supported platforms
  - unsupported cases
  - migration notes from alpha
  - verification commands
- `README.md` points to the stable release, not alpha.
- `CHANGELOG.md` links to the GitHub release.

Exit criteria:

- `https://github.com/0langa/scalpel/releases/tag/v1.0.0` exists and is the
  canonical stable release.

## Optional: npm Publication

Publishing to npm is not required for a GitHub-only release, but if the product
is expected to be installable by normal package workflows, add this as a final
release step.

Preconditions:

- Package ownership and npm auth are confirmed.
- Package name availability is confirmed.
- `npm publish --dry-run` succeeds.
- README and package metadata are final.

Commands:

```powershell
npm publish --dry-run
npm publish --access public
```

Post-publish verification:

```powershell
npm view scalpel version
npm view scalpel dist.tarball
```

If npm publish is not done, the GitHub release notes must clearly state that
installation is from source, tarball, or local clone.

## Final Quality Gate

The final release cannot ship with any unchecked item in this list:

- [ ] Safety model final and non-overclaiming.
- [ ] Streaming large-file mutation implemented or final claim narrowed.
- [ ] Cross-device move behavior finalized.
- [ ] Transaction recovery state machine complete.
- [ ] Race/interference hardening lanes complete.
- [ ] Windows expanded hardening report generated from final commit.
- [ ] Unix-like hardening report generated from final commit.
- [ ] CI green on final commit.
- [ ] `pnpm validate` green on final commit.
- [ ] `pnpm audit` clean or documented with accepted non-production risk.
- [ ] Package smoke passes from packed tarball.
- [ ] README updated for stable release.
- [ ] `SECURITY.md` added.
- [ ] `CONTRIBUTING.md` added.
- [ ] `CODE_OF_CONDUCT.md` added.
- [ ] `SUPPORT.md` added.
- [ ] Issue templates added.
- [ ] PR template added.
- [ ] CI workflows added.
- [ ] Release workflow or release process documented.
- [ ] Changelog updated.
- [ ] Final release notes added.
- [ ] Evidence zip generated.
- [ ] SHA256 checksums generated.
- [ ] `v1.0.0` tag pushed.
- [ ] GitHub release created.
- [ ] GitHub release verified.
- [ ] RECALL updated with verified final release state.

## Post-Release Verification

After the GitHub release exists:

```powershell
gh release view v1.0.0 --json tagName,isDraft,isPrerelease,url,assets
git ls-remote --tags origin v1.0.0
```

Fresh install smoke from release asset:

```powershell
mkdir C:\Users\Julius\source\repos\sandbox\scalpel_functionality\install-smoke-1.0.0
cd C:\Users\Julius\source\repos\sandbox\scalpel_functionality\install-smoke-1.0.0
pnpm init
pnpm add https://github.com/0langa/scalpel/releases/download/v1.0.0/scalpel-1.0.0.tgz
node node_modules/scalpel/dist/index.js
```

Record final state:

```powershell
python C:/Users/Julius/.codex/plugins/cache/0langas-plugins/recall/1.0.0/scripts/recall_skill.py save-insight project_state "Scalpel v1.0.0 was released on GitHub with final evidence, checksums, and validated hardening reports."
```

## Recommended Execution Order

1. Freeze safety contract.
2. Implement streaming large-file mutation.
3. Harden transaction and recovery state machine.
4. Complete race and interference proof.
5. Add cross-platform hardening evidence.
6. Add MCP effectiveness/mutating evals.
7. Add CI and release automation.
8. Complete GitHub product files.
9. Prepare final version, changelog, release notes, tarball, evidence, and
   checksums.
10. Tag and publish GitHub `v1.0.0`.
11. Verify fresh install from release asset.
12. Save verified release state to RECALL.
