import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { failure, success, type DomainResult } from "./errors.js";
import {
  readFileSnapshot,
  readPathStat,
  type FileSnapshot,
  type FileStat,
} from "./file-metadata.js";
import { isInside } from "./path-policy.js";
import { writeFileAtomic, writeFileAtomicStream } from "./write-file-atomic.js";

export type MutationPreconditionInput = {
  path: string;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
  maxReadBytes?: number | undefined;
};

export type MutationWriteInput = {
  path: string;
  content: string;
  before: FileSnapshot | undefined;
  maxReadBytes?: number | undefined;
  durability?: "default" | "strict" | undefined;
  transactionDir?: string | undefined;
  // Configured roots: when given, the parent directory must still resolve
  // inside one of them (through any symlinks) when the write commits.
  roots?: readonly string[] | undefined;
};

export type StreamingMutationWriteInput = {
  path: string;
  chunks: AsyncIterable<string | Buffer> | Iterable<string | Buffer>;
  before: FileStat | undefined;
  afterSha256: string;
  afterSizeBytes: number;
  maxReadBytes?: number | undefined;
  durability?: "default" | "strict" | undefined;
  transactionDir?: string | undefined;
  // Configured roots: when given, the parent directory must still resolve
  // inside one of them (through any symlinks) when the write commits.
  roots?: readonly string[] | undefined;
};

export async function readSnapshotForMutation(
  input: MutationPreconditionInput,
): Promise<DomainResult<FileSnapshot>> {
  const snapshot = await readFileSnapshot(input.path, {
    maxBytes: input.maxReadBytes,
    suggestedTool: "read_chunk",
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  if (input.expected_sha256 !== undefined && snapshot.data.sha256 !== input.expected_sha256) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed since the caller last observed it",
      input.path,
      {
        expected_sha256: input.expected_sha256,
        actual_sha256: snapshot.data.sha256,
      },
    );
  }

  if (input.expected_mtime_ms !== undefined && snapshot.data.mtimeMs !== input.expected_mtime_ms) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed since the caller last observed it",
      input.path,
      {
        expected_mtime_ms: input.expected_mtime_ms,
        actual_mtime_ms: snapshot.data.mtimeMs,
      },
    );
  }

  return snapshot;
}

export async function readOptionalSnapshotForMutation(
  input: MutationPreconditionInput,
): Promise<DomainResult<FileSnapshot | undefined>> {
  const snapshot = await readSnapshotForMutation(input);
  if (snapshot.ok) {
    return snapshot;
  }

  if (snapshot.error.code !== "FILE_NOT_FOUND") {
    return snapshot;
  }

  if (hasMutationPreconditions(input)) {
    return failure(
      "FILE_NOT_FOUND",
      "Path does not exist, but mutation preconditions were provided",
      input.path,
      expectedDetails(input),
    );
  }

  return success(undefined);
}

export async function readPathStatForMutation(
  input: MutationPreconditionInput,
): Promise<DomainResult<FileStat>> {
  const pathStat = await readPathStat(input.path, { maxBytes: input.maxReadBytes });
  if (!pathStat.ok) {
    return pathStat;
  }

  if (input.expected_sha256 !== undefined) {
    if (pathStat.data.sha256 === undefined) {
      return failure(
        "INVALID_INPUT",
        "SHA-256 preconditions are only supported for files",
        input.path,
        expectedDetails(input),
      );
    }

    if (pathStat.data.sha256 !== input.expected_sha256) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Path changed since the caller last observed it",
        input.path,
        {
          expected_sha256: input.expected_sha256,
          actual_sha256: pathStat.data.sha256,
        },
      );
    }
  }

  if (input.expected_mtime_ms !== undefined && pathStat.data.mtimeMs !== input.expected_mtime_ms) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Path changed since the caller last observed it",
      input.path,
      {
        expected_mtime_ms: input.expected_mtime_ms,
        actual_mtime_ms: pathStat.data.mtimeMs,
      },
    );
  }

  return pathStat;
}

export function hasMutationPreconditions(input: MutationPreconditionInput): boolean {
  return input.expected_sha256 !== undefined || input.expected_mtime_ms !== undefined;
}

