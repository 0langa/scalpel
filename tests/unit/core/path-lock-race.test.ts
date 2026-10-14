import { createHash } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { withPathLock } from "../../../src/core/path-lock.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

describe("withPathLock cross-process races", () => {
  afterEach(() => {
    vi.mocked(fsPromises.stat).mockReset();
    vi.mocked(fsPromises.stat).mockImplementation(actualFs.stat);
  });

  test("retries when the holder releases the lock between mkdir and the stale check", async () => {
    const lockDir = await actualFs.mkdtemp(join(tmpdir(), "scalpel-lock-race-"));
    const previousLockDir = process.env.SCALPEL_LOCK_DIR;
    process.env.SCALPEL_LOCK_DIR = lockDir;

    try {
      // Another live process holds the lock...
      const lockPath = join(lockDir, `${createHash("sha256").update("race.txt").digest("hex")}.lock`);
      await actualFs.mkdir(lockPath);
      await actualFs.writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`,
        "utf8",
      );

      // ...and releases it right after our mkdir() failed with EEXIST.
      vi.mocked(fsPromises.stat).mockImplementationOnce(async (path) => {
        await actualFs.rm(lockPath, { recursive: true, force: true });
        return actualFs.stat(path);
      });

      await expect(withPathLock(["race.txt"], () => Promise.resolve("ok"))).resolves.toBe("ok");
      await expect(actualFs.readdir(lockDir)).resolves.toEqual([]);
    } finally {
      if (previousLockDir === undefined) {
        delete process.env.SCALPEL_LOCK_DIR;
      } else {
        process.env.SCALPEL_LOCK_DIR = previousLockDir;
      }
      await actualFs.rm(lockDir, { recursive: true, force: true });
    }
  });
});
