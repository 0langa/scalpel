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
  include_globs?: string[] | undefined;
  exclude_globs?: string[] | undefined;
  before_context?: number | undefined;
  after_context?: number | undefined;
  max_results?: number | undefined;
};

type GrepContextLine = {
  line: number;
  content: string;
};

type GrepMatch = {
  path: string;
  relativePath: string;
  line: number;
  content: string;
  before_context?: GrepContextLine[] | undefined;
  after_context?: GrepContextLine[] | undefined;
};

type GrepResult = {
  matches: GrepMatch[];
  total_matches: number;
  has_more: boolean;
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
  const includePatterns = compileGlobPatterns(input.include_globs);
  const excludePatterns = compileGlobPatterns(input.exclude_globs);
  const beforeContext = input.before_context ?? 0;
  const afterContext = input.after_context ?? 0;
  let hasMore = false;
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
    if (hasMore) {
      return false;
    }

    const relativePath = toRelativeDisplayPath(displayRoot, filePath);
    if (!includedByGlobs(relativePath, includePatterns, excludePatterns)) {
      return true;
    }

    try {
      const info = await stat(filePath);
      if (info.size > config.maxReadBytes) {
        skippedFiles.push({
          path: filePath,
          relativePath,
          reason: "too_large"
        });
        return true;
      }

      const snapshot = await readFileSnapshot(filePath, { maxBytes: config.maxReadBytes });
      if (!snapshot.ok) {
        skippedFiles.push({
          path: filePath,
          relativePath,
          reason: skipReason(snapshot.error.code)
        });
        return true;
      }

      const lines = snapshot.data.content.split(/\r\n|\n/);
      for (const [index, line] of lines.entries()) {
        const matched = matcher === null ? line.includes(input.pattern) : matcher.test(line);
        if (matched) {
          const match = {
            path: filePath,
            relativePath,
            line: index + 1,
            content: line
          };

          matches.push({
            ...match,
            ...(beforeContext > 0
              ? { before_context: contextBefore(lines, index, beforeContext) }
              : {}),
            ...(afterContext > 0
              ? { after_context: contextAfter(lines, index, afterContext) }
              : {})
          });

          if (matches.length > limit) {
            hasMore = true;
            break;
          }
        }
      }
    } catch {
      skippedFiles.push({
        path: filePath,
        relativePath,
        reason: "unreadable"
      });
    }

    return !hasMore;
  });

  const returnedMatches = matches.slice(0, limit);
  return success({
    matches: returnedMatches,
    total_matches: returnedMatches.length,
    has_more: hasMore,
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
  onFile: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  const info = await stat(path);
  if (info.isDirectory()) {
    const children = await readdir(path);
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      if (!config.allowHiddenPaths && child.startsWith(".")) {
        continue;
      }
      const shouldContinue = await visit(join(path, child), config, onFile);
      if (!shouldContinue) {
        return false;
      }
    }
    return true;
  }

  return onFile(path);
}

function contextBefore(lines: string[], matchIndex: number, count: number): GrepContextLine[] {
  return lines
    .slice(Math.max(0, matchIndex - count), matchIndex)
    .map((line, index, contextLines) => ({
      line: matchIndex - contextLines.length + index + 1,
      content: line
    }));
}

function contextAfter(lines: string[], matchIndex: number, count: number): GrepContextLine[] {
  return lines
    .slice(matchIndex + 1, matchIndex + 1 + count)
    .map((line, index) => ({
      line: matchIndex + index + 2,
      content: line
    }));
}

function compileGlobPatterns(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? []).map((pattern) => globToRegExp(pattern));
}

function includedByGlobs(
  relativePath: string,
  includePatterns: RegExp[],
  excludePatterns: RegExp[]
): boolean {
  if (excludePatterns.some((pattern) => pattern.test(relativePath))) {
    return false;
  }
  return includePatterns.length === 0 || includePatterns.some((pattern) => pattern.test(relativePath));
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
