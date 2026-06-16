import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { recordJournal, snapshotState } from "../core/journal.js";
import { readPathStatForMutation } from "../core/mutation.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type MoveInput = {
  source: string;
  destination: string;
  overwrite?: boolean | undefined;
  dry_run?: boolean | undefined;
  expected_source_sha256?: string | undefined;
  expected_source_mtime_ms?: number | undefined;
  expected_destination_sha256?: string | undefined;
  expected_destination_mtime_ms?: number | undefined;
};

type MoveResult = {
  source: string;
  destination: string;
  applied?: boolean;
  source_exists?: boolean;
  destination_exists?: boolean;
  would_overwrite?: boolean;
  warnings?: string[];
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

  const sourceStat = await readPathStatForMutation({
    path: source.data,
    expected_sha256: input.expected_source_sha256,
    expected_mtime_ms: input.expected_source_mtime_ms,
    maxReadBytes: config.maxReadBytes
  });
  if (!sourceStat.ok) {
    if (sourceStat.error.code === "FILE_NOT_FOUND") {
      return failure("FILE_NOT_FOUND", "Source path does not exist", source.data);
    }

    return sourceStat;
  }

  let destinationExists = false;
  let destinationBefore: Awaited<ReturnType<typeof readPathStatForMutation>> | undefined;
  if (input.overwrite !== true) {
    try {
      await stat(destination.data);
      return failure("FILE_EXISTS", "Destination already exists", destination.data);
    } catch {
      // destination absent is the common path
    }
  } else {
    const destinationStat = await readPathStatForMutation({
      path: destination.data,
      expected_sha256: input.expected_destination_sha256,
      expected_mtime_ms: input.expected_destination_mtime_ms,
      maxReadBytes: config.maxReadBytes
    });
    destinationBefore = destinationStat;

    if (destinationStat.ok) {
      destinationExists = true;
    } else if (destinationStat.error.code === "FILE_NOT_FOUND") {
      if (
        input.expected_destination_sha256 !== undefined ||
        input.expected_destination_mtime_ms !== undefined
      ) {
        return failure(
          "FILE_NOT_FOUND",
          "Destination does not exist, but destination preconditions were provided",
          destination.data,
          {
            expected_sha256: input.expected_destination_sha256,
            expected_mtime_ms: input.expected_destination_mtime_ms
          }
        );
      }
    } else {
      return destinationStat;
    }
  }

  const result = {
    source: source.data,
    destination: destination.data,
    applied: input.dry_run !== true,
    source_exists: true,
    destination_exists: destinationExists,
    would_overwrite: destinationExists && input.overwrite === true
  };

  if (input.dry_run === true) {
    const warnings = await recordJournal(config, {
      tool: "move",
      paths: [source.data, destination.data],
      dry_run: true,
      applied: false,
      before: snapshotState(sourceStat.data),
      after: destinationBefore?.ok === true ? snapshotState(destinationBefore.data) : undefined
    });
    return success({
      ...result,
      ...(warnings.length > 0 ? { warnings } : {})
    });
  }

  await mkdir(dirname(destination.data), { recursive: true });
  await rename(source.data, destination.data);

  const destinationAfter = await readPathStatForMutation({
    path: destination.data,
    maxReadBytes: config.maxReadBytes
  });
  const warnings = await recordJournal(config, {
    tool: "move",
    paths: [source.data, destination.data],
    dry_run: false,
    applied: true,
    before: snapshotState(sourceStat.data),
    after: destinationAfter.ok ? snapshotState(destinationAfter.data) : undefined
  });

  return success({
    ...result,
    ...(warnings.length > 0 ? { warnings } : {})
  });
}
