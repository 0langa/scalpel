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

// Text written into an existing file takes that file's line-ending style, so an
// edit never leaves stray LF lines in a CRLF file (or CRLF lines in an LF file).
// Files that are already mixed, or have no line break yet, get the text as given.
// `afterCr` means the text lands right after a CR of the file: a leading LF then
// completes that CRLF pair and stays a bare LF.
export function matchLineEndings(text: string, style: LineEnding, afterCr = false): string {
  if (style === "\r\n") {
    return text.replace(/\r?\n/g, (lineBreak, offset: number) =>
      lineBreak === "\n" && offset === 0 && afterCr ? lineBreak : "\r\n",
    );
  }

  if (style === "\n") {
    return text.replace(/\r\n/g, "\n");
  }

  return text;
}

export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const parts = content.split(/\r\n|\n/);
  return parts.at(-1) === "" ? parts.length - 1 : parts.length;
}
