import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { recordJournal, snapshotState, textState } from "../core/journal.js";
import { readSnapshotForMutation } from "../core/mutation.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import {
  findLineMarkerIndex,
  normalizeLineInsertion,
  splitLinesWithEndings,
  validateReplacementDoesNotRepeatMarkers
} from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type ReplaceBetweenMarkersInput = {
  path: string;
  start_marker: string;
  end_marker: string;
  new_content: string;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type ReplaceBetweenMarkersResult = {
  absolutePath: string;
  replaced_lines: number;
  diff: string;
  applied: boolean;
  warnings?: string[];
};

export async function replaceBetweenMarkersTool(
  input: ReplaceBetweenMarkersInput,
  config: ScalpelConfig
): Promise<DomainResult<ReplaceBetweenMarkersResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!resolved.ok) {
    return resolved;
  }

  const snapshot = await readSnapshotForMutation({
    path: resolved.data,
    expected_sha256: input.expected_sha256,
    expected_mtime_ms: input.expected_mtime_ms,
    maxReadBytes: config.maxReadBytes
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  const lines = splitLinesWithEndings(snapshot.data.content);
  const startMarker = findLineMarkerIndex(lines, input.start_marker);
  if (!startMarker.ok) {
    return startMarker;
  }

  const endMarker = findLineMarkerIndex(lines, input.end_marker);
  if (!endMarker.ok) {
    return endMarker;
  }

  if (endMarker.data <= startMarker.data) {
    return failure("MARKER_NOT_FOUND", "end_marker must appear after start_marker", resolved.data);
  }

  const markerValidation = validateReplacementDoesNotRepeatMarkers(
    input.new_content,
    input.start_marker,
    input.end_marker
  );
  if (!markerValidation.ok) {
    return markerValidation;
  }

  const eol = snapshot.data.eol === "\r\n" ? "\r\n" : "\n";
  const replacementLines = normalizeLineInsertion(input.new_content, eol);
  const nextContent = [
    ...lines.slice(0, startMarker.data + 1),
    ...replacementLines,
    ...lines.slice(endMarker.data)
  ].join("");
  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, nextContent);

  if (input.dry_run === true) {
    const warnings = await recordJournal(config, {
      tool: "replace_between_markers",
      paths: [resolved.data],
      dry_run: true,
      applied: false,
      before: snapshotState(snapshot.data),
      after: textState(nextContent)
    });
    return success({
      absolutePath: resolved.data,
      replaced_lines: endMarker.data - startMarker.data - 1,
      diff,
      applied: false,
      ...(warnings.length > 0 ? { warnings } : {})
    });
  }

  await writeFileAtomic(resolved.data, nextContent);
  const warnings = await recordJournal(config, {
    tool: "replace_between_markers",
    paths: [resolved.data],
    dry_run: false,
    applied: true,
    before: snapshotState(snapshot.data),
    after: textState(nextContent)
  });
  return success({
    absolutePath: resolved.data,
    replaced_lines: endMarker.data - startMarker.data - 1,
    diff,
    applied: true,
    ...(warnings.length > 0 ? { warnings } : {})
  });
}
