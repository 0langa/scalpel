import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Windows only lets elevated shells or Developer Mode create file symlinks.
// CI runners can, so the tests still run there (CI is set); a plain local
// Windows shell skips them instead of failing with EPERM.
export const skipWithoutFileSymlinks = !(await canCreateFileSymlinks()) && process.env.CI === undefined;

async function canCreateFileSymlinks(): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "scalpel-symlink-probe-"));
  try {
    await writeFile(join(directory, "target.txt"), "", "utf8");
    await symlink(join(directory, "target.txt"), join(directory, "link.txt"), "file");
    return true;
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
