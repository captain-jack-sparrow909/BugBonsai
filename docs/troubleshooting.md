# Troubleshooting

Run `bugbonsai doctor --json` for a pasteable environment report.

## The baseline is unstable

Run the command repeatedly yourself, then add `--match` or `--match-regex` around a distinctive stable error fragment.

## Installation fails

Confirm the lockfile and package-manager version, review lifecycle scripts, or supply a token-free local `--install-command`. Authenticated `.npmrc` files are deliberately excluded.

## A valid removal is rejected

Use `--verbose` to inspect candidate output. The default oracle is conservative; a distinctive explicit matcher often gives it safe evidence despite framework output drift.
