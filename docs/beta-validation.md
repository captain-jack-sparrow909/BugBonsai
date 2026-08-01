# Beta validation

BugBonsai treats compatibility and reduction quality as checked properties, not
support claims inferred from package detection.

## Compatibility corpus

`pnpm corpus` reads `corpus/cases.json`, runs every case in a fresh local
workspace, enforces its run and reduction expectations, and verifies the final
portable reproduction. The current corpus covers:

- a plain Node.js runtime error;
- deep JavaScript AST reduction;
- a real TypeScript compiler diagnostic;
- a real Vitest assertion failure;
- framework-independent nested test structure.

CI runs the corpus on Node 22 and 24 across Linux, Windows, and macOS, plus Node
26 on Linux. A framework or platform should not be advertised as supported until
an offline deterministic case exercises its failure path in this matrix.

See `corpus/README.md` for fixture contribution and licensing rules.

## Performance and quality budgets

`pnpm benchmark:check` compares the benchmark matrix with the versioned limits
in `benchmarks/budgets.json`. The gate covers elapsed time, candidate executions,
cache reuse, and reduction quality. Duration ceilings intentionally allow normal
CI variance; deterministic run-count and reduction regressions use tighter
limits.

Change a budget only with benchmark output explaining why the new behavior is
acceptable. Do not raise a time budget to conceal an accidental algorithmic
regression.

## Fault model

The automated suite injects intermittent commands, installation failures,
hostile output volume, missing executables, corrupt session state, interruptions,
archive tampering, and manifest path traversal. These tests prove that failures
do not publish partial output or mutate the source project.

This is application-level fault containment. It is not an operating-system
sandbox and does not make untrusted commands safe.

## Release candidate gate

Run the same validation used before npm publication:

```bash
pnpm release:check
```

It runs formatting, type checking, linting, tests, build, compatibility corpus,
budgeted benchmarks, and a clean packed-consumer installation. Publication then
uses the protected `npm` GitHub environment and npm Trusted Publishing; it does
not require a long-lived npm token.
