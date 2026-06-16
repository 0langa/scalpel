import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { resolveWorkspacePath, toRelativeDisplayPath } from "../core/path-policy.js";

type GrepInput = {
  path: string;
  pattern: string;
  regex?: boolean | undefined;
  max_results?: number | undefined;
};

type GrepMatch = {
  path: string;
  relativePath: string;
  line: number;
  content: string;
};

type GrepResult = {
  matches: GrepMatch[];
  total_matches: number;
  skipped_files: {
    path: string;
    relativePath: string;
    reason: "too_large" | "binary" | "non_utf8" | "unreadable";
  }[];
};

export async function grepTool(
  input: GrepInput,
  config: ScalpelConfig
): Promise<DomainResult<GrepResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read",
    allowHiddenPaths: config.allowHiddenPaths
  });
  if (!resolved.ok) {
    return resolved;
  }

  const matches: GrepMatch[] = [];
  const skippedFiles: GrepResult["skipped_files"] = [];
  const limit = input.max_results ?? config.maxGrepResults;
  const displayRoot = config.roots[0] ?? resolved.data;
  let matcher: RegExp | null = null;
  if (input.regex === true) {
    try {
      matcher = new RegExp(input.pattern);
    } catch (error) {
      return failure(
        "INVALID_PATTERN",
        error instanceof Error ? error.message : "Invalid regex pattern",
        resolved.data
      );
    }
  }

  await visit(resolved.data, config, async (filePath) => {
    if (matches.length >= limit) {
      return;
    }

    try {
      const info = await stat(filePath);
      if (info.size > config.maxReadBytes) {
        skippedFiles.push({
          path: filePath,
          relativePath: toRelativeDisplayPath(displayRoot, filePath),
          reason: "too_large"
        });
        return;
      }

      const snapshot = await readFileSnapshot(filePath, { maxBytes: config.maxReadBytes });
      if (!snapshot.ok) {
        skippedFiles.push({
          path: filePath,
          relativePath: toRelativeDisplayPath(displayRoot, filePath),
          reason: skipReason(snapshot.error.code)
        });
        return;
      }

      for (const [index, line] of snapshot.data.content.split(/\r\n|\n/).entries()) {
        const matched = matcher === null ? line.includes(input.pattern) : matcher.test(line);
        if (matched) {
          matches.push({
            path: filePath,
            relativePath: toRelativeDisplayPath(displayRoot, filePath),
            line: index + 1,
            content: line
          });
        }

        if (matches.length >= limit) {
          break;
        }
      }
    } catch {
      skippedFiles.push({
        path: filePath,
        relativePath: toRelativeDisplayPath(displayRoot, filePath),
        reason: "unreadable"
      });
    }
  });

  return success({
    matches,
    total_matches: matches.length,
    skipped_files: skippedFiles
  });
}

function skipReason(code: string): GrepResult["skipped_files"][number]["reason"] {
  if (code === "FILE_TOO_LARGE") {
    return "too_large";
  }
  if (code === "BINARY_FILE_NOT_SUPPORTED") {
    return "binary";
  }
  if (code === "UNSUPPORTED_ENCODING") {
    return "non_utf8";
  }
  return "unreadable";
}

async function visit(
  path: string,
  config: ScalpelConfig,
  onFile: (filePath: string) => Promise<void>
): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    const children = await readdir(path);
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      if (!config.allowHiddenPaths && child.startsWith(".")) {
        continue;
      }
      await visit(join(path, child), config, onFile);
    }
    return;
  }

  await onFile(path);
}
