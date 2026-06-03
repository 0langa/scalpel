import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { findLineMarkerIndex, splitLinesWithEndings } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type ReplaceBetweenMarkersInput = {
  path: string;
  start_marker: string;
  end_marker: string;
  new_content: string;
  dry_run?: boolean | undefined;
};

type ReplaceBetweenMarkersResult = {
  absolutePath: string;
  replaced_lines: number;
  diff: string;
  applied: boolean;
};

export async function replaceBetweenMarkersTool(
  input: ReplaceBetweenMarkersInput,
  config: ScalpelConfig
): Promise<DomainResult<ReplaceBetweenMarkersResult>> {
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

  const nextContent = [
    ...lines.slice(0, startMarker.data + 1),
    input.new_content,
    ...lines.slice(endMarker.data)
  ].join("");
  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, nextContent);

  if (input.dry_run === true) {
    return success({
      absolutePath: resolved.data,
      replaced_lines: endMarker.data - startMarker.data - 1,
      diff,
      applied: false
    });
  }

  await writeFileAtomic(resolved.data, nextContent);
  return success({
    absolutePath: resolved.data,
    replaced_lines: endMarker.data - startMarker.data - 1,
    diff,
    applied: true
  });
}
