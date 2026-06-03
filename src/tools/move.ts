import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type MoveInput = {
  source: string;
  destination: string;
  overwrite?: boolean | undefined;
};

type MoveResult = {
  source: string;
  destination: string;
};

export async function moveTool(
  input: MoveInput,
  config: ScalpelConfig
): Promise<DomainResult<MoveResult>> {
  const source = await resolveWorkspacePath({
    path: input.source,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!source.ok) {
    return source;
  }

  const destination = await resolveWorkspacePath({
    path: input.destination,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!destination.ok) {
    return destination;
  }

  try {
    await stat(source.data);
  } catch {
    return failure("FILE_NOT_FOUND", "Source path does not exist", source.data);
  }

  if (input.overwrite !== true) {
    try {
      await stat(destination.data);
      return failure("FILE_EXISTS", "Destination already exists", destination.data);
    } catch {
      // destination absent is the common path
    }
  }

  await mkdir(dirname(destination.data), { recursive: true });
  await rename(source.data, destination.data);

  return success({
    source: source.data,
    destination: destination.data
  });
}
