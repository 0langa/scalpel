import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { success, type DomainResult } from "../core/errors.js";
import { readSnapshotForMutation } from "../core/mutation.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { planExactReplace, type PatchOccurrence } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type PatchInput = {
  path: string;
  old_string: string;
  new_string: string;
  occurrence?: PatchOccurrence | undefined;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
};

type PatchResult = {
  absolutePath: string;
  replacements: number;
  diff: string;
  applied: boolean;
  sha256: string;
};

export async function patchTool(
  input: PatchInput,
  config: ScalpelConfig
): Promise<DomainResult<PatchResult>> {
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
    expected_sha256: input.expected_sha256
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  const plan = planExactReplace(
    snapshot.data.content,
    input.old_string,
    input.new_string,
    input.occurrence ?? "unique"
  );

  if (!plan.ok) {
    return plan;
  }

  const diff = createUnifiedDiff(resolved.data, snapshot.data.content, plan.data.content);
  if (input.dry_run === true) {
    return success({
      absolutePath: resolved.data,
      replacements: plan.data.replacements,
      diff,
      applied: false,
      sha256: snapshot.data.sha256
    });
  }

  await writeFileAtomic(resolved.data, plan.data.content);
  const updated = await readSnapshotForMutation({ path: resolved.data });
  if (!updated.ok) {
    return updated;
  }

  return success({
    absolutePath: resolved.data,
    replacements: plan.data.replacements,
    diff,
    applied: true,
    sha256: updated.data.sha256
  });
}
