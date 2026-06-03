import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type CreateInput = {
  path: string;
  content: string;
  overwrite?: boolean | undefined;
};

type CreateResult = {
  absolutePath: string;
  lines: number;
  size_bytes: number;
};

export async function createTool(
  input: CreateInput,
  config: ScalpelConfig
): Promise<DomainResult<CreateResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write"
  });

  if (!resolved.ok) {
    return resolved;
  }

  const existing = await readFileSnapshot(resolved.data);
  if (existing.ok && input.overwrite !== true) {
    return failure("FILE_EXISTS", "File already exists", resolved.data);
  }

  await mkdir(dirname(resolved.data), { recursive: true });
  await writeFile(resolved.data, input.content, "utf8");

  const snapshot = await readFileSnapshot(resolved.data);
  if (!snapshot.ok) {
    return snapshot;
  }

  return success({
    absolutePath: resolved.data,
    lines: snapshot.data.lineCount,
    size_bytes: snapshot.data.sizeBytes
  });
}
