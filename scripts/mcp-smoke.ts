import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Check = {
  name: string;
  passed: boolean;
  detail?: string;
};

const checks: Check[] = [];

async function main(): Promise<void> {
  const root = resolve(process.env.SCALPEL_SMOKE_ROOT ?? (await mkdtemp(join(tmpdir(), "scalpel-smoke-"))));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(process.env.SCALPEL_SMOKE_OUT ?? join("tmp", "mcp-smoke", stamp));
  const journalPath = join(outDir, "journal.jsonl");
  await mkdir(root, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const serverPath = resolve("dist", "index.js");
  if (!existsSync(serverPath)) {
    throw new Error("dist/index.js not found. Run pnpm build before pnpm test:mcp-smoke.");
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALPEL_ROOTS: root,
      SCALPEL_JOURNAL_ENABLED: "true",
      SCALPEL_JOURNAL_PATH: journalPath
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "scalpel-smoke", version: "0.1.0" });

  try {
    await client.connect(transport);
    await runSmoke(client, root, journalPath);
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }

  const passed = checks.filter((check) => check.passed).length;
  const report = {
    root,
    outDir,
    passed,
    total: checks.length,
    checks
  };
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "report.md"), renderMarkdown(report), "utf8");

  if (passed !== checks.length) {
    throw new Error(`MCP smoke failed: ${String(passed)}/${String(checks.length)} checks passed. Report: ${join(outDir, "report.md")}`);
  }

  console.log(`MCP smoke passed: ${String(passed)}/${String(checks.length)}. Report: ${join(outDir, "report.md")}`);
}

