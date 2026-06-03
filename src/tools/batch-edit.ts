import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { readSnapshotForMutation } from "../core/mutation.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { planExactReplace, type PatchOccurrence } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type BatchEditInput = {
  path: string;
  edits: {
    old_string: string;
    new_string: string;
    occurrence?: PatchOccurrence | undefined;
  }[];
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type BatchEditResult = {
  absolutePath: string;
  edit_count: number;
  replacements_total: number;
  diff: string;
  applied: boolean;
};

export async function batchEditTool(
  input: BatchEditInput,
  config: ScalpelConfig
): Promise<DomainResult<BatchEditResult>> {
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
    expected_mtime_ms: input.expected_mtime_ms
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  let content = snapshot.data.content;
  let replacementsTotal = 0;

  for (const [index, edit] of input.edits.entries()) {
    const plan = planExactReplace(
      content,
      edit.old_string,
      edit.new_string,
      edit.occurrence ?? "unique"
    );

    if (!plan.ok) {
      return failure("ATOMIC_FAILURE", `Edit ${String(index)} failed validation`, resolved.data, {
        edit_index: index,
        cause: plan.error
      });
    }

    content = plan.data.content;
    replacementsTotal += plan.data.replacements;
  }

  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, content);
  if (input.dry_run === true) {
    return success({
      absolutePath: resolved.data,
      edit_count: input.edits.length,
      replacements_total: replacementsTotal,
      diff,
      applied: false
    });
  }

  await writeFileAtomic(resolved.data, content);

  return success({
    absolutePath: resolved.data,
    edit_count: input.edits.length,
    replacements_total: replacementsTotal,
    diff,
    applied: true
  });
}
