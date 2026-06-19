import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { beginMoveTransaction, beginWriteTransaction } from "../src/core/write-transaction.js";

type Command = "setup" | "corpus" | "race" | "crash" | "all";
type Severity = "required" | "advisory";

type Corpus = {
  name: string;
  url: string;
};

type Check = {
  name: string;
  severity: Severity;
  passed: boolean;
  detail?: string;
  duration_ms?: number;
  rss_before_bytes?: number;
  rss_after_bytes?: number;
};

type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

type Report = {
  started_at: string;
  ended_at?: string;
  root: string;
  report_dir: string;
  scalpel_commit?: string;
  telemetry?: {
    duration_ms: number;
    peak_rss_bytes: number;
    final_rss_bytes: number;
  };
  corpora: {
    name: string;
    url: string;
    path: string;
    commit?: string;
    tracked_file_count?: number;
  }[];
  checks: Check[];
};

const starterCorpora: Corpus[] = [
  { name: "express", url: "https://github.com/expressjs/express.git" },
  { name: "lodash", url: "https://github.com/lodash/lodash.git" },
];

const expandedCorpora: Corpus[] = [
  ...starterCorpora,
  { name: "typescript", url: "https://github.com/microsoft/TypeScript.git" },
  { name: "kubernetes", url: "https://github.com/kubernetes/kubernetes.git" },
  { name: "llvm-project", url: "https://github.com/llvm/llvm-project.git" },
];

const command = parseCommand(process.argv[2]);
const hardeningRoot = resolve(
  argValue("--root") ??
    process.env.SCALPEL_HARDENING_ROOT ??
    "C:\\Users\\Julius\\source\\repos\\scalpel_functionality\\scalpel-hardening",
);
const corpora = hasArg("--expanded") ? expandedCorpora : starterCorpora;
const reportStamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = resolve(hardeningRoot, "reports", reportStamp);
const checks: Check[] = [];
let peakRssBytes = process.memoryUsage().rss;

async function main(): Promise<void> {
  const suiteStart = performance.now();
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 100);
  sampler.unref();

  await mkdir(reportDir, { recursive: true });

  const scalpelCommit = await gitMaybe(["rev-parse", "HEAD"], process.cwd());
  const report: Report = {
    started_at: new Date().toISOString(),
    root: hardeningRoot,
    report_dir: reportDir,
    corpora: [],
    checks,
  };
  if (scalpelCommit !== undefined) {
    report.scalpel_commit = scalpelCommit;
  }

  if (command === "setup" || command === "all") {
    report.corpora = await setupCorpora();
  } else {
    report.corpora = await describeCorpora();
  }

  if (command === "corpus" || command === "all") {
    await runCorpusSuite(report.corpora);
  }
  if (command === "race" || command === "all") {
    await runRaceSuite();
  }
  if (command === "crash" || command === "all") {
    await runCrashSuite();
  }

  clearInterval(sampler);
  report.ended_at = new Date().toISOString();
  report.telemetry = {
    duration_ms: Math.round(performance.now() - suiteStart),
    peak_rss_bytes: peakRssBytes,
    final_rss_bytes: process.memoryUsage().rss,
  };

  await writeReport(report);
  const requiredFailures = checks.filter((check) => check.severity === "required" && !check.passed);
  if (requiredFailures.length > 0) {
    throw new Error(
      `Hardening suite failed ${String(requiredFailures.length)} required checks. Report: ${join(reportDir, "report.md")}`,
    );
  }

  console.log(`Hardening suite complete. Report: ${join(reportDir, "report.md")}`);
}

async function setupCorpora(): Promise<Report["corpora"]> {
  const corpusRoot = join(hardeningRoot, "corpora");
  await mkdir(corpusRoot, { recursive: true });

  const results: Report["corpora"] = [];
  for (const corpus of corpora) {
    const target = join(corpusRoot, corpus.name);
    if (!existsSync(target)) {
      await timedCheck(`clone ${corpus.name}`, "required", async () => {
        await run("git", ["clone", "--depth", "1", corpus.url, target], process.cwd());
      });
    } else if (!(await isCorpusFixtureUsable(target))) {
      await timedCheck(`refresh ${corpus.name}`, "required", async () => {
        await rm(target, { recursive: true, force: true });
        await run("git", ["clone", "--depth", "1", corpus.url, target], process.cwd());
      });
    } else {
      check(`clone ${corpus.name}`, "required", true, "already present");
    }

    const commit = await gitMaybe(["rev-parse", "HEAD"], target);
    const trackedFileCount = await gitTrackedFileCount(target);
    results.push({
      name: corpus.name,
      url: corpus.url,
      path: target,
      ...(commit !== undefined ? { commit } : {}),
      ...(trackedFileCount !== undefined ? { tracked_file_count: trackedFileCount } : {}),
    });
  }

  return results;
}

async function describeCorpora(): Promise<Report["corpora"]> {
  const corpusRoot = join(hardeningRoot, "corpora");
  const results: Report["corpora"] = [];
  for (const corpus of corpora) {
    const target = join(corpusRoot, corpus.name);
    if (!existsSync(target)) {
      check(
        `corpus ${corpus.name} present`,
        "required",
        false,
        `missing ${target}; run pnpm hardening:setup`,
      );
      continue;
    }
    const commit = await gitMaybe(["rev-parse", "HEAD"], target);
    const trackedFileCount = await gitTrackedFileCount(target);
    results.push({
      name: corpus.name,
      url: corpus.url,
      path: target,
      ...(commit !== undefined ? { commit } : {}),
      ...(trackedFileCount !== undefined ? { tracked_file_count: trackedFileCount } : {}),
    });
  }
  return results;
}

