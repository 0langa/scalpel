# Scalpel Server Architecture And Scaffold Plan

This document turns [SPEC.md](../SPEC.md) into a concrete build plan for the first implementation of the Scalpel MCP server.

## Goal

Build a local-first MCP server for precise, deterministic file editing over `stdio`, using TypeScript, the official MCP TypeScript SDK, and Zod 4. The server should optimize for correctness, explicit failure modes, and clean migration to newer SDK versions.

## Design Decisions

### Runtime model

- Local server only for v1
- `stdio` transport only
- Single process
- No background daemon state
- No persistent database

### SDK boundary

The MCP SDK should be treated as a thin adapter layer around a pure editing core.

That gives us:

- lower migration cost from SDK v1.x to v2
- easier testing without MCP harnesses
- clearer separation between tool contracts and editing logic

### Safety model

The implementation should strengthen the original spec in these places:

- Reject ambiguous matches by default
- Restrict all paths to configured workspace roots
- Reject symlinks and reparse-point traversal
- Preserve line endings unless an operation explicitly changes content
- Use optimistic concurrency on all mutating tools

## Tool Surface

### MVP tools

- `read`
- `stat`
- `list_dir`
- `grep`
- `create`
- `patch`
- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`
- `append`
- `move`

### Deferred tools

- `prepend`
- standalone `diff`

These can be added after the edit core is stable because every mutating tool already supports `dry_run`.

## Protocol Shape

### MCP result model

Each tool should use:

- Zod 4 input schema
- Zod 4 output schema where practical
- `structuredContent` for machine-readable responses
- `content` with a compact text summary for clients that still rely on text
- `isError: true` for tool-level failures

### Error model

Keep the custom domain error object from the spec, but return it inside MCP-native tool results.

Suggested shape:

```json
{
  "ok": false,
  "error": {
    "code": "STRING_NOT_FOUND",
    "message": "old_string not found",
    "path": "C:\\repo\\src\\main.ts",
    "details": {}
  }
}
```

### Concurrency model

All mutating tools should optionally require one of:

- `expected_sha256`
- `expected_mtime_ms`

If provided and the file changed since the caller last read it, fail before mutation.

## Project Layout

```text
scalpel/
  docs/
    ARCHITECTURE.md
    STACK.md
  src/
    index.ts
    mcp/
      server.ts
      register-tools.ts
      result.ts
      annotations.ts
    tools/
      read.ts
      stat.ts
      list-dir.ts
      grep.ts
      create.ts
      patch.ts
      batch-edit.ts
      insert.ts
      delete-range.ts
      replace-between-markers.ts
      append.ts
      move.ts
      schemas/
        common.ts
        read.ts
        stat.ts
        list-dir.ts
        grep.ts
        create.ts
        patch.ts
        batch-edit.ts
        insert.ts
        delete-range.ts
        replace-between-markers.ts
        append.ts
        move.ts
    core/
      config.ts
      errors.ts
      path-policy.ts
      fs-types.ts
      file-metadata.ts
      line-index.ts
      line-endings.ts
      read-file.ts
      write-file-atomic.ts
      temp-path.ts
      diff.ts
      search.ts
      matchers.ts
      edit-session.ts
      operations/
        create-file.ts
        patch-file.ts
        batch-edit-file.ts
        insert-into-file.ts
        delete-range-from-file.ts
        replace-between-markers-in-file.ts
        append-to-file.ts
        move-path.ts
    infra/
      logger.ts
      env.ts
      sha256.ts
  tests/
    unit/
      core/
      tools/
    integration/
      stdio-server.test.ts
      inspector-smoke.test.ts
    fixtures/
      files/
