import { join, resolve } from "node:path";

export type ScalpelConfig = {
  roots: string[];
  allowHiddenPaths: boolean;
  maxReadBytes: number;
  maxDiffBytes: number;
  maxGrepResults: number;
  durability: "default" | "strict";
  transactionDir: string;
  journalEnabled: boolean;
  journalPath?: string | undefined;
  logLevel: "silent" | "error" | "info" | "debug";
};

export function createConfig(overrides: Partial<ScalpelConfig> = {}): ScalpelConfig {
  return {
    roots: (overrides.roots ?? [process.cwd()]).map((root) => resolve(root)),
    allowHiddenPaths: overrides.allowHiddenPaths ?? true,
    maxReadBytes: overrides.maxReadBytes ?? 1024 * 1024 * 2,
    maxDiffBytes: overrides.maxDiffBytes ?? 1024 * 1024 * 2,
    maxGrepResults: overrides.maxGrepResults ?? 200,
    durability: overrides.durability ?? "default",
    transactionDir: overrides.transactionDir ?? join(resolve(overrides.roots?.[0] ?? process.cwd()), ".scalpel-transactions"),
    journalEnabled: overrides.journalEnabled ?? false,
    journalPath: overrides.journalPath,
    logLevel: overrides.logLevel ?? "error"
  };
}
