import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { writeFileAtomic } from "../../../src/core/write-file-atomic.js";
import { withTempDir } from "../../helpers/temp.js";

describe("writeFileAtomic", () => {
  test("default mode writes through a temp file and leaves no temp files behind", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "notes.txt");

      const warnings = await writeFileAtomic(filePath, "hello\n");

      expect(warnings).toEqual([]);
      await expect(readFile(filePath, "utf8")).resolves.toBe("hello\n");
      await expect(readdir(root)).resolves.toEqual(["notes.txt"]);
    });
  });

  test("strict mode writes content and reports only non-fatal durability warnings", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "strict.txt");

      const warnings = await writeFileAtomic(filePath, "strict\n", { durability: "strict" });

      expect(warnings.every((warning) => !warning.includes("strict\n"))).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("strict\n");
      await expect(readdir(root)).resolves.toEqual(["strict.txt"]);
    });
  });
});
