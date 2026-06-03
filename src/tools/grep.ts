import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

type GrepInput = {
  path: string;
  pattern: string;
  regex?: boolean | undefined;
  max_results?: number | undefined;
};

type GrepMatch = {
  path: string;
  line: number;
  content: string;
};

type GrepResult = {
  matches: GrepMatch[];
  total_matches: number;
};

export async function grepTool(
  input: GrepInput,
  config: ScalpelConfig
): Promise<DomainResult<GrepResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read"
  });
  if (!resolved.ok) {
    return resolved;
  }

  const matches: GrepMatch[] = [];
  const limit = input.max_results ?? config.maxGrepResults;
  const matcher = input.regex === true ? new RegExp(input.pattern) : null;

  await visit(resolved.data, async (filePath) => {
    if (matches.length >= limit) {
      return;
    }

    const content = await readFile(filePath, "utf8");
    for (const [index, line] of content.split(/\r\n|\n/).entries()) {
      const matched = matcher === null ? line.includes(input.pattern) : matcher.test(line);
      if (matched) {
        matches.push({ path: filePath, line: index + 1, content: line });
      }

      if (matches.length >= limit) {
        break;
      }
    }
  });

  return success({
    matches,
    total_matches: matches.length
  });
}

async function visit(path: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    const children = await readdir(path);
    for (const child of children.sort((left, right) => left.localeCompare(right))) {
      await visit(join(path, child), onFile);
    }
    return;
  }

  await onFile(path);
}
