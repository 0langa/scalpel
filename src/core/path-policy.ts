import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { failure, success, type DomainResult } from "./errors.js";

type ResolveWorkspacePathInput = {
  path: string;
  roots: string[];
  operation: "read" | "write";
};

export async function resolveWorkspacePath(
  input: ResolveWorkspacePathInput
): Promise<(DomainResult<string> & { value?: string | undefined })> {
  const roots = input.roots.map((root) => resolve(root));
  const firstRoot = roots[0];
  if (firstRoot === undefined) {
    return failure("PATH_OUTSIDE_ROOT", "No workspace roots are configured");
  }

  const candidate = isAbsolute(input.path) ? resolve(input.path) : resolve(firstRoot, input.path);

  const isInsideRoot = roots.some((root) => {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });

  if (!isInsideRoot) {
    return failure("PATH_OUTSIDE_ROOT", `Path escapes configured roots: ${input.path}`, candidate);
  }

  const stats = await tryLstat(candidate);
  if (stats?.isSymbolicLink()) {
    return failure("SYMLINK_NOT_ALLOWED", `Symlink paths are not allowed: ${input.path}`, candidate);
  }

  return { ...success(candidate), value: candidate };
}

async function tryLstat(path: string) {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

export function toRelativeDisplayPath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  return rel === "" ? "." : rel.split(sep).join("/");
}
