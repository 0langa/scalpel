# Scalpel

Precise, atomic file editing for code and text over MCP.

## Status

Working TypeScript MCP server scaffold with a tested stdio transport, read/search tools, and mutating edit tools.

## Stack

- TypeScript
- Official Model Context Protocol TypeScript SDK
- `stdio` transport for local coding clients

## Implemented tools

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

## Run

Install dependencies:

```bash
pnpm install
```

Start the stdio server:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Test:

```bash
pnpm test
```

## Configuration

`SCALPEL_ROOTS`

- Optional
- Path-delimited list of allowed workspace roots
- Defaults to the current working directory when unset

Example:

```bash
SCALPEL_ROOTS=/repo pnpm dev
```

## Docs

- [SPEC.md](./SPEC.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/STACK.md](./docs/STACK.md)

## Kimi Code

An example project-local Kimi MCP config lives at [.kimi-code/mcp.json](./.kimi-code/mcp.json).

It is intentionally minimal:

```json
{
  "mcpServers": {
    "scalpel": {
      "command": "node",
      "args": ["./dist/src/index.js"]
    }
  }
}
```

This relies on Kimi starting the subprocess in the workspace root. Because `SCALPEL_ROOTS` is optional in Scalpel, the server will confine itself to that working directory when the variable is not set.