async function runCorpusSuite(corpusReports: Report["corpora"]): Promise<void> {
  for (const corpus of corpusReports) {
    if (!existsSync(corpus.path)) {
      continue;
    }

    const fixtureBefore = await describeGitFixture(corpus.path);

    await withScalpelClient(corpus.path, `corpus-${corpus.name}`, async (client) => {
      await timedCheck(`${corpus.name}: list tools`, "required", async () => {
        const tools = await client.listTools();
        assert(
          tools.tools.some((tool) => tool.name === "grep"),
          "grep tool missing",
        );
      });

      await timedCheck(`${corpus.name}: config root confined`, "required", async () => {
        const result = await client.callTool({ name: "config", arguments: {} });
        assert(result.isError !== true, "config returned error");
        assert(
          rootsFromStructuredContent(result.structuredContent).includes(corpus.path),
          "config did not report corpus root",
        );
      });

      await timedCheck(`${corpus.name}: root listing`, "required", async () => {
        const result = await client.callTool({ name: "list_dir", arguments: { path: "." } });
        assert(result.isError !== true, "list_dir returned error");
      });

      await timedCheck(`${corpus.name}: bounded read`, "required", async () => {
        const readable = firstExisting(corpus.path, ["README.md", "readme.md", "package.json"]);
        assert(readable !== undefined, "no standard readable file found");
        const result = await client.callTool({
          name: "read_chunk",
          arguments: { path: readable, max_bytes: 4096 },
        });
        assert(result.isError !== true, `read_chunk failed for ${readable}`);
      });

      await timedCheck(`${corpus.name}: recursive grep with globs`, "required", async () => {
        const result = await client.callTool({
          name: "grep",
          arguments: {
            path: ".",
            pattern: "function",
            include_globs: ["**/*.js", "**/*.ts", "**/*.c", "**/*.h"],
            exclude_globs: ["**/node_modules/**", "**/.git/**"],
            max_results: 25,
          },
        });
        assert(result.isError !== true, "grep returned error");
      });

      await timedCheck(`${corpus.name}: path escape rejected`, "required", async () => {
        const result = await client.callTool({
          name: "read",
          arguments: { path: "..\\outside.txt" },
        });
        assert(result.isError === true, "path escape unexpectedly succeeded");
        assert(
          hasErrorCode(result.structuredContent, "PATH_OUTSIDE_ROOT"),
          "path escape returned wrong error",
        );
      });
    });

    await timedCheck(`${corpus.name}: fixture unchanged after read-only lane`, "required", async () => {
      await assertGitFixtureUnchanged(corpus.path, fixtureBefore);
    });

    await timedCheck(`${corpus.name}: disposable mutation copy`, "required", async () => {
      await runDisposableCorpusMutation(corpus);
      await assertGitFixtureUnchanged(corpus.path, fixtureBefore);
    });
  }
}

type GitFixtureState = {
  commit?: string | undefined;
  status: string;
};

async function describeGitFixture(path: string): Promise<GitFixtureState> {
  return {
    commit: await gitMaybe(["rev-parse", "HEAD"], path),
    status: await gitMaybe(["status", "--porcelain"], path) ?? "",
  };
}

async function assertGitFixtureUnchanged(path: string, before: GitFixtureState): Promise<void> {
  const after = await describeGitFixture(path);
  assert(after.commit === before.commit, "fixture commit changed");
  assert(after.status === before.status, "fixture working tree status changed");
}

async function runDisposableCorpusMutation(corpus: Report["corpora"][number]): Promise<void> {
  const copyRoot = join(hardeningRoot, "mutation-copies", reportStamp, corpus.name);
  await rm(copyRoot, { recursive: true, force: true });
  await mkdir(join(hardeningRoot, "mutation-copies", reportStamp), { recursive: true });
  try {
    await run("git", ["clone", "--shared", corpus.path, copyRoot], process.cwd());

    const mutationPath = ".scalpel-hardening-mutation.txt";
    await withScalpelClient(copyRoot, `corpus-mutation-${corpus.name}`, async (client) => {
      const created = await client.callTool({
        name: "create",
        arguments: {
          path: mutationPath,
          content: `corpus=${corpus.name}\nphase=create\n`,
        },
      });
      assert(created.isError !== true, "create failed in disposable corpus copy");

      const appended = await client.callTool({
        name: "append",
        arguments: {
          path: mutationPath,
          content: "phase=append\n",
        },
      });
      assert(appended.isError !== true, "append failed in disposable corpus copy");

      const patched = await client.callTool({
        name: "patch",
        arguments: {
          path: mutationPath,
          old_string: "phase=create",
          new_string: "phase=patch",
        },
      });
      assert(patched.isError !== true, "patch failed in disposable corpus copy");

      const moved = await client.callTool({
        name: "move",
        arguments: {
          source: mutationPath,
          destination: ".scalpel-hardening-mutation-moved.txt",
        },
      });
      assert(moved.isError !== true, "move failed in disposable corpus copy");

      const read = await client.callTool({
        name: "read",
        arguments: { path: ".scalpel-hardening-mutation-moved.txt" },
      });
      assert(read.isError !== true, "read failed after disposable copy mutation");
    });

    const content = await readFile(join(copyRoot, ".scalpel-hardening-mutation-moved.txt"), "utf8");
    assert(content.includes("phase=patch"), "disposable mutation copy did not contain patch result");
    assert(content.includes("phase=append"), "disposable mutation copy did not contain append result");
  } finally {
    if (!hasArg("--retain-copies")) {
      await rm(copyRoot, { recursive: true, force: true });
    }
  }
}

