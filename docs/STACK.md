# Scalpel Stack

This file locks the recommended implementation stack for the first Scalpel release, with performance and reliability as the main priorities.

## Core Choices

- Language: TypeScript
- MCP SDK: official MCP TypeScript SDK `v1.x`
- Validation: Zod 4
- Runtime: Node.js 22 LTS
- Package manager: pnpm
- Transport: stdio

## Why This Stack

### TypeScript

Best fit for:

- official SDK support
- strong types across tool contracts and filesystem core
- good editor support
- good test and lint ecosystem

### MCP TypeScript SDK `v1.x`

Use stable `v1.x` now.

Reason:

- the SDK repo `main` branch is v2 pre-alpha
- `v1.x` is still the recommended production line
- migration cost stays manageable if the SDK adapter layer stays thin

Current package choice in this repo:

- `@modelcontextprotocol/sdk`

The newer split-package examples around `@modelcontextprotocol/server` reflect the v2 line and alpha packaging, not the stable line this project currently targets.

### Zod 4

Use Zod 4 for:

- tool input validation
- tool output schemas where useful
- inferred TypeScript types
- clean MCP schema integration

## Runtime And Packaging

### Node.js

Use Node.js 22 LTS.

Reason:

- stable LTS line
- modern filesystem APIs
- strong compatibility with current TS tooling

### Package manager

Use `pnpm`.

Reason:

- fast installs
- disk-efficient dependency store
- strong workspace support if the repo grows later

### Module format

Use ESM with:

- `"type": "module"` in `package.json`
- `module: "nodenext"` in `tsconfig.json`
- `moduleResolution: "nodenext"` in `tsconfig.json`

Reason:

- modern Node default direction
- clean alignment with current package exports patterns

## Build And Dev Tools

### Compiler

Use plain `tsc` for builds.

Reason:

- most reliable baseline
- no bundler complexity
- enough for a stdio server

### Dev runner

Use `tsx` for local development scripts.

Reason:

- fast TypeScript execution
- good ESM ergonomics
- avoids slow `ts-node` workflows

### Linting

Use ESLint flat config with `typescript-eslint` typed rules.

Reason:

- best bug-catching value for backend TypeScript
- catches unsafe async, unchecked types, and invalid assumptions

### Formatting

Use Biome as formatter only.

Reason:

- very fast
- simple developer experience
- keep semantic linting in ESLint

If Biome formatting friction appears, fallback to Prettier is acceptable without changing the rest of the stack.

## Testing Stack

### Test runner

Use Vitest.

Reason:

- fast
- strong TypeScript support
- good mocking and watch mode

### Property testing

Use `fast-check`.

Reason:

- excellent fit for edit-engine invariants
- catches edge cases example-based tests miss

### In-memory filesystem tests

Use `memfs` for unit-level filesystem simulation.

Reason:

- keeps unit tests fast
- makes path and mutation scenarios easier to exercise

Do not rely on it alone. Keep real filesystem integration tests too.

## Logging And Diagnostics

### Logger

Use `pino`.

Reason:

- low overhead
- structured logs
- easy to disable or reduce in stdio environments

### Hashing

Use Node built-in `crypto`.

Reason:

- no external dependency needed
- enough for optimistic concurrency via SHA-256

## Diff And Search

### Diff

Use the `diff` package (`jsdiff`).

Reason:

- unified diff support
- mature and straightforward API
- better fit than fuzzy patching libraries for deterministic edits

### Search

Use a Node-native search implementation for baseline behavior.

Optional optimization:

- detect and use `rg` if installed for faster recursive grep

This keeps the server portable and reliable even when external tools are absent.

## Recommended Dependencies

### Production

- `@modelcontextprotocol/sdk`
- `zod`
- `pino`
- `diff`

### Development

- `typescript`
- `tsx`
- `vitest`
- `fast-check`
- `memfs`
- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `@types/node`
- `biome`

## Recommended Scripts

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "inspector": "npx @modelcontextprotocol/inspector"
  }
}
```

## Non-Goals For V1

- no database
- no HTTP transport
- no bundler
- no worker threads
- no fuzzy edit application
- no SDK-v2-only abstractions

## Upgrade Posture

To keep migration to SDK v2 cheap:

- isolate all SDK usage under `src/mcp/`
- keep tool logic out of SDK registration code
- keep core edit operations pure and typed
- test through real stdio integration, not just unit mocks

## Final Recommendation

If we want the highest-confidence starting point, the stack should be:

- Node.js 22 LTS
- pnpm
- TypeScript
- official MCP TypeScript SDK `v1.x`
- Zod 4
- `tsc`
- `tsx`
- ESLint + `typescript-eslint`
- Biome formatter
- Vitest
- fast-check
- memfs
- pino
- jsdiff
