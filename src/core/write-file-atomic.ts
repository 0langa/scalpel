import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { crashIfFaultPoint } from "./fault-injection.js";
import { beginWriteTransaction } from "./write-transaction.js";

type WriteFileAtomicOptions = {
  durability?: "default" | "strict";
  transactionDir?: string | undefined;
};

type WriteFileAtomicStreamOptions = WriteFileAtomicOptions & {
  afterSha256: string;
  afterSizeBytes: number;
};

export async function writeFileAtomic(
  path: string,
  content: string,
  options: WriteFileAtomicOptions = {}
): Promise<string[]> {
  return writeFileAtomicStream(path, [content], {
    ...options,
    afterSha256: sha256(content),
    afterSizeBytes: Buffer.byteLength(content, "utf8"),
  });
}

export async function writeFileAtomicStream(
  path: string,
  chunks: AsyncIterable<string | Buffer> | Iterable<string | Buffer>,
  options: WriteFileAtomicStreamOptions,
): Promise<string[]> {
  const tempPath = join(dirname(path), `.scalpel-${randomUUID()}.tmp`);
  const warnings: string[] = [];
  const transaction = options.transactionDir === undefined
    ? undefined
    : await beginWriteTransaction({
        transactionDir: options.transactionDir,
        targetPath: path,
        tempPath,
        afterSha256: options.afterSha256,
        afterSizeBytes: options.afterSizeBytes,
      });
  crashIfFaultPoint("text_write.after_transaction_start");

  try {
    const handle = await open(tempPath, "w");
    try {
      for await (const chunk of chunks) {
        await handle.writeFile(chunk, typeof chunk === "string" ? "utf8" : undefined);
      }
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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
