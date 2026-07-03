import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { TextDecoder } from "node:util";

import { failure, success, type DomainResult } from "./errors.js";
import type { PatchOccurrence } from "./text.js";

type StreamingReplacePlan = {
  replacements: number;
  afterSha256: string;
  afterSizeBytes: number;
};

export type ReplacementMode =
  | { kind: "all" }
  | { kind: "indexes"; indexes: Set<number> };

export async function planStreamingExactReplace(input: {
  path: string;
  oldString: string;
  newString: string;
  occurrence: PatchOccurrence;
}): Promise<DomainResult<StreamingReplacePlan>> {
  if (input.oldString.length === 0) {
    return failure("STRING_NOT_FOUND", "old_string was not found", input.path);
  }

  const count = await countStreamingMatches(input.path, input.oldString);
  if (!count.ok) {
    return count;
  }

  const mode = createStreamingReplacementMode(input.occurrence, count.data, input.path);
  if (!mode.ok) {
    return mode;
  }

  const hash = createHash("sha256");
  let afterSizeBytes = 0;
  for await (const chunk of streamExactReplaceChunks({
    path: input.path,
    oldString: input.oldString,
    newString: input.newString,
    mode: mode.data,
  })) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    hash.update(buffer);
    afterSizeBytes += buffer.byteLength;
  }

  return success({
    replacements: countReplacements(mode.data, count.data),
    afterSha256: hash.digest("hex"),
    afterSizeBytes,
  });
}

export async function* streamExactReplaceChunks(input: {
  path: string;
  oldString: string;
  newString: string;
  mode: ReplacementMode;
}): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const carryLength = Math.max(0, input.oldString.length - 1);
  let pending = "";
  let seen = 0;

  for await (const rawChunk of createReadStream(input.path)) {
    const buffer = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    if (buffer.includes(0)) {
      throw new Error("BINARY_FILE_NOT_SUPPORTED");
    }

    let decoded: string;
    try {
      decoded = decoder.decode(buffer, { stream: true });
    } catch {
      throw new Error("UNSUPPORTED_ENCODING");
    }

    const processed = replaceStablePrefix(
      pending + decoded,
      carryLength,
      input.oldString,
      input.newString,
      input.mode,
      seen,
    );
    pending = processed.pending;
    seen = processed.replaced.seen;
    if (processed.replaced.content.length > 0) {
      yield processed.replaced.content;
    }
  }

  try {
    pending += decoder.decode();
  } catch {
    throw new Error("UNSUPPORTED_ENCODING");
  }

  const replaced = replaceWhole(pending, input.oldString, input.newString, input.mode, seen);
  if (replaced.content.length > 0) {
    yield replaced.content;
  }
}

async function countStreamingMatches(
  path: string,
  oldString: string,
): Promise<DomainResult<number>> {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const carryLength = Math.max(0, oldString.length - 1);
    let pending = "";
    let matches = 0;

    for await (const rawChunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      if (buffer.includes(0)) {
        return failure("BINARY_FILE_NOT_SUPPORTED", "Binary files are not supported by text tools", path);
      }

      let decoded: string;
      try {
        decoded = decoder.decode(buffer, { stream: true });
      } catch {
        return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
      }

      const counted = countStablePrefix(pending + decoded, carryLength, oldString);
      pending = counted.pending;
      matches += counted.matches;
    }

    try {
      pending += decoder.decode();
    } catch {
      return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
    }

    matches += countMatches(pending, oldString);
    return success(matches);
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to read ${path}`,
      path,
    );
  }
}

export function createStreamingReplacementMode(
  occurrence: PatchOccurrence,
  matches: number,
  path: string,
): DomainResult<ReplacementMode> {
  if (matches === 0) {
    return failure("STRING_NOT_FOUND", "old_string was not found", path);
  }
  if (occurrence === "unique") {
    if (matches > 1) {
      return failure("STRING_NOT_UNIQUE", "old_string matched more than once", path);
    }
    return success({ kind: "indexes", indexes: new Set([1]) });
  }
  if (occurrence === "first") {
    return success({ kind: "indexes", indexes: new Set([1]) });
  }
  if (occurrence === "all") {
    return success({ kind: "all" });
  }
  if (matches < occurrence) {
    return failure("STRING_NOT_FOUND", `old_string occurrence ${String(occurrence)} was not found`, path);
  }
  return success({ kind: "indexes", indexes: new Set([occurrence]) });
}

function replaceStablePrefix(
  content: string,
  carryLength: number,
  oldString: string,
  newString: string,
  mode: ReplacementMode,
  seenBefore: number,
): { replaced: { content: string; seen: number }; pending: string } {
  const scanLimit = Math.max(0, content.length - carryLength);
  let output = "";
  let cursor = 0;
  let seen = seenBefore;

  while (cursor <= content.length - oldString.length) {
    const index = content.indexOf(oldString, cursor);
    if (index === -1 || index >= scanLimit) {
      break;
    }

    seen += 1;
    output += content.slice(cursor, index);
    output += shouldReplace(mode, seen) ? newString : oldString;
    cursor = index + oldString.length;
  }

  const safeDiscard = Math.max(cursor, scanLimit);
  output += content.slice(cursor, safeDiscard);
  return {
    replaced: { content: output, seen },
    pending: content.slice(safeDiscard),
  };
}

function replaceWhole(
  content: string,
  oldString: string,
  newString: string,
  mode: ReplacementMode,
  seenBefore: number,
): { content: string; seen: number } {
  let output = "";
  let offset = 0;
  let seen = seenBefore;

  while (offset <= content.length - oldString.length) {
    const index = content.indexOf(oldString, offset);
    if (index === -1) {
      break;
    }

    seen += 1;
    output += content.slice(offset, index);
    output += shouldReplace(mode, seen) ? newString : oldString;
    offset = index + oldString.length;
  }

  output += content.slice(offset);
  return { content: output, seen };
}

function countStablePrefix(
  content: string,
  carryLength: number,
  oldString: string,
): { matches: number; pending: string } {
  const scanLimit = Math.max(0, content.length - carryLength);
  let matches = 0;
  let cursor = 0;

  while (cursor <= content.length - oldString.length) {
    const index = content.indexOf(oldString, cursor);
    if (index === -1 || index >= scanLimit) {
      break;
    }
    matches += 1;
    cursor = index + oldString.length;
  }

  const safeDiscard = Math.max(cursor, scanLimit);
  return {
    matches,
    pending: content.slice(safeDiscard),
  };
}

function countMatches(content: string, oldString: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - oldString.length) {
    const index = content.indexOf(oldString, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + oldString.length;
  }
  return count;
}

function shouldReplace(mode: ReplacementMode, matchIndex: number): boolean {
  return mode.kind === "all" || mode.indexes.has(matchIndex);
}

function countReplacements(mode: ReplacementMode, matches: number): number {
  return mode.kind === "all" ? matches : mode.indexes.size;
}