async function runSmoke(client: Client, root: string, journalPath: string): Promise<void> {
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  const canonical = [
    "append",
    "batch_edit",
    "config",
    "create",
    "delete_range",
    "diff",
    "grep",
    "insert",
    "list_dir",
    "move",
    "patch",
    "prepend",
    "read",
    "read_chunk",
    "replace_between_markers",
    "stat"
  ];
  check("all canonical tools listed", canonical.every((name) => names.has(name)));
  check("all namespaced aliases listed", canonical.every((name) => names.has(`scalpel_${name}`)));

  const resources = await client.listResources();
  const resourceUris = new Set(resources.resources.map((resource) => resource.uri));
  check("expected resources listed", ["scalpel://docs/safety", "scalpel://docs/tool-contracts", "scalpel://docs/testing", "scalpel://config/current"].every((uri) => resourceUris.has(uri)));
  const safety = await client.readResource({ uri: "scalpel://docs/safety" });
  check("safety resource readable", JSON.stringify(safety.contents).includes("Safety Model"));

  await callOk(client, "config", {}, "config");
  await callOk(client, "create", { path: "work.txt", content: "alpha\nbeta\n" }, "create");
  await callOk(client, "stat", { path: "work.txt" }, "stat");
  await callOk(client, "read", { path: "work.txt" }, "read");
  await callOk(client, "read_chunk", { path: "work.txt", max_bytes: 5 }, "read_chunk");
  await callOk(client, "diff", { path: "work.txt", proposed_content: "alpha\ngamma\n" }, "diff");
  await callOk(client, "append", { path: "work.txt", content: "tail\n", dry_run: true }, "append dry-run");
  await callOk(client, "append", { path: "work.txt", content: "tail\n" }, "append");
  await callOk(client, "prepend", { path: "work.txt", content: "head\n", dry_run: true }, "prepend dry-run");
  await callOk(client, "prepend", { path: "work.txt", content: "head\n" }, "prepend");
  await callOk(client, "insert", { path: "work.txt", line: 2, content: "inserted\n", dry_run: true }, "insert dry-run");
  await callOk(client, "insert", { path: "work.txt", line: 2, content: "inserted\n" }, "insert");
  await callOk(client, "patch", { path: "work.txt", old_string: "beta", new_string: "gamma" }, "patch");
  await callOk(client, "batch_edit", {
    path: "work.txt",
    edits: [{ old_string: "gamma", new_string: "delta" }]
  }, "batch_edit");
  await callOk(client, "create", { path: "markers.txt", content: "start\nold\nend\n" }, "create markers");
  await callOk(client, "replace_between_markers", {
    path: "markers.txt",
    start_marker: "start",
    end_marker: "end",
    new_content: "new\n",
    dry_run: true
  }, "replace_between_markers dry-run");
  await callOk(client, "replace_between_markers", {
    path: "markers.txt",
    start_marker: "start",
    end_marker: "end",
    new_content: "new\n"
  }, "replace_between_markers");
  await callOk(client, "delete_range", { path: "markers.txt", start_line: 2, end_line: 2, dry_run: true }, "delete_range dry-run");
  await callOk(client, "delete_range", { path: "markers.txt", start_line: 2, end_line: 2 }, "delete_range");
  await callOk(client, "grep", { path: ".", pattern: "delta", max_results: 10 }, "grep");
  await callOk(client, "list_dir", { path: "." }, "list_dir");
  await callOk(client, "create", { path: "move-source.txt", content: "move\n" }, "create move source");
  await callOk(client, "move", { source: "move-source.txt", destination: "move-target.txt", dry_run: true }, "move dry-run");
  await callOk(client, "move", { source: "move-source.txt", destination: "move-target.txt" }, "move");
  await callOk(client, "scalpel_read", { path: "work.txt", start_line: 1, end_line: 1 }, "scalpel_read alias");

  const structuredError = await client.callTool({
    name: "patch",
    arguments: { path: "work.txt", old_string: "missing", new_string: "nope" }
  });
  check("structured error payload", structuredError.isError === true && hasErrorCode(structuredError.structuredContent, "STRING_NOT_FOUND"));

  await writeFile(join(root, "large.txt"), "x".repeat(1024 * 1024 * 3), "utf8");
  const large = await client.callTool({ name: "read", arguments: { path: "large.txt" } });
  check("large file returns FILE_TOO_LARGE", large.isError === true && hasErrorCode(large.structuredContent, "FILE_TOO_LARGE"));

  await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
  const binary = await client.callTool({ name: "read", arguments: { path: "binary.dat" } });
  check("binary file returns BINARY_FILE_NOT_SUPPORTED", binary.isError === true && hasErrorCode(binary.structuredContent, "BINARY_FILE_NOT_SUPPORTED"));

  const journal = await readFile(journalPath, "utf8");
  check("journal exists and omits content", journal.includes("\"tool\":\"create\"") && !journal.includes("alpha"));
}

async function callOk(client: Client, name: string, args: Record<string, unknown>, checkName: string): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  check(checkName, result.isError !== true, JSON.stringify(result.structuredContent ?? result.content));
}

function hasErrorCode(structuredContent: unknown, code: string): boolean {
  return (
    typeof structuredContent === "object" &&
    structuredContent !== null &&
    "error" in structuredContent &&
    typeof structuredContent.error === "object" &&
    structuredContent.error !== null &&
    "code" in structuredContent.error &&
    structuredContent.error.code === code
  );
}

function check(name: string, passed: boolean, detail?: string): void {
  checks.push({ name, passed, ...(detail !== undefined && !passed ? { detail } : {}) });
}

function renderMarkdown(report: { root: string; outDir: string; passed: number; total: number; checks: Check[] }): string {
  const lines = [
    "# Scalpel MCP Smoke Report",
    "",
    `Root: ${report.root}`,
    `Output: ${report.outDir}`,
    `Checks: ${String(report.passed)}/${String(report.total)} passed`,
    ""
  ];
  for (const [index, item] of report.checks.entries()) {
    lines.push(`- ${String(index + 1)}. ${item.passed ? "PASS" : "FAIL"} ${item.name}${item.detail === undefined ? "" : `: ${item.detail}`}`);
  }
  return `${lines.join("\n")}\n`;
}

await main();
