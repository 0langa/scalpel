# Scalpel Agent Guide

## Working Agreements

- Use RECALL before substantial Scalpel work so project memory and current release state are considered.
- Use official OpenAI Developers docs for Codex, OpenAI API, and OpenAI MCP behavior.
- Use the local mcp-builder guidance for MCP server design, tool contracts, and eval work.
- Run `pnpm validate` before claiming implementation work is complete.

## Safety Rules

- Prefer `dry_run` before mutating files when manually exercising Scalpel.
- Preserve workspace-root confinement and symlink/hidden-path policy.
- Keep operation journal records metadata-only; never add file content to journal output.
- Keep existing canonical tool names and `scalpel_*` aliases backward compatible.

## Local Commands

- `pnpm dev` runs the TypeScript stdio server.
- `pnpm build` compiles the package entry in `dist/`.
- `pnpm test:mcp-smoke` checks the built MCP server behavior.
- `pnpm test:package-smoke` checks the package `scalpel` bin path.
- `pnpm validate` is the completion gate.
