import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readSnapshotForMutation } from "../core/mutation.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { countInsertedLines } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type AppendInput = {
  path: string;
  content: string;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type AppendResult = {
  absolutePath: string;
  lines_added: number;
  new_total_lines: number;
};

export async function appendTool(
  input: AppendInput,
  config: ScalpelConfig
): Promise<DomainResult<AppendResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!resolved.ok) {
    return resolved;
  }

  const before = await readSnapshotForMutation({
    path: resolved.data,
    expected_sha256: input.expected_sha256,
    expected_mtime_ms: input.expected_mtime_ms
  });

  await mkdir(dirname(resolved.data), { recursive: true });

  if (before.ok) {
    await writeFileAtomic(resolved.data, `${before.data.content}${input.content}`);
  } else {
    await appendFile(resolved.data, input.content, "utf8");
  }

  const snapshot = await readSnapshotForMutation({ path: resolved.data });
  if (!snapshot.ok) {
    return snapshot;
  }

  return success({
    absolutePath: resolved.data,
    lines_added: countInsertedLines(input.content),
    new_total_lines: snapshot.data.lineCount
  });
}
