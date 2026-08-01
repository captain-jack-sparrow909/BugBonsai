import { describe, expect, it } from "vitest";
import {
  evaluateBenchmarkBudgets,
  type BenchmarkBudgets,
  type BenchmarkMeasurement,
} from "../../scripts/benchmark-budget.js";

const budgets: BenchmarkBudgets = {
  schemaVersion: 1,
  maxTotalDurationMs: 1_000,
  scenarios: {
    sample: {
      maxDurationMs: 800,
      maxCandidateRuns: 10,
      minByteReduction: 0.5,
      minCacheHits: 1,
    },
  },
};

const measurement: BenchmarkMeasurement = {
  name: "sample",
  durationMs: 500,
  candidateRuns: 8,
  cacheHits: 1,
  fileReduction: 0.25,
  byteReduction: 0.6,
};

describe("benchmark budgets", () => {
  it("accepts measurements within every budget", () => {
    expect(evaluateBenchmarkBudgets([measurement], budgets)).toEqual([]);
  });

  it("reports quality, run-count, duration, and coverage regressions", () => {
    const failures = evaluateBenchmarkBudgets(
      [
        {
          ...measurement,
          durationMs: 1_100,
          candidateRuns: 11,
          cacheHits: 0,
          byteReduction: 0.1,
        },
      ],
      budgets,
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("total duration"),
        expect.stringContaining("sample: duration"),
        expect.stringContaining("sample: 11 candidate runs"),
        expect.stringContaining("sample: byte reduction"),
        expect.stringContaining("sample: 0 cache hits"),
      ]),
    );
  });

  it("requires one-to-one coverage between results and budgets", () => {
    expect(
      evaluateBenchmarkBudgets(
        [{ ...measurement, name: "unexpected" }],
        budgets,
      ),
    ).toEqual(
      expect.arrayContaining([
        "sample: benchmark result is missing",
        "unexpected: no benchmark budget is defined",
      ]),
    );
  });
});
