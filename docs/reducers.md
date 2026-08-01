# Reducers

Reducers discover deterministic mutations against the current accepted candidate. Every mutation has a stable identifier, description, impact estimate, affected paths, and preparation requirement.

File reductions begin with directories and proceed to individual files. Manifest and JSON reducers preserve valid syntax. Source reductions use Oxc spans and MagicString so they do not reprint or reformat complete files. Dependency reductions trigger a candidate-local install before the failure command runs.

The `test-structure` reducer traverses nested JavaScript, TypeScript, JSX, and TSX syntax and proposes complete Vitest/Jest suite, test, and hook statements. It recognizes chained forms such as `test.each`, `test.skip`, and `describe.only`. Each edit is parsed before execution, and the failure oracle remains the authority on whether it is safe.

TypeScript, Vitest, Jest, Vite, and Next.js adapters are detected from command arguments, package metadata, and known configuration files. Adapters contribute protected configuration and source-reduction hints while the generic command path remains active.
