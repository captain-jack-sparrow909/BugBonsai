# Contributing

Thank you for helping BugBonsai produce smaller and more trustworthy reproductions.

## Development

Use Node.js 22 or newer and pnpm:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm corpus
pnpm benchmark:check
```

Changes affecting behavior should add a fixture or adversarial oracle test. Never weaken failure matching solely to make a reduction fixture pass.

## Pull requests

- Keep changes focused and explain any new failure-equivalence assumptions.
- Add a Changeset for user-visible changes.
- Include tests that prove the original fixture is not modified.
- Do not commit private reproductions, credentials, or raw customer logs.
- Avoid claiming framework or package-manager support that is not exercised in CI.
- Register deterministic real-world failure shapes in `corpus/cases.json` and
  preserve attribution for externally derived fixtures.
- Include before/after evidence when changing `benchmarks/budgets.json`.
- Use the local-only dogfood runner for public upstream failures; commit only
  reviewed aggregate observations, never third-party source or raw output.

See `ARCHITECTURE.md` for invariants that every reducer must preserve.

Plugin API changes must retain runtime validation, namespacing, and oracle authority. Treat changes to exported plugin interfaces or API-version behavior as public compatibility work, add a packed-consumer check, and document migration expectations in `docs/plugins.md`.
