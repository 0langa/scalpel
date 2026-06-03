import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { withTempDir } from "../../helpers/temp.js";
import { resolveWorkspacePath } from "../../../src/core/path-policy.js";

describe("resolveWorkspacePath", () => {
  test("resolves a relative path inside the configured root", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "main.ts"), "export const value = 1;\n", "utf8");

      const result = await resolveWorkspacePath({
        path: "src/main.ts",
        roots: [root],
        operation: "read"
      });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value).toBe(resolve(root, "src", "main.ts"));
      }
    });
  });

  test("rejects a path that escapes the configured root", async () => {
    await withTempDir(async (root) => {
      const result = await resolveWorkspacePath({
        path: "../outside.txt",
        roots: [root],
        operation: "read"
      });

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("PATH_OUTSIDE_ROOT");
      }
    });
  });

  test("rejects symlink targets inside the workspace", async () => {
    await withTempDir(async (root) => {
      const target = join(root, "real.txt");
      const link = join(root, "linked.txt");

      await writeFile(target, "hello\n", "utf8");
      await symlink(target, link);

      const result = await resolveWorkspacePath({
        path: "linked.txt",
        roots: [root],
        operation: "read"
      });

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("SYMLINK_NOT_ALLOWED");
      }
    });
  });

  test("rejects traversal through a symlinked directory component", async () => {
    await withTempDir(async (root) => {
      const realDir = join(root, "real-dir");
      const linkedDir = join(root, "linked-dir");

      await mkdir(realDir, { recursive: true });
      await writeFile(join(realDir, "inside.txt"), "hello\n", "utf8");
      await symlink(realDir, linkedDir, process.platform === "win32" ? "junction" : "dir");

      const result = await resolveWorkspacePath({
        path: "linked-dir/inside.txt",
        roots: [root],
        operation: "read"
      });

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("SYMLINK_NOT_ALLOWED");
      }
    });
  });
});
