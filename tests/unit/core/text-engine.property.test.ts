import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { readLineRangeSnapshot } from "../../../src/core/file-metadata.js";
import { countLines, detectLineEnding } from "../../../src/core/line-endings.js";
import {
  planStreamingExactReplace,
  streamExactReplaceChunks,
  type ReplacementMode,
} from "../../../src/core/streaming-replace.js";
import { planExactReplace, splitLinesWithEndings, type PatchOccurrence } from "../../../src/core/text.js";

// Small alphabet so that generated needles actually occur in generated text,
// with the pieces that break naive text handling: CRLF, a BOM, a two-byte
// character, and an astral character that is a surrogate pair in UTF-16.
const piece = fc.constantFrom("a", "b", "ab", " ", "\n", "\r\n", "é", "😀", "﻿");
const text = fc.array(piece, { maxLength: 40 }).map((parts) => parts.join(""));
const occurrence = fc.oneof(
  fc.constantFrom<PatchOccurrence>("unique", "first", "all"),
  fc.integer({ min: 1, max: 4 }),
);
// Down to one byte per read, so chunk boundaries land inside multi-byte
// characters, between CR and LF, and inside every match.
const highWaterMark = fc.integer({ min: 1, max: 24 });

let directory: string;
let fileIndex = 0;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "scalpel-property-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeTemp(content: string): Promise<string> {
  fileIndex += 1;
  const path = join(directory, `case-${String(fileIndex)}.txt`);
  await writeFile(path, content, "utf8");
  return path;
}

function needleFrom(content: string): fc.Arbitrary<string> {
  const codePoints = Array.from(content);
  return fc.oneof(
    fc
      .tuple(fc.nat({ max: codePoints.length }), fc.integer({ min: 1, max: 6 }))
      .map(([start, length]) => codePoints.slice(start, start + length).join("")),
    text,
  );
}

function modeFor(value: PatchOccurrence): ReplacementMode {
  if (value === "all") {
    return { kind: "all" };
  }
  return { kind: "indexes", indexes: new Set([value === "first" || value === "unique" ? 1 : value]) };
}

async function collect(chunks: AsyncIterable<string>): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for await (const chunk of chunks) {
    // Encode every chunk on its own, exactly like the atomic writer does.
    buffers.push(Buffer.from(chunk, "utf8"));
  }
  return Buffer.concat(buffers);
}

describe("text engine properties", () => {
  test("streaming exact replace writes the same bytes as the in-memory replace", async () => {
    await fc.assert(
      fc.asyncProperty(
        text.chain((content) => fc.tuple(fc.constant(content), needleFrom(content), text, occurrence, highWaterMark)),
        async ([content, oldString, newString, which, chunkBytes]) => {
          const path = await writeTemp(content);
          const expected = planExactReplace(content, oldString, newString, which);
          const plan = await planStreamingExactReplace({
            path,
            oldString,
            newString,
            occurrence: which,
            highWaterMark: chunkBytes,
          });

          if (!expected.ok) {
            expect(plan).toMatchObject({ ok: false, error: { code: expected.error.code } });
            return;
          }

          expect(plan.ok).toBe(true);
          if (!plan.ok) {
            return;
          }
          const expectedBytes = Buffer.from(expected.data.content, "utf8");
          const written = await collect(
            streamExactReplaceChunks({
              path,
              oldString,
              newString,
              mode: modeFor(which),
              highWaterMark: chunkBytes,
            }),
          );

          expect(written.equals(expectedBytes)).toBe(true);
          expect(plan.data.replacements).toBe(expected.data.replacements);
          expect(plan.data.afterSizeBytes).toBe(expectedBytes.byteLength);
          expect(plan.data.afterSha256).toBe(createHash("sha256").update(expectedBytes).digest("hex"));
        },
      ),
      { numRuns: 300 },
    );
  });

  test("streamed line ranges match slicing the whole file", async () => {
    await fc.assert(
      fc.asyncProperty(
        text,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        highWaterMark,
        async (content, startLine, extraLines, chunkBytes) => {
          const path = await writeTemp(content);
          const endLine = startLine + extraLines;
          const snapshot = await readLineRangeSnapshot(path, startLine, endLine, {
            highWaterMark: chunkBytes,
          });

          expect(snapshot.ok).toBe(true);
          if (!snapshot.ok) {
            return;
          }
          expect(snapshot.data.content).toBe(
            splitLinesWithEndings(content).slice(startLine - 1, endLine).join(""),
          );
          expect(snapshot.data.lineCount).toBe(countLines(content));
          expect(snapshot.data.eol).toBe(detectLineEnding(content));
          expect(snapshot.data.sha256).toBe(createHash("sha256").update(content, "utf8").digest("hex"));
        },
      ),
      { numRuns: 300 },
    );
  });
});
