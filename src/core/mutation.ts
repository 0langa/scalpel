import { failure, type DomainResult } from "./errors.js";
import { readFileSnapshot, type FileSnapshot } from "./file-metadata.js";

type MutationPreconditionInput = {
  path: string;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

export async function readSnapshotForMutation(
  input: MutationPreconditionInput
): Promise<DomainResult<FileSnapshot>> {
  const snapshot = await readFileSnapshot(input.path);
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
