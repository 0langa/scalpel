import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const safetyModelVersion = "scalpel-safety-model-v1-draft";

async function readRepoFile(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

describe("safety contract documentation", () => {
  test("defines the final release safety terms and unsupported boundaries", async () => {
    const safetyModel = await readRepoFile("docs/SAFETY_MODEL.md");

    expect(safetyModel).toContain(`Safety model version: \`${safetyModelVersion}\``);
    expect(safetyModel).toContain("### Crash-Safe");
    expect(safetyModel).toContain("### Race-Proof");
    expect(safetyModel).toContain("### Large-Scale");
    expect(safetyModel).toContain("### Recoverable");
    expect(safetyModel).toContain("malicious same-user edits after Scalpel reports success");
    expect(safetyModel).toContain("network filesystems and sync folders");
    expect(safetyModel).toContain("cross-device moves unless explicitly implemented and proven");
  });

  test("hardening docs and report generator expose a claim map", async () => {
    const hardeningDocs = await readRepoFile("docs/HARDENING.md");
    const hardeningScript = await readRepoFile("scripts/hardening.ts");

    expect(hardeningDocs).toContain("claim_map");
    expect(hardeningDocs).toContain("The report claim map is the release audit index");
    expect(hardeningScript).toContain(`const safetyModelVersion = "${safetyModelVersion}"`);
    expect(hardeningScript).toContain("claim_map: ClaimMapEntry[]");
    expect(hardeningScript).toContain("streaming large-file mutation");
    expect(hardeningScript).toContain("cross-platform persistence evidence");
  });
});
