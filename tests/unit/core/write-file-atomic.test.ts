import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { writeFileAtomic } from "../../../src/core/write-file-atomic.js";
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

      expect(summary).toMatchObject({ scanned: 1, cleanedTemps: 1, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
      await expect(readdir(root)).resolves.not.toContain(".scalpel-leftover.tmp");
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

      expect(summary).toMatchObject({ scanned: 1, recovered: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("after\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
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

      expect(summary).toMatchObject({ scanned: 1, recovered: 0, cleanedTemps: 0, warnings: [] });
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

      expect(summary).toMatchObject({ scanned: 1, recovered: 1, cleanedTemps: 0, warnings: [] });
      await expect(readFile(destinationPath, "utf8")).resolves.toBe("source\n");
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });
});
