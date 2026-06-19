import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import { readSnapshotForMutation, writeTextFileForMutation } from "../core/mutation.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import {
  findLineMarkerIndex,
  normalizeLineInsertion,
  splitLinesWithEndings,
} from "../core/text.js";

type InsertInput = {
  path: string;
  content: string;
  line?: number | undefined;
  after_marker?: string | undefined;
  before_marker?: string | undefined;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type InsertResult = {
  absolutePath: string;
  inserted_at_line: number;
  diff: string;
  applied: boolean;
  warnings?: string[];
};

export async function insertTool(
  input: InsertInput,
  config: ScalpelConfig,
): Promise<DomainResult<InsertResult>> {
  const modeCount = [input.line, input.after_marker, input.before_marker].filter(
    (value) => value !== undefined,
  ).length;
  if (modeCount !== 1) {
    return failure("INVALID_LINE_RANGE", "Exactly one insertion mode must be provided");
  }

  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths,
  });
  if (!resolved.ok) {
    return resolved;
  }

  return withPathLock([resolved.data], async () => {
    const snapshot = await readSnapshotForMutation({
      path: resolved.data,
      expected_sha256: input.expected_sha256,
      expected_mtime_ms: input.expected_mtime_ms,
      maxReadBytes: config.maxReadBytes,
    });
    if (!snapshot.ok) {
      return snapshot;
    }

    const lines = splitLinesWithEndings(snapshot.data.content);
    let insertIndex: number;

    if (input.line !== undefined) {
      if (input.line < 1 || input.line > lines.length + 1) {
        return failure("INVALID_LINE_RANGE", "Insert line is out of bounds", resolved.data);
      }
      insertIndex = input.line - 1;
    } else if (input.after_marker !== undefined) {
      const markerIndex = findLineMarkerIndex(lines, input.after_marker);
      if (!markerIndex.ok) {
        return markerIndex;
      }
      insertIndex = markerIndex.data + 1;
    } else {
      if (input.before_marker === undefined) {
        return failure("MARKER_NOT_FOUND", "before_marker is required", resolved.data);
      }

      const markerIndex = findLineMarkerIndex(lines, input.before_marker);
      if (!markerIndex.ok) {
        return markerIndex;
      }
      insertIndex = markerIndex.data;
    }

    const eol = snapshot.data.eol === "\r\n" ? "\r\n" : "\n";
    const insertionLines = normalizeLineInsertion(input.content, eol);
    const nextContent = [
      ...lines.slice(0, insertIndex),
      ...insertionLines,
      ...lines.slice(insertIndex),
    ].join("");
    const diff = createUnifiedDiff(resolved.data, snapshot.data.content, nextContent);

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "insert",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(snapshot.data),
        after: textState(nextContent),
      });
      return success({
        absolutePath: resolved.data,
        inserted_at_line: insertIndex + 1,
        diff,
        applied: false,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: nextContent,
      before: snapshot.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
      transactionDir: config.transactionDir,
    });
    if (!writeResult.ok) {
      return writeResult;
    }
    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "insert",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(snapshot.data),
        after: textState(nextContent),
      }),
    );
    return success({
      absolutePath: resolved.data,
      inserted_at_line: insertIndex + 1,
      diff,
      applied: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