```

## Module Responsibilities

### `src/index.ts`

- bootstrap process
- load config from env
- create MCP server
- connect `StdioServerTransport`

### `src/mcp/*`

- SDK-specific code only
- tool registration
- annotations
- adaptation from domain results to MCP result objects

### `src/tools/*`

- one file per public tool
- validate input
- call core operations
- translate core results to tool outputs

These files should stay thin.

### `src/core/*`

This is the real product.

Responsibilities:

- path normalization and root confinement
- metadata reads
- exact match discovery
- line and marker indexing
- edit planning
- dry-run diff generation
- atomic write execution
- concurrency validation

### `src/core/operations/*`

Pure file-editing use cases. Each operation should accept typed inputs and return a typed domain result. No MCP imports here.

## Core Types

### Config

```ts
export interface ScalpelConfig {
  roots: string[];
  allowHiddenPaths: boolean;
  maxReadBytes: number;
  maxDiffBytes: number;
  maxGrepResults: number;
  logLevel: "silent" | "error" | "info" | "debug";
}
```

### Domain result

```ts
export interface SuccessResult<T> {
  ok: true;
  data: T;
}

export interface FailureResult {
  ok: false;
  error: {
    code: string;
    message: string;
    path?: string;
    details?: Record<string, unknown>;
  };
}

export type DomainResult<T> = SuccessResult<T> | FailureResult;
```

### File snapshot

```ts
export interface FileSnapshot {
  absolutePath: string;
  content: string;
  encoding: "utf8";
  eol: "\n" | "\r\n" | "mixed" | "none";
  sizeBytes: number;
  lineCount: number;
  sha256: string;
  mtimeMs: number;
}
```

## Filesystem Policy

### Path normalization

Before any operation:

1. Resolve input path against a configured root if relative
2. Normalize separators
3. Resolve parent directories
4. Reject if final target escapes all configured roots
5. Reject if target or traversed path component is a symlink or reparse point

### Atomic writes

Mutating operations should follow this flow:

1. Read and validate current file state
2. Produce proposed content in memory
3. If `dry_run`, return diff only
4. Write temp file in the same directory
5. Flush file contents
6. Rename temp file into place
7. Re-read metadata and return final snapshot info

### Large file strategy

- `read` should stream ranged reads when possible
- mutating tools can still read the whole file for v1
- impose `maxReadBytes` and `maxDiffBytes` guards

## Tool Semantics Refinements

### `patch`

- default mode should be `occurrence: "unique"`
- if multiple matches are found, fail with `STRING_NOT_UNIQUE`
- `"first"` and `"all"` should be explicit caller choices

### `batch_edit`

- validate the full edit set against the same starting snapshot
- apply edits in order against an in-memory buffer
- if one edit fails, return `ATOMIC_FAILURE` and do not write

### Marker tools

- if a marker appears more than once and the caller did not disambiguate, fail
- do not silently use the first matching pair

### `append`

- preserve O(1) append behavior where possible
- if file metadata is needed for concurrency or line totals, fetch it separately

## Diff Strategy

Use unified diff for all previewable mutating tools.

Diff generation belongs in `src/core/diff.ts` and should:

- preserve file path headers
- preserve final newline semantics
- short-circuit if diff exceeds configured limits

## Logging

Logging should be structured and low overhead.

Log:

- startup config summary
- tool invocation name
- tool duration
- failure codes
- rejected path attempts

Do not log:

- full file contents
- secrets from environment
- huge diffs by default

## Test Strategy

### Unit tests

Focus on:

- path policy
- line ending preservation
- exact and ambiguous match detection
- atomic batch behavior
- marker disambiguation
- dry-run no-mutation guarantees
- concurrency mismatch failures

### Property tests

Use generated inputs to verify invariants such as:

- dry-run never mutates
- applying a no-op patch preserves hash
- line counts stay valid after edits
- batch validation either fully applies or fully fails

### Integration tests

- boot server over stdio
- call real MCP tools through the SDK client
- verify `structuredContent`
- verify `isError` behavior

## Initial Scaffold Sequence

### Phase 1: repo bootstrap

Create:

- `package.json`
- `tsconfig.json`
- `eslint.config.mjs`
- formatter config
- `vitest.config.ts`
- `.editorconfig`
- `.gitattributes`
- `src/index.ts`
- `src/mcp/server.ts`
- `src/core/errors.ts`
- `src/core/config.ts`

### Phase 2: vertical slice

Implement one complete read-only slice:

- `stat`
- `read`
- `list_dir`

This proves:

- config loading
- path policy
- MCP wiring
- schema/result pattern

### Phase 3: first mutator

Implement `patch` end to end with:

- exact matching
- ambiguity failure
- dry-run diff
- atomic write
- optimistic concurrency

This becomes the reference pattern for the rest.

### Phase 4: compositional mutators

Implement:

- `batch_edit`
- `insert`
- `delete_range`
- `replace_between_markers`

### Phase 5: search and append

Implement:

- `grep`
- `append`
- `move`

## Recommended First Milestone

The first milestone should ship a usable server with:

- `read`
- `stat`
- `list_dir`
- `patch`

That is enough to validate the protocol boundary, test real-world client compatibility, and lock the internal architecture before the rest of the tool surface expands.

## Open Decisions To Lock Before Coding

- SDK package line: stable `v1.x`
- ESM package layout: yes
- workspace root source: env var plus current working directory fallback
- ambiguity default: fail unless explicitly disambiguated
- concurrency field: `expected_sha256` preferred, `expected_mtime_ms` optional fallback
- diff hard limit: configurable

## Scaffold Acceptance Criteria

The scaffold is ready when:

- `pnpm build` passes
- `pnpm test` passes
- `pnpm lint` passes
- MCP Inspector can connect over stdio
- `read`, `stat`, `list_dir`, and `patch` work end to end
- a failed `dry_run: false` mutation cannot partially write a file
