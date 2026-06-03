import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { patchTool } from "../../../src/tools/patch.js";
import { statTool } from "../../../src/tools/stat.js";
import { withTempDir } from "../../helpers/temp.js";

describe("patchTool", () => {
  test("replaces a unique exact match by default", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "export const name = 'old';\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await patchTool(
        {
          path: "main.ts",
          old_string: "'old'",
          new_string: "'new'"
        },
        config
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.replacements).toBe(1);
        expect(result.data.applied).toBe(true);
      }

      await expect(readFile(filePath, "utf8")).resolves.toBe("export const name = 'new';\n");
    });
  });

  test("fails when the match is ambiguous in default unique mode", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "main.ts"), "const value = 1;\nconst value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await patchTool(
        {
          path: "main.ts",
          old_string: "const value = 1;",
          new_string: "const value = 2;"
        },
        config
      );

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("STRING_NOT_UNIQUE");
      }
    });
  });

  test("dry_run returns a diff without mutating the file", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "export const value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await patchTool(
        {
          path: "main.ts",
          old_string: "value = 1",
          new_string: "value = 2",
          dry_run: true
        },
        config
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.diff).toContain("-export const value = 1;");
        expect(result.data.diff).toContain("+export const value = 2;");
      }

      await expect(readFile(filePath, "utf8")).resolves.toBe("export const value = 1;\n");
    });
  });

  test("rejects writes when expected_sha256 no longer matches", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "export const value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "main.ts" }, config);
      if (!before.ok || before.data.sha256 === undefined) {
        throw new Error("expected initial stat to include a file hash");
      }

      await writeFile(filePath, "export const value = 9;\n", "utf8");

      const result = await patchTool(
        {
          path: "main.ts",
          old_string: "value = 9",
          new_string: "value = 2",
          expected_sha256: before.data.sha256
        },
        config
      );

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
      }
    });
  });
});
