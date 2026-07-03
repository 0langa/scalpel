import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { writeFileAtomic, writeFileAtomicStream } from "../../../src/core/write-file-atomic.js";
import {
  beginMoveTransaction,
  beginWriteTransaction,
  recoverWriteTransactions,
} from "../../../src/core/write-transaction.js";
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

  test("transactional writes remove successful recovery records", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "transactional.txt");

      const warnings = await writeFileAtomic(filePath, "committed\n", { transactionDir });

      expect(warnings).toEqual([]);
      await expect(readFile(filePath, "utf8")).resolves.toBe("committed\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("streamed writes use supplied transaction metadata without buffering content", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "streamed.txt");
      const content = "alpha\nbeta\n";

      const warnings = await writeFileAtomicStream(filePath, ["alpha\n", "beta\n"], {
        transactionDir,
        afterSha256: "7ebc23b6a14b4d28fbd1ebd7f418913b1764302f5a78cf2cae886220b3645f5c",
        afterSizeBytes: Buffer.byteLength(content, "utf8"),
      });

      expect(warnings).toEqual([]);
      await expect(readFile(filePath, "utf8")).resolves.toBe(content);
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery removes temp-written transaction temps without touching the target", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "recover-target.txt");
      const tempPath = join(root, ".scalpel-leftover.tmp");
      await writeFile(filePath, "before\n", "utf8");
      await writeFile(tempPath, "after\n", "utf8");
      const transaction = await beginWriteTransaction({
        transactionDir,
        targetPath: filePath,
        tempPath,
        content: "after\n",
      });
      await transaction.markTempWritten();

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, aborted: 1, cleanedTemps: 1, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
      await expect(readdir(root)).resolves.not.toContain(".scalpel-leftover.tmp");
    });
  });

  test("recovery aborts a started transaction whose temp file was never created", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "missing-temp-target.txt");
      const tempPath = join(root, ".scalpel-missing.tmp");
      await writeFile(filePath, "before\n", "utf8");
      await beginWriteTransaction({
        transactionDir,
        targetPath: filePath,
        tempPath,
        content: "after\n",
      });

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, aborted: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery accepts renamed transactions whose target content matches", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "renamed-target.txt");
      const tempPath = join(root, ".scalpel-renamed.tmp");
      await writeFile(filePath, "after\n", "utf8");
      const transaction = await beginWriteTransaction({
        transactionDir,
        targetPath: filePath,
        tempPath,
        content: "after\n",
      });
      await transaction.markTempWritten();
      await transaction.markRenamed();

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, committed: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("after\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery quarantines a renamed record whose target no longer matches the expected hash", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "tampered-target.txt");
      const tempPath = join(root, ".scalpel-tampered.tmp");
      await writeFile(filePath, "after\n", "utf8");
      const transaction = await beginWriteTransaction({
        transactionDir,
        targetPath: filePath,
        tempPath,
        content: "after\n",
      });
      await transaction.markTempWritten();
      await transaction.markRenamed();
      await writeFile(filePath, "tampered\n", "utf8");

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 1, cleanedTemps: 0 });
      expect(summary.warnings).toHaveLength(1);
      await expect(readFile(filePath, "utf8")).resolves.toBe("tampered\n");
      await expect(readdir(transactionDir)).resolves.toEqual(["quarantine"]);
      await expect(readdir(join(transactionDir, "quarantine"))).resolves.toHaveLength(1);
    });
  });

  test("recovery quarantines a corrupted transaction record instead of retrying it forever", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      await mkdir(transactionDir, { recursive: true });
      await writeFile(join(transactionDir, "corrupt.json"), "{not valid json", "utf8");

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 1 });
      expect(summary.warnings).toHaveLength(1);
      await expect(readdir(transactionDir)).resolves.toEqual(["quarantine"]);

      const rescanned = await recoverWriteTransactions(transactionDir);
      expect(rescanned).toMatchObject({ scanned: 0, unrecoverable: 0, quarantined: 0 });
    });
  });

  test("recovery clears move transactions that did not reach rename", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const sourcePath = join(root, "move-source.txt");
      const destinationPath = join(root, "move-destination.txt");
      await writeFile(sourcePath, "source\n", "utf8");
      await beginMoveTransaction({
        transactionDir,
        sourcePath,
        destinationPath,
      });

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, aborted: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(sourcePath, "utf8")).resolves.toBe("source\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery accepts move transactions that reached rename", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const sourcePath = join(root, "move-source.txt");
      const destinationPath = join(root, "move-destination.txt");
      await writeFile(sourcePath, "source\n", "utf8");
      const transaction = await beginMoveTransaction({
        transactionDir,
        sourcePath,
        destinationPath,
      });
      await rename(sourcePath, destinationPath);
      await transaction.markRenamed();

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, committed: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(destinationPath, "utf8")).resolves.toBe("source\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery quarantines a move transaction where both source and destination exist", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const sourcePath = join(root, "move-both-source.txt");
      const destinationPath = join(root, "move-both-destination.txt");
      await writeFile(sourcePath, "source\n", "utf8");
      await writeFile(destinationPath, "destination\n", "utf8");
      await beginMoveTransaction({
        transactionDir,
        sourcePath,
        destinationPath,
      });

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 1 });
      await expect(readFile(sourcePath, "utf8")).resolves.toBe("source\n");
      await expect(readFile(destinationPath, "utf8")).resolves.toBe("destination\n");
    });
  });

  test("recovery quarantines a move transaction where neither source nor destination exist", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const sourcePath = join(root, "move-neither-source.txt");
      const destinationPath = join(root, "move-neither-destination.txt");
      await beginMoveTransaction({
        transactionDir,
        sourcePath,
        destinationPath,
      });

      const summary = await recoverWriteTransactions(transactionDir);

      expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 1 });
    });
  });
});
