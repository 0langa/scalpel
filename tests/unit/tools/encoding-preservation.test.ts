import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { deleteRangeTool } from "../../../src/tools/delete-range.js";
import { grepTool } from "../../../src/tools/grep.js";
import { insertTool } from "../../../src/tools/insert.js";
import { patchTool } from "../../../src/tools/patch.js";
import { prependTool } from "../../../src/tools/prepend.js";
import { readChunkTool } from "../../../src/tools/read-chunk.js";
import { readTool } from "../../../src/tools/read.js";
import { withTempDir } from "../../helpers/temp.js";

const BOM = "﻿";
const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

async function readBytes(path: string): Promise<Buffer> {
  return readFile(path);
}

describe("UTF-8 BOM preservation", () => {
  test("prepend keeps the BOM at offset 0", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "bom.cs");
      await writeFile(filePath, `${BOM}using System;\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await prependTool({ path: "bom.cs", content: "// header\n" }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${BOM}// header\nusing System;\n`);
    });
  });

  test("prepend does not double a BOM supplied with the new content", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "bom.txt");
      await writeFile(filePath, `${BOM}body\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await prependTool({ path: "bom.txt", content: `${BOM}head\n` }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${BOM}head\nbody\n`);
    });
  });

  test("streaming prepend keeps the BOM at offset 0", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large-bom.txt");
      await writeFile(filePath, `${BOM}${"line\n".repeat(20)}`, "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 16 });
      const result = await prependTool({ path: "large-bom.txt", content: "header\n" }, config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.diff).toBeUndefined();
      }
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        `${BOM}header\n${"line\n".repeat(20)}`,
      );
    });
  });

  test("streaming patch keeps the BOM", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large-bom.txt");
      await writeFile(filePath, `${BOM}${"line\n".repeat(20)}target\n`, "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 16 });
      const result = await patchTool(
        { path: "large-bom.txt", old_string: "target", new_string: "done" },
        config,
      );

      expect(result.ok).toBe(true);
      const bytes = await readBytes(filePath);
      expect(bytes.subarray(0, 3)).toEqual(BOM_BYTES);
      expect(bytes.toString("utf8")).toBe(`${BOM}${"line\n".repeat(20)}done\n`);
    });
  });

  test("insert before line 1 keeps the BOM first", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "bom.py");
      await writeFile(filePath, `${BOM}import os\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool({ path: "bom.py", content: "import sys", line: 1 }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${BOM}import sys\nimport os\n`);
    });
  });

  test("delete_range of line 1 keeps the BOM", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "bom.txt");
      await writeFile(filePath, `${BOM}first\nsecond\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await deleteRangeTool({ path: "bom.txt", start_line: 1, end_line: 1 }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${BOM}second\n`);
    });
  });

  test("ranged reads, chunked reads, and full reads agree on line 1 of a BOM file", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "bom.txt"), `${BOM}first\nsecond\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const full = await readTool({ path: "bom.txt" }, config);
      const ranged = await readTool({ path: "bom.txt", start_line: 1, end_line: 1 }, config);
      const chunk = await readChunkTool({ path: "bom.txt", max_bytes: 9 }, config);

      expect(full.ok && ranged.ok && chunk.ok).toBe(true);
      if (full.ok && ranged.ok && chunk.ok) {
        expect(full.data.content).toBe(`${BOM}first\nsecond\n`);
        expect(ranged.data.content).toBe(`${BOM}first\n`);
        expect(chunk.data.content).toBe(`${BOM}first\n`);
      }
    });
  });

  test("insert after the last line of a BOM file without a trailing newline", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "bom.txt");
      await writeFile(filePath, `${BOM}only`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool({ path: "bom.txt", content: "next", line: 2 }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${BOM}only\nnext\n`);
    });
  });

  test("grep anchors match line 1 of a BOM file and report text without the BOM", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "bom.ts"), `${BOM}export const a = 1;\n`, "utf8");

      const config = createConfig({ roots: [root] });
      const result = await grepTool({ path: ".", pattern: "^export", regex: true }, config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.matches).toMatchObject([{ line: 1, content: "export const a = 1;" }]);
      }
    });
  });
});

describe("line structure preservation", () => {
  test("insert after a final line without a newline does not glue lines together", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "no-eol.txt");
      await writeFile(filePath, "a\nb", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool({ path: "no-eol.txt", content: "c", line: 3 }, config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.inserted_at_line).toBe(3);
      }
      await expect(readFile(filePath, "utf8")).resolves.toBe("a\nb\nc\n");
    });
  });

  test("insert after a marker on a final CRLF line without a newline uses CRLF", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "crlf.txt");
      await writeFile(filePath, "first\r\n// END", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool(
        { path: "crlf.txt", content: "appended", after_marker: "// END" },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("first\r\n// END\r\nappended\r\n");
    });
  });

  test("inserting empty content leaves a file without a trailing newline untouched", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "no-eol.txt");
      await writeFile(filePath, "a\nb", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool({ path: "no-eol.txt", content: "", line: 3 }, config);

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("a\nb");
    });
  });
});
