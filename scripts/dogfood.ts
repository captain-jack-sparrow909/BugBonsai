import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { reduceProject } from "../src/engine.js";
import { verifyReproduction } from "../src/verify.js";
import { VERSION } from "../src/version.js";
import {
  canonicalGitHubRepository,
  validateDogfoodCase,
} from "./dogfood-case.js";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const caseIndex = args.indexOf("--case");
const outputIndex = args.indexOf("--output");
const casePath = caseIndex >= 0 ? args[caseIndex + 1] : undefined;
const observationPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
if (!casePath || (outputIndex >= 0 && !observationPath))
  throw new Error(
    "Usage: pnpm dogfood -- --case <case.json> [--output <observation.json>]",
  );
const knownIndexes = new Set(
  [caseIndex, outputIndex]
    .filter((index) => index >= 0)
    .flatMap((index) => [index, index + 1]),
);
if (args.some((_argument, index) => !knownIndexes.has(index)))
  throw new Error("Unknown dogfood runner argument.");

const checkoutRoot = process.cwd();
const descriptor = validateDogfoodCase(
  JSON.parse(await readFile(path.resolve(casePath), "utf8")),
);
const project = path.resolve(
  path.dirname(path.resolve(casePath)),
  descriptor.project,
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-dogfood-"));
process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

try {
  const [{ stdout: head }, { stdout: remote }, { stdout: status }] =
    await Promise.all([
      execFileAsync("git", ["-C", project, "rev-parse", "HEAD"]),
      execFileAsync("git", ["-C", project, "remote", "get-url", "origin"]),
      execFileAsync("git", ["-C", project, "status", "--porcelain"]),
    ]);
  if (!head.trim().startsWith(descriptor.upstream.commit))
    throw new Error(
      `Dogfood checkout is at ${head.trim()}, not ${descriptor.upstream.commit}.`,
    );
  if (
    canonicalGitHubRepository(remote) !==
    canonicalGitHubRepository(descriptor.upstream.repository)
  )
    throw new Error("Dogfood checkout origin does not match the descriptor.");
  if (status.trim())
    throw new Error(
      "Dogfood checkout has tracked or untracked changes; use a clean pinned commit.",
    );
  const command = descriptor.command.map((part) =>
    part
      .replaceAll("{node}", process.execPath)
      .replaceAll("{root}", checkoutRoot),
  );
  const result = await reduceProject({
    cwd: project,
    command,
    output: path.join(temporary, "repro"),
    ...(descriptor.match ? { match: descriptor.match } : {}),
    ...(descriptor.matchRegex ? { matchRegex: descriptor.matchRegex } : {}),
    timeoutMs: descriptor.timeoutMs ?? 60_000,
    maxRuns: descriptor.maxRuns ?? 100,
    mode: descriptor.mode ?? "balanced",
    onlyReducers: descriptor.onlyReducers ?? [],
    noInstall: true,
    stabilityRuns: 2,
    finalRuns: 2,
    outputMode: "quiet",
  });
  await verifyReproduction(result.outputDirectory, { install: false });
  const observation = {
    schemaVersion: 1,
    caseId: descriptor.id,
    upstream: descriptor.upstream,
    bugbonsaiVersion: VERSION,
    observedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    result: {
      verified: true,
      adapters: result.detectedAdapters,
      originalMetrics: result.originalMetrics,
      finalMetrics: result.finalMetrics,
      candidateRuns: result.candidateRuns,
      cacheHits: result.cacheHits,
      durationMs: result.durationMs,
      failureHash: result.finalSignature.stableHash,
    },
  };
  const serialized = `${JSON.stringify(observation, null, 2)}\n`;
  if (observationPath)
    await writeFile(path.resolve(observationPath), serialized, { flag: "wx" });
  process.stdout.write(serialized);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
