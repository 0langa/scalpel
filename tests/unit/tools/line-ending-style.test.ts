import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import {
  readLineEndingStyle,
  readLineEndingStyleIfNeeded,
} from "../../../src/core/file-metadata.js";
import { matchLineEndings } from "../../../src/core/line-endings.js";
import { appendTool } from "../../../src/tools/append.js";
import { batchEditTool } from "../../../src/tools/batch-edit.js";
import { insertTool } from "../../../src/tools/insert.js";
import { patchTool } from "../../../src/tools/patch.js";
import { prependTool } from "../../../src/tools/prepend.js";
import { replaceBetweenMarkersTool } from "../../../src/tools/replace-between-markers.js";
import { withTempDir } from "../../helpers/temp.js";

const CRLF_FILE = "alpha\r\nbeta\r\ngamma\r\n";

async function withFile(
  content: string,
  run: (root: string, filePath: string) => Promise<void>,
): Promise<void> {
  await withTempDir(async (root) => {
    const filePath = join(root, "file.txt");
    await writeFile(filePath, content, "utf8");
    await run(root, filePath);
  });
}

describe("matchLineEndings", () => {
  test("rewrites every line break to the file's single style", () => {
    expect(matchLineEndings("a\nb\r\nc\n", "\r\n")).toBe("a\r\nb\r\nc\r\n");
    expect(matchLineEndings("a\r\nb\nc\r\n", "\n")).toBe("a\nb\nc\n");
  });

  test("leaves text alone for mixed files and files without line breaks", () => {
    expect(matchLineEndings("a\nb\r\n", "mixed")).toBe("a\nb\r\n");
    expect(matchLineEndings("a\nb\r\n", "none")).toBe("a\nb\r\n");
  });

  test("keeps a leading LF bare when it completes a CR already in the file", () => {
    expect(matchLineEndings("\nb\n", "\r\n", true)).toBe("\nb\r\n");
    expect(matchLineEndings("\nb\n", "\r\n", false)).toBe("\r\nb\r\n");
  });

  test("does not touch lone CRs", () => {
    expect(matchLineEndings("a\rb", "\n")).toBe("a\rb");
    expect(matchLineEndings("a\rb", "\r\n")).toBe("a\rb");
  });
});

describe("readLineEndingStyle", () => {
  test("finds the style across chunk boundaries and reports a trailing CR", async () => {
    await withFile("a\r\nb\r\nc\r", async (_root, filePath) => {
      for (const highWaterMark of [1, 2, 3, 64]) {
        await expect(readLineEndingStyle(filePath, { highWaterMark })).resolves.toEqual({
          ok: true,
          data: { eol: "\r\n", endsWithCr: true },
        });
      }
    });
    await withFile("a\nb\r\n", async (_root, filePath) => {
      await expect(readLineEndingStyle(filePath, { highWaterMark: 1 })).resolves.toEqual({
        ok: true,
        data: { eol: "mixed", endsWithCr: false },
      });
    });
  });
});

describe("readLineEndingStyleIfNeeded", () => {
  test("does not read the file for text without a line break", async () => {
    await withTempDir(async (root) => {
      const missing = join(root, "missing.txt");

      await expect(readLineEndingStyleIfNeeded(missing, "no line break")).resolves.toEqual({
        ok: true,
        data: { eol: "none", endsWithCr: false },
      });
      await expect(readLineEndingStyleIfNeeded(missing, "line\n")).resolves.toMatchObject({
        ok: false,
        error: { code: "FILE_NOT_FOUND" },
      });
    });
  });
});

