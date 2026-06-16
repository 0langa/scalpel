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

The mutating exact-edit eval track is intentionally separate and not yet enabled
by default, because it should run against a disposable copy of the fixture tree.
