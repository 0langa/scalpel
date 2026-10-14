import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type DiffInput = {
  path: string;
  proposed_content: string;
};

type DiffResult = {
  absolutePath: string;
  diff: string;
  lines_added: number;
  lines_removed: number;
};

export async function diffTool(
  input: DiffInput,
  config: ScalpelConfig
): Promise<DomainResult<DiffResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!resolved.ok) {
    return resolved;
  }

  const snapshot = await readFileSnapshot(resolved.data, {
    maxBytes: config.maxReadBytes,
    suggestedTool: "read_chunk"
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, input.proposed_content);
  const { added, removed } = countChangedLines(diff);

  return success({
    absolutePath: resolved.data,
    diff,
    lines_added: added,
    lines_removed: removed
  });
}

// Only count lines inside hunks. Filtering every "+++"/"---" line instead
// skipped real content lines such as an added "++counter" or removed "-- note".
function countChangedLines(diff: string): { added: number; removed: number } {
  let inHunks = false;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunks = true;
    } else if (inHunks && line.startsWith("+")) {
      added += 1;
    } else if (inHunks && line.startsWith("-")) {
      removed += 1;
    }
  }
  return { added, removed };
}