async function runRaceSuite(): Promise<void> {
  const raceRoot = await freshSyntheticRoot("race");
  await writeFile(join(raceRoot, "stale.txt"), "alpha\nbeta\n", "utf8");

  await withScalpelClient(raceRoot, "race", async (client) => {
    const before = await client.callTool({ name: "stat", arguments: { path: "stale.txt" } });
    const expectedSha = shaFromStructuredContent(before.structuredContent);
    await writeFile(join(raceRoot, "stale.txt"), "changed\nbeta\n", "utf8");

    await timedCheck("race: stale sha rejected", "required", async () => {
      const result = await client.callTool({
        name: "patch",
        arguments: {
          path: "stale.txt",
          old_string: "alpha",
          new_string: "gamma",
          expected_sha256: expectedSha,
        },
      });
      assert(result.isError === true, "stale patch unexpectedly applied");
      assert(
        hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
        "stale patch returned wrong error",
      );
    });

    await writeFile(join(raceRoot, "contended.txt"), "alpha\n", "utf8");
    const contended = await client.callTool({ name: "stat", arguments: { path: "contended.txt" } });
    const contendedSha = shaFromStructuredContent(contended.structuredContent);

    await timedCheck("race: concurrent same-sha patches", "required", async () => {
      await expectAtMostOneSuccess([
        client.callTool({
          name: "patch",
          arguments: {
            path: "contended.txt",
            old_string: "alpha",
            new_string: "left",
            expected_sha256: contendedSha,
          },
        }),
        client.callTool({
          name: "patch",
          arguments: {
            path: "contended.txt",
            old_string: "alpha",
            new_string: "right",
            expected_sha256: contendedSha,
          },
        }),
      ]);
    });

    await timedCheck("race: concurrent create overwrite with same sha", "required", async () => {
      await writeFile(join(raceRoot, "create-race.txt"), "alpha\n", "utf8");
      const sha = shaFromStructuredContent(
        (await client.callTool({ name: "stat", arguments: { path: "create-race.txt" } }))
          .structuredContent,
      );
      await expectAtMostOneSuccess([
        client.callTool({
          name: "create",
          arguments: {
            path: "create-race.txt",
            content: "left\n",
            overwrite: true,
            expected_sha256: sha,
          },
        }),
        client.callTool({
          name: "create",
          arguments: {
            path: "create-race.txt",
            content: "right\n",
            overwrite: true,
            expected_sha256: sha,
          },
        }),
      ]);
    });

    await timedCheck("race: concurrent append with same sha", "required", async () => {
      await concurrentTextMutation(client, raceRoot, "append-race.txt", "alpha\n", (sha) => [
        {
          name: "append",
          arguments: { path: "append-race.txt", content: "left\n", expected_sha256: sha },
        },
        {
          name: "append",
          arguments: { path: "append-race.txt", content: "right\n", expected_sha256: sha },
        },
      ]);
    });

    await timedCheck("race: concurrent prepend with same sha", "required", async () => {
      await concurrentTextMutation(client, raceRoot, "prepend-race.txt", "alpha\n", (sha) => [
        {
          name: "prepend",
          arguments: { path: "prepend-race.txt", content: "left\n", expected_sha256: sha },
        },
        {
          name: "prepend",
          arguments: { path: "prepend-race.txt", content: "right\n", expected_sha256: sha },
        },
      ]);
    });

    await timedCheck("race: concurrent batch_edit with same sha", "required", async () => {
      await concurrentTextMutation(client, raceRoot, "batch-race.txt", "alpha\n", (sha) => [
        {
          name: "batch_edit",
          arguments: {
            path: "batch-race.txt",
            edits: [{ old_string: "alpha", new_string: "left" }],
            expected_sha256: sha,
          },
        },
        {
          name: "batch_edit",
          arguments: {
            path: "batch-race.txt",
            edits: [{ old_string: "alpha", new_string: "right" }],
            expected_sha256: sha,
          },
        },
      ]);
    });

    await timedCheck("race: concurrent insert with same sha", "required", async () => {
      await concurrentTextMutation(client, raceRoot, "insert-race.txt", "alpha\nomega\n", (sha) => [
        {
          name: "insert",
          arguments: { path: "insert-race.txt", line: 2, content: "left\n", expected_sha256: sha },
        },
        {
          name: "insert",
          arguments: { path: "insert-race.txt", line: 2, content: "right\n", expected_sha256: sha },
        },
      ]);
    });

    await timedCheck("race: concurrent delete_range with same sha", "required", async () => {
      await concurrentTextMutation(
        client,
        raceRoot,
        "delete-race.txt",
        "alpha\nbeta\ngamma\n",
        (sha) => [
          {
            name: "delete_range",
            arguments: {
              path: "delete-race.txt",
              start_line: 2,
              end_line: 2,
              expected_sha256: sha,
            },
          },
          {
            name: "delete_range",
            arguments: {
              path: "delete-race.txt",
              start_line: 2,
              end_line: 2,
              expected_sha256: sha,
            },
          },
        ],
      );
    });

    await timedCheck(
      "race: concurrent replace_between_markers with same sha",
      "required",
      async () => {
        await concurrentTextMutation(
          client,
          raceRoot,
          "markers-race.txt",
          "BEGIN\nalpha\nEND\n",
          (sha) => [
            {
              name: "replace_between_markers",
              arguments: {
                path: "markers-race.txt",
                start_marker: "BEGIN",
                end_marker: "END",
                new_content: "left\n",
                expected_sha256: sha,
              },
            },
            {
              name: "replace_between_markers",
              arguments: {
                path: "markers-race.txt",
                start_marker: "BEGIN",
                end_marker: "END",
                new_content: "right\n",
                expected_sha256: sha,
              },
            },
          ],
        );
      },
    );

    await timedCheck("race: concurrent move from same source", "required", async () => {
      await writeFile(join(raceRoot, "move-race.txt"), "alpha\n", "utf8");
      const sha = shaFromStructuredContent(
        (await client.callTool({ name: "stat", arguments: { path: "move-race.txt" } }))
          .structuredContent,
      );
      await expectAtMostOneSuccess([
        client.callTool({
          name: "move",
          arguments: {
            source: "move-race.txt",
            destination: "move-left.txt",
            expected_source_sha256: sha,
          },
        }),
        client.callTool({
          name: "move",
          arguments: {
            source: "move-race.txt",
            destination: "move-right.txt",
            expected_source_sha256: sha,
          },
        }),
      ]);
    });
  });

  const multiProcessRoot = await freshSyntheticRoot("race-multiprocess");
  await withScalpelClients(multiProcessRoot, "race-multiprocess", 2, async (clients) => {
    const [leftClient, rightClient] = clients;
    assert(leftClient !== undefined, "failed to create left Scalpel client");
    assert(rightClient !== undefined, "failed to create right Scalpel client");

    await timedCheck("race: multiprocess concurrent same-sha patches", "required", async () => {
      await writeFile(join(multiProcessRoot, "patch-race.txt"), "alpha\n", "utf8");
      const sha = shaFromStructuredContent(
        (await leftClient.callTool({ name: "stat", arguments: { path: "patch-race.txt" } }))
          .structuredContent,
      );
      await expectAtMostOneSuccess([
        leftClient.callTool({
          name: "patch",
          arguments: {
            path: "patch-race.txt",
            old_string: "alpha",
            new_string: "left",
            expected_sha256: sha,
          },
        }),
        rightClient.callTool({
          name: "patch",
          arguments: {
            path: "patch-race.txt",
            old_string: "alpha",
            new_string: "right",
            expected_sha256: sha,
          },
        }),
      ]);
    });

    await timedCheck(
      "race: multiprocess concurrent create overwrite with same sha",
      "required",
      async () => {
        await writeFile(join(multiProcessRoot, "create-race.txt"), "alpha\n", "utf8");
        const sha = shaFromStructuredContent(
          (await leftClient.callTool({ name: "stat", arguments: { path: "create-race.txt" } }))
            .structuredContent,
        );
        await expectAtMostOneSuccess([
          leftClient.callTool({
            name: "create",
            arguments: {
              path: "create-race.txt",
              content: "left\n",
              overwrite: true,
              expected_sha256: sha,
            },
          }),
          rightClient.callTool({
            name: "create",
            arguments: {
              path: "create-race.txt",
              content: "right\n",
              overwrite: true,
              expected_sha256: sha,
            },
          }),
        ]);
      },
    );

    await timedCheck("race: multiprocess concurrent append with same sha", "required", async () => {
      await concurrentTextMutationAcrossClients(
        leftClient,
        rightClient,
        multiProcessRoot,
        "append-race.txt",
        "alpha\n",
        (sha) => [
          {
            name: "append",
            arguments: { path: "append-race.txt", content: "left\n", expected_sha256: sha },
          },
          {
            name: "append",
            arguments: { path: "append-race.txt", content: "right\n", expected_sha256: sha },
          },
        ],
      );
    });

    await timedCheck(
      "race: multiprocess concurrent prepend with same sha",
      "required",
      async () => {
        await concurrentTextMutationAcrossClients(
          leftClient,
          rightClient,
          multiProcessRoot,
          "prepend-race.txt",
          "alpha\n",
          (sha) => [
            {
              name: "prepend",
              arguments: { path: "prepend-race.txt", content: "left\n", expected_sha256: sha },
            },
            {
              name: "prepend",
              arguments: { path: "prepend-race.txt", content: "right\n", expected_sha256: sha },
            },
          ],
        );
      },
    );

    await timedCheck(
      "race: multiprocess concurrent batch_edit with same sha",
      "required",
      async () => {
        await concurrentTextMutationAcrossClients(
          leftClient,
          rightClient,
          multiProcessRoot,
          "batch-race.txt",
          "alpha\n",
          (sha) => [
            {
              name: "batch_edit",
              arguments: {
                path: "batch-race.txt",
                edits: [{ old_string: "alpha", new_string: "left" }],
                expected_sha256: sha,
              },
            },
            {
              name: "batch_edit",
              arguments: {
                path: "batch-race.txt",
                edits: [{ old_string: "alpha", new_string: "right" }],
                expected_sha256: sha,
              },
            },
          ],
        );
      },
    );

    await timedCheck("race: multiprocess concurrent insert with same sha", "required", async () => {
      await concurrentTextMutationAcrossClients(
        leftClient,
        rightClient,
        multiProcessRoot,
        "insert-race.txt",
        "alpha\nomega\n",
        (sha) => [
          {
            name: "insert",
            arguments: {
              path: "insert-race.txt",
              line: 2,
              content: "left\n",
              expected_sha256: sha,
            },
          },
          {
            name: "insert",
            arguments: {
              path: "insert-race.txt",
              line: 2,
              content: "right\n",
              expected_sha256: sha,
            },
          },
        ],
      );
    });

    await timedCheck(
      "race: multiprocess concurrent delete_range with same sha",
      "required",
      async () => {
        await concurrentTextMutationAcrossClients(
          leftClient,
          rightClient,
          multiProcessRoot,
          "delete-race.txt",
          "alpha\nbeta\ngamma\n",
          (sha) => [
            {
              name: "delete_range",
              arguments: {
                path: "delete-race.txt",
                start_line: 2,
                end_line: 2,
                expected_sha256: sha,
              },
            },
            {
              name: "delete_range",
              arguments: {
                path: "delete-race.txt",
                start_line: 2,
                end_line: 2,
                expected_sha256: sha,
              },
            },
          ],
        );
      },
    );

    await timedCheck(
      "race: multiprocess concurrent replace_between_markers with same sha",
      "required",
      async () => {
        await concurrentTextMutationAcrossClients(
          leftClient,
          rightClient,
          multiProcessRoot,
          "markers-race.txt",
          "BEGIN\nalpha\nEND\n",
          (sha) => [
            {
              name: "replace_between_markers",
              arguments: {
                path: "markers-race.txt",
                start_marker: "BEGIN",
                end_marker: "END",
                new_content: "left\n",
                expected_sha256: sha,
              },
            },
            {
              name: "replace_between_markers",
              arguments: {
                path: "markers-race.txt",
                start_marker: "BEGIN",
                end_marker: "END",
                new_content: "right\n",
                expected_sha256: sha,
              },
            },
          ],
        );
      },
    );

    await timedCheck(
      "race: multiprocess concurrent move from same source",
      "required",
      async () => {
        await writeFile(join(multiProcessRoot, "move-race.txt"), "alpha\n", "utf8");
        const sha = shaFromStructuredContent(
          (await leftClient.callTool({ name: "stat", arguments: { path: "move-race.txt" } }))
            .structuredContent,
        );
        await expectAtMostOneSuccess([
          leftClient.callTool({
            name: "move",
            arguments: {
              source: "move-race.txt",
              destination: "move-left.txt",
              expected_source_sha256: sha,
            },
          }),
          rightClient.callTool({
            name: "move",
            arguments: {
              source: "move-race.txt",
              destination: "move-right.txt",
              expected_source_sha256: sha,
            },
          }),
        ]);
      },
    );
  });

  const interferenceRoot = await freshSyntheticRoot("race-external");
  await timedCheck(
    "race: external modification before commit is rejected",
    "required",
    async () => {
      const relativePath = "external-modification.txt";
      const absolutePath = join(interferenceRoot, relativePath);
      await writeFile(absolutePath, "alpha\n", "utf8");

      await withTemporaryEnv(
        {
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH: absolutePath,
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT: "external\n",
        },
        async () => {
          await withScalpelClient(
            interferenceRoot,
            "race-external-modification",
            async (client) => {
              const result = await client.callTool({
                name: "patch",
                arguments: {
                  path: relativePath,
                  old_string: "alpha",
                  new_string: "scalpel",
                },
              });
              assert(result.isError === true, "external modification was silently overwritten");
              assert(
                hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
                "external modification returned wrong error",
              );
            },
          );
        },
      );
    },
  );

  await timedCheck("race: external create before commit is rejected", "required", async () => {
    const relativePath = "external-create.txt";
    const absolutePath = join(interferenceRoot, relativePath);

    await withTemporaryEnv(
      {
        SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH: absolutePath,
        SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_CONTENT: "external\n",
      },
      async () => {
        await withScalpelClient(interferenceRoot, "race-external-create", async (client) => {
          const result = await client.callTool({
            name: "append",
            arguments: {
              path: relativePath,
              content: "scalpel\n",
            },
          });
          assert(result.isError === true, "external create was silently overwritten");
          assert(
            hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
            "external create returned wrong error",
          );
        });
      },
    );
  });

  await timedCheck("race: external delete before commit is rejected", "required", async () => {
    const relativePath = "external-delete.txt";
    const absolutePath = join(interferenceRoot, relativePath);
    await writeFile(absolutePath, "alpha\n", "utf8");

    await withTemporaryEnv(
      {
        SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH: absolutePath,
        SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE: "delete",
      },
      async () => {
        await withScalpelClient(interferenceRoot, "race-external-delete", async (client) => {
          const result = await client.callTool({
            name: "patch",
            arguments: {
              path: relativePath,
              old_string: "alpha",
              new_string: "scalpel",
            },
          });
          assert(result.isError === true, "external delete was silently recreated");
          assert(
            hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
            "external delete returned wrong error",
          );
        });
      },
    );
  });

  await timedCheck(
    "race: external directory replacement before commit is rejected",
    "required",
    async () => {
      const relativePath = "external-directory-replacement.txt";
      const absolutePath = join(interferenceRoot, relativePath);
      await writeFile(absolutePath, "alpha\n", "utf8");

      await withTemporaryEnv(
        {
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH: absolutePath,
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE: "directory",
        },
        async () => {
          await withScalpelClient(
            interferenceRoot,
            "race-external-directory-replacement",
            async (client) => {
              const result = await client.callTool({
                name: "patch",
                arguments: {
                  path: relativePath,
                  old_string: "alpha",
                  new_string: "scalpel",
                },
              });
              assert(
                result.isError === true,
                "external directory replacement was silently overwritten",
              );
              assert(
                hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
                "external directory replacement returned wrong error",
              );
            },
          );
        },
      );
    },
  );

  await timedCheck(
    "race: external symlink swap before commit is rejected",
    "required",
    async () => {
      const relativePath = "external-symlink-before.txt";
      const absolutePath = join(interferenceRoot, relativePath);
      const symlinkTarget = join(reportDir, "external-targets", "before-symlink-target.txt");
      await mkdir(join(reportDir, "external-targets"), { recursive: true });
      await writeFile(absolutePath, "alpha\n", "utf8");
      await writeFile(symlinkTarget, "external\n", "utf8");

      await withTemporaryEnv(
        {
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_PATH: absolutePath,
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_MODE: "symlink",
          SCALPEL_HARDENING_INTERFERE_BEFORE_COMMIT_SYMLINK_TARGET: symlinkTarget,
        },
        async () => {
          await withScalpelClient(
            interferenceRoot,
            "race-external-symlink-before",
            async (client) => {
              const result = await client.callTool({
                name: "patch",
                arguments: {
                  path: relativePath,
                  old_string: "alpha",
                  new_string: "scalpel",
                },
              });
              assert(result.isError === true, "external symlink swap was silently overwritten");
              assert(
                hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
                "external symlink swap returned wrong error",
              );
            },
          );
        },
      );
    },
  );

  await timedCheck("race: external modification after commit is rejected", "required", async () => {
    const relativePath = "external-after-commit.txt";
    const absolutePath = join(interferenceRoot, relativePath);
    await writeFile(absolutePath, "alpha\n", "utf8");

    await withTemporaryEnv(
      {
        SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH: absolutePath,
        SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_CONTENT: "external\n",
      },
      async () => {
        await withScalpelClient(interferenceRoot, "race-external-after-commit", async (client) => {
          const result = await client.callTool({
            name: "patch",
            arguments: {
              path: relativePath,
              old_string: "alpha",
              new_string: "scalpel",
            },
          });
          assert(
            result.isError === true,
            "external post-commit modification was reported as success",
          );
          assert(
            hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
            "external post-commit modification returned wrong error",
          );
        });
      },
    );
  });

  await timedCheck("race: external symlink swap after commit is rejected", "required", async () => {
    const relativePath = "external-symlink-after.txt";
    const absolutePath = join(interferenceRoot, relativePath);
    const symlinkTarget = join(reportDir, "external-targets", "after-symlink-target.txt");
    await mkdir(join(reportDir, "external-targets"), { recursive: true });
    await writeFile(absolutePath, "alpha\n", "utf8");
    await writeFile(symlinkTarget, "scalpel\n", "utf8");

    await withTemporaryEnv(
      {
        SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_PATH: absolutePath,
        SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_MODE: "symlink",
        SCALPEL_HARDENING_INTERFERE_AFTER_COMMIT_SYMLINK_TARGET: symlinkTarget,
      },
      async () => {
        await withScalpelClient(interferenceRoot, "race-external-symlink-after", async (client) => {
          const result = await client.callTool({
            name: "patch",
            arguments: {
              path: relativePath,
              old_string: "alpha",
              new_string: "scalpel",
            },
          });
          assert(
            result.isError === true,
            "external post-commit symlink swap was reported as success",
          );
          assert(
            hasErrorCode(result.structuredContent, "CONCURRENCY_CONFLICT"),
            "external post-commit symlink swap returned wrong error",
          );
        });
      },
    );
  });
}

