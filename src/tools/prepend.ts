import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import {
  readOptionalSnapshotForMutation,
  readSnapshotForMutation,
  writeTextFileForMutation,
} from "../core/mutation.js";
import { success, type DomainResult } from "../core/errors.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { countLines } from "../core/line-endings.js";
import { countInsertedLines } from "../core/text.js";

type PrependInput = {
  path: string;
  content: string;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type PrependResult = {
  absolutePath: string;
  lines_added: number;
  new_total_lines: number;
  diff?: string;
  applied?: boolean;
  warnings?: string[];
};

export async function prependTool(
  input: PrependInput,
  config: ScalpelConfig,
): Promise<DomainResult<PrependResult>> {
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
    const before = await readOptionalSnapshotForMutation({
      path: resolved.data,
      expected_sha256: input.expected_sha256,
      expected_mtime_ms: input.expected_mtime_ms,
      maxReadBytes: config.maxReadBytes,
    });
    if (!before.ok) {
      return before;
    }

    const existing = before.data?.content ?? "";
    const nextContent = `${input.content}${existing}`;
    const diff = createUnifiedDiff(resolved.data, existing, nextContent);
    const result = {
      absolutePath: resolved.data,
      lines_added: countInsertedLines(input.content),
      new_total_lines: countLines(nextContent),
      diff,
      applied: input.dry_run !== true,
    };

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "prepend",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(before.data),
        after: textState(nextContent),
      });
      return success({
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    await mkdir(dirname(resolved.data), { recursive: true });
    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: nextContent,
      before: before.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
      transactionDir: config.transactionDir,
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    const after = await readSnapshotForMutation({
      path: resolved.data,
      maxReadBytes: config.maxReadBytes,
    });
    if (!after.ok) {
      return after;
    }

    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "prepend",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(before.data),
        after: snapshotState(after.data),
      }),
    );

    return success({
      ...result,
      new_total_lines: after.data.lineCount,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
