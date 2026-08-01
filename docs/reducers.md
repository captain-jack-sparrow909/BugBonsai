# Reducers

Reducers discover deterministic mutations against the current accepted candidate. Every mutation has a stable identifier, description, impact estimate, affected paths, and preparation requirement.

File reductions begin with directories and proceed to individual files. Manifest and JSON reducers preserve valid syntax. Source reductions use Oxc spans and MagicString so they do not reprint or reformat complete files. Dependency reductions trigger a candidate-local install before the failure command runs.