async function runCrashSuite(): Promise<void> {
  const crashRoot = await freshSyntheticRoot("crash");
  const payload = "x".repeat(1024 * 1024 * 20);
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath()],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALPEL_ROOTS: crashRoot,
      SCALPEL_DURABILITY: "strict",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "scalpel-hardening-crash", version: "0.1.0" });

  await client.connect(transport);
  const createPromise = client
    .callTool({
      name: "create",
      arguments: { path: "large-write.txt", content: payload },
    })
    .catch((error: unknown) => error);
  await delay(10);
  await Promise.allSettled([transport.close(), client.close()]);
  await Promise.race([createPromise, delay(250)]);

  await timedCheck(
    "crash: interrupted write leaves absent-or-complete file",
    "required",
    async () => {
      const filePath = join(crashRoot, "large-write.txt");
      if (!existsSync(filePath)) {
        return;
      }
      const info = await stat(filePath);
      assert(
        info.size === Buffer.byteLength(payload, "utf8"),
        `unexpected partial file size ${String(info.size)}`,
      );
    },
  );

  await timedCheck(
    "crash: interrupted write leaves no scalpel temp files",
    "advisory",
    async () => {
      const names = await readdir(crashRoot);
      const leftovers = names.filter(
        (name) => name.startsWith(".scalpel-") && name.endsWith(".tmp"),
      );
      assert(leftovers.length === 0, `leftover temp files: ${leftovers.join(", ")}`);
    },
  );

  await timedCheck("crash: startup recovery cleans interrupted transaction", "required", async () => {
    const recoveryRoot = await freshSyntheticRoot("crash-recovery");
    const transactionDir = join(recoveryRoot, ".scalpel-transactions");
    const relativePath = "recover-me.txt";
    const targetPath = join(recoveryRoot, relativePath);
    const tempPath = join(recoveryRoot, ".scalpel-interrupted.tmp");
    await writeFile(targetPath, "before\n", "utf8");
    await writeFile(tempPath, "after\n", "utf8");
    const transaction = await beginWriteTransaction({
      transactionDir,
      targetPath,
      tempPath,
      content: "after\n",
    });
    await transaction.markTempWritten();

    await withScalpelClient(recoveryRoot, "crash-startup-recovery", async (recoveryClient) => {
      const result = await recoveryClient.callTool({
        name: "read",
        arguments: { path: relativePath },
      });
      assert(result.isError !== true, "read failed after startup recovery");
    });

    const names = await readdir(recoveryRoot);
    assert(!names.includes(".scalpel-interrupted.tmp"), "startup recovery left temp file");
    const transactionNames = await readdir(transactionDir);
    assert(
      transactionNames.length === 0,
      `startup recovery left transaction records: ${transactionNames.join(", ")}`,
    );
  });

  await timedCheck("crash: startup recovery accepts completed move transaction", "required", async () => {
    const recoveryRoot = await freshSyntheticRoot("crash-move-recovery");
    const transactionDir = join(recoveryRoot, ".scalpel-transactions");
    const sourcePath = join(recoveryRoot, "move-source.txt");
    const destinationPath = join(recoveryRoot, "move-destination.txt");
    await writeFile(sourcePath, "moved\n", "utf8");
    const transaction = await beginMoveTransaction({
      transactionDir,
      sourcePath,
      destinationPath,
    });
    await rename(sourcePath, destinationPath);
    await transaction.markRenamed();

    await withScalpelClient(recoveryRoot, "crash-move-startup-recovery", async (recoveryClient) => {
      const result = await recoveryClient.callTool({
        name: "read",
        arguments: { path: "move-destination.txt" },
      });
      assert(result.isError !== true, "read failed after move startup recovery");
    });

    const transactionNames = await readdir(transactionDir);
    assert(
      transactionNames.length === 0,
      `move startup recovery left transaction records: ${transactionNames.join(", ")}`,
    );
  });

  for (const faultPoint of [
    "text_write.after_transaction_start",
    "text_write.after_temp_written",
    "text_write.after_rename",
    "text_write.after_parent_flush",
  ]) {
    await timedCheck(`crash: killed text write at ${faultPoint} recovers`, "required", async () => {
      await verifyTextWriteFaultRecovery(faultPoint);
    });
  }

  for (const faultPoint of [
    "move.after_transaction_start",
    "move.after_rename",
    "move.after_mark_renamed",
    "move.after_journal",
  ]) {
    await timedCheck(`crash: killed move at ${faultPoint} recovers`, "required", async () => {
      await verifyMoveFaultRecovery(faultPoint);
    });
  }

  await timedCheck("crash: recovery cleanup crash is retried", "required", async () => {
    const recoveryRoot = await freshSyntheticRoot("crash-recovery-cleanup");
    const transactionDir = join(recoveryRoot, ".scalpel-transactions");
    const targetPath = join(recoveryRoot, "cleanup-retry.txt");
    const tempPath = join(recoveryRoot, ".scalpel-cleanup-retry.tmp");
    await writeFile(targetPath, "before\n", "utf8");
    await writeFile(tempPath, "after\n", "utf8");
    const transaction = await beginWriteTransaction({
      transactionDir,
      targetPath,
      tempPath,
      content: "after\n",
    });
    await transaction.markTempWritten();

    await launchServerExpectingCrash(recoveryRoot, "recovery.before_record_cleanup");
    await recoverByStartingServer(recoveryRoot, "crash-recovery-cleanup-retry", "cleanup-retry.txt");
    await assertNoTransactionRecords(transactionDir);
    await assertNoScalpelTemps(recoveryRoot);
  });

  await timedCheck("crash: stale path lock is recovered", "required", async () => {
    const lockDir = join(reportDir, "locks");
    const relativePath = "stale-lock.txt";
    const absolutePath = join(crashRoot, relativePath);
    await writeFile(absolutePath, "alpha\n", "utf8");
    await createStalePathLock(lockDir, absolutePath);

    await withScalpelClient(crashRoot, "crash-stale-lock", async (staleClient) => {
      const result = await staleClient.callTool({
        name: "append",
        arguments: { path: relativePath, content: "beta\n" },
      });
      assert(result.isError !== true, "append failed behind stale lock");
    });

    const names = await readdir(lockDir);
    assert(names.length === 0, `stale lock directory was not cleaned: ${names.join(", ")}`);
  });
}

