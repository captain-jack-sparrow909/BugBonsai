# BugBonsai architecture

BugBonsai is a local delta-debugging engine. It repeatedly removes project material and accepts a removal only when an explainable failure oracle confirms that the original failure remains.

## Invariants

1. Existing files in the source project are never modified. Baseline commands run in disposable workspaces.
2. A non-zero exit code alone never proves failure equivalence.
3. Every candidate outcome and its next deterministic scheduler cursor are persisted before progress is reported or the next reduction begins.
4. Raw environment values and unredacted command output are not persisted.
5. Candidate evaluation is sequential. This avoids accepting incompatible mutations from stale candidate generations.
6. The sanitized export is installed and verified from a fresh directory before success is reported.

## Lifecycle

1. Resolve inventory root, invocation directory, and package-manager root.
2. Copy a read-only logical seed into the session directory.
3. Prepare dependencies once, then capture the baseline in disposable copies.
4. Copy the current best candidate, apply a mutation, execute, and compare.
5. Persist accepted candidates and a bounded, redacted attempt record.
6. Scan the final candidate, export it, install it fresh, and revalidate it.

## Domains

- `process`: bounded, cancellable child execution without a shell.
- `oracle`: normalization, structured signatures, and explainable matching.
- `sandbox`: inventory, safe copy, containment, and session persistence.
- `reducers`: hierarchical file, workspace manifest, JSON/JSONC, dependency, source, and nested test-structure pruning.
- `import-graph`: conservative local-module reachability and package-import evidence used only for candidate ordering.
- `ddmin`: deterministic coarse-to-fine compound mutation scheduling.
- `cache`: content- and execution-fingerprinted rejected-candidate reuse; acceptances are never cached.
- `session scheduler`: schema-versioned reducer cursor, cumulative run budget, elapsed time, and dependency-snapshot pointer for same-run continuation.
- `plugin`: API-versioned trusted ESM loading, component namespacing, runtime contract validation, and source fingerprinting.
- `adapters`: evidence-based TypeScript, Vitest, Jest, Vite, and Next.js detection and reduction hints.
- `config`: validated project-local defaults and trusted custom-oracle selection.
- `core`: orchestration and acceptance policy.
- `report`: Markdown and versioned JSON reproduction metadata.

The public API exposes reduction entry points, stable configuration/result and oracle types, custom failure-oracle helpers, and the framework-adapter contract. Reducer internals remain private until their extension contract has real-world validation.
