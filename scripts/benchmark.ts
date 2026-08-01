import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reduceProject } from "../src/engine.js";

const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-benchmark-"));
process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

try {
  const result = await reduceProject({
    cwd: path.resolve("fixtures/node-basic"),
    command: [process.execPath, "failure.js"],
    output: path.join(temporary, "repro"),
    match: "BUGBONSAI_SENTINEL_BASIC",
    noInstall: true,
    maxRuns: 50,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        durationMs: result.durationMs,
        candidateRuns: result.candidateRuns,
        cacheHits: result.cacheHits,
        originalMetrics: result.originalMetrics,
        finalMetrics: result.finalMetrics,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
