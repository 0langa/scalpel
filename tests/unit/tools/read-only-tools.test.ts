import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { configTool } from "../../../src/tools/config.js";
import { listDirTool } from "../../../src/tools/list-dir.js";
import { readChunkTool } from "../../../src/tools/read-chunk.js";
import { readTool } from "../../../src/tools/read.js";
import { statTool } from "../../../src/tools/stat.js";
import { withTempDir } from "../../helpers/temp.js";

describe("read-only tools", () => {
  test("config returns live server settings", () => {
    const root = process.cwd();
    const config = createConfig({
      roots: [root],
      allowHiddenPaths: false,
      maxReadBytes: 123,
      maxDiffBytes: 456,
      maxGrepResults: 7,
      durability: "strict",
      transactionDir: join(root, ".custom-transactions"),
      journalEnabled: true,
      journalPath: join(root, "journal.jsonl"),
      logLevel: "debug"
    });

    const result = configTool(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.roots).toEqual([root]);
      expect(result.data.allowHiddenPaths).toBe(false);
      expect(result.data.maxReadBytes).toBe(123);
      expect(result.data.maxDiffBytes).toBe(456);
      expect(result.data.maxGrepResults).toBe(7);
      expect(result.data.durability).toBe("strict");
      expect(result.data.transactionDir).toBe(join(root, ".custom-transactions"));
      expect(result.data.journalEnabled).toBe(true);
      expect(result.data.journalPath).toBe(join(root, "journal.jsonl"));
      expect(result.data.logLevel).toBe("debug");
      expect(result.data.cwd).toBe(process.cwd());
      expect(result.data.env.pathDelimiter.length).toBeGreaterThan(0);
    }
  });

  test("stat returns file metadata for a workspace file", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "notes.txt");
      await writeFile(filePath, "hello\nworld\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await statTool({ path: "notes.txt" }, config);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.absolutePath).toBe(filePath);
        expect(result.data.isDirectory).toBe(false);
        expect(result.data.lineCount).toBe(2);
        expect(result.data.textKind).toBe("utf8");
      }
    });
  });

  test("read returns only the requested line range", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "notes.txt");
      await writeFile(filePath, "one\ntwo\nthree\nfour\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await readTool({ path: "notes.txt", start_line: 2, end_line: 3 }, config);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.content).toBe("two\nthree\n");
        expect(result.data.range).toEqual({ start_line: 2, end_line: 3 });
      }
    });
  });

  test("list_dir returns child entries in stable name order", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "b-dir"));
      await mkdir(join(root, "a-dir"));
      await writeFile(join(root, "c.txt"), "c\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await listDirTool({ path: "." }, config);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.entries.map((entry) => entry.name)).toEqual(["a-dir", "b-dir", "c.txt"]);
      }
    });
  });

  test("read succeeds on an empty file", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "empty.txt");
      await writeFile(filePath, "", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await readTool({ path: "empty.txt" }, config);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.content).toBe("");
        expect(result.data.lines).toBe(0);
        expect(result.data.range).toEqual({ start_line: 1, end_line: 0 });
      }
    });
  });

  test("full read fails clearly for oversized files, but ranged read streams", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "large.txt"), "one\ntwo\nthree\n", "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 5 });
      const full = await readTool({ path: "large.txt" }, config);
      expect(full.ok).toBe(false);
      if (!full.ok) {
        expect(full.error.code).toBe("FILE_TOO_LARGE");
        expect(full.error.details).toMatchObject({ max_bytes: 5, suggested_tool: "read_chunk" });
      }

      const ranged = await readTool({ path: "large.txt", start_line: 2, end_line: 2 }, config);
      expect(ranged.ok).toBe(true);
      if (ranged.ok) {
        expect(ranged.data.content).toBe("two\n");
        expect(ranged.data.lines).toBe(3);
      }
    });
  });

  test("read_chunk returns bounded UTF-8 chunks", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "chunk.txt"), "a🙂b\n", "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 4 });
      const first = await readChunkTool({ path: "chunk.txt", max_bytes: 2 }, config);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.data.content).toBe("a");
        expect(first.data.truncated).toBe(true);
        expect(first.data.next_offset_bytes).toBe(1);
      }

      const second = await readChunkTool({ path: "chunk.txt", offset_bytes: 1, max_bytes: 4 }, config);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.data.content).toBe("🙂");
      }
    });
  });

  test("text tools reject binary and invalid UTF-8 files", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
      await writeFile(join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));

      const config = createConfig({ roots: [root] });
      const binary = await readTool({ path: "binary.dat" }, config);
      expect(binary.ok).toBe(false);
      if (!binary.ok) {
        expect(binary.error.code).toBe("BINARY_FILE_NOT_SUPPORTED");
      }

      const invalid = await readTool({ path: "invalid.txt" }, config);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error.code).toBe("UNSUPPORTED_ENCODING");
      }
    });
  });
});
