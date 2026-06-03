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
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: errorResult.error }) }],
    structuredContent: {
      ok: false,
      error: errorResult.error
    },
    isError: true
  };
}

export function toCallToolResult(
  result: { ok: true; data: Record<string, unknown> } | FailureResult
): CallToolResult {
  return result.ok ? toolSuccess(result.data) : toolFailure(result);
}