async function verifyTextWriteFaultRecovery(faultPoint: string): Promise<void> {
  const root = await freshSyntheticRoot(`crash-text-${sanitizeName(faultPoint)}`);
  const transactionDir = join(root, ".scalpel-transactions");
  const relativePath = "fault-write.txt";
  const absolutePath = join(root, relativePath);
  const before = "before\n";
  const after = "after\n";
  await writeFile(absolutePath, before, "utf8");

  await callToolExpectingCrash(root, faultPoint, {
    name: "patch",
    arguments: {
      path: relativePath,
      old_string: "before",
      new_string: "after",
    },
  });

  await recoverByStartingServer(root, `recover-${sanitizeName(faultPoint)}`, relativePath);
  await assertAbsentOrContent(absolutePath, before, after);
  await assertNoTransactionRecords(transactionDir);
  await assertNoScalpelTemps(root);
}

async function verifyMoveFaultRecovery(faultPoint: string): Promise<void> {
  const root = await freshSyntheticRoot(`crash-move-${sanitizeName(faultPoint)}`);
  const transactionDir = join(root, ".scalpel-transactions");
  const sourceRelative = "move-source.txt";
  const destinationRelative = "move-destination.txt";
  const sourcePath = join(root, sourceRelative);
  const destinationPath = join(root, destinationRelative);
  await writeFile(sourcePath, "move me\n", "utf8");

  await callToolExpectingCrash(root, faultPoint, {
    name: "move",
    arguments: {
      source: sourceRelative,
      destination: destinationRelative,
    },
  });

  await recoverByStartingServer(root, `recover-${sanitizeName(faultPoint)}`, ".");
  assert(
    existsSync(sourcePath) !== existsSync(destinationPath),
    "move recovery left neither or both source and destination",
  );
  await assertNoTransactionRecords(transactionDir);
}

