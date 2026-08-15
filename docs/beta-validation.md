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
- a TypeScript declaration-merging failure whose identity depends on file order;
- a TypeDoc-shaped zero-exit warning with ESM sibling dependencies, a workspace
  package link, and a workspace-local installation;
- a real Vitest assertion failure;
- a real Jest assertion failure with test-structure reduction;
- a real Vite build failure;
- framework-independent nested test structure.

CI runs the corpus on Node 22 and 24 across Linux, Windows, and macOS, plus Node
26 on Linux. A framework or platform should not be advertised as supported until
an offline deterministic case exercises its failure path in this matrix.

See `corpus/README.md` for fixture contribution and licensing rules.
Post-launch evidence and the weekly triage loop are recorded in
[`docs/beta-operations.md`](beta-operations.md).

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

## External structural dogfood

On 2026-08-02, the beta candidate reduced synthetic failing assertions against
three clean, pinned, MIT-licensed public projects. These checks exercise real
repository layouts without claiming that the upstream projects contain bugs;
they are therefore launch evidence, not compatibility-scoreboard entries.

| Project                                                                                     | Commit    |                  Original |   Verified reproduction | Candidate runs |
| ------------------------------------------------------------------------------------------- | --------- | ------------------------: | ----------------------: | -------------: |
| [`sindresorhus/yoctocolors`](https://github.com/sindresorhus/yoctocolors)                   | `a02a16e` | 17 files, 11 dependencies | 3 files, 0 dependencies |            100 |
| [`sindresorhus/escape-string-regexp`](https://github.com/sindresorhus/escape-string-regexp) | `cbc4240` |  12 files, 3 dependencies | 2 files, 0 dependencies |             15 |
| [`sindresorhus/slash`](https://github.com/sindresorhus/slash)                               | `98b618f` |  13 files, 3 dependencies | 2 files, 0 dependencies |             13 |

Each result passed BugBonsai's recipient-side verification with installation
disabled. Only aggregate metrics and normalized failure hashes were retained;
no upstream source or generated reproduction is stored in this repository.

## Public failure field validation

On 2026-08-14, a pinned checkout of
[`Teascade/typescript-error-demonstration`](https://github.com/Teascade/typescript-error-demonstration)
at commit `e07b566143dc79437be4915db66f155ec9ca6515`, prepared according to its
upstream npm-link instructions, reproduced the linked-package TS2742 failure reported in
[`microsoft/TypeScript#58914`](https://github.com/microsoft/TypeScript/issues/58914).
The run exposed two isolation gaps: required declarations in ignored `dist/`
output were absent, and `--no-install` did not preserve the prepared workspace
dependency links. After recovery was implemented, BugBonsai reduced 19 project
files and 32.4 KB to 5 files and 1.33 KB in 6.1 seconds. It verified the TS2742
oracle twice before reduction and three times afterward.

This is engine field evidence, not a recipient-portability claim. The upstream
case requires a manually prepared npm-link topology, and `--no-install` exports
no dependency tree. Only the pinned revision, aggregate metrics, timing, and
failure identity are recorded here; no upstream source or reproduction is
stored in this repository.

The same process uncovered a second isolation gap on 2026-08-14 using
[`lucasmcht-corp/next-font-404-repro`](https://github.com/lucasmcht-corp/next-font-404-repro)
at commit `c7355acb832acb8831c9773a663b5e63cf3ba94f`, linked from
[`vercel/next.js#97378`](https://github.com/vercel/next.js/issues/97378). The
original Next.js 16.3.1 build reproducibly failed with the reported Turbopack
module-resolution error. BugBonsai `0.1.0-beta.3` initially replaced that
failure with `Could not find the Next.js package` because the isolated
candidate resolved its linked dependency snapshot outside the candidate root.
BugBonsai now materializes that snapshot for detected Next.js projects. The
fixed local candidate preserved the intended failure twice before reduction and
three times afterward, reducing 8 project files and 35.6 KB to 4 files and
32.3 KB in 86.7 seconds across 15 candidate executions.

This remains engine field evidence rather than a Next.js support claim. The run
used `--no-install`, so recipient portability was not evaluated, and the
license-safe regression covers the isolation invariant rather than copying the
upstream project into the corpus.

Additional candidates were intentionally excluded from compatibility evidence:
the historical reproduction for
[`microsoft/TypeScript#48212`](https://github.com/microsoft/TypeScript/issues/48212)
requires pnpm 6, which does not run on the current Node 24 validation host, while
the investigated Vite reproduction requires an interactive browser oracle.
