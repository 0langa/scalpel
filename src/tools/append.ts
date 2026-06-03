import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type AppendInput = {
  path: string;
  content: string;
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
    operation: "write"
  });
  if (!resolved.ok) {
    return resolved;
  }

  await mkdir(dirname(resolved.data), { recursive: true });
  await appendFile(resolved.data, input.content, "utf8");

  const snapshot = await readFileSnapshot(resolved.data);
  if (!snapshot.ok) {
    return snapshot;
  }

  return success({
    absolutePath: resolved.data,
    lines_added: input.content.split(/\r\n|\n/).filter((line, index, items) => !(index === items.length - 1 && line === "")).length,
    new_total_lines: snapshot.data.lineCount
  });
}
