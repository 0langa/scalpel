import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

const CROSS_DEVICE_MARKER = "cross-device-marker.txt";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (source: string, destination: string) => {
      if (source.includes(CROSS_DEVICE_MARKER)) {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
      }
      return actual.rename(source, destination);
    }),
  };
});

const { createConfig } = await import("../../../src/core/config.js");
const { moveTool } = await import("../../../src/tools/move.js");
const { recoverWriteTransactions } = await import("../../../src/core/write-transaction.js");
const { withTempDir } = await import("../../helpers/temp.js");

describe("moveTool cross-device handling", () => {
  test("rejects a move that fails with EXDEV instead of throwing or overwriting", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, CROSS_DEVICE_MARKER);
      await writeFile(sourcePath, "hello\n", "utf8");
      const config = createConfig({ roots: [root] });

      const result = await moveTool(
        { source: CROSS_DEVICE_MARKER, destination: "moved.txt" },
        config,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CROSS_DEVICE_MOVE_NOT_SUPPORTED");
      }

      await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
      await expect(readFile(join(root, "moved.txt"), "utf8")).rejects.toThrow();
    });
  });

  test("a failed rename leaves no move transaction record to be quarantined later", async () => {
    await withTempDir(async (root) => {
      const transactionDir = join(root, ".scalpel-transactions");
      await writeFile(join(root, CROSS_DEVICE_MARKER), "source\n", "utf8");
      await writeFile(join(root, "existing.txt"), "destination\n", "utf8");
      const config = createConfig({ roots: [root], transactionDir });

      const result = await moveTool(
        { source: CROSS_DEVICE_MARKER, destination: "existing.txt", overwrite: true },
        config,
      );

      expect(result.ok).toBe(false);
      await expect(readdir(transactionDir)).resolves.toEqual([]);
      await expect(recoverWriteTransactions(transactionDir)).resolves.toMatchObject({
        scanned: 0,
        unrecoverable: 0,
      });
    });
  });
});
