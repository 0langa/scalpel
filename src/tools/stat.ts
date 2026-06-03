import { type ScalpelConfig } from "../core/config.js";
import { readPathStat } from "../core/file-metadata.js";
import { resolveWorkspacePath } from "../core/path-policy.js";

export async function statTool(
  input: { path: string },
  config: ScalpelConfig
): ReturnType<typeof readPathStat> {
  const resolved = await resolveWorkspacePath({
    path: input.path,
    roots: config.roots,
    operation: "read"
  });

  if (!resolved.ok) {
    return resolved;
  }

  return readPathStat(resolved.data);
}
