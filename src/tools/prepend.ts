import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type PrependInput = {
  path: string;
  content: string;
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
    operation: "write"
  });
  if (!resolved.ok) {
    return resolved;
  }

  const before = await readFileSnapshot(resolved.data);
  const existing = before.ok ? before.data.content : "";

  await mkdir(dirname(resolved.data), { recursive: true });
  await writeFile(resolved.data, `${input.content}${existing}`, "utf8");

  const after = await readFileSnapshot(resolved.data);
  if (!after.ok) {
    return after;
  }

  return success({
    absolutePath: resolved.data,
    lines_added: input.content.split(/\r\n|\n/).filter((line, index, items) => !(index === items.length - 1 && line === "")).length,
    new_total_lines: after.data.lineCount
  });
}
