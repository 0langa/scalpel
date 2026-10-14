import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig, type ScalpelConfig } from "../../../src/core/config.js";
import type { DomainResult } from "../../../src/core/errors.js";
import { appendTool } from "../../../src/tools/append.js";
import { batchEditTool } from "../../../src/tools/batch-edit.js";
import { createTool } from "../../../src/tools/create.js";
import { insertTool } from "../../../src/tools/insert.js";
import { patchTool } from "../../../src/tools/patch.js";
import { prependTool } from "../../../src/tools/prepend.js";
import { replaceBetweenMarkersTool } from "../../../src/tools/replace-between-markers.js";
import { withTempDir } from "../../helpers/temp.js";

// The files below start under this limit, so the in-memory paths edit them, and end above it.
const LIMIT = 16;

async function withFile(
  content: string | undefined,
  run: (root: string, filePath: string) => Promise<void>,
): Promise<void> {
  await withTempDir(async (root) => {
    const filePath = join(root, "file.txt");
    if (content !== undefined) {
      await writeFile(filePath, content, "utf8");
    }
    await run(root, filePath);
  });
}

async function sha256OfFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

// A failure after the write committed makes a client retry an edit that was already applied.
describe("edits that grow a file past maxReadBytes", () => {
  test("append reports success, so a retry cannot append twice", async () => {
    await withFile("line one\n", async (root, filePath) => {
      const result = await appendTool(
        { path: "file.txt", content: "line two\n" },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      expect(result).toMatchObject({
        ok: true,
        data: { applied: true, lines_added: 1, new_total_lines: 2 },
      });
      await expect(readFile(filePath, "utf8")).resolves.toBe("line one\nline two\n");
    });
  });

  test("prepend reports success", async () => {
    await withFile("line two\n", async (root, filePath) => {
      const result = await prependTool(
        { path: "file.txt", content: "line one\n" },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      expect(result).toMatchObject({
        ok: true,
        data: { applied: true, lines_added: 1, new_total_lines: 2 },
      });
      await expect(readFile(filePath, "utf8")).resolves.toBe("line one\nline two\n");
    });
  });

  test("patch reports success with the hash of the file it wrote", async () => {
    await withFile("name = old\n", async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "old", new_string: "a much longer value" },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      await expect(readFile(filePath, "utf8")).resolves.toBe("name = a much longer value\n");
      expect(result).toMatchObject({
        ok: true,
        data: { applied: true, replacements: 1, sha256: await sha256OfFile(filePath) },
      });
    });
  });

  test("the hash patch returns is a valid precondition for the next, streaming, edit", async () => {
    await withFile("name = old\n", async (root, filePath) => {
      const config = createConfig({ roots: [root], maxReadBytes: LIMIT });
      const first = await patchTool(
        { path: "file.txt", old_string: "old", new_string: "a much longer value" },
        config,
      );
      expect(first.ok).toBe(true);
      if (!first.ok) {
        return;
      }

      const second = await patchTool(
        {
          path: "file.txt",
          old_string: "longer",
          new_string: "longer, streamed",
          expected_sha256: first.data.sha256,
        },
        config,
      );

      expect(second).toMatchObject({ ok: true, data: { applied: true, replacements: 1 } });
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "name = a much longer, streamed value\n",
      );
    });
  });

  test("create reports the lines and size of a file larger than the limit", async () => {
    await withFile(undefined, async (root, filePath) => {
      const content = "first line\nsecond line\n";
      const result = await createTool(
        { path: "file.txt", content },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      expect(result).toMatchObject({
        ok: true,
        data: { applied: true, lines: 2, size_bytes: Buffer.byteLength(content) },
      });
      await expect(readFile(filePath, "utf8")).resolves.toBe(content);
    });
  });

  test("create with overwrite reports success when the new content is larger than the limit", async () => {
    await withFile("small\n", async (root, filePath) => {
      const content = "first line\nsecond line\n";
      const result = await createTool(
        { path: "file.txt", content, overwrite: true },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      expect(result).toMatchObject({ ok: true, data: { applied: true, lines: 2 } });
      await expect(readFile(filePath, "utf8")).resolves.toBe(content);
    });
  });

  test("append and prepend that create a file larger than the limit report success", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root], maxReadBytes: LIMIT });
      const content = "first line\nsecond line\n";

      const appended = await appendTool({ path: "appended.txt", content }, config);
      const prepended = await prependTool({ path: "prepended.txt", content }, config);

      expect(appended).toMatchObject({ ok: true, data: { applied: true, new_total_lines: 2 } });
      expect(prepended).toMatchObject({ ok: true, data: { applied: true, new_total_lines: 2 } });
      await expect(readFile(join(root, "appended.txt"), "utf8")).resolves.toBe(content);
      await expect(readFile(join(root, "prepended.txt"), "utf8")).resolves.toBe(content);
    });
  });

  test("the journal records the grown file as the after state", async () => {
    await withFile("line one\n", async (root, filePath) => {
      const journalPath = join(root, "journal.jsonl");
      const result = await appendTool(
        { path: "file.txt", content: "line two\n" },
        createConfig({ roots: [root], maxReadBytes: LIMIT, journalEnabled: true, journalPath }),
      );

      expect(result.ok).toBe(true);
      const records = (await readFile(journalPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        tool: "append",
        applied: true,
        after: { sha256: await sha256OfFile(filePath), size_bytes: 18 },
      });
    });
  });

  test("the other whole-file editors report success too", async () => {
    const edits: [string, (config: ScalpelConfig) => Promise<DomainResult<unknown>>][] = [
      [
        "inserted\n// BEGIN\n// END\n",
        (config) => insertTool({ path: "file.txt", content: "inserted", line: 1 }, config),
      ],
      [
        "// BEGIN\nreplaced\n// END\n",
        (config) =>
          replaceBetweenMarkersTool(
            {
              path: "file.txt",
              start_marker: "// BEGIN",
              end_marker: "// END",
              new_content: "replaced",
            },
            config,
          ),
      ],
      [
        "// BEGIN, batch edited\n// END\n",
        (config) =>
          batchEditTool(
            {
              path: "file.txt",
              edits: [{ old_string: "BEGIN", new_string: "BEGIN, batch edited" }],
            },
            config,
          ),
      ],
    ];

    for (const [expected, edit] of edits) {
      // 16 bytes, exactly at the limit.
      await withFile("// BEGIN\n// END\n", async (root, filePath) => {
        const result = await edit(createConfig({ roots: [root], maxReadBytes: LIMIT }));

        expect(result).toMatchObject({ ok: true, data: { applied: true } });
        await expect(readFile(filePath, "utf8")).resolves.toBe(expected);
      });
    }
  });

  test("a streaming patch that shrinks a file under the limit reports the hash it wrote", async () => {
    await withFile(`${"x".repeat(LIMIT)}\n`, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "x".repeat(LIMIT), new_string: "short" },
        createConfig({ roots: [root], maxReadBytes: LIMIT }),
      );

      await expect(readFile(filePath, "utf8")).resolves.toBe("short\n");
      expect(result).toMatchObject({
        ok: true,
        data: { applied: true, sha256: await sha256OfFile(filePath) },
      });
    });
  });
});
