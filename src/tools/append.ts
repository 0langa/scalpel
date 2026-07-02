import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { createUnifiedDiff } from "../core/diff.js";
import { combineWarnings, recordJournal, snapshotState, textState } from "../core/journal.js";
import {
  readOptionalSnapshotForMutation,
  readPathStatForMutation,
  readSnapshotForMutation,
  writeTextFileStreamForMutation,
  writeTextFileForMutation,
} from "../core/mutation.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { withPathLock } from "../core/path-lock.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { countLines } from "../core/line-endings.js";
import { countInsertedLines } from "../core/text.js";

type AppendInput = {
  path: string;
  content: string;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type AppendResult = {
  absolutePath: string;
  lines_added: number;
  new_total_lines: number;
  diff?: string;
  applied?: boolean;
  warnings?: string[];
};

export async function appendTool(
  input: AppendInput,
  config: ScalpelConfig,
): Promise<DomainResult<AppendResult>> {
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
    const before = await readOptionalSnapshotForMutation({
      path: resolved.data,
      expected_sha256: input.expected_sha256,
      expected_mtime_ms: input.expected_mtime_ms,
      maxReadBytes: config.maxReadBytes,
    });
    if (!before.ok) {
      if (before.error.code === "FILE_TOO_LARGE" && input.dry_run !== true) {
        return appendLargeExistingFile(input, config, resolved.data);
      }
      return before;
    }

    const beforeContent = before.data?.content ?? "";
    const afterContent = `${beforeContent}${input.content}`;
    const diff = createUnifiedDiff(resolved.data, beforeContent, afterContent);
    const result = {
      absolutePath: resolved.data,
      lines_added: countInsertedLines(input.content),
      new_total_lines: countLines(afterContent),
      diff,
      applied: input.dry_run !== true,
    };

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "append",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(before.data),
        after: textState(afterContent),
      });
      return success({
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    await mkdir(dirname(resolved.data), { recursive: true });
    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: afterContent,
      before: before.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
      transactionDir: config.transactionDir,
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    const snapshot = await readSnapshotForMutation({
      path: resolved.data,
      maxReadBytes: config.maxReadBytes,
    });
    if (!snapshot.ok) {
      return snapshot;
    }

    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "append",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(before.data),
        after: snapshotState(snapshot.data),
      }),
    );

    return success({
      ...result,
      new_total_lines: snapshot.data.lineCount,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

async function appendLargeExistingFile(
  input: AppendInput,
  config: ScalpelConfig,
  path: string,
): Promise<DomainResult<AppendResult>> {
  const before = await readPathStatForMutation({
    path,
    expected_sha256: input.expected_sha256,
    expected_mtime_ms: input.expected_mtime_ms,
    maxReadBytes: config.maxReadBytes,
  });
  if (!before.ok) {
    return before;
  }
  if (before.data.isDirectory) {
    return failure("INVALID_INPUT", "Cannot append text content to a directory", path);
  }
  if (before.data.textKind === "binary") {
    return failure("BINARY_FILE_NOT_SUPPORTED", "Binary files are not supported by text tools", path);
  }
  if (before.data.textKind === "non_utf8") {
    return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
  }
  if (before.data.sha256 === undefined) {
    return failure("UNSUPPORTED_ENCODING", "File text metadata could not be computed", path);
  }

  const afterSizeBytes = before.data.sizeBytes + Buffer.byteLength(input.content, "utf8");
  const afterSha256 = await hashFileThenContent(path, input.content);
  const writeResult = await writeTextFileStreamForMutation({
    path,
    chunks: appendChunks(path, input.content),
    before: before.data,
    afterSha256,
    afterSizeBytes,
    maxReadBytes: config.maxReadBytes,
    durability: config.durability,
    transactionDir: config.transactionDir,
  });
  if (!writeResult.ok) {
    return writeResult;
  }

  const after = await readPathStatForMutation({ path, maxReadBytes: config.maxReadBytes });
  if (!after.ok) {
    return after;
  }

  const warnings = combineWarnings(
    writeResult.data.warnings,
    await recordJournal(config, {
      tool: "append",
      paths: [path],
      dry_run: false,
      applied: true,
      before: snapshotState(before.data),
      after: snapshotState(after.data),
    }),
  );

  return success({
    absolutePath: path,
    lines_added: countInsertedLines(input.content),
    new_total_lines: after.data.lineCount,
    applied: true,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

async function hashFileThenContent(path: string, content: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  hash.update(content);
  return hash.digest("hex");
}

async function* appendChunks(path: string, content: string): AsyncIterable<string | Buffer> {
  for await (const chunk of createReadStream(path)) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
  yield content;
}
