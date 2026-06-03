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
    operation: "read"
  });
  if (!resolved.ok) {
    return resolved;
  }

  const snapshot = await readFileSnapshot(resolved.data);
  if (!snapshot.ok) {
    return snapshot;
  }

  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, input.proposed_content);
  const linesAdded = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const linesRemoved = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

  return success({
    absolutePath: resolved.data,
    diff,
    lines_added: linesAdded,
    lines_removed: linesRemoved
  });
}