// `after` is the file as verified right after the commit. Callers report it
// instead of reading the file again: a read bound by maxReadBytes fails once an
// edit grows the file past the limit, after the edit is already on disk (a
// client that retries would apply it twice), and a later read could report a
// change another process made after the verification as Scalpel's own.
export async function writeTextFileForMutation(
  input: MutationWriteInput,
): Promise<DomainResult<{ warnings: string[]; after: FileSnapshot }>> {
  await runHardeningInterference(input.path, "BEFORE_COMMIT");

  const containment = await validateParentInsideRoots(input.path, input.roots);
  if (!containment.ok) {
    return containment;
  }
  const identity = await readTargetIdentity(input.path);
  const guard = await validateCommitGuard(input);
  if (!guard.ok) {
    return guard;
  }

  let warnings: string[];
  try {
    warnings = await writeFileAtomic(input.path, input.content, {
      ...(input.durability !== undefined ? { durability: input.durability } : {}),
      ...(input.transactionDir !== undefined ? { transactionDir: input.transactionDir } : {}),
      beforeRename: () => assertTargetUnchanged(input.path, identity, input.roots),
    });
  } catch (error) {
    if (error instanceof TargetChangedError) {
      return failure("CONCURRENCY_CONFLICT", error.message, input.path);
    }
    throw error;
  }
  await runHardeningInterference(input.path, "AFTER_COMMIT");

  const verification = await verifyCommittedContent(input);
  if (!verification.ok) {
    return verification;
  }

  return success({ warnings, after: verification.data });
}

// `after` is the file as verified right after the commit, as for
// writeTextFileForMutation.
export async function writeTextFileStreamForMutation(
  input: StreamingMutationWriteInput,
): Promise<DomainResult<{ warnings: string[]; after: FileStat }>> {
  await runHardeningInterference(input.path, "BEFORE_COMMIT");

  const containment = await validateParentInsideRoots(input.path, input.roots);
  if (!containment.ok) {
    return containment;
  }
  const identity = await readTargetIdentity(input.path);
  const guard = await validateStreamingCommitGuard(input);
  if (!guard.ok) {
    return guard;
  }

  let warnings: string[];
  try {
    warnings = await writeFileAtomicStream(input.path, input.chunks, {
      afterSha256: input.afterSha256,
      afterSizeBytes: input.afterSizeBytes,
      ...(input.durability !== undefined ? { durability: input.durability } : {}),
      ...(input.transactionDir !== undefined ? { transactionDir: input.transactionDir } : {}),
      beforeRename: () => assertTargetUnchanged(input.path, identity, input.roots),
    });
  } catch (error) {
    if (error instanceof TargetChangedError) {
      return failure("CONCURRENCY_CONFLICT", error.message, input.path);
    }
    throw error;
  }
  await runHardeningInterference(input.path, "AFTER_COMMIT");

  const verification = await verifyCommittedStreamContent(input);
  if (!verification.ok) {
    return verification;
  }

  return success({ warnings, after: verification.data });
}

async function validateCommitGuard(input: MutationWriteInput): Promise<DomainResult<undefined>> {
  if (input.before === undefined) {
    const symlinkCheck = await validatePathIsNotSymlink(input.path);
    if (!symlinkCheck.ok) {
      return symlinkCheck;
    }

    const current = await readPathStat(input.path, { maxBytes: input.maxReadBytes });
    if (current.ok) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Path appeared after the mutation plan was built",
        input.path,
        {
          actual_mtime_ms: current.data.mtimeMs,
          actual_sha256: current.data.sha256,
        },
      );
    }

    if (current.error.code === "FILE_NOT_FOUND") {
      return success(undefined);
    }

    return current;
  }

  const symlinkCheck = await validatePathIsNotSymlink(input.path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  const writableCheck = await validateFileIsWritable(input.path);
  if (!writableCheck.ok) {
    return writableCheck;
  }

  const current = await readFileSnapshot(input.path, {
    maxBytes: input.maxReadBytes,
    suggestedTool: "read_chunk",
  });
  if (!current.ok) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed or disappeared after the mutation plan was built",
      input.path,
      {
        expected_sha256: input.before.sha256,
        expected_mtime_ms: input.before.mtimeMs,
        cause: current.error,
      },
    );
  }

  if (
    current.data.sha256 !== input.before.sha256 ||
    current.data.mtimeMs !== input.before.mtimeMs
  ) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed after the mutation plan was built",
      input.path,
      {
        expected_sha256: input.before.sha256,
        actual_sha256: current.data.sha256,
        expected_mtime_ms: input.before.mtimeMs,
        actual_mtime_ms: current.data.mtimeMs,
      },
    );
  }

  return success(undefined);
}

