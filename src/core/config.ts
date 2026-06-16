import { resolve } from "node:path";

export type ScalpelConfig = {
  roots: string[];
  allowHiddenPaths: boolean;
  maxReadBytes: number;
  maxDiffBytes: number;
  maxGrepResults: number;
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
    journalEnabled: overrides.journalEnabled ?? false,
    journalPath: overrides.journalPath,
    logLevel: overrides.logLevel ?? "error"
  };
}
