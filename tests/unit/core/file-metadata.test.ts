import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { readFileSnapshot } from "../../../src/core/file-metadata.js";
import { withTempDir } from "../../helpers/temp.js";

describe("readFileSnapshot", () => {
  test("detects CRLF files and reports line metadata", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "sample.txt");
      await writeFile(filePath, "alpha\r\nbeta\r\n", "utf8");

      const snapshot = await readFileSnapshot(filePath);

      expect(snapshot.ok).toBe(true);

      if (snapshot.ok) {
        expect(snapshot.data.eol).toBe("\r\n");
        expect(snapshot.data.lineCount).toBe(2);
        expect(snapshot.data.sizeBytes).toBeGreaterThan(0);
        expect(snapshot.data.sha256).toHaveLength(64);
      }
    });
  });
});
