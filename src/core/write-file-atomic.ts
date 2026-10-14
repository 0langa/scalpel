import { type FileHandle, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { crashIfFaultPoint } from "./fault-injection.js";
import { beginWriteTransaction } from "./write-transaction.js";

type WriteFileAtomicOptions = {
  durability?: "default" | "strict";
  transactionDir?: string | undefined;
  // Runs once the temp file is complete, immediately before each attempt to
  // rename it over the target. Throwing aborts the write: the temp file and
  // transaction record are removed and the target is left untouched.
  beforeRename?: (() => Promise<void>) | undefined;
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
  const existingMode = await readExistingMode(path);
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

  let renamed = false;
  try {
    const handle = await open(tempPath, "wx");
    try {
      for await (const chunk of chunks) {
        await handle.writeFile(chunk, typeof chunk === "string" ? "utf8" : undefined);
      }
      warnings.push(...await preserveMode(handle, existingMode));
      if (options.durability === "strict") {
        await handle.sync();
      }
    } finally {
      await handle.close();
    }

    await transaction?.markTempWritten();
    crashIfFaultPoint("text_write.after_temp_written");
    await renameWithRetry(tempPath, path, options.beforeRename);
    renamed = true;
    crashIfFaultPoint("text_write.after_rename");
    await transaction?.markRenamed();

    if (options.durability === "strict") {
      warnings.push(...await flushParentDirectory(dirname(path)));
    }
    crashIfFaultPoint("text_write.after_parent_flush");
    await transaction?.complete();
  } catch (error) {
    await Promise.allSettled([unlink(tempPath)]);
    if (!renamed) {
      // The target was never replaced, so the record has nothing left to
      // reconcile; leaving it would only produce a spurious recovery entry.
      await Promise.allSettled([transaction?.complete()]);
    }
    throw error;
  }

  return warnings;
}

const TRANSIENT_RENAME_ERROR_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

// On Windows, replacing a file fails with EPERM/EACCES/EBUSY while another
// process (antivirus, indexer, backup or sync client, an editor) holds it open
// without delete sharing. Those locks are usually released within
// milliseconds, so retry with a short backoff before giving up. Other
// platforms do not have this failure mode and rename once.
//
// `beforeAttempt` runs before every attempt, so a precondition is rechecked
// after each wait: the process holding the file may have changed it.
export async function renameWithRetry(
  from: string,
  to: string,
  beforeAttempt?: () => Promise<void>,
): Promise<void> {
  if (process.platform !== "win32") {
    await beforeAttempt?.();
    await rename(from, to);
    return;
  }

  const budgetMs = renameRetryBudgetMs();
  const started = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    await beforeAttempt?.();
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || Date.now() - started >= budgetMs) {
        throw error;
      }
      await delay(Math.min(100, attempt * 10));
    }
  }
}

function renameRetryBudgetMs(): number {
  const raw = process.env.SCALPEL_RENAME_RETRY_MS;
  if (raw === undefined) {
    return 5_000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

function isTransientRenameError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_RENAME_ERROR_CODES.has(error.code)
  );
}

async function readExistingMode(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.mode & 0o7777 : undefined;
  } catch {
    return undefined;
  }
}

// The temp file is created with default permissions, so without this an edit
// would silently drop the executable bit (or any other mode) of the file it
// replaces. Windows only maps the read-only attribute onto mode bits, and
// read-only targets are rejected before writing, so there is nothing to copy.
async function preserveMode(
  handle: FileHandle,
  mode: number | undefined,
): Promise<string[]> {
  if (mode === undefined || process.platform === "win32") {
    return [];
  }

  try {
    await handle.chmod(mode);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "chmod failed";
    return [`FILE_MODE_NOT_PRESERVED: ${message}`];
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
