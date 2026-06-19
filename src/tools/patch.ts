import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { success, type DomainResult } from "../core/errors.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import { readSnapshotForMutation, writeTextFileForMutation } from "../core/mutation.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { planExactReplace, type PatchOccurrence } from "../core/text.js";

type PatchInput = {
  path: string;
  old_string: string;
  new_string: string;
  occurrence?: PatchOccurrence | undefined;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type PatchResult = {
  absolutePath: string;
  replacements: number;
  diff: string;
  applied: boolean;
  sha256: string;
  warnings?: string[];
};

export async function patchTool(
  input: PatchInput,
  config: ScalpelConfig,
): Promise<DomainResult<PatchResult>> {
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

    const plan = planExactReplace(
      snapshot.data.content,
      input.old_string,
      input.new_string,
      input.occurrence ?? "unique",
    );

    if (!plan.ok) {
      await recordJournal(config, {
        tool: "patch",
        paths: [resolved.data],
        dry_run: input.dry_run === true,
        applied: false,
        error_code: plan.error.code,
        before: snapshotState(snapshot.data),
      });
      return plan;
    }

    const diff = createUnifiedDiff(resolved.data, snapshot.data.content, plan.data.content);
    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "patch",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(snapshot.data),
        after: textState(plan.data.content),
      });
      return success({
        absolutePath: resolved.data,
        replacements: plan.data.replacements,
        diff,
        applied: false,
        sha256: snapshot.data.sha256,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: plan.data.content,
      before: snapshot.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
      transactionDir: config.transactionDir,
    });
    if (!writeResult.ok) {
      return writeResult;
    }
    const updated = await readSnapshotForMutation({
      path: resolved.data,
      maxReadBytes: config.maxReadBytes,
    });
    if (!updated.ok) {
      return updated;
    }

    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "patch",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(snapshot.data),
        after: snapshotState(updated.data),
      }),
    );

    return success({
      absolutePath: resolved.data,
      replacements: plan.data.replacements,
      diff,
      applied: true,
      sha256: updated.data.sha256,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
