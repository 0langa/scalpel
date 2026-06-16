import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { type ScalpelConfig } from "../core/config.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./register-tools.js";

export function createScalpelServer(config: ScalpelConfig): McpServer {
  const server = new McpServer(
    {
      name: "scalpel",
      version: "0.1.0"
    },
    {
      instructions:
        "Use these tools for precise workspace file edits. Prefer dry_run before mutation. Exact-string tools fail on ambiguity by default. All operations are confined to configured workspace roots."
    }
  );

  registerTools(server, config);
  registerResources(server, config);
  return server;
}
