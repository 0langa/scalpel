import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { ScalpelConfig } from "../core/config.js";
import { appendTool } from "../tools/append.js";
import { batchEditTool } from "../tools/batch-edit.js";
import { createTool } from "../tools/create.js";
import { deleteRangeTool } from "../tools/delete-range.js";
import { diffTool } from "../tools/diff.js";
import { grepTool } from "../tools/grep.js";
import { insertTool } from "../tools/insert.js";
import { listDirTool } from "../tools/list-dir.js";
import { moveTool } from "../tools/move.js";
import { patchTool } from "../tools/patch.js";
import { prependTool } from "../tools/prepend.js";
import { readTool } from "../tools/read.js";
import { replaceBetweenMarkersTool } from "../tools/replace-between-markers.js";
import { statTool } from "../tools/stat.js";
import { mutatingAnnotations, readOnlyAnnotations } from "./annotations.js";
import { toCallToolResult } from "./result.js";

const pathSchema = z.object({
  path: z.string().min(1)
});

export function registerTools(server: McpServer, config: ScalpelConfig): void {
  server.registerTool(
    "stat",
    {
      title: "Stat",
      description: "Return metadata about a workspace file or directory.",
      inputSchema: pathSchema,
      outputSchema: z.object({
        absolutePath: z.string(),
        isDirectory: z.boolean(),
        sizeBytes: z.number(),
        lineCount: z.number(),
        sha256: z.string().optional(),
        mtimeMs: z.number()
      }),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await statTool(args, config))
  );

  server.registerTool(
    "read",
    {
      title: "Read",
      description: "Read a workspace file, optionally by inclusive 1-based line range.",
      inputSchema: z.object({
        path: z.string().min(1),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        content: z.string(),
        lines: z.number(),
        size_bytes: z.number(),
        range: z.object({
          start_line: z.number(),
          end_line: z.number()
        }),
        sha256: z.string(),
        eol: z.enum(["\n", "\r\n", "mixed", "none"])
      }),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await readTool(args, config))
  );

  server.registerTool(
    "list_dir",
    {
      title: "List Directory",
      description: "List direct children of a workspace directory.",
      inputSchema: pathSchema,
      outputSchema: z.object({
        absolutePath: z.string(),
        entries: z.array(
          z.object({
            name: z.string(),
            path: z.string(),
            relativePath: z.string(),
            isDirectory: z.boolean(),
            sizeBytes: z.number()
          })
        )
      }),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await listDirTool(args, config))
  );

  server.registerTool(
    "diff",
    {
      title: "Diff",
      description: "Compute a unified diff between the current file and proposed content.",
      inputSchema: z.object({
        path: z.string().min(1),
        proposed_content: z.string()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        diff: z.string(),
        lines_added: z.number(),
        lines_removed: z.number()
      }),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await diffTool(args, config))
  );

  server.registerTool(
    "grep",
    {
      title: "Grep",
      description: "Search recursively for literal or regex matches within the workspace.",
      inputSchema: z.object({
        path: z.string().min(1),
        pattern: z.string().min(1),
        regex: z.boolean().optional(),
        max_results: z.number().int().positive().optional()
      }),
      outputSchema: z.object({
        matches: z.array(
          z.object({
            path: z.string(),
            relativePath: z.string(),
            line: z.number(),
            content: z.string()
          })
        ),
        total_matches: z.number()
      }),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await grepTool(args, config))
  );

  server.registerTool(
    "create",
    {
      title: "Create",
      description: "Create a new file with exact content.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        overwrite: z.boolean().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        lines: z.number(),
        size_bytes: z.number()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await createTool(args, config))
  );

  server.registerTool(
    "patch",
    {
      title: "Patch",
      description: "Replace an exact string match inside a file.",
      inputSchema: z.object({
        path: z.string().min(1),
        old_string: z.string(),
        new_string: z.string(),
        occurrence: z.union([z.literal("unique"), z.literal("first"), z.literal("all"), z.number().int().positive()]).optional(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        replacements: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        sha256: z.string()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await patchTool(args, config))
  );

  server.registerTool(
    "batch_edit",
    {
      title: "Batch Edit",
      description: "Apply multiple exact replacements atomically to one file.",
      inputSchema: z.object({
        path: z.string().min(1),
        edits: z.array(
          z.object({
            old_string: z.string(),
            new_string: z.string(),
            occurrence: z.union([z.literal("unique"), z.literal("first"), z.literal("all"), z.number().int().positive()]).optional()
          })
        ).min(1),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        edit_count: z.number(),
        replacements_total: z.number(),
        diff: z.string(),
        applied: z.boolean()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await batchEditTool(args, config))
  );

  server.registerTool(
    "insert",
    {
      title: "Insert",
      description: "Insert content at a line, before a marker, or after a marker.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        line: z.number().int().positive().optional(),
        after_marker: z.string().optional(),
        before_marker: z.string().optional(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        inserted_at_line: z.number(),
        diff: z.string(),
        applied: z.boolean()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await insertTool(args, config))
  );

  server.registerTool(
    "delete_range",
    {
      title: "Delete Range",
      description: "Delete an inclusive line range or marker-bounded block.",
      inputSchema: z.object({
        path: z.string().min(1),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
        start_marker: z.string().optional(),
        end_marker: z.string().optional(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        deleted_lines: z.number(),
        diff: z.string(),
        applied: z.boolean()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await deleteRangeTool(args, config))
  );

  server.registerTool(
    "replace_between_markers",
    {
      title: "Replace Between Markers",
      description: "Replace content between two unique markers while preserving the marker lines.",
      inputSchema: z.object({
        path: z.string().min(1),
        start_marker: z.string().min(1),
        end_marker: z.string().min(1),
        new_content: z.string(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        replaced_lines: z.number(),
        diff: z.string(),
        applied: z.boolean()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await replaceBetweenMarkersTool(args, config))
  );

  server.registerTool(
    "append",
    {
      title: "Append",
      description: "Append content to the end of a file, creating it if needed.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        lines_added: z.number(),
        new_total_lines: z.number()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await appendTool(args, config))
  );

  server.registerTool(
    "prepend",
    {
      title: "Prepend",
      description: "Prepend content to the beginning of a file, creating it if needed.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: z.object({
        absolutePath: z.string(),
        lines_added: z.number(),
        new_total_lines: z.number()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await prependTool(args, config))
  );

  server.registerTool(
    "move",
    {
      title: "Move",
      description: "Move or rename a file or directory within the configured roots.",
      inputSchema: z.object({
        source: z.string().min(1),
        destination: z.string().min(1),
        overwrite: z.boolean().optional()
      }),
      outputSchema: z.object({
        source: z.string(),
        destination: z.string()
      }),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await moveTool(args, config))
  );
}
