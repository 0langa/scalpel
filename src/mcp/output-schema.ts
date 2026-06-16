import * as z from "zod/v4";

export function withErrorOutput(_schema: z.ZodType): z.ZodType {
  // SDK v1.29 validates successful structuredContent against outputSchema and
  // skips validation for isError results. Strict success/error unions have been
  // fragile across SDK/client combinations, so advertise a permissive object
  // schema while returning precise runtime structuredContent. Keep this helper
  // as the single compatibility switch for future precise schema restoration.
  void _schema;
  return z.object({}).catchall(z.unknown());
}
