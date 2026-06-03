import { lstat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { failure, success, type DomainResult } from "./errors.js";

type ResolveWorkspacePathInput = {
  path: string;
  roots: string[];
  operation: "read" | "write";
  allowHiddenPaths?: boolean | undefined;
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

  const containingRoot = roots.find((root) => {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });

  if (containingRoot === undefined) {
    return failure("PATH_OUTSIDE_ROOT", `Path escapes configured roots: ${input.path}`, candidate);
  }

  const traversalValidation = await validatePathTraversal(
    containingRoot,
    candidate,
    input.allowHiddenPaths ?? true
  );
  if (!traversalValidation.ok) {
    return traversalValidation;
  }

  return { ...success(candidate), value: candidate };
}

async function validatePathTraversal(
  root: string,
  candidate: string,
  allowHiddenPaths: boolean
): Promise<DomainResult<string>> {
  const rel = relative(root, candidate);
  const segments = rel === "" ? [] : rel.split(sep).filter((segment) => segment.length > 0);

  let current = root;
  for (const segment of segments) {
    if (!allowHiddenPaths && segment.startsWith(".")) {
      return failure(
        "HIDDEN_PATH_NOT_ALLOWED",
        `Hidden paths are not allowed: ${segment}`,
        candidate
      );
    }

    current = join(current, segment);
    const stats = await tryLstat(current);
    if (stats === undefined) {
      continue;
    }

    if (stats.isSymbolicLink()) {
      return failure(
        "SYMLINK_NOT_ALLOWED",
        `Symlink paths are not allowed: ${basename(current)}`,
        current
      );
    }
  }

  return success(candidate);
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