async function callToolExpectingCrash(
  root: string,
  faultPoint: string,
  call: ToolCall,
): Promise<void> {
  const transport = createScalpelTransport(root, join(reportDir, `${sanitizeName(faultPoint)}.jsonl`), {
    SCALPEL_FAULT_POINT: faultPoint,
    SCALPEL_LOCK_DIR: join(reportDir, "fault-locks", sanitizeName(faultPoint)),
  });
  const client = new Client({
    name: `scalpel-hardening-fault-${sanitizeName(faultPoint)}`,
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    let crashed = false;
    await client.callTool(call).catch(() => {
      crashed = true;
      return undefined;
    });
    await delay(250);
    assert(crashed, `fault point ${faultPoint} did not crash the tool call`);
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

async function launchServerExpectingCrash(root: string, faultPoint: string): Promise<void> {
  const transport = createScalpelTransport(root, join(reportDir, `${sanitizeName(faultPoint)}.jsonl`), {
    SCALPEL_FAULT_POINT: faultPoint,
  });
  const client = new Client({
    name: `scalpel-hardening-fault-${sanitizeName(faultPoint)}`,
    version: "0.1.0",
  });
  const result = await Promise.race([
    client.connect(transport).then(() => "connected" as const).catch(() => "crashed" as const),
    delay(1000).then(() => "timeout" as const),
  ]);
  await Promise.allSettled([client.close(), transport.close()]);
  assert(result !== "connected", `fault point ${faultPoint} did not crash during startup`);
}

async function recoverByStartingServer(root: string, label: string, readPath: string): Promise<void> {
  await withScalpelClient(root, label, async (client) => {
    const result = await client.callTool({
      name: readPath === "." ? "list_dir" : "read",
      arguments: { path: readPath },
    });
    assert(result.isError !== true, "recovery server returned an error");
  });
}

async function assertAbsentOrContent(path: string, before: string, after: string): Promise<void> {
  if (!existsSync(path)) {
    return;
  }
  const content = await readFile(path, "utf8");
  assert(
    content === before || content === after,
    `unexpected recovered content ${JSON.stringify(content)}`,
  );
}

async function assertNoTransactionRecords(transactionDir: string): Promise<void> {
  const names = existsSync(transactionDir) ? await readdir(transactionDir) : [];
  const records = names.filter((name) => name.endsWith(".json"));
  assert(records.length === 0, `leftover transaction records: ${records.join(", ")}`);
}

async function assertNoScalpelTemps(root: string): Promise<void> {
  const names = await readdir(root);
  const leftovers = names.filter((name) => name.startsWith(".scalpel-") && name.endsWith(".tmp"));
  assert(leftovers.length === 0, `leftover scalpel temp files: ${leftovers.join(", ")}`);
}

async function withScalpelClient<T>(
  root: string,
  label: string,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  return await withScalpelClients(root, label, 1, async ([client]) => {
    assert(client !== undefined, "failed to create Scalpel client");
    return await callback(client);
  });
}

async function withScalpelClients<T>(
  root: string,
  label: string,
  count: number,
  callback: (clients: Client[]) => Promise<T>,
): Promise<T> {
  const clients: Client[] = [];
  const transports: StdioClientTransport[] = [];

  try {
    for (let index = 0; index < count; index += 1) {
      const journalPath = join(reportDir, `${label}-${String(index + 1)}-journal.jsonl`);
      const transport = createScalpelTransport(root, journalPath);
      const client = new Client({
        name: `scalpel-hardening-${label}-${String(index + 1)}`,
        version: "0.1.0",
      });
      await client.connect(transport);
      transports.push(transport);
      clients.push(client);
    }

    return await callback(clients);
  } finally {
    await Promise.allSettled([
      ...clients.map((client) => client.close()),
      ...transports.map((transport) => transport.close()),
    ]);
  }
}

function createScalpelTransport(
  root: string,
  journalPath: string,
  envOverrides: Record<string, string> = {},
): StdioClientTransport {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath()],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCALPEL_ROOTS: root,
      SCALPEL_JOURNAL_ENABLED: "true",
      SCALPEL_JOURNAL_PATH: journalPath,
      SCALPEL_DURABILITY: "strict",
      SCALPEL_LOCK_DIR: join(reportDir, "locks"),
      SCALPEL_LOCK_STALE_MS: process.env.SCALPEL_LOCK_STALE_MS ?? "300000",
      ...envOverrides,
    },
    stderr: "pipe",
  });
  return transport;
}

