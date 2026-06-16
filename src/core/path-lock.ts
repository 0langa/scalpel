import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pathLocks = new Map<string, Promise<void>>();

type AcquiredLock = {
  key: string;
  tail: Promise<void>;
  release: () => void;
};

type FileLock = {
  path: string;
  release: () => Promise<void>;
};

type LockOwner = {
  pid?: number;
  token?: string;
  key_hash?: string;
  acquired_at?: string;
};

export async function withPathLock<T>(paths: string[], callback: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  const acquired: AcquiredLock[] = [];
  const fileLocks: FileLock[] = [];

  try {
    for (const key of keys) {
      const previous = pathLocks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.catch(() => undefined).then(() => current);
      pathLocks.set(key, tail);
      await previous.catch(() => undefined);
      acquired.push({ key, tail, release });
    }

    for (const key of keys) {
      fileLocks.push(await acquireFileLock(key));
    }

    return await callback();
  } finally {
    await Promise.allSettled(fileLocks.reverse().map((lock) => lock.release()));

    for (const lock of acquired.reverse()) {
      lock.release();
      if (pathLocks.get(lock.key) === lock.tail) {
        pathLocks.delete(lock.key);
      }
    }
  }
}

async function acquireFileLock(key: string): Promise<FileLock> {
  const root = lockRoot();
  await mkdir(root, { recursive: true });
  const lockPath = join(root, `${hashKey(key)}.lock`);
  const timeoutMs = lockTimeoutMs();
  const started = Date.now();

  for (;;) {
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({
          pid: process.pid,
          token: randomUUID(),
          key_hash: hashKey(key),
          acquired_at: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      return {
        path: lockPath,
        release: async () => {
          await rm(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!isNodeErrorWithCode(error, "EEXIST")) {
        throw error;
      }

      if (await recoverStaleFileLock(lockPath)) {
        continue;
      }

      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for Scalpel path lock: ${lockPath}`, {
          cause: error,
        });
      }

      await delay(10);
    }
  }
}

async function recoverStaleFileLock(lockPath: string): Promise<boolean> {
  const staleMs = lockStaleMs();
  if (staleMs <= 0) {
    return false;
  }

  const owner = await readLockOwner(lockPath);
  const ageMs = Date.now() - owner.acquiredAtMs;
  if (ageMs < staleMs) {
    return false;
  }

  if (owner.pid !== undefined && isProcessAlive(owner.pid)) {
    return false;
  }

  await rm(lockPath, { recursive: true, force: true });
  return true;
}

async function readLockOwner(lockPath: string): Promise<{ pid?: number; acquiredAtMs: number }> {
  const fallback = await stat(lockPath);
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as LockOwner;
    const acquiredAtMs =
      typeof parsed.acquired_at === "string" ? Date.parse(parsed.acquired_at) : Number.NaN;
    return {
      ...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
      acquiredAtMs: Number.isFinite(acquiredAtMs) ? acquiredAtMs : fallback.mtimeMs,
    };
  } catch {
    return { acquiredAtMs: fallback.mtimeMs };
  }
}

function lockRoot(): string {
  return process.env.SCALPEL_LOCK_DIR ?? join(tmpdir(), "scalpel-locks");
}

function lockTimeoutMs(): number {
  const raw = process.env.SCALPEL_LOCK_TIMEOUT_MS;
  if (raw === undefined) {
    return 30_000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function lockStaleMs(): number {
  const raw = process.env.SCALPEL_LOCK_STALE_MS;
  if (raw === undefined) {
    return 300_000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300_000;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
