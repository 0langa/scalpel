import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import type { ScalpelConfig } from "../core/config.js";
import { appendTool } from "../tools/append.js";
import { batchEditTool } from "../tools/batch-edit.js";
import { configTool } from "../tools/config.js";
import { createTool } from "../tools/create.js";
import { deleteRangeTool } from "../tools/delete-range.js";
import { diffTool } from "../tools/diff.js";
import { grepTool } from "../tools/grep.js";
import { insertTool } from "../tools/insert.js";
import { listDirTool } from "../tools/list-dir.js";
import { moveTool } from "../tools/move.js";
import { patchTool } from "../tools/patch.js";
import { prependTool } from "../tools/prepend.js";
import { readChunkTool } from "../tools/read-chunk.js";
import { readTool } from "../tools/read.js";
import { replaceBetweenMarkersTool } from "../tools/replace-between-markers.js";
import { statTool } from "../tools/stat.js";
import { mutatingAnnotations, readOnlyAnnotations } from "./annotations.js";
import { toCallToolResult } from "./result.js";

const pathSchema = z.object({
  path: z.string().min(1)
});

function withErrorOutput(_schema: z.ZodType): z.ZodType {
  // SDK v1.29 validates every structuredContent response against outputSchema.
  // Strict success/error unions currently fail inside the SDK, so keep runtime
  // structured errors and advertise a permissive schema until that is fixed.
  void _schema;
  return z.object({}).catchall(z.unknown());
}

