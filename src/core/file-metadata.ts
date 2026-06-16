import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";

import { countLines, detectLineEnding, type LineEnding } from "./line-endings.js";
import { failure, success, type DomainResult } from "./errors.js";

export type TextKind = "utf8" | "binary" | "non_utf8" | "unknown";

type ReadOptions = {
  maxBytes?: number | undefined;
  suggestedTool?: string | undefined;
};

export type FileSnapshot = {
  absolutePath: string;
  content: string;
  encoding: "utf8";
  eol: LineEnding;
  sizeBytes: number;
  lineCount: number;
  sha256: string;
  mtimeMs: number;
  textKind: TextKind;
};

export type FileStat = {
  absolutePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  lineCount: number;
  sha256?: string;
  mtimeMs: number;
  textKind: TextKind;
};

export type LineRangeSnapshot = FileSnapshot & {
  range: {
    startLine: number;
    endLine: number;
  };
};

export async function readFileSnapshot(
  path: string,
  options: ReadOptions = {}
): Promise<DomainResult<FileSnapshot>> {
  try {
    const stats = await stat(path);
    if (stats.size > (options.maxBytes ?? Number.POSITIVE_INFINITY)) {
      return fileTooLarge(path, stats.size, options.maxBytes ?? 0, options.suggestedTool);
    }

    const buffer = await readFile(path);
    const classified = decodeUtf8Text(buffer, path);
    if (!classified.ok) {
      return classified;
    }

    const content = classified.data;
    const sha256 = createHash("sha256").update(content).digest("hex");

    return success({
      absolutePath: path,
      content,
      encoding: "utf8",
      eol: detectLineEnding(content),
      sizeBytes: stats.size,
      lineCount: countLines(content),
      sha256,
      mtimeMs: stats.mtimeMs,
      textKind: "utf8"
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to read ${path}`,
      path
    );
  }
}

export async function readLineRangeSnapshot(
  path: string,
  startLine: number,
  endLine: number
): Promise<DomainResult<LineRangeSnapshot>> {
  try {
    const stats = await stat(path);
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    let content = "";
    let lineCount = 0;
    let eol: LineEnding = "none";

    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        return failure("BINARY_FILE_NOT_SUPPORTED", "Binary files are not supported by text tools", path);
      }

      hash.update(buffer);

      let decoded: string;
      try {
        decoded = decoder.decode(buffer, { stream: true });
      } catch {
        return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
      }

      pending += decoded;
      const completeLines = pending.match(/[^\n]*\n/g) ?? [];
      pending = pending.slice(completeLines.join("").length);

      for (const line of completeLines) {
        lineCount += 1;
        eol = mergeLineEnding(eol, line.endsWith("\r\n") ? "\r\n" : "\n");
        if (lineCount >= startLine && lineCount <= endLine) {
          content += line;
        }
      }
    }

    try {
      const tail = decoder.decode();
      pending += tail;
    } catch {
      return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
    }

    if (pending.length > 0) {
      lineCount += 1;
      if (lineCount >= startLine && lineCount <= endLine) {
        content += pending;
      }
    }

    return success({
      absolutePath: path,
      content,
      encoding: "utf8",
      eol,
      sizeBytes: stats.size,
      lineCount,
      sha256: hash.digest("hex"),
      mtimeMs: stats.mtimeMs,
      textKind: "utf8",
      range: {
        startLine,
        endLine
      }
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to read ${path}`,
      path
    );
  }
}

export async function readPathStat(
  path: string,
  options: ReadOptions = {}
): Promise<DomainResult<FileStat>> {
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      return success({
        absolutePath: path,
        isDirectory: true,
        sizeBytes: stats.size,
        lineCount: 0,
        mtimeMs: stats.mtimeMs,
        textKind: "unknown"
      });
    }

    if (stats.size > (options.maxBytes ?? Number.POSITIVE_INFINITY)) {
      const textKind = await classifyFile(path);
      if (!textKind.ok) {
        return textKind;
      }

      return success({
        absolutePath: path,
        isDirectory: false,
        sizeBytes: stats.size,
        lineCount: 0,
        mtimeMs: stats.mtimeMs,
        textKind: textKind.data
      });
    }

    const snapshot = await readFileSnapshot(path, options);
    if (!snapshot.ok) {
      return snapshot;
    }

    return success({
      absolutePath: path,
      isDirectory: false,
      sizeBytes: snapshot.data.sizeBytes,
      lineCount: snapshot.data.lineCount,
      sha256: snapshot.data.sha256,
      mtimeMs: snapshot.data.mtimeMs,
      textKind: snapshot.data.textKind
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to stat ${path}`,
      path
    );
  }
}

export async function classifyFile(path: string, sampleBytes = 8192): Promise<DomainResult<TextKind>> {
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      return success("unknown");
    }
    if (stats.size === 0) {
      return success("utf8");
    }

    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, sampleBytes));
      const read = await handle.read(buffer, 0, buffer.length, 0);
      return success(classifyBuffer(buffer.subarray(0, read.bytesRead)));
    } finally {
      await handle.close();
    }
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to classify ${path}`,
      path
    );
  }
}

export function fileTooLarge(
  path: string,
  sizeBytes: number,
  maxBytes: number,
  suggestedTool = "read_chunk"
): DomainResult<never> {
  return failure("FILE_TOO_LARGE", "File exceeds configured text read limit", path, {
    size_bytes: sizeBytes,
    max_bytes: maxBytes,
    suggested_tool: suggestedTool
  });
}

function decodeUtf8Text(buffer: Buffer, path: string): DomainResult<string> {
  const textKind = classifyBuffer(buffer);
  if (textKind === "binary") {
    return failure("BINARY_FILE_NOT_SUPPORTED", "Binary files are not supported by text tools", path);
  }
  if (textKind === "non_utf8") {
    return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
  }

  return success(buffer.toString("utf8"));
}

function classifyBuffer(buffer: Buffer): TextKind {
  if (buffer.includes(0)) {
    return "binary";
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return "utf8";
  } catch {
    return "non_utf8";
  }
}

function mergeLineEnding(current: LineEnding, next: "\n" | "\r\n"): LineEnding {
  if (current === "none") {
    return next;
  }
  return current === next ? current : "mixed";
}
