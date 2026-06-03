import { createTwoFilesPatch } from "diff";

export function createUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  context = 3
): string {
  return createTwoFilesPatch(filePath, filePath, before, after, "", "", {
    context
  });
}
