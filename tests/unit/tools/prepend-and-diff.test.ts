import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { diffTool } from "../../../src/tools/diff.js";
import { prependTool } from "../../../src/tools/prepend.js";
import { withTempDir } from "../../helpers/temp.js";

describe("prependTool and diffTool", () => {
  test("prepend inserts content at the beginning of an existing file", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "script.sh");
      await writeFile(filePath, "echo hello\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await prependTool(
        {
          path: "script.sh",
          content: "#!/usr/bin/env bash\n"
        },
        config
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("#!/usr/bin/env bash\necho hello\n");
    });
  });

  test("diff returns a unified diff for proposed content", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "const value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await diffTool(
        {
          path: "main.ts",
          proposed_content: "const value = 2;\n"
        },
        config
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.diff).toContain("-const value = 1;");
        expect(result.data.diff).toContain("+const value = 2;");
      }
    });
  });
});
