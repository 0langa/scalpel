import { failure, success, type DomainResult } from "./errors.js";

export type PatchOccurrence = "unique" | "first" | "all" | number;

export function splitLinesWithEndings(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const matches = content.match(/[^\n]*\n|[^\n]+$/g);
  return matches ?? [];
}

export function planExactReplace(
  content: string,
  oldString: string,
  newString: string,
  occurrence: PatchOccurrence
): DomainResult<{ content: string; replacements: number }> {
  const matches = findMatches(content, oldString);
  if (matches.length === 0) {
    return failure("STRING_NOT_FOUND", "old_string was not found");
  }

  if (occurrence === "unique") {
    if (matches.length > 1) {
      return failure("STRING_NOT_UNIQUE", "old_string matched more than once");
    }

    const firstMatch = matches[0];
    if (firstMatch === undefined) {
      return failure("STRING_NOT_FOUND", "old_string was not found");
    }

    return success({
      content: replaceAt(content, firstMatch, oldString.length, newString),
      replacements: 1
    });
  }

  if (occurrence === "first") {
    const firstMatch = matches[0];
    if (firstMatch === undefined) {
      return failure("STRING_NOT_FOUND", "old_string was not found");
    }

    return success({
      content: replaceAt(content, firstMatch, oldString.length, newString),
      replacements: 1
    });
  }

  if (occurrence === "all") {
    return success({
      content: content.split(oldString).join(newString),
      replacements: matches.length
    });
  }

  const targetIndex = occurrence - 1;
  const found = matches[targetIndex];

  if (found === undefined) {
    return failure("STRING_NOT_FOUND", `old_string occurrence ${String(occurrence)} was not found`);
  }

  return success({
    content: replaceAt(content, found, oldString.length, newString),
    replacements: 1
  });
}

export function findLineMarkerIndex(lines: string[], marker: string): DomainResult<number> {
  const indexes = lines
    .map((line, index) => (line.includes(marker) ? index : -1))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return failure("MARKER_NOT_FOUND", `Marker not found: ${marker}`);
  }

  if (indexes.length > 1) {
    return failure("STRING_NOT_UNIQUE", `Marker matched more than once: ${marker}`);
  }

  const firstIndex = indexes[0];
  if (firstIndex === undefined) {
    return failure("MARKER_NOT_FOUND", `Marker not found: ${marker}`);
  }

  return success(firstIndex);
}

function findMatches(content: string, needle: string): number[] {
  if (needle.length === 0) {
    return [];
  }

  const matches: number[] = [];
  let offset = 0;

  while (offset <= content.length - needle.length) {
    const index = content.indexOf(needle, offset);
    if (index === -1) {
      break;
    }

    matches.push(index);
    offset = index + needle.length;
  }

  return matches;
}

function replaceAt(content: string, start: number, length: number, next: string): string {
  return `${content.slice(0, start)}${next}${content.slice(start + length)}`;
}
