import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { findLineMarkerIndex, splitLinesWithEndings } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type InsertInput = {
  path: string;
  content: string;
  line?: number | undefined;
  after_marker?: string | undefined;
  before_marker?: string | undefined;
  dry_run?: boolean | undefined;
};

type InsertResult = {
  absolutePath: string;
  inserted_at_line: number;
  diff: string;
  applied: boolean;
};

export async function insertTool(
  input: InsertInput,
  config: ScalpelConfig
): Promise<DomainResult<InsertResult>> {
  const modeCount = [input.line, input.after_marker, input.before_marker].filter(
    (value) => value !== undefined
  ).length;
  if (modeCount !== 1) {
    return failure("INVALID_LINE_RANGE", "Exactly one insertion mode must be provided");
  }

  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write"
  });
  if (!resolved.ok) {
    return resolved;
  }

  const snapshot = await readFileSnapshot(resolved.data);
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

  const nextContent = [...lines.slice(0, insertIndex), input.content, ...lines.slice(insertIndex)].join(
    ""
  );
  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, nextContent);

  if (input.dry_run === true) {
    return success({
      absolutePath: resolved.data,
      inserted_at_line: insertIndex + 1,
      diff,
      applied: false
    });
  }

  await writeFileAtomic(resolved.data, nextContent);
  return success({
    absolutePath: resolved.data,
    inserted_at_line: insertIndex + 1,
    diff,
    applied: true
  });
}
