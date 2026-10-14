import type { Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath, toRelativeDisplayPath } from "../core/path-policy.js";

type ListDirEntry = {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  isSymlink: boolean;
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

  let children: string[];
  try {
    children = await readdir(resolved.data);
  } catch (error) {
    return failure(
      isNodeErrorWithCode(error, "ENOTDIR") ? "INVALID_INPUT" : "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to list directory ${resolved.data}`,
      resolved.data
    );
  }

  const ordered = [...children].sort((left, right) => left.localeCompare(right));
  const entries: ListDirEntry[] = [];
  const displayRoot = config.roots[0] ?? resolved.data;

  for (const child of ordered) {
    if (!config.allowHiddenPaths && child.startsWith(".")) {
      continue;
    }

    // lstat only: listing must not read file contents (binary or huge files
    // used to fail the whole listing) and must not follow links out of the root.
    const childPath = join(resolved.data, child);
    let stats: Stats;
    try {
      stats = await lstat(childPath);
    } catch {
      // The entry vanished between readdir and lstat.
      continue;
    }

    entries.push({
      name: child,
      path: childPath,
      relativePath: toRelativeDisplayPath(displayRoot, childPath),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      sizeBytes: stats.size
    });
  }

  return success({
    absolutePath: resolved.data,
    entries
  });
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
