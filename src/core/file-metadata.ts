import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";

import { countLines, detectLineEnding, type LineEnding } from "./line-endings.js";
import { failure, success, type DomainResult } from "./errors.js";

export type TextKind = "utf8" | "binary" | "non_utf8" | "unknown";

const CR_BYTE = 0x0d;
const LF_BYTE = 0x0a;

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

type TextMetadata = {
  sizeBytes: number;
  lineCount: number;
  sha256: string;
  mtimeMs: number;
  textKind: "utf8";
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
  endLine: number,
  // highWaterMark is the read chunk size; only tests lower it.
  options: { maxContentBytes?: number | undefined; highWaterMark?: number | undefined } = {}
): Promise<DomainResult<LineRangeSnapshot>> {
  try {
    const stats = await stat(path);
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const maxContentBytes = options.maxContentBytes ?? Number.POSITIVE_INFINITY;
    const parts: string[] = [];
    const scan = {
      contentBytes: 0,
      lineCount: 0,
      inUnterminatedLine: false,
      previousEndedWithCr: false,
      eol: "none" as LineEnding,
    };

    // Scans only newly decoded text (no re-scanning of a growing remainder, which
    // was quadratic for long lines) and keeps only the requested lines.
    const consume = (decoded: string): boolean => {
      let cursor = 0;
      while (cursor < decoded.length) {
        const newline = decoded.indexOf("\n", cursor);
        const end = newline === -1 ? decoded.length : newline + 1;
        const currentLine = scan.lineCount + 1;
        if (currentLine >= startLine && currentLine <= endLine) {
          const piece = decoded.slice(cursor, end);
          scan.contentBytes += Buffer.byteLength(piece, "utf8");
          if (scan.contentBytes > maxContentBytes) {
            return false;
          }
          parts.push(piece);
        }

        if (newline === -1) {
          scan.inUnterminatedLine = true;
        } else {
          const crlf = newline > 0 ? decoded[newline - 1] === "\r" : scan.previousEndedWithCr;
          scan.eol = mergeLineEnding(scan.eol, crlf ? "\r\n" : "\n");
          scan.lineCount += 1;
          scan.inUnterminatedLine = false;
        }
        cursor = end;
      }
      if (decoded.length > 0) {
        scan.previousEndedWithCr = decoded.endsWith("\r");
      }
      return true;
    };

    const streamOptions =
      options.highWaterMark === undefined ? {} : { highWaterMark: options.highWaterMark };
    for await (const chunk of createReadStream(path, streamOptions)) {
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

      if (!consume(decoded)) {
        return rangeTooLarge(path, startLine, endLine, maxContentBytes);
      }
    }

    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
    }
    if (!consume(tail)) {
      return rangeTooLarge(path, startLine, endLine, maxContentBytes);
    }

    if (scan.inUnterminatedLine) {
      scan.lineCount += 1;
    }

    return success({
      absolutePath: path,
      content: parts.join(""),
      encoding: "utf8",
      eol: scan.eol,
      sizeBytes: stats.size,
      lineCount: scan.lineCount,
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
      const metadata = await readTextMetadata(path);
      if (metadata.ok) {
        return success({
          absolutePath: path,
          isDirectory: false,
          sizeBytes: metadata.data.sizeBytes,
          lineCount: metadata.data.lineCount,
          sha256: metadata.data.sha256,
          mtimeMs: metadata.data.mtimeMs,
          textKind: metadata.data.textKind
        });
      }

      if (
        metadata.error.code === "BINARY_FILE_NOT_SUPPORTED" ||
        metadata.error.code === "UNSUPPORTED_ENCODING"
      ) {
        return success({
          absolutePath: path,
          isDirectory: false,
          sizeBytes: stats.size,
          lineCount: 0,
          mtimeMs: stats.mtimeMs,
          textKind: metadata.error.code === "BINARY_FILE_NOT_SUPPORTED" ? "binary" : "non_utf8"
        });
      }

      return metadata;
    }

    // Small files are classified rather than rejected: stat and move must work
    // on binary and non-UTF-8 files too, not just on text.
    const buffer = await readFile(path);
    const textKind = classifyBuffer(buffer);

    return success({
      absolutePath: path,
      isDirectory: false,
      sizeBytes: buffer.byteLength,
      lineCount: textKind === "utf8" ? countLines(buffer.toString("utf8")) : 0,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      mtimeMs: stats.mtimeMs,
      textKind
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to stat ${path}`,
      path
    );
  }
}

function countNewlines(content: string): number {
  return content.split("\n").length - 1;
}

export async function readTextMetadata(path: string): Promise<DomainResult<TextMetadata>> {
  try {
    const stats = await stat(path);
    const hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let lineCount = 0;
    let sawContent = false;
    let lastCharacter = "";

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

      if (decoded.length > 0) {
        sawContent = true;
        lastCharacter = decoded.at(-1) ?? lastCharacter;
        lineCount += countNewlines(decoded);
      }
    }

    try {
      const tail = decoder.decode();
      if (tail.length > 0) {
        sawContent = true;
        lastCharacter = tail.at(-1) ?? lastCharacter;
        lineCount += countNewlines(tail);
      }
    } catch {
      return failure("UNSUPPORTED_ENCODING", "File is not valid UTF-8", path);
    }

    if (sawContent && lastCharacter !== "\n") {
      lineCount += 1;
    }

    return success({
      sizeBytes: stats.size,
      lineCount,
      sha256: hash.digest("hex"),
      mtimeMs: stats.mtimeMs,
      textKind: "utf8"
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to stat ${path}`,
      path
    );
  }
}

// Line-ending style of a file too large to load whole. CR and LF are single
// bytes that never occur inside a multi-byte UTF-8 sequence, so the raw bytes
// can be scanned without decoding. `endsWithCr` tells callers that append text
// whether a leading LF would complete a CRLF pair split at the end of the file.
export async function readLineEndingStyle(
  path: string,
  // highWaterMark is the read chunk size; only tests lower it.
  options: { highWaterMark?: number | undefined } = {}
): Promise<DomainResult<{ eol: LineEnding; endsWithCr: boolean }>> {
  try {
    let eol: LineEnding = "none";
    let previousByte = -1;
    const streamOptions =
      options.highWaterMark === undefined ? {} : { highWaterMark: options.highWaterMark };

    for await (const chunk of createReadStream(path, streamOptions)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let newline = eol === "mixed" ? -1 : buffer.indexOf(LF_BYTE);
      while (newline !== -1) {
        const before = newline > 0 ? buffer[newline - 1] : previousByte;
        eol = mergeLineEnding(eol, before === CR_BYTE ? "\r\n" : "\n");
        newline = eol === "mixed" ? -1 : buffer.indexOf(LF_BYTE, newline + 1);
      }
      if (buffer.length > 0) {
        previousByte = buffer[buffer.length - 1] ?? previousByte;
      }
    }

    return success({ eol, endsWithCr: previousByte === CR_BYTE });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to read ${path}`,
      path
    );
  }
}

// matchLineEndings never changes text without a line break, so such text skips the extra pass over a
// large file (and reports "none", which leaves it as it is).
export async function readLineEndingStyleIfNeeded(
  path: string,
  text: string
): Promise<DomainResult<{ eol: LineEnding; endsWithCr: boolean }>> {
  return text.includes("\n")
    ? readLineEndingStyle(path)
    : success({ eol: "none", endsWithCr: false });
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

function rangeTooLarge(
  path: string,
  startLine: number,
  endLine: number,
  maxBytes: number
): DomainResult<never> {
  return failure("FILE_TOO_LARGE", "Requested line range exceeds configured text read limit", path, {
    start_line: startLine,
    end_line: endLine,
    max_bytes: maxBytes,
    suggested_tool: "read_chunk"
  });
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
