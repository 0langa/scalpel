import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { withPathLock } from "../../../src/core/path-lock.js";

describe("withPathLock", () => {
  test("serializes overlapping path work", async () => {
    const events: string[] = [];
    let leftStarted!: () => void;
    const leftStartedPromise = new Promise<void>((resolve) => {
      leftStarted = resolve;
    });

    const left = withPathLock(["same.txt"], async () => {
      events.push("left:start");
      leftStarted();
      await delay(20);
      events.push("left:end");
    });
    await leftStartedPromise;

    const right = withPathLock(["same.txt"], async () => {
      events.push("right:start");
      await delay(1);
      events.push("right:end");
    });

    await Promise.all([left, right]);

    expect(events).toEqual(["left:start", "left:end", "right:start", "right:end"]);
  });

  test("does not block unrelated paths", async () => {
    const events: string[] = [];

    await Promise.all([
      withPathLock(["left.txt"], async () => {
        events.push("left:start");
        await delay(20);
        events.push("left:end");
      }),
      withPathLock(["same.txt"], async () => {
        events.push("right:start");
        await delay(1);
        events.push("right:end");
      }),
    ]);

    expect(events.indexOf("right:start")).toBeGreaterThan(-1);
    expect(events.indexOf("right:start")).toBeLessThan(events.indexOf("left:end"));
  });

  test("releases locks after a failed callback", async () => {
    await expect(
      withPathLock(["same.txt"], () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    await expect(withPathLock(["same.txt"], () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  test("recovers stale locks whose owner process is gone", async () => {
    const lockDir = await mkdtemp(join(tmpdir(), "scalpel-lock-test-"));
    const previousLockDir = process.env.SCALPEL_LOCK_DIR;
    const previousStaleMs = process.env.SCALPEL_LOCK_STALE_MS;

    process.env.SCALPEL_LOCK_DIR = lockDir;
    process.env.SCALPEL_LOCK_STALE_MS = "1";

    try {
      const lockPath = join(lockDir, `${hashKey("stale.txt")}.lock`);
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({
          pid: 999_999_999,
          acquired_at: "2000-01-01T00:00:00.000Z",
        })}\n`,
        "utf8",
      );

      await expect(withPathLock(["stale.txt"], () => Promise.resolve("ok"))).resolves.toBe("ok");
      await expect(readdir(lockDir)).resolves.toEqual([]);
    } finally {
      restoreEnv("SCALPEL_LOCK_DIR", previousLockDir);
      restoreEnv("SCALPEL_LOCK_STALE_MS", previousStaleMs);
      await rm(lockDir, { recursive: true, force: true });
    }
  });

  test("times out instead of stealing a live owner lock", async () => {
    const lockDir = await mkdtemp(join(tmpdir(), "scalpel-lock-test-"));
    const previousLockDir = process.env.SCALPEL_LOCK_DIR;
    const previousStaleMs = process.env.SCALPEL_LOCK_STALE_MS;
    const previousTimeoutMs = process.env.SCALPEL_LOCK_TIMEOUT_MS;

    process.env.SCALPEL_LOCK_DIR = lockDir;
    process.env.SCALPEL_LOCK_STALE_MS = "1";
    process.env.SCALPEL_LOCK_TIMEOUT_MS = "20";

    try {
      const lockPath = join(lockDir, `${hashKey("live.txt")}.lock`);
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({
          pid: process.pid,
          acquired_at: "2000-01-01T00:00:00.000Z",
        })}\n`,
        "utf8",
      );

      await expect(withPathLock(["live.txt"], () => Promise.resolve("ok"))).rejects.toThrow(
        "Timed out waiting for Scalpel path lock",
      );
    } finally {
      restoreEnv("SCALPEL_LOCK_DIR", previousLockDir);
      restoreEnv("SCALPEL_LOCK_STALE_MS", previousStaleMs);
      restoreEnv("SCALPEL_LOCK_TIMEOUT_MS", previousTimeoutMs);
      await rm(lockDir, { recursive: true, force: true });
    }
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function restoreEnv(
  name: "SCALPEL_LOCK_DIR" | "SCALPEL_LOCK_STALE_MS" | "SCALPEL_LOCK_TIMEOUT_MS",
  value: string | undefined,
): void {
  if (name === "SCALPEL_LOCK_DIR") {
    if (value === undefined) {
      delete process.env.SCALPEL_LOCK_DIR;
    } else {
      process.env.SCALPEL_LOCK_DIR = value;
    }
  } else if (name === "SCALPEL_LOCK_STALE_MS") {
    if (value === undefined) {
      delete process.env.SCALPEL_LOCK_STALE_MS;
    } else {
      process.env.SCALPEL_LOCK_STALE_MS = value;
    }
  } else if (value === undefined) {
    delete process.env.SCALPEL_LOCK_TIMEOUT_MS;
  } else {
    process.env.SCALPEL_LOCK_TIMEOUT_MS = value;
  }
}
