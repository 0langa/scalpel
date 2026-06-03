import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { readPathStat } from "../core/file-metadata.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath, toRelativeDisplayPath } from "../core/path-policy.js";

type ListDirEntry = {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
};

type ListDirResult = {
  absolutePath: string;
  entries: ListDirEntry[];
};

export async function listDirTool(
  input: { path: string },
  config: ScalpelConfig
): Promise<DomainResult<ListDirResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read",
    allowHiddenPaths: config.allowHiddenPaths
  });

  if (!resolved.ok) {
    return resolved;
  }

  try {
    const children = await readdir(resolved.data);
    const ordered = [...children].sort((left, right) => left.localeCompare(right));
    const entries: ListDirEntry[] = [];
    const displayRoot = config.roots[0] ?? resolved.data;

    for (const child of ordered) {
      const childPath = join(resolved.data, child);
      const stats = await readPathStat(childPath);

      if (!stats.ok) {
        return stats;
      }

      entries.push({
        name: child,
        path: childPath,
        relativePath: toRelativeDisplayPath(displayRoot, childPath),
        isDirectory: stats.data.isDirectory,
        sizeBytes: stats.data.sizeBytes
      });
    }

    return success({
      absolutePath: resolved.data,
      entries
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to list directory ${resolved.data}`,
      resolved.data
    );
  }
}
