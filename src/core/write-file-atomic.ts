import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tempPath = join(dirname(path), `.scalpel-${randomUUID()}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}
