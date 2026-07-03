# Security Policy

## Supported Versions

Security fixes are supported for the latest `1.0.x` stable release. Older
prereleases (`1.0.0-alpha.x`) are no longer supported; upgrade to `1.0.0` or
later.

| Version | Supported |
| --- | --- |
| `1.0.x` | yes |
| `1.0.0-alpha.x` | no, upgrade |

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability.

Report privately through GitHub's private vulnerability reporting if enabled on
the repository. If that is unavailable, contact the repository owner through a
private channel and include:

- affected version or commit
- operating system and filesystem, if relevant
- configured `SCALPEL_ROOTS`
- exact tool call shape, without secrets or private file content
- observed result
- expected safety behavior
- whether file content, path confinement, symlink handling, journaling,
  recovery, or race safety is involved

## Security Boundary

Scalpel is local-first and workspace-confined. It is not an OS sandbox.
Operating-system user permissions remain the enforcement layer. The safety
model is documented in `docs/SAFETY_MODEL.md`.

Do not include private file content in vulnerability reports unless explicitly
requested through a private channel. Scalpel journals and recovery records are
designed to be metadata-only; reports should follow the same rule.
