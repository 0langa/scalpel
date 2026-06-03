import { delimiter } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createConfig } from "./core/config.js";
import { createScalpelServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = createConfig({
    roots: loadRoots()
  });

  const server = createScalpelServer(config);
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    void (async () => {
      await server.close();
      process.exit(0);
    })();
  });

  await server.connect(transport);
}

function loadRoots(): string[] {
  const raw = process.env.SCALPEL_ROOTS;
  if (raw === undefined || raw.trim() === "") {
    return [process.cwd()];
  }

  return raw
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

void main();
