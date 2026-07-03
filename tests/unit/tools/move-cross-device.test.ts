import { readFile, writeFile } from "node:fs/promises";
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
});
