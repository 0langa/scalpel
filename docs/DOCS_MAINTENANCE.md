# Docs Maintenance

Docs must follow code, tests, and config. Do not preserve aspirational claims as if they are implemented.

## Source Priority

Use this order:

1. `src/*`
2. `tests/*`
3. `package.json`, `tsconfig*`, lint/test config
4. command output
5. existing docs

## When Changing Tools

Update these docs when a public tool changes:

- `README.md`
- `SPEC.md`
- `docs/TOOL_CONTRACTS.md`
- `docs/SAFETY_MODEL.md` if safety semantics changed
- tests under `tests/unit/tools/*` or `tests/integration/*`

## When Changing Safety Behavior

Update:

- `docs/SAFETY_MODEL.md`
- `docs/AUDIT.md` if a risk is resolved or added
- tests for symlinks, root escapes, hidden paths, stale writes, and dry runs

## When Changing Test Fixtures

Update:

- `scalpel-reliability-suite/TESTING_NOTES.md`
- `scalpel-reliability-suite/RELIABILITY_CHECKLIST.md`
- `docs/TESTING_AND_RELIABILITY.md` if fixture purpose changes

## Language Rules

Use:

- "supports" only when code and tests prove it
- "currently" for implementation facts
- "target" for future requirements
- "unknown" when not verified

Avoid:

- "safe" without defining threat model
- "atomic" without specifying durability level
- "structured" for failure payloads unless `structuredContent` behavior is covered by tests
- "large-scale" unless memory and performance limits are stated
