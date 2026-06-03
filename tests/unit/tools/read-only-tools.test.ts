import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { listDirTool } from "../../../src/tools/list-dir.js";
import { readTool } from "../../../src/tools/read.js";
import { statTool } from "../../../src/tools/stat.js";
import { withTempDir } from "../../helpers/temp.js";

describe("read-only tools", () => {
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
});
