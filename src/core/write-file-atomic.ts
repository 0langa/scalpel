import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

type WriteFileAtomicOptions = {
  durability?: "default" | "strict";
};

export async function writeFileAtomic(
  path: string,
  content: string,
  options: WriteFileAtomicOptions = {}
): Promise<string[]> {
  const tempPath = join(dirname(path), `.scalpel-${randomUUID()}.tmp`);
  const warnings: string[] = [];

  try {
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      if (options.durability === "strict") {
        await handle.sync();
      }
    } finally {
      await handle.close();
    }

    await rename(tempPath, path);

    if (options.durability === "strict") {
      warnings.push(...await flushParentDirectory(dirname(path)));
    }
  } catch (error) {
    await Promise.allSettled([unlink(tempPath)]);
    throw error;
  }

  return warnings;
}

async function flushParentDirectory(path: string): Promise<string[]> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
      return [];
    } finally {
      await handle.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "parent directory flush failed";
    return [`DURABILITY_PARENT_FLUSH_UNAVAILABLE: ${message}`];
  }
}
