import { createHash } from "node:crypto";
import { lstat, mkdir, rm, symlink } from "node:fs/promises";

import { failure, success, type DomainResult } from "./errors.js";
import {
  readFileSnapshot,
  readPathStat,
  type FileSnapshot,
  type FileStat,
} from "./file-metadata.js";
import { writeFileAtomic } from "./write-file-atomic.js";

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

export async function writeTextFileForMutation(
  input: MutationWriteInput,
): Promise<DomainResult<{ warnings: string[] }>> {
  await runHardeningInterference(input.path, "BEFORE_COMMIT");

  const guard = await validateCommitGuard(input);
  if (!guard.ok) {
    return guard;
  }

  const warnings = await writeFileAtomic(input.path, input.content, {
    ...(input.durability !== undefined ? { durability: input.durability } : {}),
    ...(input.transactionDir !== undefined ? { transactionDir: input.transactionDir } : {}),
  });
  await runHardeningInterference(input.path, "AFTER_COMMIT");

  const verification = await verifyCommittedContent(input);
  if (!verification.ok) {
    return verification;
  }

  return success({ warnings });
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

async function verifyCommittedContent(input: MutationWriteInput): Promise<DomainResult<undefined>> {
  const symlinkCheck = await validatePathIsNotSymlink(input.path);
  if (!symlinkCheck.ok) {
    return symlinkCheck;
  }

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

  return success(undefined);
}

async function validatePathIsNotSymlink(path: string): Promise<DomainResult<undefined>> {
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

async function runHardeningInterference(
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
  if (mode === "symlink") {
    const target = process.env[`SCALPEL_HARDENING_INTERFERE_${phase}_SYMLINK_TARGET`];
    if (target === undefined) {
      throw new Error(`SCALPEL_HARDENING_INTERFERE_${phase}_SYMLINK_TARGET is required`);
    }
    await rm(path, { recursive: true, force: true });
    await symlink(target, path, "file");
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
