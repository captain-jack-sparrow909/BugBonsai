# BugBonsai compatibility corpus

This corpus turns real failure shapes into a repeatable beta-readiness gate. Each
case is reduced in a fresh workspace, checked against explicit quality
expectations, and then verified using the same portability manifest a recipient
would receive.

Run it with:

```bash
pnpm corpus
```

## Adding a case

Add a small, deterministic fixture and register it in `cases.json`. A case must:

- fail without network access, credentials, services, or wall-clock assumptions;
- contain no secrets or proprietary source;
- name its failure with a stable sentinel;
- use `failOnOutput` when the bug is a warning or incorrect result that exits
  successfully;
- set finite run and reduction-quality expectations;
- declare the upstream project, version, and license when derived from an
  external open-source reproduction.

The checked-in fixtures are original BugBonsai test projects and are covered by
the repository MIT license. External contributions should be minimized before
being committed and retain any attribution their license requires.

Commands may use `{node}` for the current Node executable and `{root}` for the
BugBonsai checkout. Cases default to `noInstall: true`; a case may provide an
offline `installCommand` and set `noInstall: false` when dependency isolation is
part of the regression. Paths remain portable across Windows, macOS, and Linux.
