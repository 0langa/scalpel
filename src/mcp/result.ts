import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { FailureResult } from "../core/errors.js";

export function toolSuccess(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: { ...data }
  };
}

export function toolFailure(errorResult: FailureResult): CallToolResult {
  return {
    content: [{ type: "text", text: formatErrorText(errorResult) }],
    structuredContent: { error: { ...errorResult.error } },
    isError: true
  };
}

function formatErrorText(errorResult: FailureResult): string {
  const { code, message, path, details } = errorResult.error;
  let text = `[${code}] ${message}`;

  if (path !== undefined) {
    text += ` (${path})`;
  }

  if (details !== undefined) {
    text += `\n${JSON.stringify(details)}`;
  }

  return text;
}

export function toCallToolResult(
  result: { ok: true; data: Record<string, unknown> } | FailureResult
): CallToolResult {
  return result.ok ? toolSuccess(result.data) : toolFailure(result);
}