describe("edits keep a CRLF file CRLF", () => {
  test("patch writes new_string with CRLF", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "beta", new_string: "beta\nbeta2\nbeta3" },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "alpha\r\nbeta\r\nbeta2\r\nbeta3\r\ngamma\r\n",
      );
    });
  });

  test("patch whose old_string starts at the LF of a CRLF pair does not double the CR", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "\nbeta", new_string: "\nnew\nbeta" },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nnew\r\nbeta\r\ngamma\r\n");
    });
  });

  test("patch with occurrence all converts every replacement", async () => {
    await withFile("x\r\ny\r\nx\r\n", async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "x", new_string: "x\nz", occurrence: "all" },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("x\r\nz\r\ny\r\nx\r\nz\r\n");
    });
  });

  test("streaming patch on a file over maxReadBytes converts new_string too", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "beta", new_string: "beta\nbeta2" },
        createConfig({ roots: [root], maxReadBytes: 8 }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nbeta\r\nbeta2\r\ngamma\r\n");
    });
  });

  test("batch_edit converts each edit", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await batchEditTool(
        {
          path: "file.txt",
          edits: [
            { old_string: "alpha", new_string: "alpha\nalpha2" },
            { old_string: "gamma", new_string: "gamma\ngamma2" },
          ],
        },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "alpha\r\nalpha2\r\nbeta\r\ngamma\r\ngamma2\r\n",
      );
    });
  });

  test("insert converts the line breaks inside multi-line content", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await insertTool(
        { path: "file.txt", content: "one\ntwo\n", line: 2 },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "alpha\r\none\r\ntwo\r\nbeta\r\ngamma\r\n",
      );
    });
  });

  test("replace_between_markers converts the replacement block", async () => {
    await withFile("// BEGIN\r\nold\r\n// END\r\n", async (root, filePath) => {
      const result = await replaceBetweenMarkersTool(
        {
          path: "file.txt",
          start_marker: "// BEGIN",
          end_marker: "// END",
          new_content: "one\ntwo",
        },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "// BEGIN\r\none\r\ntwo\r\n// END\r\n",
      );
    });
  });

  test("append and prepend convert their content, including on the streaming paths", async () => {
    for (const maxReadBytes of [undefined, 8]) {
      await withFile(CRLF_FILE, async (root, filePath) => {
        const config = createConfig({
          roots: [root],
          ...(maxReadBytes === undefined ? {} : { maxReadBytes }),
        });

        expect(
          (await appendTool({ path: "file.txt", content: "delta\nepsilon\n" }, config)).ok,
        ).toBe(true);
        expect((await prependTool({ path: "file.txt", content: "zero\nhalf\n" }, config)).ok).toBe(
          true,
        );
        await expect(readFile(filePath, "utf8")).resolves.toBe(
          "zero\r\nhalf\r\nalpha\r\nbeta\r\ngamma\r\ndelta\r\nepsilon\r\n",
        );
      });
    }
  });

  test("append after a trailing CR completes the pair instead of doubling the CR", async () => {
    for (const maxReadBytes of [undefined, 8]) {
      await withFile("alpha\r\nbeta\r", async (root, filePath) => {
        const config = createConfig({
          roots: [root],
          ...(maxReadBytes === undefined ? {} : { maxReadBytes }),
        });

        expect((await appendTool({ path: "file.txt", content: "\ngamma\n" }, config)).ok).toBe(
          true,
        );
        await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nbeta\r\ngamma\r\n");
      });
    }
  });

  test("dry runs preview the converted text", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "beta", new_string: "beta\nbeta2", dry_run: true },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // "beta" keeps its CRLF, so it stays a context line instead of -beta/+beta.
        expect(result.data.diff).toContain("\n beta\r\n+beta2\r\n");
      }
      await expect(readFile(filePath, "utf8")).resolves.toBe(CRLF_FILE);
    });
  });
});

describe("other files keep their style", () => {
  test("CRLF text written into an LF file becomes LF", async () => {
    await withFile("alpha\nbeta\n", async (root, filePath) => {
      const config = createConfig({ roots: [root] });

      expect(
        (
          await patchTool(
            { path: "file.txt", old_string: "beta", new_string: "beta\r\nbeta2" },
            config,
          )
        ).ok,
      ).toBe(true);
      expect((await appendTool({ path: "file.txt", content: "gamma\r\n" }, config)).ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\nbeta\nbeta2\ngamma\n");
    });
  });

  test("a mixed file gets the text exactly as given", async () => {
    await withFile("alpha\r\nbeta\n", async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "beta", new_string: "beta\r\nb2\nb3" },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nbeta\r\nb2\nb3\n");
    });
  });

  test("new files and files without a line break get the text exactly as given", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });

      expect((await appendTool({ path: "new.txt", content: "a\r\nb\n" }, config)).ok).toBe(true);
      await expect(readFile(join(root, "new.txt"), "utf8")).resolves.toBe("a\r\nb\n");

      await writeFile(join(root, "one-line.txt"), "only", "utf8");
      expect((await appendTool({ path: "one-line.txt", content: "\r\nnext" }, config)).ok).toBe(
        true,
      );
      await expect(readFile(join(root, "one-line.txt"), "utf8")).resolves.toBe("only\r\nnext");
    });
  });
});

describe("edits that only change line breaks", () => {
  test("patch applies a CRLF to LF conversion instead of a silent no-op, also when streaming", async () => {
    for (const maxReadBytes of [undefined, 8]) {
      await withFile(CRLF_FILE, async (root, filePath) => {
        const result = await patchTool(
          { path: "file.txt", old_string: "\r\n", new_string: "\n", occurrence: "all" },
          createConfig({ roots: [root], ...(maxReadBytes === undefined ? {} : { maxReadBytes }) }),
        );

        expect(result.ok).toBe(true);
        await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\nbeta\ngamma\n");
      });
    }
  });

  test("patch applies an LF to CRLF conversion, also when streaming", async () => {
    for (const maxReadBytes of [undefined, 8]) {
      await withFile("alpha\nbeta\n", async (root, filePath) => {
        const result = await patchTool(
          { path: "file.txt", old_string: "\n", new_string: "\r\n", occurrence: "all" },
          createConfig({ roots: [root], ...(maxReadBytes === undefined ? {} : { maxReadBytes }) }),
        );

        expect(result.ok).toBe(true);
        await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nbeta\r\n");
      });
    }
  });

  test("a text change with LF line breaks in a CRLF file is still converted", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await patchTool(
        { path: "file.txt", old_string: "alpha\r\nbeta", new_string: "alpha\nBETA" },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\r\nBETA\r\ngamma\r\n");
    });
  });

  test("batch_edit follows a line-break change made by an earlier edit", async () => {
    await withFile(CRLF_FILE, async (root, filePath) => {
      const result = await batchEditTool(
        {
          path: "file.txt",
          edits: [
            { old_string: "\r\n", new_string: "\n", occurrence: "all" },
            { old_string: "beta", new_string: "beta\nbeta2" },
          ],
        },
        createConfig({ roots: [root] }),
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\nbeta\nbeta2\ngamma\n");
    });
  });
});