async function validateStreamingCommitGuard(
  input: StreamingMutationWriteInput,
): Promise<DomainResult<undefined>> {
  const symlinkCheck = await validatePathIsNotSymlink(input.path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  if (input.before === undefined) {
    const current = await readPathStat(input.path, { maxBytes: input.maxReadBytes });
    if (current.ok) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Path appeared after the mutation plan was built",
        input.path,
        {
          actual_mtime_ms: current.data.mtimeMs,
          actual_sha256: current.data.sha256,
        },
      );
    }

    if (current.error.code === "FILE_NOT_FOUND") {
      return success(undefined);
    }

    return current;
  }

  const writableCheck = await validateFileIsWritable(input.path);
  if (!writableCheck.ok) {
    return writableCheck;
  }

  const current = await readPathStat(input.path, { maxBytes: input.maxReadBytes });
  if (!current.ok) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Path changed or disappeared after the mutation plan was built",
      input.path,
      {
        expected_sha256: input.before.sha256,
        expected_mtime_ms: input.before.mtimeMs,
        cause: current.error,
      },
    );
  }

  if (
    current.data.sha256 !== input.before.sha256 ||
    current.data.mtimeMs !== input.before.mtimeMs ||
    current.data.sizeBytes !== input.before.sizeBytes
  ) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Path changed after the mutation plan was built",
      input.path,
      {
        expected_sha256: input.before.sha256,
        actual_sha256: current.data.sha256,
        expected_mtime_ms: input.before.mtimeMs,
        actual_mtime_ms: current.data.mtimeMs,
      },
    );
  }

  return success(undefined);
}

async function verifyCommittedContent(
  input: MutationWriteInput,
): Promise<DomainResult<FileSnapshot>> {
  const symlinkCheck = await validatePathIsNotSymlink(input.path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  // The limit applies to the file before the edit; the new content may be larger.
  const maxBytes = Math.max(input.maxReadBytes ?? 0, Buffer.byteLength(input.content, "utf8"));
  const current = await readFileSnapshot(input.path, {
    maxBytes,
    suggestedTool: "read_chunk",
  });
  if (!current.ok) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed or disappeared after Scalpel committed the mutation",
      input.path,
      {
        expected_sha256: sha256(input.content),
        cause: current.error,
      },
    );
  }

  const expectedSha = sha256(input.content);
  if (current.data.sha256 !== expectedSha) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed after Scalpel committed the mutation",
      input.path,
      {
        expected_sha256: expectedSha,
        actual_sha256: current.data.sha256,
      },
    );
  }

  return current;
}

async function verifyCommittedStreamContent(
  input: StreamingMutationWriteInput,
): Promise<DomainResult<FileStat>> {
  const symlinkCheck = await validatePathIsNotSymlink(input.path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

  const current = await readPathStat(input.path, { maxBytes: input.maxReadBytes });
  if (!current.ok) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed or disappeared after Scalpel committed the mutation",
      input.path,
      {
        expected_sha256: input.afterSha256,
        cause: current.error,
      },
    );
  }

  if (current.data.sha256 !== input.afterSha256 || current.data.sizeBytes !== input.afterSizeBytes) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed after Scalpel committed the mutation",
      input.path,
      {
        expected_sha256: input.afterSha256,
        actual_sha256: current.data.sha256,
      },
    );
  }

  return current;
}

export async function validatePathIsNotSymlink(path: string): Promise<DomainResult<undefined>> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Path was replaced by a symlink during mutation",
        path,
      );
    }
  } catch {
    // Missing paths are handled by the normal commit guard.
  }

  return success(undefined);
}

class TargetChangedError extends Error {}

type EntryIdentity =
  | { dev: number; ino: number; size: number; mtimeMs: number; symlink: boolean }
  | "absent";

type TargetIdentity = { target: EntryIdentity; parent: EntryIdentity };

async function readEntryIdentity(path: string): Promise<EntryIdentity> {
  try {
    const info = await lstat(path);
    return {
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
      symlink: info.isSymbolicLink(),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return "absent";
    }
    throw error;
  }
}

async function readTargetIdentity(path: string): Promise<TargetIdentity> {
  return { target: await readEntryIdentity(path), parent: await readEntryIdentity(dirname(path)) };
}

function sameEntry(left: EntryIdentity, right: EntryIdentity, compareContent: boolean): boolean {
  if (left === "absent" || right === "absent") {
    return left === right;
  }
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.symlink === right.symlink &&
    (!compareContent || (left.size === right.size && left.mtimeMs === right.mtimeMs))
  );
}

