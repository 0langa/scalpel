import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "vitest";

import { withTempDir } from "../helpers/temp.js";

describe("stdio server", () => {
  const transports: StdioClientTransport[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.allSettled(clients.map(async (client) => client.close()));
    await Promise.allSettled(transports.map(async (transport) => transport.close()));
    transports.length = 0;
    clients.length = 0;
  });

  test("lists tools and supports read plus patch over MCP", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "sample.txt");
      await writeFile(filePath, "alpha\nbeta\n", "utf8");

      const transport = new StdioClientTransport({
        command: "node",
        args: ["--import", "tsx", "src/index.ts"],
        cwd: process.cwd(),
        env: {
          ...process.env,
          SCALPEL_ROOTS: root
        },
        stderr: "pipe"
      });
      transports.push(transport);

      const client = new Client({
        name: "scalpel-test-client",
        version: "0.1.0"
      });
      clients.push(client);

      await client.connect(transport);

      const toolList = await client.listTools();
      expect(toolList.tools.some((tool) => tool.name === "read")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "patch")).toBe(true);

      const readResult = await client.callTool({
        name: "read",
        arguments: {
          path: "sample.txt"
        }
      });

      expect(readResult.isError).not.toBe(true);
      expect(JSON.stringify(readResult.content)).toContain("alpha");

      const patchResult = await client.callTool({
        name: "patch",
        arguments: {
          path: "sample.txt",
          old_string: "beta",
          new_string: "gamma"
        }
      });

      expect(patchResult.isError).not.toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\ngamma\n");
    });
  }, 15000);
});