type RegisterToolOptions<InputSchema extends z.ZodType = z.ZodType> = {
  title?: string;
  description?: string;
  inputSchema?: InputSchema;
  outputSchema?: z.ZodType;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

function registerScalpelTool<InputSchema extends z.ZodType>(
  server: McpServer,
  name: string,
  options: RegisterToolOptions<InputSchema>,
  handler: ToolCallback<InputSchema>
): void {
  server.registerTool(name, options, handler);
  server.registerTool(
    `scalpel_${name}`,
    {
      ...options,
      title: `Scalpel ${options.title ?? name}`,
      description: `Alias of \`${name}\`; prefer this in multi-MCP contexts. ${options.description ?? ""}`.trim()
    },
    handler
  );
}

export function registerTools(server: McpServer, config: ScalpelConfig): void {
  registerScalpelTool(
    server,
    "config",
    {
      title: "Config",
      description: "Return the live Scalpel configuration for this MCP server process.",
      inputSchema: z.object({}),
      outputSchema: withErrorOutput(z.object({
        roots: z.array(z.string()),
        allowHiddenPaths: z.boolean(),
        maxReadBytes: z.number(),
        maxDiffBytes: z.number(),
        maxGrepResults: z.number(),
        journalEnabled: z.boolean(),
        journalPath: z.string().optional(),
        logLevel: z.enum(["silent", "error", "info", "debug"]),
        cwd: z.string(),
        env: z.object({
          SCALPEL_ROOTS: z.string().optional(),
          SCALPEL_JOURNAL_ENABLED: z.string().optional(),
          SCALPEL_JOURNAL_PATH: z.string().optional(),
          pathDelimiter: z.string()
        })
      })),
      annotations: readOnlyAnnotations
    },
    () => toCallToolResult(configTool(config))
  );

  registerScalpelTool(
    server,
    "stat",
    {
      title: "Stat",
      description: "Return metadata about a workspace file or directory.",
      inputSchema: pathSchema,
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        isDirectory: z.boolean(),
        sizeBytes: z.number(),
        lineCount: z.number(),
        sha256: z.string().optional(),
        mtimeMs: z.number(),
        textKind: z.enum(["utf8", "binary", "non_utf8", "unknown"])
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await statTool(args, config))
  );

  registerScalpelTool(
    server,
    "read",
    {
      title: "Read",
      description: "Read a workspace file, optionally by inclusive 1-based line range.",
      inputSchema: z.object({
        path: z.string().min(1),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional()
      }),
      outputSchema: withErrorOutput(z.object({
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
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await readTool(args, config))
  );

  registerScalpelTool(
    server,
    "read_chunk",
    {
      title: "Read Chunk",
      description: "Read a bounded UTF-8-safe byte chunk from a workspace file.",
      inputSchema: z.object({
        path: z.string().min(1),
        offset_bytes: z.number().int().nonnegative().optional(),
        max_bytes: z.number().int().positive().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        content: z.string(),
        offset_bytes: z.number(),
        start_offset_bytes: z.number(),
        next_offset_bytes: z.number(),
        max_bytes: z.number(),
        size_bytes: z.number(),
        truncated: z.boolean(),
        sha256: z.string().optional()
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await readChunkTool(args, config))
  );

  registerScalpelTool(
    server,
    "list_dir",
    {
      title: "List Directory",
      description: "List direct children of a workspace directory.",
      inputSchema: pathSchema,
      outputSchema: withErrorOutput(z.object({
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
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await listDirTool(args, config))
  );

  registerScalpelTool(
    server,
    "diff",
    {
      title: "Diff",
      description: "Compute a unified diff between the current file and proposed content.",
      inputSchema: z.object({
        path: z.string().min(1),
        proposed_content: z.string()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        diff: z.string(),
        lines_added: z.number(),
        lines_removed: z.number()
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await diffTool(args, config))
  );

  registerScalpelTool(
    server,
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
      outputSchema: withErrorOutput(z.object({
        matches: z.array(
          z.object({
            path: z.string(),
            relativePath: z.string(),
            line: z.number(),
            content: z.string()
          })
        ),
        total_matches: z.number(),
        skipped_files: z.array(
          z.object({
            path: z.string(),
            relativePath: z.string(),
            reason: z.enum(["too_large", "binary", "non_utf8", "unreadable"])
          })
        )
      })),
      annotations: readOnlyAnnotations
    },
    async (args) => toCallToolResult(await grepTool(args, config))
  );

  registerScalpelTool(
    server,
    "create",
    {
      title: "Create",
      description: "Create a new file with exact content.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        overwrite: z.boolean().optional(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        lines: z.number(),
        size_bytes: z.number(),
        diff: z.string().optional(),
        applied: z.boolean().optional(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await createTool(args, config))
  );

  registerScalpelTool(
    server,
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
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        replacements: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        sha256: z.string(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await patchTool(args, config))
  );

  registerScalpelTool(
    server,
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
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        edit_count: z.number(),
        replacements_total: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await batchEditTool(args, config))
  );

  registerScalpelTool(
    server,
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
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        inserted_at_line: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await insertTool(args, config))
  );

  registerScalpelTool(
    server,
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
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        deleted_lines: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await deleteRangeTool(args, config))
  );

  registerScalpelTool(
    server,
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
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        replaced_lines: z.number(),
        diff: z.string(),
        applied: z.boolean(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await replaceBetweenMarkersTool(args, config))
  );

  registerScalpelTool(
    server,
    "append",
    {
      title: "Append",
      description: "Append content to the end of a file, creating it if needed.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        lines_added: z.number(),
        new_total_lines: z.number(),
        diff: z.string().optional(),
        applied: z.boolean().optional(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await appendTool(args, config))
  );

  registerScalpelTool(
    server,
    "prepend",
    {
      title: "Prepend",
      description: "Prepend content to the beginning of a file, creating it if needed.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        dry_run: z.boolean().optional(),
        expected_sha256: z.string().optional(),
        expected_mtime_ms: z.number().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        absolutePath: z.string(),
        lines_added: z.number(),
        new_total_lines: z.number(),
        diff: z.string().optional(),
        applied: z.boolean().optional(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await prependTool(args, config))
  );

  registerScalpelTool(
    server,
    "move",
    {
      title: "Move",
      description: "Move or rename a file or directory within the configured roots.",
      inputSchema: z.object({
        source: z.string().min(1),
        destination: z.string().min(1),
        overwrite: z.boolean().optional(),
        dry_run: z.boolean().optional(),
        expected_source_sha256: z.string().optional(),
        expected_source_mtime_ms: z.number().optional(),
        expected_destination_sha256: z.string().optional(),
        expected_destination_mtime_ms: z.number().optional()
      }),
      outputSchema: withErrorOutput(z.object({
        source: z.string(),
        destination: z.string(),
        applied: z.boolean().optional(),
        source_exists: z.boolean().optional(),
        destination_exists: z.boolean().optional(),
        would_overwrite: z.boolean().optional(),
        warnings: z.array(z.string()).optional()
      })),
      annotations: mutatingAnnotations
    },
    async (args) => toCallToolResult(await moveTool(args, config))
  );
}
