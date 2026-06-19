import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { crashIfFaultPoint } from "./fault-injection.js";

type WriteTransactionState = "started" | "temp_written" | "renamed";
type MoveTransactionState = "started" | "renamed";

export type TextWriteTransactionRecord = {
  version: 1;
  kind: "text_write";
  id: string;
  targetPath: string;
  tempPath: string;
  afterSha256: string;
  afterSizeBytes: number;
  state: WriteTransactionState;
  updatedAt: string;
};

export type MoveTransactionRecord = {
  version: 1;
  kind: "move";
  id: string;
  sourcePath: string;
  destinationPath: string;
  state: MoveTransactionState;
  updatedAt: string;
};

export type WriteTransactionRecord = TextWriteTransactionRecord | MoveTransactionRecord;

export type WriteTransactionHandle = {
  id: string;
  recordPath: string;
  record: TextWriteTransactionRecord;
  markTempWritten: () => Promise<void>;
  markRenamed: () => Promise<void>;
  complete: () => Promise<void>;
};

export type MoveTransactionHandle = {
  id: string;
  recordPath: string;
  record: MoveTransactionRecord;
  markRenamed: () => Promise<void>;
  complete: () => Promise<void>;
};

export type RecoverySummary = {
  scanned: number;
  recovered: number;
  cleanedTemps: number;
  warnings: string[];
};

export async function beginWriteTransaction(input: {
  transactionDir: string;
  targetPath: string;
  tempPath: string;
  content: string;
}): Promise<WriteTransactionHandle> {
  await mkdir(input.transactionDir, { recursive: true });
  const id = randomUUID();
  const recordPath = join(input.transactionDir, `${id}.json`);
  const record: TextWriteTransactionRecord = {
    version: 1,
    kind: "text_write",
    id,
    targetPath: input.targetPath,
    tempPath: input.tempPath,
    afterSha256: sha256(input.content),
    afterSizeBytes: Buffer.byteLength(input.content, "utf8"),
    state: "started",
    updatedAt: new Date().toISOString(),
  };

  await writeRecordAtomic(recordPath, record);

  return {
    id,
    recordPath,
    record,
    markTempWritten: async () => {
      record.state = "temp_written";
      record.updatedAt = new Date().toISOString();
      await writeRecordAtomic(recordPath, record);
    },
    markRenamed: async () => {
      record.state = "renamed";
      record.updatedAt = new Date().toISOString();
      await writeRecordAtomic(recordPath, record);
    },
    complete: async () => {
      await rm(recordPath, { force: true });
    },
  };
}

export async function beginMoveTransaction(input: {
  transactionDir: string;
  sourcePath: string;
  destinationPath: string;
}): Promise<MoveTransactionHandle> {
  await mkdir(input.transactionDir, { recursive: true });
  const id = randomUUID();
  const recordPath = join(input.transactionDir, `${id}.json`);
  const record: MoveTransactionRecord = {
    version: 1,
    kind: "move",
    id,
    sourcePath: input.sourcePath,
    destinationPath: input.destinationPath,
    state: "started",
    updatedAt: new Date().toISOString(),
  };

  await writeRecordAtomic(recordPath, record);

  return {
    id,
    recordPath,
    record,
    markRenamed: async () => {
      record.state = "renamed";
      record.updatedAt = new Date().toISOString();
      await writeRecordAtomic(recordPath, record);
    },
    complete: async () => {
      await rm(recordPath, { force: true });
    },
  };
}

export async function recoverWriteTransactions(transactionDir: string): Promise<RecoverySummary> {
  const summary: RecoverySummary = {
    scanned: 0,
    recovered: 0,
    cleanedTemps: 0,
    warnings: [],
  };

  if (!existsSync(transactionDir)) {
    return summary;
  }

  const entries = await readdir(transactionDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    summary.scanned += 1;
    const recordPath = join(transactionDir, entry.name);
    try {
      const record = parseRecord(await readFile(recordPath, "utf8"));
      const reconciled = await reconcileRecord(record);
      if (reconciled.cleanedTemp) {
        summary.cleanedTemps += 1;
      }
      if (reconciled.recovered) {
        summary.recovered += 1;
      }
      crashIfFaultPoint("recovery.before_record_cleanup");
      await rm(recordPath, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown transaction recovery error";
      summary.warnings.push(
        `TRANSACTION_RECOVERY_WARNING: ${basename(recordPath)}: ${message}`,
      );
    }
  }

  return summary;
}

async function reconcileRecord(
  record: WriteTransactionRecord,
): Promise<{ recovered: boolean; cleanedTemp: boolean }> {
  if (record.kind === "move") {
    return reconcileMoveRecord(record);
  }

  const targetMatches = await fileMatches(record.targetPath, record.afterSha256, record.afterSizeBytes);
  let cleanedTemp = false;

  if (existsSync(record.tempPath)) {
    await rm(record.tempPath, { force: true });
    cleanedTemp = true;
  }

  return {
    recovered: record.state === "renamed" && targetMatches,
    cleanedTemp,
  };
}

function reconcileMoveRecord(
  record: MoveTransactionRecord,
): Promise<{ recovered: boolean; cleanedTemp: boolean }> {
  const sourceExists = existsSync(record.sourcePath);
  const destinationExists = existsSync(record.destinationPath);

  if (sourceExists && !destinationExists) {
    return Promise.resolve({ recovered: false, cleanedTemp: false });
  }

  if (!sourceExists && destinationExists) {
    return Promise.resolve({ recovered: true, cleanedTemp: false });
  }

  if (record.state === "renamed" && destinationExists) {
    return Promise.resolve({ recovered: true, cleanedTemp: false });
  }

  throw new Error("move transaction is in an unrecoverable ambiguous state");
}

async function fileMatches(path: string, expectedSha256: string, expectedSizeBytes: number): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== expectedSizeBytes) {
      return false;
    }
    const content = await readFile(path);
    return createHash("sha256").update(content).digest("hex") === expectedSha256;
  } catch {
    return false;
  }
}

function parseRecord(raw: string): WriteTransactionRecord {
  const value: unknown = JSON.parse(raw);
  if (!isWriteTransactionRecord(value)) {
    throw new Error("invalid transaction record");
  }
  return value;
}

function isWriteTransactionRecord(value: unknown): value is WriteTransactionRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("kind" in value) ||
    (value.kind !== "text_write" && value.kind !== "move") ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("updatedAt" in value) ||
    typeof value.updatedAt !== "string"
  ) {
    return false;
  }

  if (value.kind === "move") {
    return (
      "sourcePath" in value &&
      typeof value.sourcePath === "string" &&
      "destinationPath" in value &&
      typeof value.destinationPath === "string" &&
      "state" in value &&
      (value.state === "started" || value.state === "renamed")
    );
  }

  return (
    "targetPath" in value &&
    typeof value.targetPath === "string" &&
    "tempPath" in value &&
    typeof value.tempPath === "string" &&
    "afterSha256" in value &&
    typeof value.afterSha256 === "string" &&
    "afterSizeBytes" in value &&
    typeof value.afterSizeBytes === "number" &&
    "state" in value &&
    (value.state === "started" || value.state === "temp_written" || value.state === "renamed")
  );
}

async function writeRecordAtomic(path: string, record: WriteTransactionRecord): Promise<void> {
  const tempPath = join(dirname(path), `.scalpel-txn-${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  try {
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
