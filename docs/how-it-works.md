# How BugBonsai works

BugBonsai applies hierarchical delta debugging to a project copy. Reducers propose mutations such as removing a directory, a manifest field, a dependency, a JSON property, or an AST span. Each proposal is evaluated in a disposable candidate.

A proposal is accepted only when the failure oracle finds compatible exit behavior, error identity, output tokens, and stack context. Accepted candidates become the next generation; rejected candidates are discarded. Execution is sequential in v0.1 so a result can never be accepted against a stale project generation.

Baseline capture also happens in disposable workspaces. This protects snapshots, generated outputs, caches, and other existing project files from the user-supplied command.

When `--root` points above the invocation directory, BugBonsai inventories and installs from that root but executes every baseline, candidate, and final validation from the same relative nested directory. Reports include that `cd` step so the reproduction command is not accidentally changed.
