# Troubleshooting

Run `bugbonsai doctor --json` for a pasteable environment report.

## The baseline is unstable

Run the command repeatedly yourself, then add `--match` or `--match-regex` around a distinctive stable error fragment.

## Installation fails

Confirm the lockfile and package-manager version, review lifecycle scripts, or supply a token-free local `--install-command`. Authenticated `.npmrc` files are deliberately excluded.

## The isolated baseline loses a generated file

BugBonsai starts with Git-visible files. If that baseline no longer matches, it automatically retries with safe gitignored files from the working tree. Dependency trees, caches, and sensitive files remain excluded. Use `--exclude` to omit an expensive ignored path or `--keep` when a deliberately ignored sensitive filename has been reviewed and is essential.

Commands run in disposable execution copies, so files created by a compiler or test runner are not promoted into the accepted project candidate.

## A valid removal is rejected

Use `--verbose` to inspect candidate output. The default oracle is conservative; a distinctive explicit matcher often gives it safe evidence despite framework output drift.
