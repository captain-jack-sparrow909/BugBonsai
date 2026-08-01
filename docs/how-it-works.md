# How BugBonsai works

BugBonsai applies hierarchical delta debugging to a project copy. Reducers propose mutations such as removing a directory, a manifest field, a dependency, a JSON property, or an AST span. Each proposal is evaluated in a disposable candidate.

A proposal is accepted only when the failure oracle finds compatible exit behavior, error identity, output tokens, and stack context. Accepted candidates become the next generation; rejected candidates are discarded. Execution is sequential in v0.1 so a result can never be accepted against a stale project generation.

Baseline capture also happens in disposable workspaces. This protects snapshots, generated outputs, caches, and other existing project files from the user-supplied command.
