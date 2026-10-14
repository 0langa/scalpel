import { chmod, mkdir, readdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
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
import { skipWithoutFileSymlinks } from "../../helpers/symlinks.js";
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

  test("move and stat handle small binary files", async () => {
    await withTempDir(async (root) => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
      await writeFile(join(root, "logo.png"), bytes);

      const config = createConfig({ roots: [root] });
      const before = await statTool({ path: "logo.png" }, config);
      expect(before.ok).toBe(true);
      if (!before.ok) {
        return;
      }
      expect(before.data.textKind).toBe("binary");

      const result = await moveTool(
        {
          source: "logo.png",
          destination: "assets/logo.png",
          ...(before.data.sha256 === undefined ? {} : { expected_source_sha256: before.data.sha256 }),
        },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "assets", "logo.png"))).resolves.toEqual(bytes);
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

  test("move rejects moving a directory into itself without creating anything", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "pkg"), { recursive: true });
      await writeFile(join(root, "pkg", "index.ts"), "export {};\n", "utf8");

      const config = createConfig({ roots: [root] });
      const result = await moveTool({ source: "pkg", destination: "pkg/nested/pkg" }, config);

      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      await expect(stat(join(root, "pkg", "nested"))).rejects.toThrow();
      await expect(readFile(join(root, "pkg", "index.ts"), "utf8")).resolves.toBe("export {};\n");
    });
  });

  test("move allows a case-only rename of a directory", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "Docs"), { recursive: true });
      await writeFile(join(root, "Docs", "a.md"), "# a\n", "utf8");

      const config = createConfig({ roots: [root] });
      const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
      const result = await moveTool(
        { source: "Docs", destination: "docs", ...(caseInsensitive ? { overwrite: true } : {}) },
        config,
      );

      expect(result.ok).toBe(true);
      await expect(readFile(join(root, "docs", "a.md"), "utf8")).resolves.toBe("# a\n");
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

  test("move rejects a source that was externally replaced immediately before commit", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, "old.txt");
      await writeFile(sourcePath, "hello\n", "utf8");
      const config = createConfig({ roots: [root] });

      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousContent = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = sourcePath;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT = "external\n";

      try {
        const result = await moveTool({ source: "old.txt", destination: "new.txt" }, config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT", previousContent);
      }

      await expect(readFile(sourcePath, "utf8")).resolves.toBe("external\n");
      await expect(readFile(join(root, "new.txt"), "utf8")).rejects.toThrow();
    });
  });

  test("move rejects a destination that externally appeared immediately before commit", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, "old.txt");
      const destinationPath = join(root, "new.txt");
      await writeFile(sourcePath, "hello\n", "utf8");
      const config = createConfig({ roots: [root] });

      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousContent = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = destinationPath;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT = "external\n";

      try {
        const result = await moveTool({ source: "old.txt", destination: "new.txt" }, config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT", previousContent);
      }

      await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
      await expect(readFile(destinationPath, "utf8")).resolves.toBe("external\n");
    });
  });

  test("move rejects a destination parent directory that was replaced immediately before commit", async () => {
    await withTempDir(async (root) => {
      const sourcePath = join(root, "old.txt");
      const destinationDir = join(root, "nested");
      await writeFile(sourcePath, "hello\n", "utf8");
      const config = createConfig({ roots: [root] });

      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
      const previousContent = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = destinationDir;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "file";
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT = "external\n";

      try {
        const result = await moveTool({ source: "old.txt", destination: "nested/new.txt" }, config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE", previousMode);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT", previousContent);
      }

      await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
      await expect(readFile(destinationDir, "utf8")).resolves.toBe("external\n");
    });
  });

  test("move refuses a source whose directory was swapped for a link to a look-alike outside", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const sourceDir = join(root, "src");
        const sourcePath = join(sourceDir, "data.txt");
        await mkdir(sourceDir);
        await writeFile(sourcePath, "same\n", "utf8");
        // An outside file indistinguishable by content and mtime.
        const stamp = new Date("2026-01-01T00:00:00.000Z");
        await writeFile(join(outside, "data.txt"), "same\n", "utf8");
        await utimes(sourcePath, stamp, stamp);
        await utimes(join(outside, "data.txt"), stamp, stamp);
        const config = createConfig({ roots: [root] });

        const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
        const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
        const previousTarget = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET;
        process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = sourceDir;
        process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "junction";
        process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET = outside;

        try {
          const result = await moveTool({ source: "src/data.txt", destination: "moved.txt" }, config);
          expect(result).toMatchObject({ ok: false, error: { code: "SYMLINK_NOT_ALLOWED" } });
        } finally {
          restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
          restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE", previousMode);
          restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET", previousTarget);
        }

        await expect(readFile(join(outside, "data.txt"), "utf8")).resolves.toBe("same\n");
        await expect(stat(join(root, "moved.txt"))).rejects.toThrow();
      });
    });
  });

  test("move rejects a destination parent swapped for a junction or a new directory before commit", async () => {
    for (const mode of ["junction", "directory"] as const) {
      await withTempDir(async (root) => {
        await withTempDir(async (outside) => {
          const sourcePath = join(root, "old.txt");
          const destinationDir = join(root, "nested");
          await writeFile(sourcePath, "hello\n", "utf8");
          const config = createConfig({ roots: [root] });

          const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
          const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
          const previousTarget = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET;
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = destinationDir;
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = mode;
          process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET = outside;

          try {
            const result = await moveTool({ source: "old.txt", destination: "nested/new.txt" }, config);
            expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
          } finally {
            restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
            restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE", previousMode);
            restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET", previousTarget);
          }

          await expect(readFile(sourcePath, "utf8")).resolves.toBe("hello\n");
          await expect(readdir(outside)).resolves.toEqual([]);
        });
      });
    }
  });

  test("move into the top level of a root that is itself a symlink or junction", async () => {
    await withTempDir(async (base) => {
      const real = join(base, "real");
      const linkedRoot = join(base, "linked-root");
      await mkdir(join(real, "nested"), { recursive: true });
      await writeFile(join(real, "nested", "old.txt"), "hello\n", "utf8");
      await symlink(real, linkedRoot, process.platform === "win32" ? "junction" : "dir");

      const config = createConfig({ roots: [linkedRoot] });
      const result = await moveTool({ source: "nested/old.txt", destination: "new.txt" }, config);

      expect(result).toMatchObject({ ok: true, data: { applied: true } });
      await expect(readFile(join(real, "new.txt"), "utf8")).resolves.toBe("hello\n");
      await expect(stat(join(real, "nested", "old.txt"))).rejects.toThrow();
    });
  });

  test("move still detects a linked root that is swapped for another link before commit", async () => {
    await withTempDir(async (base) => {
      // Two roots, so the source stays valid and only the destination root's
      // link changes: the parent identity check is what has to catch it.
      const sourceRoot = join(base, "source-root");
      const real = join(base, "real");
      const other = join(base, "other");
      const linkedRoot = join(base, "linked-root");
      await mkdir(sourceRoot);
      await mkdir(real);
      await mkdir(other);
      await writeFile(join(sourceRoot, "old.txt"), "hello\n", "utf8");
      await symlink(real, linkedRoot, process.platform === "win32" ? "junction" : "dir");
      const config = createConfig({
        roots: [sourceRoot, linkedRoot],
        transactionDir: join(base, "transactions"),
      });

      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
      const previousTarget = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = linkedRoot;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "junction";
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET = other;

      try {
        const result = await moveTool(
          { source: join(sourceRoot, "old.txt"), destination: join(linkedRoot, "new.txt") },
          config,
        );
        expect(result).toMatchObject({ ok: false, error: { code: "CONCURRENCY_CONFLICT" } });
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE", previousMode);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET", previousTarget);
      }

      await expect(readFile(join(sourceRoot, "old.txt"), "utf8")).resolves.toBe("hello\n");
      await expect(readdir(other)).resolves.toEqual([]);
      await expect(readdir(real)).resolves.toEqual([]);
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

  test("grep prunes excluded directories including root hidden directories", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, ".git", "objects"), { recursive: true });
      await mkdir(join(root, "vendor", "lib"), { recursive: true });
      await writeFile(join(root, "src", "one.ts"), "needle one\n", "utf8");
      await writeFile(join(root, ".git", "objects", "hidden.txt"), "needle hidden\n", "utf8");
      await writeFile(join(root, "vendor", "lib", "vendored.ts"), "needle vendor\n", "utf8");

      const config = createConfig({ roots: [root], maxGrepResults: 10 });
      const result = await grepTool(
        {
          path: ".",
          pattern: "needle",
          include_globs: ["**/*.ts", "**/*.txt"],
          exclude_globs: ["**/.git/**", "**/vendor/**"],
        },
        config,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.matches.map((match) => match.relativePath)).toEqual(["src/one.ts"]);
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

  test("grep does not follow directory symlinks or junctions out of the workspace", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        await mkdir(join(root, "src"), { recursive: true });
        await writeFile(join(root, "src", "one.ts"), "needle one\n", "utf8");
        await writeFile(join(outside, "secret.txt"), "needle secret\n", "utf8");
        await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

        const config = createConfig({ roots: [root], maxGrepResults: 10 });
        const result = await grepTool({ path: ".", pattern: "needle" }, config);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.matches.map((match) => match.relativePath)).toEqual(["src/one.ts"]);
          expect(result.data.skipped_files).toMatchObject([{ relativePath: "linked", reason: "symlink" }]);
        }
      });
    });
  });

  test("grep searches a root that is itself a symlink or junction, without following links below it", async () => {
    await withTempDir(async (base) => {
      await withTempDir(async (outside) => {
        const real = join(base, "real");
        const linkedRoot = join(base, "linked-root");
        const linkType = process.platform === "win32" ? "junction" : "dir";
        await mkdir(join(real, "src"), { recursive: true });
        await writeFile(join(real, "src", "one.ts"), "needle one\n", "utf8");
        await writeFile(join(outside, "secret.txt"), "needle secret\n", "utf8");
        await symlink(outside, join(real, "linked"), linkType);
        await symlink(real, linkedRoot, linkType);

        const config = createConfig({ roots: [linkedRoot], maxGrepResults: 10 });
        const result = await grepTool({ path: ".", pattern: "needle" }, config);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.matches.map((match) => match.relativePath)).toEqual(["src/one.ts"]);
          expect(result.data.skipped_files).toMatchObject([{ relativePath: "linked", reason: "symlink" }]);
        }
      });
    });
  });

  test("grep fails clearly for a missing search path", async () => {
    await withTempDir(async (root) => {
      const config = createConfig({ roots: [root] });
      const result = await grepTool({ path: "missing", pattern: "needle" }, config);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  test("append and prepend stream large existing UTF-8 files", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "append-large.txt"), "0123456789\n", "utf8");
      await writeFile(join(root, "prepend-large.txt"), "0123456789\n", "utf8");

      const config = createConfig({ roots: [root], maxReadBytes: 5 });
      const append = await appendTool({ path: "append-large.txt", content: "more\n" }, config);
      const prepend = await prependTool({ path: "prepend-large.txt", content: "more\n" }, config);

      expect(append.ok).toBe(true);
      expect(prepend.ok).toBe(true);
      if (append.ok && prepend.ok) {
        expect(append.data.applied).toBe(true);
        expect(prepend.data.applied).toBe(true);
        expect(append.data.diff).toBeUndefined();
        expect(prepend.data.diff).toBeUndefined();
        expect(append.data.new_total_lines).toBe(2);
        expect(prepend.data.new_total_lines).toBe(2);
      }
      await expect(readFile(join(root, "append-large.txt"), "utf8")).resolves.toBe(
        "0123456789\nmore\n",
      );
      await expect(readFile(join(root, "prepend-large.txt"), "utf8")).resolves.toBe(
        "more\n0123456789\n",
      );
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

  test.skipIf(skipWithoutFileSymlinks)("journal never appends through a symlinked journal path", async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (outside) => {
        const outsideFile = join(outside, "profile.sh");
        const journalPath = join(root, ".scalpel-journal.jsonl");
        await writeFile(outsideFile, "export KEEP=1\n", "utf8");
        await symlink(outsideFile, journalPath, "file");
        await writeFile(join(root, "notes.txt"), "alpha\n", "utf8");

        const config = createConfig({ roots: [root], journalEnabled: true });
        const result = await appendTool({ path: "notes.txt", content: "beta\n" }, config);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.warnings).toEqual(["JOURNAL_WRITE_FAILED: journal path is a symlink"]);
        }
        await expect(readFile(outsideFile, "utf8")).resolves.toBe("export KEEP=1\n");
      });
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

  test.skipIf(process.getuid?.() === 0)(
    "mutations refuse read-only files with PERMISSION_DENIED instead of replacing them",
    async () => {
      await withTempDir(async (root) => {
        const filePath = join(root, "readonly.txt");
        await writeFile(filePath, "alpha\n", "utf8");
        await chmod(filePath, 0o444);

        try {
          const config = createConfig({ roots: [root] });
          const streaming = createConfig({ roots: [root], maxReadBytes: 4 });
          const results = [
            await patchTool({ path: "readonly.txt", old_string: "alpha", new_string: "beta" }, config),
            await appendTool({ path: "readonly.txt", content: "more\n" }, config),
            await appendTool({ path: "readonly.txt", content: "more\n" }, streaming),
          ];

          for (const result of results) {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("PERMISSION_DENIED");
            }
          }
          await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\n");
          expect((await stat(filePath)).mode & 0o222).toBe(0);
        } finally {
          await chmod(filePath, 0o644);
        }
      });
    },
  );

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

  test("mutations reject files changed by external interference after commit", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "externally-changed-after-commit.txt");
      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH;
      const previousContent = process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_CONTENT;
      await writeFile(filePath, "alpha\n", "utf8");

      process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH = filePath;
      process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_CONTENT = "external\n";

      try {
        const config = createConfig({ roots: [root] });
        const result = await patchTool(
          {
            path: "externally-changed-after-commit.txt",
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
          delete process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH = previousPath;
        }
        if (previousContent === undefined) {
          delete process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_CONTENT;
        } else {
          process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_CONTENT = previousContent;
        }
      }
    });
  });

  test.skipIf(skipWithoutFileSymlinks)("mutations reject symlink swaps before commit", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "symlink-before.txt");
      const targetPath = join(root, "outside-target.txt");
      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE;
      const previousTarget = process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET;
      await writeFile(filePath, "alpha\n", "utf8");
      await writeFile(targetPath, "external\n", "utf8");

      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH = filePath;
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE = "symlink";
      process.env.SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET = targetPath;

      try {
        const config = createConfig({ roots: [root] });
        const result = await patchTool(
          {
            path: "symlink-before.txt",
            old_string: "alpha",
            new_string: "scalpel",
          },
          config,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE", previousMode);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET", previousTarget);
      }
    });
  });

  test.skipIf(skipWithoutFileSymlinks)("mutations reject symlink swaps after commit", async () => {
    await withTempDir(async (root) => {
      const filePath = join(root, "symlink-after.txt");
      const targetPath = join(root, "outside-target-after.txt");
      const previousPath = process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH;
      const previousMode = process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_MODE;
      const previousTarget = process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_SYMLINK_TARGET;
      await writeFile(filePath, "alpha\n", "utf8");
      await writeFile(targetPath, "scalpel\n", "utf8");

      process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH = filePath;
      process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_MODE = "symlink";
      process.env.SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_SYMLINK_TARGET = targetPath;

      try {
        const config = createConfig({ roots: [root] });
        const result = await patchTool(
          {
            path: "symlink-after.txt",
            old_string: "alpha",
            new_string: "scalpel",
          },
          config,
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONCURRENCY_CONFLICT");
        }
      } finally {
        restoreEnv("SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH", previousPath);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_MODE", previousMode);
        restoreEnv("SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_SYMLINK_TARGET", previousTarget);
      }
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}
