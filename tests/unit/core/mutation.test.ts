import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { readFileSnapshot, readPathStat } from "../../../src/core/file-metadata.js";
import {
  writeTextFileForMutation,
  writeTextFileStreamForMutation,
} from "../../../src/core/mutation.js";
import { withTempDir } from "../../helpers/temp.js";
import { holdWindowsFileLock } from "../../helpers/windows-lock.js";

const replacement = "replacement content\n";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("commit-time revalidation", () => {
  test("a write refuses a parent directory that resolves outside the roots", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        // As if another process created the directory as a link after the
        // tool had resolved and validated the (then missing) path.
        const linked = join(root, "linked");
        await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");

        const result = await writeTextFileForMutation({
          path: join(linked, "new.txt"),
          content: "escaped?\n",
          before: undefined,
          roots: [root],
        });

        expect(result).toMatchObject({ ok: false, error: { code: "SYMLINK_NOT_ALLOWED" } });
        await expect(readdir(outside)).resolves.toEqual([]);
      });
    });
  });

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

  test.runIf(process.platform === "win32")(
    "a process that edits the file while it blocks the rename does not lose its edit",
    async () => {
      await withTempDir(async (root) => {
        const filePath = join(root, "notes.txt");
        await writeFile(filePath, "before\n", "utf8");
        const before = await readFileSnapshot(filePath);
        if (!before.ok) {
          throw new Error("expected a readable file");
        }

        // The holder blocks the rename, rewrites the file, then lets go.
        const lock = await holdWindowsFileLock(filePath, 800, "changed by the holder");
        const result = await writeTextFileForMutation({
          path: filePath,
          content: "scalpel\n",
          before: before.data,
        });
        await lock.released;

        expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
        await expect(readFile(filePath, "utf8")).resolves.toBe("changed by the holder");
        await expect(readdir(root)).resolves.toEqual(["notes.txt"]);
      });
    },
    20_000,
  );
});
