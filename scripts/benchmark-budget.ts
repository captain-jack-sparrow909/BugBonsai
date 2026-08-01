export interface BenchmarkMeasurement {
  name: string;
  durationMs: number;
  candidateRuns: number;
  cacheHits: number;
  fileReduction: number;
  byteReduction: number;
}

interface ScenarioBudget {
  maxDurationMs: number;
  maxCandidateRuns: number;
  minFileReduction?: number;
  minByteReduction?: number;
  minCacheHits?: number;
}

export interface BenchmarkBudgets {
  schemaVersion: number;
  maxTotalDurationMs: number;
  scenarios: Record<string, ScenarioBudget>;
}

export function evaluateBenchmarkBudgets(
  measurements: BenchmarkMeasurement[],
  budgets: BenchmarkBudgets,
): string[] {
  if (budgets.schemaVersion !== 1)
    return [`Unsupported benchmark budget schema ${budgets.schemaVersion}.`];
  const failures: string[] = [];
  const byName = new Map(measurements.map((item) => [item.name, item]));
  const totalDuration = measurements.reduce(
    (sum, item) => sum + item.durationMs,
    0,
  );
  if (totalDuration > budgets.maxTotalDurationMs)
    failures.push(
      `total duration ${totalDuration}ms exceeds ${budgets.maxTotalDurationMs}ms`,
    );
  for (const [name, budget] of Object.entries(budgets.scenarios)) {
    const measurement = byName.get(name);
    if (!measurement) {
      failures.push(`${name}: benchmark result is missing`);
      continue;
    }
    if (measurement.durationMs > budget.maxDurationMs)
      failures.push(
        `${name}: duration ${measurement.durationMs}ms exceeds ${budget.maxDurationMs}ms`,
      );
    if (measurement.candidateRuns > budget.maxCandidateRuns)
      failures.push(
        `${name}: ${measurement.candidateRuns} candidate runs exceeds ${budget.maxCandidateRuns}`,
      );
    if (
      budget.minFileReduction !== undefined &&
      measurement.fileReduction < budget.minFileReduction
    )
      failures.push(
        `${name}: file reduction ${measurement.fileReduction} is below ${budget.minFileReduction}`,
      );
    if (
      budget.minByteReduction !== undefined &&
      measurement.byteReduction < budget.minByteReduction
    )
      failures.push(
        `${name}: byte reduction ${measurement.byteReduction} is below ${budget.minByteReduction}`,
      );
    if (
      budget.minCacheHits !== undefined &&
      measurement.cacheHits < budget.minCacheHits
    )
      failures.push(
        `${name}: ${measurement.cacheHits} cache hits is below ${budget.minCacheHits}`,
      );
  }
  for (const measurement of measurements) {
    if (!(measurement.name in budgets.scenarios))
      failures.push(`${measurement.name}: no benchmark budget is defined`);
  }
  return failures;
}
