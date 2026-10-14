import { mkdir, readdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

// Simulates another process winning a race: right before Scalpel creates its
// temp file, the target's parent directory is swapped for a link that points
// outside the workspace.
const swap = vi.hoisted(() => ({ run: undefined as (() => Promise<void>) | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const [path] = args;
      if (typeof path === "string" && path.includes(".scalpel-") && swap.run !== undefined) {
        const run = swap.run;
        swap.run = undefined;
        await run();
      }
      return actual.open(...args);
    }),
  };
});

const { writeTextFileForMutation } = await import("../../../src/core/mutation.js");
const { withTempDir } = await import("../../helpers/temp.js");

describe("commit-time parent revalidation", () => {
  test("a parent directory swapped for a link before the temp file is created fails closed", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const parent = join(root, "sub");
        await mkdir(parent);

        swap.run = async () => {
          await rename(parent, join(root, "sub-real"));
          await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
        };

        const result = await writeTextFileForMutation({
          path: join(parent, "new.txt"),
          content: "escaped?\n",
          before: undefined,
        });

        expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
        await expect(readdir(outside)).resolves.toEqual([]);
      });
    });
  });
});
