# Beta operations

This document records the evidence loop used after the public beta launch. It is
deliberately separate from support claims: observations become compatibility
evidence only after a deterministic real-command case is repeatable in the
cross-platform corpus.

## Current signal

As of 2026-08-14, `0.1.0-beta.3` is published and the public beta feedback
thread has no confirmed external BugBonsai run. A reply on an upstream issue is
not counted unless the participant says they ran the package or provides
aggregate run evidence. The project therefore has no basis for claiming
real-user adoption or ecosystem success yet. Maintainer-run public failure
investigations are recorded separately as field evidence and do not count as
external adoption.

Canonical feedback thread:
https://github.com/captain-jack-sparrow909/BugBonsai/issues/9

## Evidence promoted in this phase

- Jest: installed Jest CLI, real assertion failure, adapter detection,
  test-structure pruning, and recipient verification.
- Vite: installed Vite CLI, real build failure, file pruning, and recipient
  verification.

Both cases run through `pnpm corpus`, so CI exercises them on the same Node and
operating-system matrix as the existing compatibility cases. A local pass is not
enough to call them verified; the status is confirmed only after the complete CI
matrix passes.

A pinned Next.js 16.3.1/Turbopack public reproduction also exposed a hermetic
dependency-resolution gap in `0.1.0-beta.3`. The local fix materializes the
dependency snapshot inside each disposable candidate, preserved the intended
failure across the complete reduction, and added a source-independent
regression test for the realpath invariant. This is field-discovered engine
evidence; it is not external adoption, recipient verification, or a promoted
compatibility case.

The initial local corpus run used Node 24.18.0 on macOS arm64 and produced:

| Case                   | Candidate runs | File reduction | Byte reduction | Recipient verification |
| ---------------------- | -------------: | -------------: | -------------: | ---------------------- |
| Jest assertion failure |              3 |             0% |          23.3% | Passed                 |
| Vite build failure     |              2 |            60% |          39.6% | Passed                 |

Next.js remains experimental because field and adapter evidence still lacks a
portable corpus case and cross-platform recipient verification. Yarn Plug'n'Play
and Bun workspaces remain experimental because only adapter evidence exists.

## Weekly triage loop

1. Review new beta feedback and compatibility issues.
2. Reproduce a report without copying private source or raw logs into the repo.
3. Reduce the failure to a deterministic, license-safe fixture.
4. Add finite run-count and reduction-quality expectations to the corpus.
5. Verify the exported reproduction as a recipient.
6. Update the compatibility matrix only after the full CI matrix passes.
7. Link the regression case back to the originating public issue.

Aggregate metrics, tool versions, and normalized failure hashes are acceptable
evidence. Private paths, environment values, credentials, customer logs, and
third-party source are not.
