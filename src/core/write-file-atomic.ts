import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { crashIfFaultPoint } from "./fault-injection.js";
import { beginWriteTransaction } from "./write-transaction.js";

type WriteFileAtomicOptions = {
  durability?: "default" | "strict";
  transactionDir?: string | undefined;
};

export async function writeFileAtomic(
  path: string,
  content: string,
  options: WriteFileAtomicOptions = {}
): Promise<string[]> {
  const tempPath = join(dirname(path), `.scalpel-${randomUUID()}.tmp`);
  const warnings: string[] = [];
  const transaction = options.transactionDir === undefined
    ? undefined
    : await beginWriteTransaction({
        transactionDir: options.transactionDir,
        targetPath: path,
        tempPath,
        content,
      });
  crashIfFaultPoint("text_write.after_transaction_start");

  try {
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      if (options.durability === "strict") {
        await handle.sync();
      }
    } finally {
      await handle.close();
    }

    await transaction?.markTempWritten();
    crashIfFaultPoint("text_write.after_temp_written");
    await rename(tempPath, path);
    crashIfFaultPoint("text_write.after_rename");
    await transaction?.markRenamed();

    if (options.durability === "strict") {
      warnings.push(...await flushParentDirectory(dirname(path)));
    }
    crashIfFaultPoint("text_write.after_parent_flush");
    await transaction?.complete();
  } catch (error) {
    await Promise.allSettled([unlink(tempPath)]);
    throw error;
  }

  return warnings;
}

async function flushParentDirectory(path: string): Promise<string[]> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
      return [];
    } finally {
      await handle.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "parent directory flush failed";
    return [`DURABILITY_PARENT_FLUSH_UNAVAILABLE: ${message}`];
  }
}
