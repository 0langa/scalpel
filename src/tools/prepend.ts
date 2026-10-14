import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
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
import { readLineEndingStyleIfNeeded } from "../core/file-metadata.js";
import { countLines, matchLineEndings } from "../core/line-endings.js";
import { countInsertedLines, splitBom, UTF8_BOM } from "../core/text.js";

const UTF8_BOM_BYTES = Buffer.from(UTF8_BOM, "utf8");

type PrependInput = {
  path: string;
  content: string;
  dry_run?: boolean | undefined;
  expected_sha256?: string | undefined;
  expected_mtime_ms?: number | undefined;
};

type PrependResult = {
  absolutePath: string;
  lines_added: number;
  new_total_lines: number;
  diff?: string;
  applied?: boolean;
  warnings?: string[];
};

export async function prependTool(
  input: PrependInput,
  config: ScalpelConfig,
): Promise<DomainResult<PrependResult>> {
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
        return prependLargeExistingFile(input, config, resolved.data);
      }
      return before;
    }

    const existing = before.data?.content ?? "";
    const { bom, body } = splitBom(existing);
    const content = matchLineEndings(input.content, before.data?.eol ?? "none");
    const nextContent = `${bom}${bom === "" ? content : splitBom(content).body}${body}`;
    const diff = createUnifiedDiff(resolved.data, existing, nextContent);
    const result = {
      absolutePath: resolved.data,
      lines_added: countInsertedLines(input.content),
      new_total_lines: countLines(nextContent),
      diff,
      applied: input.dry_run !== true,
    };

    if (input.dry_run === true) {
      const warnings = await recordJournal(config, {
        tool: "prepend",
        paths: [resolved.data],
        dry_run: true,
        applied: false,
        before: snapshotState(before.data),
        after: textState(nextContent),
      });
      return success({
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    await mkdir(dirname(resolved.data), { recursive: true });
    const writeResult = await writeTextFileForMutation({
      path: resolved.data,
      content: nextContent,
      before: before.data,
      maxReadBytes: config.maxReadBytes,
      durability: config.durability,
      transactionDir: config.transactionDir,
      roots: config.roots,
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    const after = await readSnapshotForMutation({
      path: resolved.data,
      maxReadBytes: config.maxReadBytes,
    });
    if (!after.ok) {
      return after;
    }

    const warnings = combineWarnings(
      writeResult.data.warnings,
      await recordJournal(config, {
        tool: "prepend",
        paths: [resolved.data],
        dry_run: false,
        applied: true,
        before: snapshotState(before.data),
        after: snapshotState(after.data),
      }),
    );

    return success({
      ...result,
      new_total_lines: after.data.lineCount,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

async function prependLargeExistingFile(
  input: PrependInput,
  config: ScalpelConfig,
  path: string,
): Promise<DomainResult<PrependResult>> {
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
    return failure("INVALID_INPUT", "Cannot prepend text content to a directory", path);
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

  const style = await readLineEndingStyleIfNeeded(path, input.content);
  if (!style.ok) {
    return style;
  }
  const content = matchLineEndings(input.content, style.data.eol);

  // Keep an existing BOM at offset 0: emit it, then the new content, then the
  // rest of the file after the BOM bytes.
  const skipBytes = (await startsWithUtf8Bom(path)) ? UTF8_BOM_BYTES.length : 0;
  const prefix = skipBytes === 0 ? content : `${UTF8_BOM}${splitBom(content).body}`;
  const afterSizeBytes = Buffer.byteLength(prefix, "utf8") + before.data.sizeBytes - skipBytes;
  const afterSha256 = await hashChunks(prependChunks(prefix, path, skipBytes));
  const writeResult = await writeTextFileStreamForMutation({
    path,
    chunks: prependChunks(prefix, path, skipBytes),
    before: before.data,
    afterSha256,
    afterSizeBytes,
    maxReadBytes: config.maxReadBytes,
    durability: config.durability,
    transactionDir: config.transactionDir,
    roots: config.roots,
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
      tool: "prepend",
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

async function hashChunks(chunks: AsyncIterable<string | Buffer>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function* prependChunks(
  content: string,
  path: string,
  skipBytes: number,
): AsyncIterable<string | Buffer> {
  yield content;
  for await (const chunk of createReadStream(path, { start: skipBytes })) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

async function startsWithUtf8Bom(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(UTF8_BOM_BYTES.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.equals(UTF8_BOM_BYTES);
  } finally {
    await handle.close();
  }
}
