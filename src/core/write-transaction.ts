import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { crashIfFaultPoint } from "./fault-injection.js";

type WriteTransactionState = "started" | "temp_written" | "renamed";
type MoveTransactionState = "started" | "renamed";

export type RecoveryDecision = "committed" | "aborted" | "unrecoverable";

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
  committed: number;
  aborted: number;
  unrecoverable: number;
  cleanedTemps: number;
  quarantined: number;
  warnings: string[];
};

export async function beginWriteTransaction(input: {
  transactionDir: string;
  targetPath: string;
  tempPath: string;
  content?: string | undefined;
  afterSha256?: string | undefined;
  afterSizeBytes?: number | undefined;
}): Promise<WriteTransactionHandle> {
  await mkdir(input.transactionDir, { recursive: true });
  const afterSha256 = input.afterSha256 ?? (input.content === undefined ? undefined : sha256(input.content));
  const afterSizeBytes = input.afterSizeBytes ?? (
    input.content === undefined ? undefined : Buffer.byteLength(input.content, "utf8")
  );
  if (afterSha256 === undefined || afterSizeBytes === undefined) {
    throw new Error("write transaction requires content or after metadata");
  }

  const id = randomUUID();
  const recordPath = join(input.transactionDir, `${id}.json`);
  const record: TextWriteTransactionRecord = {
    version: 1,
    kind: "text_write",
    id,
    targetPath: input.targetPath,
    tempPath: input.tempPath,
    afterSha256,
    afterSizeBytes,
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
    committed: 0,
    aborted: 0,
    unrecoverable: 0,
    cleanedTemps: 0,
    quarantined: 0,
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

    let record: WriteTransactionRecord;
    try {
      record = parseRecord(await readFile(recordPath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown transaction record parse error";
      summary.unrecoverable += 1;
      summary.warnings.push(
        `TRANSACTION_RECOVERY_UNRECOVERABLE: ${entry.name}: corrupted record (${message})`,
      );
      await quarantineRecord(transactionDir, recordPath, entry.name);
      summary.quarantined += 1;
      continue;
    }

    try {
      const reconciled = await reconcileRecord(record);
      if (reconciled.cleanedTemp) {
        summary.cleanedTemps += 1;
      }

      if (reconciled.decision === "unrecoverable") {
        summary.unrecoverable += 1;
        summary.warnings.push(
          `TRANSACTION_RECOVERY_UNRECOVERABLE: ${entry.name}: ${reconciled.detail ?? "ambiguous recovery state"}`,
        );
        await quarantineRecord(transactionDir, recordPath, entry.name);
        summary.quarantined += 1;
        continue;
      }

      if (reconciled.decision === "committed") {
        summary.committed += 1;
      } else {
        summary.aborted += 1;
      }
      crashIfFaultPoint("recovery.before_record_cleanup");
      await rm(recordPath, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown transaction recovery error";
      summary.unrecoverable += 1;
      summary.warnings.push(
        `TRANSACTION_RECOVERY_UNRECOVERABLE: ${entry.name}: ${message}`,
      );
      await quarantineRecord(transactionDir, recordPath, entry.name);
      summary.quarantined += 1;
    }
  }

  return summary;
}

type ReconcileResult = {
  decision: RecoveryDecision;
  cleanedTemp: boolean;
  detail?: string;
};

async function reconcileRecord(record: WriteTransactionRecord): Promise<ReconcileResult> {
  if (record.kind === "move") {
    return reconcileMoveRecord(record);
  }

  return reconcileTextWriteRecord(record);
}

async function reconcileTextWriteRecord(record: TextWriteTransactionRecord): Promise<ReconcileResult> {
  const targetMatches = await fileMatches(record.targetPath, record.afterSha256, record.afterSizeBytes);
  let cleanedTemp = false;

  if (existsSync(record.tempPath)) {
    await rm(record.tempPath, { force: true });
    cleanedTemp = true;
  }

  if (targetMatches) {
    return { decision: "committed", cleanedTemp };
  }

  if (record.state === "renamed") {
    return {
      decision: "unrecoverable",
      cleanedTemp,
      detail: "record marked renamed but target content does not match the expected hash",
    };
  }

  return { decision: "aborted", cleanedTemp };
}

function reconcileMoveRecord(record: MoveTransactionRecord): Promise<ReconcileResult> {
  const sourceExists = existsSync(record.sourcePath);
  const destinationExists = existsSync(record.destinationPath);

  if (!sourceExists && destinationExists) {
    return Promise.resolve({ decision: "committed", cleanedTemp: false });
  }

  if (sourceExists && !destinationExists) {
    if (record.state === "renamed") {
      return Promise.resolve({
        decision: "unrecoverable",
        cleanedTemp: false,
        detail: "record marked renamed but source still exists and destination is missing",
      });
    }
    return Promise.resolve({ decision: "aborted", cleanedTemp: false });
  }

  if (sourceExists && destinationExists) {
    return Promise.resolve({
      decision: "unrecoverable",
      cleanedTemp: false,
      detail: "both source and destination exist; move outcome is ambiguous",
    });
  }

  return Promise.resolve({
    decision: "unrecoverable",
    cleanedTemp: false,
    detail: "neither source nor destination exists; move outcome cannot be determined",
  });
}

async function quarantineRecord(transactionDir: string, recordPath: string, name: string): Promise<void> {
  const quarantineDir = join(transactionDir, "quarantine");
  try {
    await mkdir(quarantineDir, { recursive: true });
    await rename(recordPath, join(quarantineDir, `${Date.now().toString(36)}-${name}`));
  } catch {
    await rm(recordPath, { force: true });
  }
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
