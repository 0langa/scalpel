# Contributing To Scalpel

## Development Setup

Requirements:

- Node.js matching `package.json`
- pnpm matching `packageManager`
- Git

Install:

```powershell
pnpm install
```

Run the local server:

```powershell
pnpm dev
```

Build:

```powershell
pnpm build
```

## Required Gate

Before claiming implementation work complete, run:

```powershell
pnpm validate
```

For safety-sensitive changes, also run the relevant hardening lane:

```powershell
pnpm hardening:race
pnpm hardening:crash
pnpm hardening:corpus
```

Expanded release hardening:

```powershell
pnpm hardening:setup -- --expanded
pnpm hardening:all -- --expanded
```

## Safety Rules

- Preserve workspace-root confinement.
- Preserve symlink and hidden-path policy.
- Prefer dry runs before manual mutation tests.
- Keep journals and recovery records metadata-only.
- Do not add file content to hardening reports.
- Keep canonical tool names and `scalpel_*` aliases backward compatible.
- Do not document future safety goals as current guarantees.

## Documentation Rules

- Update `docs/TOOL_CONTRACTS.md` for user-visible tool behavior changes.
- Update `docs/SAFETY_MODEL.md` for guarantee or threat-model changes.
- Update `docs/HARDENING.md` for hardening lane or release-gate changes.
- Update `CHANGELOG.md` for release-facing changes.

## Pull Request Checklist

- [ ] `pnpm validate` passes.
- [ ] Relevant hardening lane passes, if safety behavior changed.
- [ ] Tool contracts updated, if behavior changed.
- [ ] Safety model updated, if guarantees changed.
- [ ] Journals/reports remain metadata-only.
- [ ] Backward-compatible aliases still work.
