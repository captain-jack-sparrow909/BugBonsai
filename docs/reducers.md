# Reducers

Reducers discover deterministic mutations against the current accepted candidate. Every mutation has a stable identifier, description, impact estimate, affected paths, and preparation requirement.

File reductions begin with directories and proceed to individual files. A conservative Oxc import graph makes source files unreachable from command, protected, configuration, and failure-stack entry paths the earliest file candidates. Package dependencies absent from every parsed source import are attempted before referenced packages. The graph only changes ordering; the failure oracle still decides every deletion.

Manifest and recursive JSON/JSONC reducers preserve valid syntax and surrounding comments while removing nested object properties and array elements. Source reductions use Oxc spans and MagicString so they do not reprint or reformat complete files. Dependency reductions trigger a candidate-local install and lockfile refresh before the failure command runs.

File, manifest, JSON configuration, and dependency candidates use deterministic coarse-to-fine partitions. BugBonsai starts with large removal groups, increases granularity after rejection, and rediscovers coarse partitions whenever a group succeeds. Individual candidates remain the final fallback.

The `test-structure` reducer traverses nested JavaScript, TypeScript, JSX, and TSX syntax and proposes complete Vitest/Jest suite, test, and hook statements. It recognizes chained forms such as `test.each`, `test.skip`, and `describe.only`. Each edit is parsed before execution, and the failure oracle remains the authority on whether it is safe.

TypeScript, Vitest, Jest, Vite, and Next.js adapters are detected from command arguments, package metadata, and known configuration files. Adapters contribute protected configuration and source-reduction hints while the generic command path remains active.

In `thorough` mode, the `deep-source` reducer proposes nested block statements, `if`/`else` and conditional branches, class members, switch cases, object properties, array elements, JSX attributes, and JSX children. Comma-sensitive list edits include the adjacent separator, and every generated edit must parse before its command is executed.
