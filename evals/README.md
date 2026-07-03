# Scalpel MCP Evals

`evals/read-only/scalpel-reliability.xml` is a read-only effectiveness eval over
`scalpel-reliability-suite/`. It supplements `pnpm test:mcp-smoke`: smoke tests
prove representative tool behavior, while evals check whether an agent can solve
stable, realistic questions with Scalpel tools.

Build the server first:

```powershell
pnpm build
```

Run the eval with an MCP eval harness that supports stdio servers, launching
Scalpel with a fixed root:

```text
transport: stdio
command: node
args: dist/index.js
env: SCALPEL_ROOTS=<repo>\scalpel-reliability-suite
eval file: evals/read-only/scalpel-reliability.xml
```

Generated reports should be written under `tmp/evals/`.

## Mutating Eval Track

`evals/mutating/scalpel-mutating-workflow.xml` is a mutating effectiveness eval.
Unlike the read-only track, it must never run against the tracked
`scalpel-reliability-suite/` tree directly, because it edits files. Copy the
fixture tree to a disposable location first:

```powershell
Copy-Item -Recurse scalpel-reliability-suite $env:TEMP\scalpel-eval-mutating
```

```bash
cp -r scalpel-reliability-suite /tmp/scalpel-eval-mutating
```

Then point the harness at the copy instead of the repo fixture:

```text
transport: stdio
command: node
args: dist/index.js
env: SCALPEL_ROOTS=<disposable-copy-path>
     SCALPEL_JOURNAL_ENABLED=true
     SCALPEL_JOURNAL_PATH=<disposable-copy-path>/.scalpel-eval-journal.jsonl
eval file: evals/mutating/scalpel-mutating-workflow.xml
```

The five tasks build on each other in order (inspect, dry run, apply, verify,
recover from a stale precondition) against `fixtures/tiny.txt` and
`config/settings.ini`, mirroring a realistic agent editing session rather than
independent questions. After a run, check the journal file at
`SCALPEL_JOURNAL_PATH`: every record must be metadata only (tool, path,
dry-run/applied status, error code, before/after hash/mtime/size) with no file
content, matching the guarantee in `docs/SAFETY_MODEL.md`.

Discard the disposable copy after each run instead of reusing it, so every eval
run starts from the same known fixture state.
