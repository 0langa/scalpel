import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type PackageJson = {
  bin?: Record<string, string> | undefined;
};

async function main(): Promise<void> {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;
  const bin = packageJson.bin?.scalpel;
  if (bin === undefined) {
    throw new Error("package.json must expose a scalpel bin entry");
  }

  const binPath = resolve(bin);
  if (!existsSync(binPath)) {
    throw new Error(`${binPath} not found. Run pnpm build before pnpm test:package-smoke.`);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [binPath],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALPEL_ROOTS: process.cwd()
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "scalpel-package-smoke", version: "0.1.0" });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    if (!toolNames.has("config") || !toolNames.has("read") || !toolNames.has("scalpel_read")) {
      throw new Error("package smoke did not list expected tools");
    }

    const resources = await client.listResources();
    const resourceUris = new Set(resources.resources.map((resource) => resource.uri));
    if (!resourceUris.has("scalpel://docs/safety") || !resourceUris.has("scalpel://config/current")) {
      throw new Error("package smoke did not list expected resources");
    }

    const config = await client.callTool({ name: "config", arguments: {} });
    if (config.isError === true) {
      throw new Error("config tool failed through package bin");
    }

    const dryRun = await client.callTool({
      name: "append",
      arguments: {
        path: join("tmp", "package-smoke-dry-run.txt"),
        content: "package smoke\n",
        dry_run: true
      }
    });
    if (dryRun.isError === true) {
      throw new Error("dry-run mutation failed through package bin");
    }
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }

  console.log("Package smoke passed.");
}

await main();
