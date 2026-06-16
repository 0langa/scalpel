import { delimiter } from "node:path";

import { type ScalpelConfig } from "../core/config.js";
import { success, type DomainResult } from "../core/errors.js";

type ConfigResult = {
  roots: string[];
  allowHiddenPaths: boolean;
  maxReadBytes: number;
  maxDiffBytes: number;
  maxGrepResults: number;
  journalEnabled: boolean;
  journalPath?: string;
  logLevel: ScalpelConfig["logLevel"];
  cwd: string;
  env: {
    SCALPEL_ROOTS?: string;
    SCALPEL_JOURNAL_ENABLED?: string;
    SCALPEL_JOURNAL_PATH?: string;
    pathDelimiter: string;
  };
};

export function configTool(config: ScalpelConfig): DomainResult<ConfigResult> {
  const env: ConfigResult["env"] = {
    pathDelimiter: delimiter
  };

  if (process.env.SCALPEL_ROOTS !== undefined) {
    env.SCALPEL_ROOTS = process.env.SCALPEL_ROOTS;
  }
  if (process.env.SCALPEL_JOURNAL_ENABLED !== undefined) {
    env.SCALPEL_JOURNAL_ENABLED = process.env.SCALPEL_JOURNAL_ENABLED;
  }
  if (process.env.SCALPEL_JOURNAL_PATH !== undefined) {
    env.SCALPEL_JOURNAL_PATH = process.env.SCALPEL_JOURNAL_PATH;
  }

  const result: ConfigResult = {
    roots: config.roots,
    allowHiddenPaths: config.allowHiddenPaths,
    maxReadBytes: config.maxReadBytes,
    maxDiffBytes: config.maxDiffBytes,
    maxGrepResults: config.maxGrepResults,
    journalEnabled: config.journalEnabled,
    logLevel: config.logLevel,
    cwd: process.cwd(),
    env
  };

  if (config.journalPath !== undefined) {
    result.journalPath = config.journalPath;
  }

  return success(result);
}
