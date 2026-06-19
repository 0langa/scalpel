import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import { readSnapshotForMutation, writeTextFileForMutation } from "../core/mutation.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { findLineMarkerIndex, splitLinesWithEndings } from "../core/text.js";

type DeleteRangeInput = {
  path: string;
  start_line?: number | undefined;
  end_line?: number | undefined;
  start_marker?: string | undefined;
  end_marker?: string | undefined;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type DeleteRangeResult = {
  absolutePath: string;
  deleted_lines: number;
  diff: string;
  applied: boolean;
  warnings?: string[];
};

export async function deleteRangeTool(
  input: DeleteRangeInput,
  config: ScalpelConfig,
): Promise<DomainResult<DeleteRangeResult>> {
  const lineMode = input.start_line !== undefined || input.end_line !== undefined;
  const markerMode = input.start_marker !== undefined || input.end_marker !== undefined;

  if (lineMode === markerMode) {
    return failure("INVALID_LINE_RANGE", "Provide either line range or marker range");
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
    let startIndex: number;
    let endIndex: number;

    if (lineMode) {
      if (
        input.start_line === undefined ||
        input.end_line === undefined ||
        input.start_line < 1 ||
        input.end_line < input.start_line ||
        input.end_line > lines.length
      ) {
        return failure("INVALID_LINE_RANGE", "Delete line range is invalid", resolved.data);
      }

      startIndex = input.start_line - 1;
      endIndex = input.end_line - 1;
    } else {
      if (input.start_marker === undefined || input.end_marker === undefined) {
        return failure(
          "MARKER_NOT_FOUND",
          "Both start_marker and end_marker are required",
          resolved.data,
        );
      }

      const startMarker = findLineMarkerIndex(lines, input.start_marker);
      if (!startMarker.ok) {
        return startMarker;
      }

      const endMarker = findLineMarkerIndex(lines, input.end_marker);
      if (!endMarker.ok) {
        return endMarker;
      }

      if (endMarker.data < startMarker.data) {
        return failure("MARKER_NOT_FOUND", "end_marker appears before start_marker", resolved.data);
      }

      startIndex = startMarker.data;
      endIndex = endMarker.data;
    }

    const nextContent = [...lines.slice(0, startIndex), ...lines.slice(endIndex + 1)].join("");
    const diff = createUnifiedDiff(resolved.data, snapshot.data.content, nextContent);

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "delete_range",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(snapshot.data),
        after: textState(nextContent),
      });
      return success({
        absolutePath: resolved.data,
        deleted_lines: endIndex - startIndex + 1,
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
        tool: "delete_range",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(snapshot.data),
        after: textState(nextContent),
      }),
    );
    return success({
      absolutePath: resolved.data,
      deleted_lines: endIndex - startIndex + 1,
      diff,
      applied: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
