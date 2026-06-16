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
      expect(toolList.tools.some((tool) => tool.name === "config")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "read")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "read_chunk")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "patch")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "scalpel_read")).toBe(true);
      expect(toolList.tools.some((tool) => tool.name === "scalpel_patch")).toBe(true);

      const configResult = await client.callTool({
        name: "config",
        arguments: {}
      });

      expect(configResult.isError).not.toBe(true);
      expect(configResult.structuredContent).toMatchObject({
        roots: [root]
      });

      const readResult = await client.callTool({
        name: "read",
        arguments: {
          path: "sample.txt"
        }
      });

      expect(readResult.isError).not.toBe(true);
      expect(JSON.stringify(readResult.content)).toContain("alpha");

      const chunkResult = await client.callTool({
        name: "read_chunk",
        arguments: {
          path: "sample.txt",
          max_bytes: 5
        }
      });

      expect(chunkResult.isError).not.toBe(true);
      expect(chunkResult.structuredContent).toMatchObject({
        content: "alpha",
        truncated: true
      });

      const patchResult = await client.callTool({
        name: "scalpel_patch",
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

  test("returns structured error payloads for tool failures", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "sample.txt");
      await writeFile(filePath, "foo\nbar\nfoo\n", "utf8");

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

      const patchResult = await client.callTool({
        name: "patch",
        arguments: {
          path: "sample.txt",
          old_string: "foo",
          new_string: "qux"
        }
      });

      expect(patchResult.isError).toBe(true);
      expect(JSON.stringify(patchResult.content)).toContain("STRING_NOT_UNIQUE");
      expect(patchResult.structuredContent).toMatchObject({
        error: {
          code: "STRING_NOT_UNIQUE"
        }
      });
    });
  }, 15000);

  test("supports dry-run create and move over MCP without mutating files", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, "source.txt");
      const createdPath = join(root, "created.txt");
      const movedPath = join(root, "moved.txt");
      await writeFile(sourcePath, "hello\n", "utf8");

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

      const createResult = await client.callTool({
        name: "create",
        arguments: {
          path: "created.txt",
          content: "new\n",
          dry_run: true
        }
      });

      expect(createResult.isError).not.toBe(true);
      expect(createResult.structuredContent).toMatchObject({ applied: false });
      await expect(readFile(createdPath, "utf8")).rejects.toThrow();

      const moveResult = await client.callTool({
        name: "move",
        arguments: {
          source: "source.txt",
          destination: "moved.txt",
          dry_run: true
        }
      });

      expect(moveResult.isError).not.toBe(true);
      expect(moveResult.structuredContent).toMatchObject({
        applied: false,
        source_exists: true,
        destination_exists: false
      });
      await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
      await expect(readFile(movedPath, "utf8")).rejects.toThrow();
    });
  }, 15000);
});
