import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { createConfig } from "../../../src/core/config.js";
import { appendTool } from "../../../src/tools/append.js";
import { batchEditTool } from "../../../src/tools/batch-edit.js";
import { createTool } from "../../../src/tools/create.js";
import { deleteRangeTool } from "../../../src/tools/delete-range.js";
import { grepTool } from "../../../src/tools/grep.js";
import { insertTool } from "../../../src/tools/insert.js";
import { moveTool } from "../../../src/tools/move.js";
import { patchTool } from "../../../src/tools/patch.js";
import { prependTool } from "../../../src/tools/prepend.js";
import { replaceBetweenMarkersTool } from "../../../src/tools/replace-between-markers.js";
import { statTool } from "../../../src/tools/stat.js";
import { withTempDir } from "../../helpers/temp.js";

describe("mutation and search tools", () => {
  test("create writes a new file and its parent directories", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });
      const result = await createTool(
        {
          path: "nested/file.txt",
          content: "hello\n",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "nested", "file.txt"), "utf8")).resolves.toBe("hello\n");
    });
  });

  test("create dry_run returns a diff without writing", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "nested", "file.txt");
      const config = createConfig({ roots: [root] });
      const result = await createTool(
        {
          path: "nested/file.txt",
          content: "hello\n",
          dry_run: true,
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.diff).toContain("+hello");
      }
      await expect(readFile(filePath, "utf8")).rejects.toThrow();
    });
  });

  test("create overwrite honors matching and stale preconditions", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "file.txt");
      await writeFile(filePath, "old\n", "utf8");

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "file.txt" }, config);
      if (!before.ok || before.data.sha256 === undefined) {
        throw new Error("expected stat with hash");
      }

      const stale = await createTool(
        {
          path: "file.txt",
          content: "new\n",
          overwrite: true,
          expected_sha256: "not-the-current-sha",
        },
        config,
      );
      expect(stale.ok).toBe(false);
      if (!stale.ok) {
        expect(stale.error.code).toBe("CONCURRENCY_CONFLICT");
      }

      const applied = await createTool(
        {
          path: "file.txt",
          content: "new\n",
          overwrite: true,
          expected_sha256: before.data.sha256,
          expected_mtime_ms: before.data.mtimeMs,
        },
        config,
      );

      expect(applied.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("new\n");
    });
  });

  test("batch_edit applies multiple changes atomically", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "const alpha = 1;\nconst beta = 2;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await batchEditTool(
        {
          path: "main.ts",
          edits: [
            { old_string: "alpha = 1", new_string: "alpha = 10" },
            { old_string: "beta = 2", new_string: "beta = 20" },
          ],
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "const alpha = 10;\nconst beta = 20;\n",
      );
    });
  });

  test("batch_edit leaves the file untouched when one edit fails", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "const alpha = 1;\nconst beta = 2;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await batchEditTool(
        {
          path: "main.ts",
          edits: [
            { old_string: "alpha = 1", new_string: "alpha = 10" },
            { old_string: "gamma = 3", new_string: "gamma = 30" },
          ],
        },
        config,
      );

      expect(result.ok).toBe(false);
      await expect(readFile(filePath, "utf8")).resolves.toBe("const alpha = 1;\nconst beta = 2;\n");
    });
  });

  test("insert adds content before a target line", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "line one\nline three\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool(
        {
          path: "main.ts",
          content: "line two\n",
          line: 2,
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("line one\nline two\nline three\n");
    });
  });

  test("delete_range removes an inclusive line span", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "one\ntwo\nthree\nfour\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await deleteRangeTool(
        {
          path: "main.ts",
          start_line: 2,
          end_line: 3,
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe("one\nfour\n");
    });
  });

  test("replace_between_markers keeps markers and swaps inner content", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "config.txt");
      await writeFile(filePath, "before\nBEGIN\nold one\nold two\nEND\nafter\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await replaceBetweenMarkersTool(
        {
          path: "config.txt",
          start_marker: "BEGIN",
          end_marker: "END",
          new_content: "fresh line\n",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "before\nBEGIN\nfresh line\nEND\nafter\n",
      );
    });
  });

  test("replace_between_markers rejects replacement content that repeats markers", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "config.txt");
      await writeFile(filePath, "before\nBEGIN\nold one\nEND\nafter\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await replaceBetweenMarkersTool(
        {
          path: "config.txt",
          start_marker: "BEGIN",
          end_marker: "END",
          new_content: "BEGIN\nfresh line\nEND\n",
        },
        config,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MARKER_NOT_ALLOWED_IN_REPLACEMENT");
      }
    });
  });

  test("insert normalizes content inserted after a marker into its own line", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "line one\nmarker\nline three\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await insertTool(
        {
          path: "main.ts",
          after_marker: "marker",
          content: "line two",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toBe(
        "line one\nmarker\nline two\nline three\n",
      );
    });
  });

  test("append creates a missing file and appends content", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });
      const result = await appendTool(
        {
          path: "logs/activity.log",
          content: "entry 1\n",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "logs", "activity.log"), "utf8")).resolves.toBe("entry 1\n");
    });
  });

  test("append and prepend dry_run do not mutate files", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "log.txt");
      await writeFile(filePath, "middle\n", "utf8");
      const config = createConfig({ roots: [root] });

      const append = await appendTool(
        {
          path: "log.txt",
          content: "tail\n",
          dry_run: true,
        },
        config,
      );
      const prepend = await prependTool(
        {
          path: "log.txt",
          content: "head\n",
          dry_run: true,
        },
        config,
      );

      expect(append.ok).toBe(true);
      expect(prepend.ok).toBe(true);
      if (append.ok && prepend.ok) {
        expect(append.data.applied).toBe(false);
        expect(prepend.data.applied).toBe(false);
      }
      await expect(readFile(filePath, "utf8")).resolves.toBe("middle\n");
    });
  });

  test("append and prepend reject preconditions when creating missing files", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });

      const append = await appendTool(
        {
          path: "missing-append.txt",
          content: "tail\n",
          expected_sha256: "abc",
        },
        config,
      );
      const prepend = await prependTool(
        {
          path: "missing-prepend.txt",
          content: "head\n",
          expected_mtime_ms: 1,
        },
        config,
      );

      expect(append.ok).toBe(false);
      expect(prepend.ok).toBe(false);
      if (!append.ok && !prepend.ok) {
        expect(append.error.code).toBe("FILE_NOT_FOUND");
        expect(prepend.error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  test("move renames a file into a new parent directory", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "old.txt"), "hello\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await moveTool(
        {
          source: "old.txt",
          destination: "nested/new.txt",
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "nested", "new.txt"), "utf8")).resolves.toBe("hello\n");
    });
  });

  test("move dry_run reports plan without renaming", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, "old.txt");
      await writeFile(sourcePath, "hello\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await moveTool(
        {
          source: "old.txt",
          destination: "nested/new.txt",
          dry_run: true,
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.source_exists).toBe(true);
        expect(result.data.destination_exists).toBe(false);
      }
      await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
      await expect(readFile(join(root, "nested", "new.txt"), "utf8")).rejects.toThrow();
    });
  });

  test("move honors source and destination preconditions", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "old.txt"), "old\n", "utf8");
      await writeFile(join(root, "new.txt"), "new\n", "utf8");

      const config = createConfig({ roots: [root] });
      const source = await statTool({ path: "old.txt" }, config);
      const destination = await statTool({ path: "new.txt" }, config);
      if (
        !source.ok ||
        source.data.sha256 === undefined ||
        !destination.ok ||
        destination.data.sha256 === undefined
      ) {
        throw new Error("expected file hashes");
      }

      const staleDestination = await moveTool(
        {
          source: "old.txt",
          destination: "new.txt",
          overwrite: true,
          expected_source_sha256: source.data.sha256,
          expected_destination_sha256: "not-the-current-sha",
        },
        config,
      );
      expect(staleDestination.ok).toBe(false);
      if (!staleDestination.ok) {
        expect(staleDestination.error.code).toBe("CONCURRENCY_CONFLICT");
      }

      const moved = await moveTool(
        {
          source: "old.txt",
          destination: "new.txt",
          overwrite: true,
          expected_source_sha256: source.data.sha256,
          expected_source_mtime_ms: source.data.mtimeMs,
          expected_destination_sha256: destination.data.sha256,
          expected_destination_mtime_ms: destination.data.mtimeMs,
        },
        config,
      );

      expect(moved.ok).toBe(true);
      await expect(readFile(join(root, "new.txt"), "utf8")).resolves.toBe("old\n");
    });
  });

  test("directory move accepts mtime preconditions and rejects sha preconditions", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "source-dir"));

      const config = createConfig({ roots: [root] });
      const directory = await stat(join(root, "source-dir"));

      const rejected = await moveTool(
        {
          source: "source-dir",
          destination: "sha-dir",
          expected_source_sha256: "abc",
        },
        config,
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.error.code).toBe("INVALID_INPUT");
      }

      const accepted = await moveTool(
        {
          source: "source-dir",
          destination: "mtime-dir",
          expected_source_mtime_ms: directory.mtimeMs,
        },
        config,
      );
      expect(accepted.ok).toBe(true);
    });
  });

  test("grep finds literal matches across nested files", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "export const value = 1;\n", "utf8");
      await writeFile(join(root, "src", "two.ts"), "export const other = value;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await grepTool(
        {
          path: "src",
          pattern: "value",
          max_results: 10,
        },
        config,
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data.total_matches).toBe(2);
        expect(result.data.has_more).toBe(false);
      }
    });
  });

  test("grep supports globs, context lines, and has_more metadata", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "before\nneedle one\nafter\n", "utf8");
      await writeFile(join(root, "src", "two.ts"), "needle two\n", "utf8");
      await writeFile(join(root, "docs", "notes.md"), "needle docs\n", "utf8");

      const config = createConfig({ roots: [root], maxGrepResults: 1 });
      const result = await grepTool(
        {
          path: ".",
          pattern: "needle",
          include_globs: ["src/*.ts"],
          before_context: 1,
          after_context: 1,
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total_matches).toBe(1);
        expect(result.data.has_more).toBe(true);
        expect(result.data.matches[0]).toMatchObject({
          relativePath: "src/one.ts",
          line: 2,
          before_context: [{ line: 1, content: "before" }],
          after_context: [{ line: 3, content: "after" }],
        });
      }
    });
  });

  test("grep excludes matching glob patterns", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "needle one\n", "utf8");
      await writeFile(join(root, "src", "skip.test.ts"), "needle test\n", "utf8");

      const config = createConfig({ roots: [root], maxGrepResults: 10 });
      const result = await grepTool(
        {
          path: ".",
          pattern: "needle",
          exclude_globs: ["src/*.test.ts"],
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.matches.map((match) => match.relativePath)).toEqual(["src/one.ts"]);
        expect(result.data.has_more).toBe(false);
      }
    });
  });

  test("grep reports skipped large, binary, and non-UTF-8 files", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "ok.txt"), "needle\n", "utf8");
      await writeFile(join(root, "src", "large.txt"), "needle ".repeat(10), "utf8");
      await writeFile(join(root, "src", "binary.dat"), Buffer.from([0, 1, 2]));
      await writeFile(join(root, "src", "bad.txt"), Buffer.from([0xc3, 0x28]));

      const config = createConfig({ roots: [root], maxReadBytes: 12, maxGrepResults: 10 });
      const result = await grepTool({ path: "src", pattern: "needle" }, config);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.total_matches).toBe(1);
        expect(result.data.skipped_files.map((file) => file.reason).sort()).toEqual([
          "binary",
          "non_utf8",
          "too_large",
        ]);
      }
    });
  });

  test("large existing files reject full-text mutators", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "large.txt"), "0123456789\n", "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 5 });
      const result = await appendTool({ path: "large.txt", content: "more\n" }, config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_TOO_LARGE");
      }
    });
  });

  test("journal records dry-run, applied, and validation failure without content", async () => {
    await withTempDir(async (root) => {
      const journalPath = join(root, "journal", "scalpel.jsonl");
      await writeFile(join(root, "notes.txt"), "alpha\nalpha\n", "utf8");

      const config = createConfig({
        roots: [root],
        journalEnabled: true,
        journalPath,
      });

      const failed = await patchTool(
        { path: "notes.txt", old_string: "alpha", new_string: "SECRET" },
        config,
      );
      expect(failed.ok).toBe(false);

      const preview = await appendTool(
        { path: "notes.txt", content: "SECRET\n", dry_run: true },
        config,
      );
      expect(preview.ok).toBe(true);

      const applied = await appendTool({ path: "notes.txt", content: "done\n" }, config);
      expect(applied.ok).toBe(true);

      const lines = (await readFile(journalPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(3);
      const records = lines.map(
        (line) => JSON.parse(line) as { tool: string; applied: boolean; error_code?: string },
      );
      expect(records.map((record) => record.tool)).toEqual(["patch", "append", "append"]);
      expect(records[0]?.error_code).toBe("STRING_NOT_UNIQUE");
      expect(records[1]?.applied).toBe(false);
      expect(records[2]?.applied).toBe(true);
      expect(lines.join("\n")).not.toContain("SECRET");
      expect(lines.join("\n")).not.toContain("alpha");
    });
  });

  test("grep returns a domain error for invalid regex patterns", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "export const value = 1;\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await grepTool(
        {
          path: "src",
          pattern: "[unterminated",
          regex: true,
        },
        config,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_PATTERN");
      }
    });
  });

  test("insert rejects stale expected_sha256 values", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "main.ts");
      await writeFile(filePath, "line one\nline three\n", "utf8");

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "main.ts" }, config);
      if (!before.ok || before.data.sha256 === undefined) {
        throw new Error("expected initial stat to include sha256");
      }

      await writeFile(filePath, "changed\nline three\n", "utf8");

      const result = await insertTool(
        {
          path: "main.ts",
          line: 2,
          content: "line two",
          expected_sha256: before.data.sha256,
        },
        config,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
      }
    });
  });

  test("concurrent patch calls with the same expected_sha256 allow at most one write", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "contended.txt");
      await writeFile(filePath, "alpha\n", "utf8");

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "contended.txt" }, config);
      if (!before.ok || before.data.sha256 === undefined) {
        throw new Error("expected initial stat to include sha256");
      }

      const [left, right] = await Promise.all([
        patchTool(
          {
            path: "contended.txt",
            old_string: "alpha",
            new_string: "left",
            expected_sha256: before.data.sha256,
          },
          config,
        ),
        patchTool(
          {
            path: "contended.txt",
            old_string: "alpha",
            new_string: "right",
            expected_sha256: before.data.sha256,
          },
          config,
        ),
      ]);

      const applied = [left, right].filter((result) => result.ok).length;
      expect(applied).toBe(1);
      expect(
        [left, right].some((result) => !result.ok && result.error.code === "CONCURRENCY_CONFLICT"),
      ).toBe(true);
      await expect(readFile(filePath, "utf8")).resolves.toMatch(/^(left|right)\n$/u);
    });
  });

  test("mutations reject files changed by external interference before commit", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "externally-changed.txt");
      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousContent = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
      await writeFile(filePath, "alpha\n", "utf8");

      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = filePath;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "write";
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT = "external\n";

      try {
        const config = createConfig({ roots: [root] });
        const result = await patchTool(
          {
            path: "externally-changed.txt",
            old_string: "alpha",
            new_string: "scalpel",
          },
          config,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
        await expect(readFile(filePath, "utf8")).resolves.toBe("external\n");
      } finally {
        if (previousPath === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = previousPath;
        }
        if (previousContent === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT = previousContent;
        }
        if (previousMode === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = previousMode;
        }
      }
    });
  });

  test("mutations reject files deleted by external interference before commit", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "externally-deleted.txt");
      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
      await writeFile(filePath, "alpha\n", "utf8");

      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = filePath;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "delete";

      try {
        const config = createConfig({ roots: [root] });
        const result = await patchTool(
          {
            path: "externally-deleted.txt",
            old_string: "alpha",
            new_string: "scalpel",
          },
          config,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
        await expect(readFile(filePath, "utf8")).rejects.toThrow();
      } finally {
        if (previousPath === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = previousPath;
        }
        if (previousMode === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = previousMode;
        }
      }
    });
  });
});
