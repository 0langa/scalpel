import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { readFileSnapshot, readPathStat } from "../../../src/core/file-metadata.js";
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

describe("readPathStat", () => {
  test("streams oversized UTF-8 files for hash and line metadata", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "large.txt");
      const content = "alpha\nbeta\ngamma\n".repeat(32);
      await writeFile(filePath, content, "utf8");

      const pathStat = await readPathStat(filePath, { maxBytes: 5 });

      expect(pathStat.ok).toBe(true);
      if (pathStat.ok) {
        expect(pathStat.data.textKind).toBe("utf8");
        expect(pathStat.data.lineCount).toBe(96);
        expect(pathStat.data.sha256).toBe(createHash("sha256").update(content).digest("hex"));
      }
    });
  });

  test("classifies oversized binary and invalid UTF-8 files without content", async () => {
    await withTempDir(async (root) => {
      const binaryPath = join(root, "binary.dat");
      const invalidPath = join(root, "invalid.txt");
      await writeFile(binaryPath, Buffer.from([0x61, 0x00, 0x62]));
      await writeFile(invalidPath, Buffer.from([0x61, 0xff, 0x62]));

      const binary = await readPathStat(binaryPath, { maxBytes: 1 });
      const invalid = await readPathStat(invalidPath, { maxBytes: 1 });

      expect(binary.ok).toBe(true);
      expect(invalid.ok).toBe(true);
      if (binary.ok && invalid.ok) {
        expect(binary.data).toMatchObject({ textKind: "binary", lineCount: 0 });
        expect(binary.data.sha256).toBeUndefined();
        expect(invalid.data).toMatchObject({ textKind: "non_utf8", lineCount: 0 });
        expect(invalid.data.sha256).toBeUndefined();
      }
    });
  });
});
