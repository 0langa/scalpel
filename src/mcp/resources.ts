import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { ScalpelConfig } from "../core/config.js";
import { configTool } from "../tools/config.js";

type TextResource = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  read: (uri: URL) => Promise<ReadResourceResult> | ReadResourceResult;
};

const docResources = [
  {
    name: "scalpel_safety_model",
    uri: "scalpel://docs/safety",
    title: "Scalpel Safety Model",
    description: "Workspace confinement, mutation safety, journaling, and known safety boundaries.",
    path: "../../docs/SAFETY_MODEL.md"
  },
  {
    name: "scalpel_tool_contracts",
    uri: "scalpel://docs/tool-contracts",
    title: "Scalpel Tool Contracts",
    description: "Current public contracts for Scalpel MCP tools.",
    path: "../../docs/TOOL_CONTRACTS.md"
  },
  {
    name: "scalpel_testing_reliability",
    uri: "scalpel://docs/testing",
    title: "Scalpel Testing And Reliability",
    description: "Verification commands, smoke coverage, and reliability-suite posture.",
    path: "../../docs/TESTING_AND_RELIABILITY.md"
  }
] as const;

export function registerResources(server: McpServer, config: ScalpelConfig): void {
  for (const resource of resources(config)) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType
      },
      resource.read
    );
  }
}

function resources(config: ScalpelConfig): TextResource[] {
  return [
    ...docResources.map((resource) => ({
      name: resource.name,
      uri: resource.uri,
      title: resource.title,
      description: resource.description,
      mimeType: "text/markdown",
      read: async (uri: URL) => textContents(uri, await readFile(resourcePath(resource.path), "utf8"), "text/markdown")
    })),
    {
      name: "scalpel_current_config",
      uri: "scalpel://config/current",
      title: "Scalpel Current Config",
      description: "Live Scalpel server configuration for this MCP process.",
      mimeType: "application/json",
      read: (uri: URL) => {
        const configResult = configTool(config);
        const content = configResult.ok ? configResult.data : { error: configResult.error };
        return textContents(uri, `${JSON.stringify(content, null, 2)}\n`, "application/json");
      }
    }
  ];
}

function resourcePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function textContents(uri: URL, text: string, mimeType: string): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text
      }
    ]
  };
}
