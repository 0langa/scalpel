# Summary

Describe the change.

# Verification

- [ ] `pnpm validate`
- [ ] relevant hardening lane, if safety behavior changed

# Safety Checklist

- [ ] Root confinement preserved.
- [ ] Symlink/hidden-path policy preserved.
- [ ] Journals and recovery records remain metadata-only.
- [ ] Tool contracts updated if behavior changed.
- [ ] Safety model updated if guarantees changed.
- [ ] Backward-compatible tool aliases preserved.
