import { lstat, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult, type FailureResult } from "../core/errors.js";
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
import { renameWithRetry } from "../core/write-file-atomic.js";
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

    if (sourceStat.data.isDirectory && isStrictlyInside(source.data, destination.data)) {
      // Fail before mkdir() would create the destination parent inside the
      // source, and with a clear error instead of rename()'s EINVAL.
      return failure("INVALID_INPUT", "Cannot move a directory into itself", source.data, {
        destination: destination.data,
      });
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
    const parentIdentity = await directoryIdentity(dirname(destination.data));

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

    const parentGuard = await revalidateParentDirectory(dirname(destination.data), parentIdentity);
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
      // Windows may retry the rename for a while; recheck what can change in
      // the meantime before every attempt.
      await renameWithRetry(source.data, destination.data, async () => {
        const recheck = await revalidateParentDirectory(dirname(destination.data), parentIdentity);
        const absent = destinationExists ? recheck : await revalidatePathIsAbsent(destination.data);
        const failed = !recheck.ok ? recheck : absent;
        if (!failed.ok) {
          throw new MoveGuardError(failed);
        }
      });
    } catch (error) {
      // rename() is atomic: when it fails nothing moved, so the record must not
      // linger (with overwrite it would later be quarantined as "both exist").
      await Promise.allSettled([transaction.complete()]);
      if (error instanceof MoveGuardError) {
        return error.result;
      }
      const causeCode = errorCode(error);

      if (causeCode === "EXDEV") {
        return failure(
          "CROSS_DEVICE_MOVE_NOT_SUPPORTED",
          "Move across filesystems or devices is not supported",
          source.data,
          { destination: destination.data },
        );
      }

      const cause = {
        cause: error instanceof Error ? error.message : String(error),
        ...(causeCode === undefined ? {} : { cause_code: causeCode }),
      };
      if (causeCode === "EACCES" || causeCode === "EPERM") {
        return failure(
          "PERMISSION_DENIED",
          "Move was refused by the operating system (permissions, or a file held open by another process)",
          source.data,
          cause,
        );
      }

      return failure(
        "CONCURRENCY_CONFLICT",
        "Move failed because the source or destination changed after the move plan was built",
        source.data,
        cause,
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

class MoveGuardError extends Error {
  constructor(readonly result: FailureResult) {
    super(result.error.message);
  }
}

// birthtime as well: Linux readily reuses a just-freed inode number for a new
// directory created at the same path.
type DirectoryIdentity = { dev: number; ino: number; birthtimeMs: number } | undefined;

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  try {
    const info = await lstat(path);
    return info.isDirectory()
      ? { dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs }
      : undefined;
  } catch {
    return undefined;
  }
}

// lstat, not stat: a parent swapped for a symlink or junction to another
// directory still "is a directory" through stat(), and the rename would move
// the source wherever the link points. Comparing the identity also catches a
// parent replaced by a different real directory.
async function revalidateParentDirectory(
  path: string,
  expected: DirectoryIdentity,
): Promise<DomainResult<undefined>> {
  try {
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.dev !== expected?.dev ||
      info.ino !== expected.ino ||
      info.birthtimeMs !== expected.birthtimeMs
    ) {
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

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

// Strictly inside: the same path (for example a case-only rename) is not.
function isStrictlyInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
