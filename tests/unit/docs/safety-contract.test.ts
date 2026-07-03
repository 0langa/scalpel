import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const broadSafetyTerms = [/crash-safe/i, /race-proof/i, /large-scale/i];

const safetyModelVersion = "scalpel-safety-model-v1";

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

  test("final release notes never use broad safety terms without linking to the safety model", async () => {
    // Prereleases (alpha/beta/rc) predate the finalized safety model and are
    // historical records, not final release claims; only final release notes
    // are held to this rule.
    const releasesDir = resolve("docs/releases");
    const entries = await readdir(releasesDir, { withFileTypes: true });
    const releaseNoteFiles = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".md") &&
          !entry.name.endsWith("-audit.md") &&
          !/-alpha\.|-beta\.|-rc\./.test(entry.name),
      )
      .map((entry) => entry.name);

    expect(releaseNoteFiles.length).toBeGreaterThan(0);

    for (const name of releaseNoteFiles) {
      const content = await readRepoFile(`docs/releases/${name}`);
      const usesBroadTerm = broadSafetyTerms.some((term) => term.test(content));
      if (!usesBroadTerm) {
        continue;
      }

      expect(
        content.includes("SAFETY_MODEL.md"),
        `${name} uses a broad safety term (crash-safe/race-proof/large-scale) without linking to docs/SAFETY_MODEL.md`,
      ).toBe(true);
    }
  });
});
