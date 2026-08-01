import { mkdtemp, rm } from "node:fs/promises";
import os, { cpus } from "node:os";
import path from "node:path";
import { reduceProject } from "../src/engine.js";
import type { ReductionOptions, ReductionResult } from "../src/types.js";

const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-benchmark-"));
process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

try {
  const run = async (
    name: string,
    options: Omit<ReductionOptions, "output">,
  ) => {
    const result: ReductionResult = await reduceProject({
      ...options,
      output: path.join(temporary, name),
      stabilityRuns: 1,
      finalRuns: 1,
    });
    const accepted = result.attempts.filter(
      (attempt) => attempt.accepted,
    ).length;
    const attemptedExecutions = result.candidateRuns + result.cacheHits;
    return {
      name,
      durationMs: result.durationMs,
      candidateRuns: result.candidateRuns,
      cacheHits: result.cacheHits,
      cacheHitRate:
        attemptedExecutions === 0
          ? 0
          : Number((result.cacheHits / attemptedExecutions).toFixed(3)),
      acceptedMutations: accepted,
      dependencySnapshotsReused: result.attempts.filter(
        (attempt) => attempt.dependencySnapshotReused,
      ).length,
      fileReduction: Number(
        (
          1 -
          result.finalMetrics.files / Math.max(1, result.originalMetrics.files)
        ).toFixed(3),
      ),
      byteReduction: Number(
        (
          1 -
          result.finalMetrics.bytes / Math.max(1, result.originalMetrics.bytes)
        ).toFixed(3),
      ),
      originalMetrics: result.originalMetrics,
      finalMetrics: result.finalMetrics,
    };
  };

  const scenarios = [];
  scenarios.push(
    await run("node-basic", {
      cwd: path.resolve("fixtures/node-basic"),
      command: [process.execPath, "failure.js"],
      match: "BUGBONSAI_SENTINEL_BASIC",
      noInstall: true,
      maxRuns: 50,
    }),
  );
  scenarios.push(
    await run("typescript-real", {
      cwd: path.resolve("fixtures/typescript-real"),
      command: [
        process.execPath,
        path.resolve("node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--pretty",
        "false",
      ],
      match: "TS2322",
      noInstall: true,
      maxRuns: 20,
      onlyReducers: ["files", "json-config"],
    }),
  );
  scenarios.push(
    await run("vitest-real", {
      cwd: path.resolve("fixtures/vitest-real"),
      command: [
        process.execPath,
        path.resolve("node_modules/vitest/vitest.mjs"),
        "run",
        "payment.test.ts",
      ],
      match: "BUGBONSAI_VITEST_SENTINEL",
      noInstall: true,
      maxRuns: 12,
      onlyReducers: ["test-structure"],
    }),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
          cpu: cpus()[0]?.model ?? "unknown",
        },
        scenarios,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
