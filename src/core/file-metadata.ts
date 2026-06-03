import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

import { countLines, detectLineEnding, type LineEnding } from "./line-endings.js";
import { failure, success, type DomainResult } from "./errors.js";

export type FileSnapshot = {
  absolutePath: string;
  content: string;
  encoding: "utf8";
  eol: LineEnding;
  sizeBytes: number;
  lineCount: number;
  sha256: string;
  mtimeMs: number;
};

export type FileStat = {
  absolutePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  lineCount: number;
  sha256?: string;
  mtimeMs: number;
};

export async function readFileSnapshot(path: string): Promise<DomainResult<FileSnapshot>> {
  try {
    const [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const sha256 = createHash("sha256").update(content).digest("hex");

    return success({
      absolutePath: path,
      content,
      encoding: "utf8",
      eol: detectLineEnding(content),
      sizeBytes: stats.size,
      lineCount: countLines(content),
      sha256,
      mtimeMs: stats.mtimeMs
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to read ${path}`,
      path
    );
  }
}

export async function readPathStat(path: string): Promise<DomainResult<FileStat>> {
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      return success({
        absolutePath: path,
        isDirectory: true,
        sizeBytes: stats.size,
        lineCount: 0,
        mtimeMs: stats.mtimeMs
      });
    }

    const snapshot = await readFileSnapshot(path);
    if (!snapshot.ok) {
      return snapshot;
    }

    return success({
      absolutePath: path,
      isDirectory: false,
      sizeBytes: snapshot.data.sizeBytes,
      lineCount: snapshot.data.lineCount,
      sha256: snapshot.data.sha256,
      mtimeMs: snapshot.data.mtimeMs
    });
  } catch (error) {
    return failure(
      "FILE_NOT_FOUND",
      error instanceof Error ? error.message : `Unable to stat ${path}`,
      path
    );
  }
}
