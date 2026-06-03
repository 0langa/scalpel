import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readSnapshotForMutation } from "../core/mutation.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { countInsertedLines } from "../core/text.js";
import { writeFileAtomic } from "../core/write-file-atomic.js";

type PrependInput = {
  path: string;
  content: string;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type PrependResult = {
  absolutePath: string;
  lines_added: number;
  new_total_lines: number;
};

export async function prependTool(
  input: PrependInput,
  config: ScalpelConfig
): Promise<DomainResult<PrependResult>> {
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
  const existing = before.ok ? before.data.content : "";

  await mkdir(dirname(resolved.data), { recursive: true });
  await writeFileAtomic(resolved.data, `${input.content}${existing}`);

  const after = await readSnapshotForMutation({ path: resolved.data });
  if (!after.ok) {
    return after;
  }

  return success({
    absolutePath: resolved.data,
    lines_added: countInsertedLines(input.content),
    new_total_lines: after.data.lineCount
  });
}
