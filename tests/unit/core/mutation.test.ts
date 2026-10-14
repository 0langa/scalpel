import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { readPathStat } from "../../../src/core/file-metadata.js";
import { writeTextFileStreamForMutation } from "../../../src/core/mutation.js";
import { withTempDir } from "../../helpers/temp.js";

const replacement = "replacement content\n";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("commit-time revalidation", () => {
  test("a streamed write fails closed when the target is edited while the temp file is written", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large.txt");
      const transactionDir = join(root, ".scalpel-transactions");
      await writeFile(filePath, "original\n", "utf8");
      const before = await readPathStat(filePath);
      if (!before.ok) {
        throw new Error("expected a readable file");
      }

      async function* chunks(): AsyncIterable<string> {
        yield "replacement ";
        // Another process edits the file in place mid-stream.
        await writeFile(filePath, "external edit\n", "utf8");
        yield "content\n";
      }

      const result = await writeTextFileStreamForMutation({
        path: filePath,
        chunks: chunks(),
        before: before.data,
        afterSha256: sha256(replacement),
        afterSizeBytes: Buffer.byteLength(replacement),
        transactionDir,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
      await expect(readFile(filePath, "utf8")).resolves.toBe("external edit\n");
      await expect(readdir(root)).resolves.toEqual([".scalpel-transactions", "large.txt"]);
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("a same-size, same-mtime replacement of the target is still detected", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large.txt");
      await writeFile(filePath, "original\n", "utf8");
      const original = await stat(filePath);
      const before = await readPathStat(filePath);
      if (!before.ok) {
        throw new Error("expected a readable file");
      }

      async function* chunks(): AsyncIterable<string> {
        yield replacement;
        // Another process atomically replaces the file with same-size content
        // and restores the old mtime: only the file identity differs.
        const other = join(root, "other.tmp");
        await writeFile(other, "external\n", "utf8");
        await utimes(other, original.atime, original.mtime);
        await rename(other, filePath);
      }

      const result = await writeTextFileStreamForMutation({
        path: filePath,
        chunks: chunks(),
        before: before.data,
        afterSha256: sha256(replacement),
        afterSizeBytes: Buffer.byteLength(replacement),
      });

      expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
      await expect(readFile(filePath, "utf8")).resolves.toBe("external\n");
    });
  });
});
