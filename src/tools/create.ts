import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { readFileSnapshot, readPathStat } from "../core/file-metadata.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import { readPathStatForMutation, writeTextFileForMutation } from "../core/mutation.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { countLines } from "../core/line-endings.js";

type CreateInput = {
  path: string;
  content: string;
  overwrite?: boolean | undefined;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type CreateResult = {
  absolutePath: string;
  lines: number;
  size_bytes: number;
  diff?: string;
  applied?: boolean;
  warnings?: string[];
};

export async function createTool(
  input: CreateInput,
  config: ScalpelConfig,
): Promise<DomainResult<CreateResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "write",
    allowHiddenPaths: config.allowHiddenPaths,
  });

  if (!resolved.ok) {
    return resolved;
  }

  return withPathLock([resolved.data], async () => {
    const existingStat =
      input.overwrite === true
        ? await readPathStatForMutation({
            path: resolved.data,
            expected_sha256: input.expected_sha256,
            expected_mtime_ms: input.expected_mtime_ms,
            maxReadBytes: config.maxReadBytes,
          })
        : await readPathStat(resolved.data, { maxBytes: config.maxReadBytes });

    if (existingStat.ok && input.overwrite !== true) {
      return failure("FILE_EXISTS", "File already exists", resolved.data);
    }

    if (existingStat.ok && existingStat.data.isDirectory) {
      return failure("FILE_EXISTS", "Path already exists and is a directory", resolved.data);
    }

    if (
      !existingStat.ok &&
      existingStat.error.code === "FILE_NOT_FOUND" &&
      (input.expected_sha256 !== undefined || input.expected_mtime_ms !== undefined)
    ) {
      return failure(
        "FILE_NOT_FOUND",
        "Path does not exist, but create preconditions were provided",
        resolved.data,
        {
          expected_sha256: input.expected_sha256,
          expected_mtime_ms: input.expected_mtime_ms,
        },
      );
    }

    if (!existingStat.ok && existingStat.error.code !== "FILE_NOT_FOUND") {
      return existingStat;
    }

    const existing = existingStat.ok
      ? await readFileSnapshot(resolved.data, {
          maxBytes: config.maxReadBytes,
          suggestedTool: "read_chunk",
        })
      : undefined;
    if (existing !== undefined && !existing.ok) {
      return existing;
    }

    const before = existing?.data.content ?? "";
    const diff = createUnifiedDiff(resolved.data, before, input.content);
    const result = {
      absolutePath: resolved.data,
      lines: countLines(input.content),
      size_bytes: Buffer.byteLength(input.content, "utf8"),
      diff,
      applied: input.dry_run !== true,
    };

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "create",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: existing?.ok === true ? snapshotState(existing.data) : undefined,
        after: textState(input.content),
      });
      return success({
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    await mkdir(dirname(resolved.data), { recursive: true });
    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: input.content,
      before: existing?.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    const snapshot = await readFileSnapshot(resolved.data, {
      maxBytes: config.maxReadBytes,
      suggestedTool: "read_chunk",
    });
    if (!snapshot.ok) {
      return snapshot;
    }

    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "create",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: existing?.ok === true ? snapshotState(existing.data) : undefined,
        after: snapshotState(snapshot.data),
      }),
    );

    return success({
      ...result,
      lines: snapshot.data.lineCount,
      size_bytes: snapshot.data.sizeBytes,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
