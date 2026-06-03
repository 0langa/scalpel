/**
 * Type Definitions
 * Scalpel Reliability Test Suite - Long Lines File
 *
 * This file contains very long single lines to test read, diff, and patch
 * behavior when line length exceeds typical terminal widths.
 */

export interface FileOperationResult<T = unknown> {
  success: boolean;
  data: T;
  error: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export type EditTool = "patch" | "batch_edit" | "insert" | "delete_range" | "replace_between_markers" | "append" | "prepend";

export type ReadTool = "read" | "stat" | "list_dir" | "grep";

export interface BatchEditOperation { old_string: string; new_string: string; path: string; }

export interface InsertOperation { path: string; line?: number; after_marker?: string; before_marker?: string; content: string; }

export interface DeleteRangeOperation { path: string; start_line?: number; end_line?: number; start_marker?: string; end_marker?: string; }

export interface ReplaceBetweenMarkersOperation { path: string; start_marker: string; end_marker: string; new_content: string; }
