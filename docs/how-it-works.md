# How BugBonsai works

BugBonsai applies hierarchical delta debugging to a project copy. Reducers propose mutations such as removing a directory, a manifest field, a dependency, a JSON property, or an AST span. Each proposal is evaluated in a disposable candidate.

Before file and dependency discovery, BugBonsai parses JavaScript, TypeScript, JSX, and TSX imports. Command paths, protected files, detected framework configuration, and normalized application stack frames seed a reachability graph. Unreachable files and packages never imported by parsed source receive higher impact scores, allowing the engine to remove likely noise sooner without treating static analysis as proof.

A proposal is accepted only when the failure oracle finds compatible exit behavior, error identity, output tokens, and stack context. Accepted candidates become the next generation; rejected candidates are discarded. Execution is sequential so a result can never be accepted against a stale project generation.

Session schema 4 persists the exact reducer index, accepted generation, deterministic schedule IDs, next mutation index, cumulative candidate executions, elapsed time, and active dependency snapshot. State is written before progress callbacks are emitted. If a callback, SIGINT, or SIGTERM interrupts the run, resumption uses the same run ID and continues at the next safe boundary without replenishing `maxRuns`.

Before preparation and command execution, BugBonsai fingerprints the complete candidate tree. Rejections are cached against that content plus the command, baseline, oracle, version, invocation directory, and a one-way environment fingerprint. Cache entries contain only the rejection score and reason. Accepted outcomes are deliberately not cached: every accepted mutation must still execute the failure command.

When dependency metadata changes, the candidate receives a private filesystem copy of the last accepted installation snapshot before the mutable package-manager install. The package manager can reuse prepared package contents, but its changes remain candidate-local. If accepted, that installed tree becomes the next snapshot; if rejected, it is discarded.

Reduction progress events include consumed and remaining run budget, normalized budget progress, and an ETA derived from completed uncached candidate durations. The ETA is deliberately a worst-case budget estimate because productive reductions may finish before every available run is consumed.

Baseline capture also happens in disposable workspaces. This protects snapshots, generated outputs, caches, and other existing project files from the user-supplied command.

When `--root` points above the invocation directory, BugBonsai inventories and installs from that root but executes every baseline, candidate, and final validation from the same relative nested directory. Reports include that `cd` step so the reproduction command is not accidentally changed.
