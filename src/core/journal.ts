import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import type { ScalpelConfig } from "./config.js";
import type { FileSnapshot, FileStat } from "./file-metadata.js";

type JournalState = {
  sha256?: string;
  mtime_ms?: number;
  size_bytes?: number;
};

type JournalRecord = {
  tool: string;
  paths: string[];
  dry_run: boolean;
  applied: boolean;
  error_code?: string | undefined;
  before?: JournalState | undefined;
  after?: JournalState | undefined;
};

export async function recordJournal(
  config: ScalpelConfig,
  record: JournalRecord
): Promise<string[]> {
  if (!config.journalEnabled) {
    return [];
  }

  const journalPath = config.journalPath ?? join(config.roots[0] ?? process.cwd(), ".scalpel-journal.jsonl");
  const event = {
    timestamp: new Date().toISOString(),
    ...record
  };

  try {
    await mkdir(dirname(journalPath), { recursive: true });
    await appendFile(journalPath, `${JSON.stringify(event)}\n`, "utf8");
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to write journal";
    return [`JOURNAL_WRITE_FAILED: ${message}`];
  }
}

export function snapshotState(snapshot: FileSnapshot | FileStat | undefined): JournalState | undefined {
  if (snapshot === undefined) {
    return undefined;
  }

  const state: JournalState = {
    mtime_ms: snapshot.mtimeMs,
    size_bytes: snapshot.sizeBytes
  };

  if (snapshot.sha256 !== undefined) {
    state.sha256 = snapshot.sha256;
  }

  return state;
}

export function textState(content: string): JournalState {
  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    size_bytes: Buffer.byteLength(content, "utf8")
  };
}
