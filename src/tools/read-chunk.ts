import { open, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type ReadChunkInput = {
  path: string;
  offset_bytes?: number | undefined;
  max_bytes?: number | undefined;
};

type ReadChunkResult = {
  absolutePath: string;
  content: string;
  offset_bytes: number;
  start_offset_bytes: number;
  next_offset_bytes: number;
  max_bytes: number;
  size_bytes: number;
  truncated: boolean;
  sha256?: string;
};

export async function readChunkTool(
  input: ReadChunkInput,
  config: ScalpelConfig
): Promise<DomainResult<ReadChunkResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!resolved.ok) {
    return resolved;
  }

  const offset = input.offset_bytes ?? 0;
  const maxBytes = Math.min(input.max_bytes ?? config.maxReadBytes, config.maxReadBytes);
  if (offset < 0 || maxBytes < 1) {
    return failure("INVALID_INPUT", "offset_bytes must be >= 0 and max_bytes must be positive", resolved.data);
  }

  const stats = await stat(resolved.data);
  if (offset > stats.size) {
    return failure("INVALID_INPUT", "offset_bytes is beyond end of file", resolved.data, {
      offset_bytes: offset,
      size_bytes: stats.size
    });
  }

  const handle = await open(resolved.data, "r");
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes + 4, Math.max(0, stats.size - offset)));
    const read = await handle.read(buffer, 0, buffer.length, offset);
    let chunk = buffer.subarray(0, read.bytesRead);

    if (chunk.includes(0)) {
      return failure("BINARY_FILE_NOT_SUPPORTED", "Binary files are not supported by text tools", resolved.data);
    }

    const leadingSkip = countLeadingUtf8ContinuationBytes(chunk);
    chunk = chunk.subarray(leadingSkip);
    const decoded = decodeLargestUtf8Prefix(chunk, maxBytes, resolved.data);
    if (!decoded.ok) {
      return decoded;
    }

    const startOffset = offset + leadingSkip;
    const nextOffset = startOffset + decoded.data.bytesUsed;
    const result: ReadChunkResult = {
      absolutePath: resolved.data,
      content: decoded.data.content,
      offset_bytes: offset,
      start_offset_bytes: startOffset,
      next_offset_bytes: nextOffset,
      max_bytes: maxBytes,
      size_bytes: stats.size,
      truncated: nextOffset < stats.size
    };

    if (stats.size <= config.maxReadBytes) {
      const wholeFile = await readFile(resolved.data);
      result.sha256 = createHash("sha256").update(wholeFile.toString("utf8")).digest("hex");
    }

    return success(result);
  } finally {
    await handle.close();
  }
}

function countLeadingUtf8ContinuationBytes(buffer: Buffer): number {
  let count = 0;
  while (count < buffer.length) {
    const byte = buffer[count];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    count += 1;
  }
  return count;
}

function decodeLargestUtf8Prefix(
  buffer: Buffer,
  maxBytes: number,
  path: string
): DomainResult<{ content: string; bytesUsed: number }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const capped = buffer.subarray(0, Math.min(buffer.length, maxBytes));

  for (let length = capped.length; length >= Math.max(0, capped.length - 4); length -= 1) {
    try {
      return success({
        content: decoder.decode(capped.subarray(0, length)),
        bytesUsed: length
      });
    } catch {
      // Try shorter prefix. A UTF-8 character may straddle the chunk boundary.
    }
  }

  return failure("UNSUPPORTED_ENCODING", "Chunk is not valid UTF-8", path);
}
