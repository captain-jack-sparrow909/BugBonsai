# Benchmarks

Run the deterministic built-in benchmark matrix:

```bash
pnpm benchmark
```

The matrix exercises a generic Node failure, a real TypeScript compiler failure, and a real Vitest assertion failure. For every scenario it reports elapsed time, candidate executions, rejected-candidate cache hits and hit rate, accepted transformations, file and byte reduction ratios, and original/final metrics. It also records Node, operating-system architecture, and CPU model.

Use the matrix to detect regressions in three separate dimensions:

- reduction quality: `fileReduction`, `byteReduction`, and final metrics;
- execution cost: `durationMs` and `candidateRuns`;
- avoided work: `cacheHits` and `cacheHitRate`.
- dependency preparation reuse: `dependencySnapshotsReused`.

Results vary with hardware and Node version. The project does not publish performance claims without the emitted environment block and repeated measurements on a clean checkout.