// The commit guard checks content before the temp file is written, but writing
// it (streaming a large file can take seconds) leaves a window in which another
// process can replace or modify the target, and the rename would silently
// discard that change. Re-check the target's identity right before the rename.
// The parent directory is checked by identity only (its mtime changes when the
// temp file is created): if it, or any ancestor, was swapped for a symlink or
// junction, lstat() resolves the parent to a different directory.
async function assertTargetUnchanged(
  path: string,
  expected: TargetIdentity,
  roots: readonly string[] | undefined,
): Promise<void> {
  const containment = await validateParentInsideRoots(path, roots);
  if (!containment.ok) {
    throw new TargetChangedError(containment.error.message);
  }
  const current = await readTargetIdentity(path);
  if (!sameEntry(expected.parent, current.parent, false)) {
    throw new TargetChangedError("Parent directory was replaced while Scalpel was writing the file");
  }
  if (!sameEntry(expected.target, current.target, true)) {
    throw new TargetChangedError("File changed while Scalpel was writing its replacement");
  }
}

// resolveWorkspacePath() rejects symlinks in the path, but only for segments
// that existed at that moment. A directory that a concurrent process creates
// as (or swaps for) a link to somewhere else afterwards would carry the temp
// file and the rename out of the roots. Resolve the parent for real and
// require it to still be inside a configured root (also resolved, so a root
// that itself sits behind a symlink keeps working).
export async function validateParentInsideRoots(
  path: string,
  roots: readonly string[] | undefined,
): Promise<DomainResult<undefined>> {
  if (roots === undefined) {
    return success(undefined);
  }

  let realParent: string;
  try {
    realParent = await realpath(dirname(path));
  } catch (error) {
    return failure("FILE_NOT_FOUND", "Parent directory of the target disappeared", path, {
      ...(errorCode(error) === undefined ? {} : { cause_code: errorCode(error) }),
    });
  }

  const realRoots = await Promise.all(
    roots.map((root) => realpath(root).catch(() => resolve(root))),
  );
  if (!realRoots.some((root) => isInside(root, realParent))) {
    return failure(
      "SYMLINK_NOT_ALLOWED",
      "Target directory resolves outside the configured roots through a symlink or junction",
      path,
      { resolved_parent: realParent },
    );
  }

  return success(undefined);
}

// Atomic replacement only needs write access to the directory, so without this
// check Scalpel would replace files the user marked read-only (and on Windows
// the rename fails with a raw EPERM). Respect the file's own write permission.
async function validateFileIsWritable(path: string): Promise<DomainResult<undefined>> {
  try {
    await access(path, constants.W_OK);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      // A vanished file is reported by the commit guard's content check.
      return success(undefined);
    }
    return failure("PERMISSION_DENIED", "File is read-only or not writable by this process", path, {
      ...(code === undefined ? {} : { cause_code: code }),
    });
  }

  return success(undefined);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export async function runHardeningInterference(
  path: string,
  phase: "BEFORE_COMMIT" | "AFTER_COMMIT",
): Promise<void> {
  if (process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_PATH`] !== path) {
    return;
  }

  const mode = process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_MODE`] ?? "write";
  if (mode === "delete") {
    await rm(path, { recursive: true, force: true });
    return;
  }
  if (mode === "directory") {
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
    return;
  }
  if (mode === "symlink" || mode === "junction") {
    const target = process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_SYMLINK_TARGET`];
    if (target === undefined) {
      throw new Error(`SCALPEL_HARDENING_INTERFERE_${phase}_SYMLINK_TARGET is required`);
    }
    await rm(path, { recursive: true, force: true });
    // "junction": a directory link, which Windows lets unprivileged users create.
    const linkType = mode === "symlink" ? "file" : process.platform === "win32" ? "junction" : "dir";
    await symlink(target, path, linkType);
    return;
  }
  if (mode === "file") {
    await rm(path, { recursive: true, force: true });
    await writeFileAtomic(
      path,
      process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_CONTENT`] ?? "external interference\n",
    );
    return;
  }

  await writeFileAtomic(
    path,
    process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_CONTENT`] ?? "external interference\n",
  );
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function expectedDetails(input: MutationPreconditionInput): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (input.expected_sha256 !== undefined) {
    details.expected_sha256 = input.expected_sha256;
  }
  if (input.expected_mtime_ms !== undefined) {
    details.expected_mtime_ms = input.expected_mtime_ms;
  }

  return details;
}
