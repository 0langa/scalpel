import { failure, success, type DomainResult } from "./errors.js";
import {
  readFileSnapshot,
  readPathStat,
  type FileSnapshot,
  type FileStat
} from "./file-metadata.js";

export type MutationPreconditionInput = {
  path: string;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
  maxReadBytes?: number | undefined;
};

export async function readSnapshotForMutation(
  input: MutationPreconditionInput
): Promise<DomainResult<FileSnapshot>> {
  const snapshot = await readFileSnapshot(input.path, {
    maxBytes: input.maxReadBytes,
    suggestedTool: "read_chunk"
  });
  if (!snapshot.ok) {
    return snapshot;
  }

  if (
    input.expected_sha256 !== undefined &&
    snapshot.data.sha256 !== input.expected_sha256
  ) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed since the caller last observed it",
      input.path,
      {
        expected_sha256: input.expected_sha256,
        actual_sha256: snapshot.data.sha256
      }
    );
  }

  if (
    input.expected_mtime_ms !== undefined &&
    snapshot.data.mtimeMs !== input.expected_mtime_ms
  ) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "File changed since the caller last observed it",
      input.path,
      {
        expected_mtime_ms: input.expected_mtime_ms,
        actual_mtime_ms: snapshot.data.mtimeMs
      }
    );
  }

  return snapshot;
}

export async function readOptionalSnapshotForMutation(
  input: MutationPreconditionInput
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
      expectedDetails(input)
    );
  }

  return success(undefined);
}

export async function readPathStatForMutation(
  input: MutationPreconditionInput
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
        expectedDetails(input)
      );
    }

    if (pathStat.data.sha256 !== input.expected_sha256) {
      return failure(
        "CONCURRENCY_CONFLICT",
        "Path changed since the caller last observed it",
        input.path,
        {
          expected_sha256: input.expected_sha256,
          actual_sha256: pathStat.data.sha256
        }
      );
    }
  }

  if (
    input.expected_mtime_ms !== undefined &&
    pathStat.data.mtimeMs !== input.expected_mtime_ms
  ) {
    return failure(
      "CONCURRENCY_CONFLICT",
      "Path changed since the caller last observed it",
      input.path,
      {
        expected_mtime_ms: input.expected_mtime_ms,
        actual_mtime_ms: pathStat.data.mtimeMs
      }
    );
  }

  return pathStat;
}

export function hasMutationPreconditions(input: MutationPreconditionInput): boolean {
  return input.expected_sha256 !== undefined || input.expected_mtime_ms !== undefined;
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
