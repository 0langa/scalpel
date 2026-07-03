import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { crashIfFaultPoint } from "../core/fault-injection.js";
import { type FileStat, readPathStat } from "../core/file-metadata.js";
import { recordJournal, snapshotState } from "../core/journal.js";
import {
  readPathStatForMutation,
  runHardeningInterference,
  validatePathIsNotSymlink,
} from "../core/mutation.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { beginMoveTransaction } from "../core/write-transaction.js";

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
  config: ScalpelConfig,
): Promise<DomainResult<MoveResult>> {
  const source = await resolveWorkspacePath({
    path: input.source,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths,
  });
  if (!source.ok) {
    return source;
  }

  const destination = await resolveWorkspacePath({
    path: input.destination,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths,
  });
  if (!destination.ok) {
    return destination;
  }

  return withPathLock([source.data, destination.data], async () => {
    const sourceStat = await readPathStatForMutation({
      path: source.data,
      expected_sha256: input.expected_source_sha256,
      expected_mtime_ms: input.expected_source_mtime_ms,
      maxReadBytes: config.maxReadBytes,
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
        maxReadBytes: config.maxReadBytes,
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
              expected_mtime_ms: input.expected_destination_mtime_ms,
            },
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
      would_overwrite: destinationExists && input.overwrite === true,
    };

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "move",
        paths: [source.data, destination.data],
        dry_run: true,
        applied: false,
        before: snapshotState(sourceStat.data),
        after: destinationBefore?.ok === true ? snapshotState(destinationBefore.data) : undefined,
      });
      return success({
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    await mkdir(dirname(destination.data), { recursive: true });

    await runHardeningInterference(source.data, "BEFORE_COMMIT");
    await runHardeningInterference(destination.data, "BEFORE_COMMIT");
    await runHardeningInterference(dirname(destination.data), "BEFORE_COMMIT");

    const sourceGuard = await revalidatePathBeforeMove(source.data, sourceStat.data, config.maxReadBytes);
    if (!sourceGuard.ok) {
      await recordJournal(config, {
        tool: "move",
        paths: [source.data, destination.data],
        dry_run: false,
        applied: false,
        error_code: sourceGuard.error.code,
        before: snapshotState(sourceStat.data),
      });
      return sourceGuard;
    }

    const destinationGuard =
      destinationExists && destinationBefore?.ok === true
        ? await revalidatePathBeforeMove(destination.data, destinationBefore.data, config.maxReadBytes)
        : await revalidatePathIsAbsent(destination.data);
    if (!destinationGuard.ok) {
      await recordJournal(config, {
        tool: "move",
        paths: [source.data, destination.data],
        dry_run: false,
        applied: false,
        error_code: destinationGuard.error.code,
        before: snapshotState(sourceStat.data),
      });
      return destinationGuard;
    }

    const parentGuard = await revalidateParentDirectory(dirname(destination.data));
    if (!parentGuard.ok) {
      await recordJournal(config, {
        tool: "move",
        paths: [source.data, destination.data],
        dry_run: false,
        applied: false,
        error_code: parentGuard.error.code,
        before: snapshotState(sourceStat.data),
      });
      return parentGuard;
    }

    const transaction = await beginMoveTransaction({
      transactionDir: config.transactionDir,
      sourcePath: source.data,
      destinationPath: destination.data,
    });
    crashIfFaultPoint("move.after_transaction_start");
    try {
      await rename(source.data, destination.data);
    } catch (error) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Move failed because the source or destination changed after the move plan was built",
        source.data,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    crashIfFaultPoint("move.after_rename");
    await transaction.markRenamed();
    crashIfFaultPoint("move.after_mark_renamed");

    const destinationAfter = await readPathStatForMutation({
      path: destination.data,
      maxReadBytes: config.maxReadBytes,
    });
    const warnings = await recordJournal(config, {
      tool: "move",
      paths: [source.data, destination.data],
      dry_run: false,
      applied: true,
      before: snapshotState(sourceStat.data),
      after: destinationAfter.ok ? snapshotState(destinationAfter.data) : undefined,
    });
    crashIfFaultPoint("move.after_journal");
    await transaction.complete();

    return success({
      ...result,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

async function revalidatePathBeforeMove(
  path: string,
  before: FileStat,
  maxReadBytes: number | undefined,
): Promise<DomainResult<undefined>> {
  const symlinkCheck = await validatePathIsNotSymlink(path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  const current = await readPathStat(path, { maxBytes: maxReadBytes });
  if (!current.ok) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Path changed or disappeared after the move plan was built",
      path,
      { cause: current.error },
    );
  }

  const shaChanged = before.sha256 !== undefined && current.data.sha256 !== before.sha256;
  if (
    current.data.mtimeMs !== before.mtimeMs ||
    current.data.isDirectory !== before.isDirectory ||
    shaChanged
  ) {
    return failure("CONCURRENCY_CONFLICT", "Path changed after the move plan was built", path, {
      expected_mtime_ms: before.mtimeMs,
      actual_mtime_ms: current.data.mtimeMs,
      ...(before.sha256 !== undefined
        ? { expected_sha256: before.sha256, actual_sha256: current.data.sha256 }
        : {}),
    });
  }

  return success(undefined);
}

async function revalidatePathIsAbsent(path: string): Promise<DomainResult<undefined>> {
  const symlinkCheck = await validatePathIsNotSymlink(path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  try {
    await stat(path);
    return failure("CONCURRENCY_CONFLICT", "Destination appeared after the move plan was built", path);
  } catch {
    return success(undefined);
  }
}

async function revalidateParentDirectory(path: string): Promise<DomainResult<undefined>> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Destination parent directory was replaced after the move plan was built",
        path,
      );
    }
    return success(undefined);
  } catch {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Destination parent directory disappeared after the move plan was built",
      path,
    );
  }
}