async function createStalePathLock(lockDir: string, absolutePath: string): Promise<void> {
  await mkdir(lockDir, { recursive: true });
  const lockPath = join(lockDir, `${hashKey(absolutePath)}.lock`);
  await mkdir(lockPath, { recursive: true });
  await writeFile(
    join(lockPath, "owner.json"),
    `${JSON.stringify({
      pid: 999_999_999,
      key_hash: hashKey(absolutePath),
      acquired_at: "2000-01-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
}

async function freshSyntheticRoot(prefix: string): Promise<string> {
  const syntheticRoot = join(hardeningRoot, "synthetic");
  await mkdir(syntheticRoot, { recursive: true });
  const root = await mkdtemp(join(syntheticRoot, `${prefix}-`));
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

function firstExisting(root: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(join(root, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function expectAtMostOneSuccess(promises: Promise<ToolResult>[]): Promise<void> {
  const results = await Promise.all(promises);
  const applied = results.filter((result) => result.isError !== true).length;
  assert(applied <= 1, `expected at most one call to apply, but ${String(applied)} applied`);
}

async function concurrentTextMutation(
  client: Client,
  root: string,
  path: string,
  content: string,
  calls: (sha: string) => [ToolCall, ToolCall],
): Promise<void> {
  await writeFile(join(root, path), content, "utf8");
  const sha = shaFromStructuredContent(
    (await client.callTool({ name: "stat", arguments: { path } })).structuredContent,
  );
  const [left, right] = calls(sha);
  await expectAtMostOneSuccess([client.callTool(left), client.callTool(right)]);
}

async function concurrentTextMutationAcrossClients(
  leftClient: Client,
  rightClient: Client,
  root: string,
  path: string,
  content: string,
  calls: (sha: string) => [ToolCall, ToolCall],
): Promise<void> {
  await writeFile(join(root, path), content, "utf8");
  const sha = shaFromStructuredContent(
    (await leftClient.callTool({ name: "stat", arguments: { path } })).structuredContent,
  );
  const [left, right] = calls(sha);
  await expectAtMostOneSuccess([leftClient.callTool(left), rightClient.callTool(right)]);
}

async function timedCheck(
  name: string,
  severity: Severity,
  runCheck: () => Promise<void>,
): Promise<void> {
  const start = performance.now();
  const rssBefore = process.memoryUsage().rss;
  try {
    await runCheck();
    check(name, severity, true, undefined, performance.now() - start, rssBefore);
  } catch (error) {
    check(name, severity, false, errorMessage(error), performance.now() - start, rssBefore);
  }
}

function check(
  name: string,
  severity: Severity,
  passed: boolean,
  detail?: string,
  durationMs?: number,
  rssBeforeBytes?: number,
): void {
  const rssAfterBytes = process.memoryUsage().rss;
  peakRssBytes = Math.max(peakRssBytes, rssAfterBytes);
  checks.push({
    name,
    severity,
    passed,
    ...(detail !== undefined ? { detail } : {}),
    ...(durationMs !== undefined ? { duration_ms: Math.round(durationMs) } : {}),
    ...(rssBeforeBytes !== undefined ? { rss_before_bytes: rssBeforeBytes } : {}),
    rss_after_bytes: rssAfterBytes,
  });
}

async function writeReport(report: Report): Promise<void> {
  await mkdir(report.report_dir, { recursive: true });
  await writeFile(
    join(report.report_dir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(report.report_dir, "report.md"), renderMarkdown(report), "utf8");
}

function renderMarkdown(report: Report): string {
  const required = report.checks.filter((check) => check.severity === "required");
  const requiredPassed = required.filter((check) => check.passed).length;
  const advisory = report.checks.filter((check) => check.severity === "advisory");
  const advisoryPassed = advisory.filter((check) => check.passed).length;
  const lines = [
    "# Scalpel Hardening Report",
    "",
    `Root: ${report.root}`,
    `Report: ${report.report_dir}`,
    `Scalpel commit: ${report.scalpel_commit ?? "unknown"}`,
    `Required checks: ${String(requiredPassed)}/${String(required.length)} passed`,
    `Advisory checks: ${String(advisoryPassed)}/${String(advisory.length)} passed`,
    ...(report.telemetry === undefined
      ? []
      : [
          `Duration: ${String(report.telemetry.duration_ms)} ms`,
          `Peak RSS: ${String(report.telemetry.peak_rss_bytes)} bytes`,
          `Final RSS: ${String(report.telemetry.final_rss_bytes)} bytes`,
        ]),
    "",
    "## Corpora",
    "",
  ];

  for (const corpus of report.corpora) {
    const fileCount = corpus.tracked_file_count === undefined
      ? ""
      : `, ${String(corpus.tracked_file_count)} tracked files`;
    lines.push(`- ${corpus.name}: ${corpus.commit ?? "unknown"}${fileCount} (${corpus.path})`);
  }

  lines.push("", "## Checks", "");
  for (const [index, item] of report.checks.entries()) {
    const status = item.passed ? "PASS" : "FAIL";
    const detail = item.detail === undefined ? "" : `: ${item.detail}`;
    const duration = item.duration_ms === undefined ? "" : ` (${String(item.duration_ms)} ms`;
    const rss =
      item.rss_before_bytes === undefined || item.rss_after_bytes === undefined
        ? ""
        : `${duration === "" ? " (" : ", "}rss ${String(item.rss_before_bytes)} -> ${String(item.rss_after_bytes)} bytes`;
    const telemetry = duration === "" && rss === "" ? "" : `${duration}${rss})`;
    lines.push(
      `- ${String(index + 1)}. ${status} [${item.severity}] ${item.name}${telemetry}${detail}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function serverPath(): string {
  const path = resolve("dist", "index.js");
  if (!existsSync(path)) {
    throw new Error("dist/index.js not found. Run pnpm build before hardening checks.");
  }
  return path;
}

async function run(commandName: string, args: string[], cwd: string): Promise<string> {
  const actualArgs = commandName === "git" ? ["-c", "core.longpaths=true", ...args] : args;
  const child = spawn(commandName, actualArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const code = await new Promise<number | null>((resolveExit) => {
    child.on("error", (error) => {
      stderr.push(Buffer.from(error.message));
      resolveExit(-1);
    });
    child.on("close", resolveExit);
  });

  const output = Buffer.concat(stdout).toString("utf8");
  if (code !== 0) {
    throw new Error(
      `${commandName} ${args.join(" ")} failed with ${String(code)}: ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
  return output.trim();
}

async function gitMaybe(args: string[], cwd: string): Promise<string | undefined> {
  try {
    return await run("git", args, cwd);
  } catch {
    return undefined;
  }
}

async function gitTrackedFileCount(cwd: string): Promise<number | undefined> {
  const output = await gitMaybe(["ls-files"], cwd);
  if (output === undefined) {
    return undefined;
  }
  if (output.length === 0) {
    return 0;
  }
  return output.split("\n").length;
}

async function isCorpusFixtureUsable(cwd: string): Promise<boolean> {
  const commit = await gitMaybe(["rev-parse", "HEAD"], cwd);
  if (commit === undefined) {
    return false;
  }

  const trackedFileCount = await gitTrackedFileCount(cwd);
  if (trackedFileCount === undefined || trackedFileCount === 0) {
    return false;
  }

  const status = await gitMaybe(["status", "--porcelain"], cwd);
  return status?.trim().length === 0;
}

function parseCommand(value: string | undefined): Command {
  if (
    value === "setup" ||
    value === "corpus" ||
    value === "race" ||
    value === "crash" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  return index === -1 || value === undefined || value.startsWith("--") ? undefined : value;
}

async function withTemporaryEnv<T>(
  values: Record<string, string>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

function shaFromStructuredContent(structuredContent: unknown): string {
  if (
    typeof structuredContent === "object" &&
    structuredContent !== null &&
    "sha256" in structuredContent &&
    typeof structuredContent.sha256 === "string"
  ) {
    return structuredContent.sha256;
  }
  throw new Error("stat response did not include sha256");
}

function rootsFromStructuredContent(structuredContent: unknown): string[] {
  if (
    typeof structuredContent === "object" &&
    structuredContent !== null &&
    "roots" in structuredContent &&
    Array.isArray(structuredContent.roots) &&
    structuredContent.roots.every((root) => typeof root === "string")
  ) {
    return structuredContent.roots;
  }
  throw new Error("config response did not include roots");
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

await main();
