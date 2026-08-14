import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reduceProject } from "../src/engine.js";
import type { ReductionResult } from "../src/types.js";
import { verifyReproduction } from "../src/verify.js";

interface AbsentTextExpectation {
  path: string;
  text: string;
}

interface CorpusCase {
  id: string;
  category: string;
  fixture: string;
  command: string[];
  match?: string;
  failOnOutput?: string;
  installCommand?: string[];
  noInstall?: boolean;
  mode?: "fast" | "balanced" | "thorough";
  maxRuns: number;
  reducers: string[];
  expect: {
    adapter?: string;
    minFileReduction?: number;
    minByteReduction?: number;
    maxCandidateRuns: number;
    absentText?: AbsentTextExpectation[];
  };
}

interface CorpusManifest {
  schemaVersion: number;
  cases: CorpusCase[];
}

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "corpus", "cases.json"), "utf8"),
) as CorpusManifest;

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases))
  throw new Error("Unsupported compatibility corpus manifest.");

const ids = manifest.cases.map(({ id }) => id);
if (new Set(ids).size !== ids.length)
  throw new Error("Compatibility corpus case IDs must be unique.");

const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-corpus-"));
process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

function ratio(before: number, after: number): number {
  return Number((1 - after / Math.max(1, before)).toFixed(3));
}

function resolveCommand(command: string[]): string[] {
  return command.map((part) =>
    part.replaceAll("{node}", process.execPath).replaceAll("{root}", root),
  );
}

async function assertExpectations(
  testCase: CorpusCase,
  result: ReductionResult,
): Promise<void> {
  const fileReduction = ratio(
    result.originalMetrics.files,
    result.finalMetrics.files,
  );
  const byteReduction = ratio(
    result.originalMetrics.bytes,
    result.finalMetrics.bytes,
  );
  if (
    testCase.expect.adapter &&
    !result.detectedAdapters.includes(testCase.expect.adapter)
  )
    throw new Error(
      `${testCase.id}: expected adapter ${testCase.expect.adapter}.`,
    );
  if (
    testCase.expect.minFileReduction !== undefined &&
    fileReduction < testCase.expect.minFileReduction
  )
    throw new Error(
      `${testCase.id}: file reduction ${fileReduction} is below ${testCase.expect.minFileReduction}.`,
    );
  if (
    testCase.expect.minByteReduction !== undefined &&
    byteReduction < testCase.expect.minByteReduction
  )
    throw new Error(
      `${testCase.id}: byte reduction ${byteReduction} is below ${testCase.expect.minByteReduction}.`,
    );
  if (result.candidateRuns > testCase.expect.maxCandidateRuns)
    throw new Error(
      `${testCase.id}: used ${result.candidateRuns} candidate runs; budget is ${testCase.expect.maxCandidateRuns}.`,
    );
  for (const absent of testCase.expect.absentText ?? []) {
    const content = await readFile(
      path.join(result.outputDirectory, absent.path),
      "utf8",
    );
    if (content.includes(absent.text))
      throw new Error(
        `${testCase.id}: ${absent.path} still contains ${JSON.stringify(absent.text)}.`,
      );
  }
}

try {
  const results = [];
  for (const testCase of manifest.cases) {
    if (Boolean(testCase.match) === Boolean(testCase.failOnOutput))
      throw new Error(
        `${testCase.id}: choose exactly one of match or failOnOutput.`,
      );
    const fixture = path.resolve(root, testCase.fixture);
    const output = path.join(temporary, testCase.id);
    const result = await reduceProject({
      cwd: fixture,
      command: resolveCommand(testCase.command),
      output,
      ...(testCase.match ? { match: testCase.match } : {}),
      ...(testCase.failOnOutput ? { failOnOutput: testCase.failOnOutput } : {}),
      ...(testCase.installCommand
        ? { installCommand: resolveCommand(testCase.installCommand) }
        : {}),
      mode: testCase.mode ?? "balanced",
      noInstall: testCase.noInstall ?? true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: testCase.maxRuns,
      onlyReducers: testCase.reducers,
      outputMode: "quiet",
    });
    await assertExpectations(testCase, result);
    await verifyReproduction(output, {
      install: !(testCase.noInstall ?? true),
    });
    results.push({
      id: testCase.id,
      category: testCase.category,
      durationMs: result.durationMs,
      candidateRuns: result.candidateRuns,
      fileReduction: ratio(
        result.originalMetrics.files,
        result.finalMetrics.files,
      ),
      byteReduction: ratio(
        result.originalMetrics.bytes,
        result.finalMetrics.bytes,
      ),
      verified: true,
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
        },
        cases: results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
