import { describe, expect, test } from "vitest";
import * as z from "zod/v4";

import { withErrorOutput } from "../../../src/mcp/output-schema.js";

describe("output schema compatibility", () => {
  test("advertises a permissive object schema for success and structured errors", () => {
    const schema = withErrorOutput(z.object({ value: z.string() }));

    expect(schema.safeParse({ value: "ok" }).success).toBe(true);
    expect(schema.safeParse({ error: { code: "STRING_NOT_FOUND" } }).success).toBe(true);
  });
});
