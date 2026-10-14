import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { writeFileAtomic, writeFileAtomicStream } from "../../../src/core/write-file-atomic.js";
import {
  beginMoveTransaction,
  beginWriteTransaction,
  recoverWriteTransactions,
} from "../../../src/core/write-transaction.js";
import { withTempDir } from "../../helpers/temp.js";
import { holdWindowsFileLock } from "../../helpers/windows-lock.js";

// process.umask() is process-wide, so it is restored as soon as `run` settles.
async function withUmask<T>(mask: number, run: () => Promise<T>): Promise<T> {
  const previous = process.umask(mask);
  try {
    return await run();
  } finally {
    process.umask(previous);
  }
}

// The permission bits of the one `.scalpel-*.tmp` file a write in `directory`
// has open.
async function openTempFileMode(directory: string): Promise<number> {
  const temps = (await readdir(directory)).filter(
    (name) => name.startsWith(".scalpel-") && name.endsWith(".tmp"),
  );
  const [temp] = temps;
  if (temp === undefined || temps.length !== 1) {
    throw new Error(`expected one temp file in ${directory}, found ${String(temps.length)}`);
  }
  return (await stat(join(directory, temp))).mode & 0o7777;
}

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

  test("a write that fails before rename leaves the target, no temp file, and no record", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "target.txt");
      await writeFile(filePath, "before\n", "utf8");

      async function* failingChunks(): AsyncIterable<string> {
        yield "partial";
        await Promise.resolve();
        throw new Error("disk full");
      }

      await expect(
        writeFileAtomicStream(filePath, failingChunks(), {
          transactionDir,
          afterSha256: "0".repeat(64),
          afterSizeBytes: 1,
        }),
      ).rejects.toThrow("disk full");

      await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
      await expect(readdir(root)).resolves.toEqual([".scalpel-transactions", "target.txt"]);
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test.skipIf(process.platform === "win32")("replacing a file keeps its permission bits", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "run.sh");
      await writeFile(filePath, "#!/bin/sh\necho old\n", "utf8");
      await chmod(filePath, 0o750);

      await writeFileAtomic(filePath, "#!/bin/sh\necho new\n");

      expect((await stat(filePath)).mode & 0o777).toBe(0o750);
      await expect(readFile(filePath, "utf8")).resolves.toBe("#!/bin/sh\necho new\n");
    });
  });

  test.skipIf(process.platform === "win32").each([
    { label: "0600", mode: 0o600 },
    { label: "0640", mode: 0o640 },
    { label: "0755", mode: 0o755 },
  ])(
    "the replacement of a $label file is owner-only while its content is written",
    async ({ mode }) => {
      await withTempDir(async (root) => {
        const filePath = join(root, "target");
        await writeFile(filePath, "old\n", "utf8");
        await chmod(filePath, mode);
        const content = "new\ncontent\n";

        // Runs while the temp file is open: before the first chunk is written,
        // between the chunks, and after the last one.
        const tempModes: number[] = [];
        async function* chunks(): AsyncIterable<string> {
          tempModes.push(await openTempFileMode(root));
          yield "new\n";
          tempModes.push(await openTempFileMode(root));
          yield "content\n";
          tempModes.push(await openTempFileMode(root));
        }

        // Under this umask, a temp file created with the default mode would be
        // readable by group and others (0644).
        await withUmask(0o022, () =>
          writeFileAtomicStream(filePath, chunks(), {
            afterSha256: createHash("sha256").update(content).digest("hex"),
            afterSizeBytes: Buffer.byteLength(content, "utf8"),
          }),
        );

        expect(tempModes).toHaveLength(3);
        for (const tempMode of tempModes) {
          expect(tempMode & ~0o600, `temp file mode ${tempMode.toString(8)}`).toBe(0);
        }
        expect((await stat(filePath)).mode & 0o7777).toBe(mode);
        await expect(readFile(filePath, "utf8")).resolves.toBe(content);
        await expect(readdir(root)).resolves.toEqual(["target"]);
      });
    },
  );

  test.skipIf(process.platform === "win32")("a new file still gets 0666 minus the umask", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "new.txt");

      await withUmask(0o022, () => writeFileAtomic(filePath, "new\n"));

      expect((await stat(filePath)).mode & 0o7777).toBe(0o644);
    });
  });

  test.runIf(process.platform === "win32")(
    "waits out a transient lock held by another process on Windows",
    async () => {
      await withTempDir(async (root) => {
        const filePath = join(root, "locked.txt");
        await writeFile(filePath, "before\n", "utf8");

        const lock = await holdWindowsFileLock(filePath, 400);
        const warnings = await writeFileAtomic(filePath, "after\n");
        await lock.released;

        expect(warnings).toEqual([]);
        await expect(readFile(filePath, "utf8")).resolves.toBe("after\n");
        await expect(readdir(root)).resolves.toEqual(["locked.txt"]);
      });
    },
    20_000,
  );

  test.runIf(process.platform === "win32")(
    "gives up after the retry budget and cleans up when the lock is not released",
    async () => {
      await withTempDir(async (root) => {
        const transactionDir = join(root, ".scalpel-transactions");
        const filePath = join(root, "locked.txt");
        await writeFile(filePath, "before\n", "utf8");
        const previousBudget = process.env.SCALPEL_RENAME_RETRY_MS;
        process.env.SCALPEL_RENAME_RETRY_MS = "50";

        const lock = await holdWindowsFileLock(filePath, 1_500);
        try {
          await expect(writeFileAtomic(filePath, "after\n", { transactionDir })).rejects.toMatchObject({
            code: "EPERM",
          });
        } finally {
          if (previousBudget === undefined) {
            delete process.env.SCALPEL_RENAME_RETRY_MS;
          } else {
            process.env.SCALPEL_RENAME_RETRY_MS = previousBudget;
          }
          await lock.released;
        }

        await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
        await expect(readdir(root)).resolves.toEqual([".scalpel-transactions", "locked.txt"]);
        await expect(readdir(transactionDir)).resolves.toEqual([]);
      });
    },
    20_000,
  );

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

  test("recovery never deletes a file that a tampered record names as its temp path", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const transactionDir = join(root, ".scalpel-transactions");
        const victimPath = join(outside, "precious.txt");
        await writeFile(victimPath, "keep me\n", "utf8");
        await mkdir(transactionDir, { recursive: true });
        await writeFile(
          join(transactionDir, "tampered.json"),
          JSON.stringify({
            version: 1,
            kind: "text_write",
            id: "tampered",
            targetPath: join(root, "target.txt"),
            tempPath: victimPath,
            afterSha256: "0".repeat(64),
            afterSizeBytes: 1,
            state: "started",
            updatedAt: new Date().toISOString(),
          }),
          "utf8",
        );

        const summary = await recoverWriteTransactions(transactionDir);

        expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 1, cleanedTemps: 0 });
        await expect(readFile(victimPath, "utf8")).resolves.toBe("keep me\n");
      });
    });
  });

  test("recovery refuses to scan a transaction directory that is a symlink or junction", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const transactionDir = join(root, ".scalpel-transactions");
        await writeFile(join(outside, "settings.json"), "{\"user\": true}\n", "utf8");
        await symlink(outside, transactionDir, process.platform === "win32" ? "junction" : "dir");

        const summary = await recoverWriteTransactions(transactionDir);

        expect(summary).toMatchObject({ scanned: 0, unrecoverable: 0, quarantined: 0 });
        expect(summary.warnings).toHaveLength(1);
        await expect(readdir(outside)).resolves.toEqual(["settings.json"]);
      });
    });
  });

  test("recovery with roots still reconciles records inside them", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      const filePath = join(root, "nested", "target.txt");
      const tempPath = join(root, "nested", ".scalpel-leftover.tmp");
      await mkdir(join(root, "nested"));
      await writeFile(filePath, "before\n", "utf8");
      await writeFile(tempPath, "after\n", "utf8");
      const write = await beginWriteTransaction({ transactionDir, targetPath: filePath, tempPath, content: "after\n" });
      await write.markTempWritten();
      const sourcePath = join(root, "move-source.txt");
      const destinationPath = join(root, "nested", "move-destination.txt");
      await writeFile(sourcePath, "moved\n", "utf8");
      const move = await beginMoveTransaction({ transactionDir, sourcePath, destinationPath });
      await rename(sourcePath, destinationPath);
      await move.markRenamed();

      const summary = await recoverWriteTransactions(transactionDir, { roots: [root] });

      expect(summary).toMatchObject({ scanned: 2, aborted: 1, committed: 1, cleanedTemps: 1, warnings: [] });
      await expect(readFile(filePath, "utf8")).resolves.toBe("before\n");
      await expect(readdir(join(root, "nested"))).resolves.toEqual(["move-destination.txt", "target.txt"]);
      await expect(readdir(transactionDir)).resolves.toEqual([]);
    });
  });

  test("recovery leaves records that name paths outside the roots untouched", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        // Another Scalpel's in-flight temp file, and files a crafted move
        // record points at: recovery must not touch (or even stat) them.
        const transactionDir = join(root, ".scalpel-transactions");
        const outsideTemp = join(outside, ".scalpel-in-flight.tmp");
        await writeFile(outsideTemp, "in flight\n", "utf8");
        await writeFile(join(outside, "a.txt"), "a\n", "utf8");
        await mkdir(transactionDir);
        const records = {
          "write.json": {
            kind: "text_write",
            targetPath: join(outside, "target.txt"),
            tempPath: outsideTemp,
            afterSha256: "0".repeat(64),
            afterSizeBytes: 1,
            state: "temp_written",
          },
          "move.json": {
            kind: "move",
            sourcePath: join(outside, "a.txt"),
            destinationPath: join(root, "a.txt"),
            state: "renamed",
          },
        };
        for (const [name, record] of Object.entries(records)) {
          await writeFile(
            join(transactionDir, name),
            JSON.stringify({ version: 1, id: name, updatedAt: new Date().toISOString(), ...record }),
            "utf8",
          );
        }

        const summary = await recoverWriteTransactions(transactionDir, { roots: [root] });

        expect(summary).toMatchObject({
          scanned: 2,
          committed: 0,
          aborted: 0,
          unrecoverable: 0,
          cleanedTemps: 0,
          quarantined: 0,
        });
        expect(summary.warnings).toHaveLength(2);
        expect(summary.warnings.every((warning) => warning.startsWith("TRANSACTION_RECOVERY_SKIPPED"))).toBe(true);
        await expect(readFile(outsideTemp, "utf8")).resolves.toBe("in flight\n");
        await expect(readdir(transactionDir)).resolves.toEqual(["move.json", "write.json"]);
      });
    });
  });

  test("recovery does not reach outside the roots through a link inside them", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const transactionDir = join(root, ".scalpel-transactions");
        const outsideTemp = join(outside, ".scalpel-in-flight.tmp");
        await writeFile(outsideTemp, "in flight\n", "utf8");
        await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
        await mkdir(transactionDir);
        await writeFile(
          join(transactionDir, "linked.json"),
          JSON.stringify({
            version: 1,
            kind: "text_write",
            id: "linked",
            targetPath: join(root, "linked", "target.txt"),
            tempPath: join(root, "linked", ".scalpel-in-flight.tmp"),
            afterSha256: "0".repeat(64),
            afterSizeBytes: 1,
            state: "temp_written",
            updatedAt: new Date().toISOString(),
          }),
          "utf8",
        );

        const summary = await recoverWriteTransactions(transactionDir, { roots: [root] });

        expect(summary).toMatchObject({ scanned: 1, cleanedTemps: 0, quarantined: 0 });
        expect(summary.warnings).toMatchObject([expect.stringMatching(/^TRANSACTION_RECOVERY_SKIPPED: linked\.json/)]);
        await expect(readFile(outsideTemp, "utf8")).resolves.toBe("in flight\n");
      });
    });
  });

  test("recovery never moves a record into a quarantine directory that is a link", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const transactionDir = join(root, ".scalpel-transactions");
        await mkdir(transactionDir);
        await writeFile(join(transactionDir, "payload.json"), "bytes the repository chose\n", "utf8");
        await symlink(outside, join(transactionDir, "quarantine"), process.platform === "win32" ? "junction" : "dir");

        const summary = await recoverWriteTransactions(transactionDir, { roots: [root] });

        expect(summary).toMatchObject({ scanned: 1, unrecoverable: 1, quarantined: 0 });
        expect(summary.warnings).toHaveLength(2);
        await expect(readdir(outside)).resolves.toEqual([]);
        await expect(readFile(join(transactionDir, "payload.json"), "utf8")).resolves.toBe(
          "bytes the repository chose\n",
        );
      });
    });
  });
});
