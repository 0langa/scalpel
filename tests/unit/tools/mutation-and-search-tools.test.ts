import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { appendTool } from "../../../src/tools/append.js";
import { batchEditTool } from "../../../src/tools/batch-edit.js";
import { createTool } from "../../../src/tools/create.js";
import { deleteRangeTool } from "../../../src/tools/delete-range.js";
import { grepTool } from "../../../src/tools/grep.js";
import { insertTool } from "../../../src/tools/insert.js";
import { moveTool } from "../../../src/tools/move.js";
import { replaceBetweenMarkersTool } from "../../../src/tools/replace-between-markers.js";
import { withTempDir } from "../../helpers/temp.js";

describe("mutation and search tools", () => {
  test("create writes a new file and its parent directories", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });
      const result = await createTool(
        {
          path: "nested/file.txt",
          content: "hello\n"
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "nested", "file.txt"), "utf8")).resolves.toBe("hello\n");
    });
  });

  test("batch_edit applies multiple changes atomically", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "const alpha = 1;\nconst beta = 2;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await batchEditTool(
        {
          path: "main.ts",
          edits: [
            { old_string: "alpha = 1", new_string: "alpha = 10" },
            { old_string: "beta = 2", new_string: "beta = 20" }
          ]
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("const alpha = 10;\nconst beta = 20;\n");
    });
  });

  test("batch_edit leaves the file untouched when one edit fails", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "const alpha = 1;\nconst beta = 2;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await batchEditTool(
        {
          path: "main.ts",
          edits: [
            { old_string: "alpha = 1", new_string: "alpha = 10" },
            { old_string: "gamma = 3", new_string: "gamma = 30" }
          ]
        },
        config
      );

      expect(result.ok).toBe(false);
      await expect(readFile(filePath, "utf8")).resolves.toBe("const alpha = 1;\nconst beta = 2;\n");
    });
  });

  test("insert adds content before a target line", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "line one\nline three\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool(
        {
          path: "main.ts",
          content: "line two\n",
          line: 2
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("line one\nline two\nline three\n");
    });
  });

  test("delete_range removes an inclusive line span", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "one\ntwo\nthree\nfour\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await deleteRangeTool(
        {
          path: "main.ts",
          start_line: 2,
          end_line: 3
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("one\nfour\n");
    });
  });

  test("replace_between_markers keeps markers and swaps inner content", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "config.txt");
      await writeFile(
        filePath,
        "before\nBEGIN\nold one\nold two\nEND\nafter\n",
        "utf8"
      );

      const config = createConfig({ roots: [root] });
      const result = await replaceBetweenMarkersTool(
        {
          path: "config.txt",
          start_marker: "BEGIN",
          end_marker: "END",
          new_content: "fresh line\n"
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "before\nBEGIN\nfresh line\nEND\nafter\n"
      );
    });
  });

  test("append creates a missing file and appends content", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });
      const result = await appendTool(
        {
          path: "logs/activity.log",
          content: "entry 1\n"
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "logs", "activity.log"), "utf8")).resolves.toBe("entry 1\n");
    });
  });

  test("move renames a file into a new parent directory", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "old.txt"), "hello\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await moveTool(
        {
          source: "old.txt",
          destination: "nested/new.txt"
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "nested", "new.txt"), "utf8")).resolves.toBe("hello\n");
    });
  });

  test("grep finds literal matches across nested files", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "export const value = 1;\n", "utf8");
      await writeFile(join(root, "src", "two.ts"), "export const other = value;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await grepTool(
        {
          path: "src",
          pattern: "value",
          max_results: 10
        },
        config
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.total_matches).toBe(2);
      }
    });
  });
});
