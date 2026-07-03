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

  test("rejects writes when expected_mtime_ms no longer matches", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "export const value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "main.ts" }, config);
      if (!before.ok) {
        throw new Error("expected initial stat");
      }

      const result = await patchTool(
        {
          path: "main.ts",
          old_string: "value = 1",
          new_string: "value = 2",
          expected_mtime_ms: before.data.mtimeMs - 1
        },
        config
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
      }
    });
  });

  test("streams a unique replacement in an oversized UTF-8 file", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large.txt");
      await writeFile(filePath, `${"alpha\n".repeat(20)}target\n${"omega\n".repeat(20)}`, "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 12 });
      const result = await patchTool(
        {
          path: "large.txt",
          old_string: "target",
          new_string: "patched",
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.replacements).toBe(1);
        expect(result.data.applied).toBe(true);
        expect(result.data.diff).toBeUndefined();
      }
      await expect(readFile(filePath, "utf8")).resolves.toContain("patched\nomega");
    });
  });

  test("streams a replacement when the match crosses a read chunk boundary", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "boundary.txt");
      const content = `${"x".repeat(65_535)}ABC\n`;
      await writeFile(filePath, content, "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 12 });
      const result = await patchTool(
        {
          path: "boundary.txt",
          old_string: "xABC",
          new_string: "YABC",
          occurrence: "unique",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(`${"x".repeat(65_534)}YABC\n`);
    });
  });

  test("streaming patch rejects ambiguous oversized unique matches", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "ambiguous-large.txt");
      await writeFile(filePath, `${"alpha\n".repeat(20)}needle\nneedle\n`, "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 12 });
      const result = await patchTool(
        {
          path: "ambiguous-large.txt",
          old_string: "needle",
          new_string: "patched",
        },
        config,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("STRING_NOT_UNIQUE");
      }
      await expect(readFile(filePath, "utf8")).resolves.toContain("needle\nneedle\n");
    });
  });
});
