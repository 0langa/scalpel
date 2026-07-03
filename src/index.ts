#!/usr/bin/env node
import { delimiter } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createConfig } from "./core/config.js";
import { recoverWriteTransactions } from "./core/write-transaction.js";
import { createLogger } from "./infra/logger.js";
import { createScalpelServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const configInput = {
    roots: loadRoots(),
    journalEnabled: process.env.SCALPEL_JOURNAL_ENABLED === "1" || process.env.SCALPEL_JOURNAL_ENABLED === "true",
    durability: process.env.SCALPEL_DURABILITY === "strict" ? "strict" as const : "default" as const,
    ...(process.env.SCALPEL_TRANSACTION_DIR === undefined
      ? {}
      : { transactionDir: process.env.SCALPEL_TRANSACTION_DIR })
  };

  const config = createConfig(
    process.env.SCALPEL_JOURNAL_PATH === undefined
      ? configInput
      : { ...configInput, journalPath: process.env.SCALPEL_JOURNAL_PATH }
  );

  const logger = createLogger(config.logLevel);
  const recovery = await recoverWriteTransactions(config.transactionDir);
  if (recovery.scanned > 0) {
    const hasProblems = recovery.unrecoverable > 0 || recovery.warnings.length > 0;
    logger[hasProblems ? "error" : "info"](
      { recovery },
      "scalpel startup transaction recovery"
    );
  }

  const server = createScalpelServer(config);
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    void (async () => {
      await server.close();
      process.exit(0);
    })();
  });

  await server.connect(transport);
}

function loadRoots(): string[] {
  const raw = process.env.SCALPEL_ROOTS;
  if (raw === undefined || raw.trim() === "") {
    return [process.cwd()];
  }

  return raw
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

void main();
