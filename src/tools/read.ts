import { type ScalpelConfig } from "../core/config.js";
import { readFileSnapshot } from "../core/file-metadata.js";
import { failure, success, type DomainResult } from "../core/errors.js";
import { resolveWorkspacePath } from "../core/path-policy.js";
import { splitLinesWithEndings } from "../core/text.js";

type ReadToolResult = {
  absolutePath: string;
  content: string;
  lines: number;
  size_bytes: number;
  range: {
    start_line: number;
    end_line: number;
  };
  sha256: string;
  eol: "\n" | "\r\n" | "mixed" | "none";
};

export async function readTool(
  input: { path: string; start_line?: number | undefined; end_line?: number | undefined },
  config: ScalpelConfig
): Promise<DomainResult<ReadToolResult>> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read"
  });

  if (!resolved.ok) {
    return resolved;
  }

  const snapshot = await readFileSnapshot(resolved.data);
  if (!snapshot.ok) {
    return snapshot;
  }

  const lines = splitLinesWithEndings(snapshot.data.content);
  const startLine = input.start_line ?? 1;
  const endLine = input.end_line ?? lines.length;

  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    return failure("INVALID_LINE_RANGE", "Requested line range is invalid", resolved.data, {
      start_line: startLine,
      end_line: endLine,
      total_lines: lines.length
    });
  }

  return success({
    absolutePath: snapshot.data.absolutePath,
    content: lines.slice(startLine - 1, endLine).join(""),
    lines: snapshot.data.lineCount,
    size_bytes: snapshot.data.sizeBytes,
    range: {
      start_line: startLine,
      end_line: endLine
    },
    sha256: snapshot.data.sha256,
    eol: snapshot.data.eol
  });
}
