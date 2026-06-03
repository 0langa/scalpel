# Kimi Test Prompt For Scalpel

Use this prompt inside Kimi Code when the current working directory is this repository and the `scalpel` MCP server is connected.

## Prompt

```text
You are validating the connected `scalpel` MCP server in this repository.

Your goal is to exercise all 14 Scalpel tools and verify both normal behavior and at least a few important safety behaviors.

Important constraints:
- You may use the full repository as your workspace.
- Do not leave the repository in a messy state.
- Either:
  1. do all destructive testing inside a dedicated temporary folder such as `tmp/scalpel-mcp-test/`, then remove it when done, or
  2. if you touch existing files outside that folder, revert those changes before finishing.
- Prefer the dedicated temporary folder approach.
- Do not modify `.git/`.
- Do not change dependency lockfiles, package versions, or the core implementation unless absolutely necessary for the test itself.

Required tools to exercise:
- `stat`
- `read`
- `list_dir`
- `grep`
- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `prepend`
- `diff`
- `move`

Testing instructions:

1. Create a dedicated test workspace folder under `tmp/scalpel-mcp-test/`.
2. Inside that folder, create a small set of test files with predictable content:
   - one TypeScript-like file
   - one markdown/text file
   - one config-like file with clear start/end markers
   - one nested subdirectory for recursive search tests
3. Use each of the 14 Scalpel tools at least once.
4. For mutating tools, verify the result by reading files back afterward.
5. Include at least these safety checks:
   - confirm `patch` fails or would fail on ambiguous matches unless disambiguated
   - confirm a `dry_run` mutation does not actually change file contents
   - confirm `batch_edit` behaves atomically by attempting one valid and one invalid edit in the same batch
6. Use `grep`, `read`, and `stat` as verification tools, not only as standalone tool demos.
7. At the end, produce a concise report in `tmp/scalpel-mcp-test-report.md` summarizing:
   - each tool used
   - whether it succeeded
   - any unexpected behavior
   - any likely bugs or rough edges
   - whether cleanup was completed
8. Clean up the temporary test directory when you are done, but keep the final report file in the repo root `tmp/` directory.

Preferred execution style:
- Be methodical and explicit.
- Announce what you are testing before each group of actions.
- If a tool behaves incorrectly, do not hide it; record it in the report.

Success criteria:
- all 14 tools are exercised
- at least 3 safety/behavior checks are performed
- final report is written
- repo is left clean except for the intentional final report file in `tmp/`

Begin now.
```

## Notes

- This prompt is intentionally repo-local and stateful.
- It is designed for regression testing after future Scalpel changes.
- If you want stricter comparisons later, the next upgrade should be turning this into a checklist-driven golden test harness plus a machine-readable report format.
