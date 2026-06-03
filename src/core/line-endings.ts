export type LineEnding = "\n" | "\r\n" | "mixed" | "none";

export function detectLineEnding(content: string): LineEnding {
  const hasLf = content.includes("\n");
  const hasCrLf = content.includes("\r\n");

  if (!hasLf) {
    return "none";
  }

  if (hasCrLf) {
    return content.replace(/\r\n/g, "").includes("\n") ? "mixed" : "\r\n";
  }

  return "\n";
}

export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const parts = content.split(/\r\n|\n/);
  return parts.at(-1) === "" ? parts.length - 1 : parts.length;
}
