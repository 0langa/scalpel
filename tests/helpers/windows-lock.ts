import { open } from "node:fs/promises";

// On Windows any open handle on a file (an antivirus scan, the indexer, an
// editor; here: this process) makes renaming over that file fail with EPERM
// until the handle is closed. Holds `path` open for `holdMs`. With
// `rewriteTo`, the holder also replaces the file's content halfway through the
// hold, like an editor saving in place while it has the file open.
export async function holdWindowsFileLock(
  path: string,
  holdMs: number,
  rewriteTo?: string,
): Promise<{ released: Promise<void> }> {
  const handle = await open(path, rewriteTo === undefined ? "r" : "r+");
  const released = (async () => {
    try {
      if (rewriteTo !== undefined) {
        await delay(holdMs / 2);
        await handle.truncate(0);
        await handle.write(rewriteTo, 0, "utf8");
        await delay(holdMs / 2);
      } else {
        await delay(holdMs);
      }
    } finally {
      await handle.close();
    }
  })();
  return { released };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
