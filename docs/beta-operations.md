# Beta operations

This document records the evidence loop used after the public beta launch. It is
deliberately separate from support claims: observations become compatibility
evidence only after a deterministic real-command case is repeatable in the
cross-platform corpus.

## Current signal

As of 2026-08-08, the public beta feedback thread has no external observations.
The project therefore has no basis for claiming real-user adoption or ecosystem
success yet. Initial beta operations focus on closing known evidence gaps in the
existing fixtures while the feedback channel remains open.

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

The initial local corpus run used Node 24.18.0 on macOS arm64 and produced:

| Case                   | Candidate runs | File reduction | Byte reduction | Recipient verification |
| ---------------------- | -------------: | -------------: | -------------: | ---------------------- |
| Jest assertion failure |              3 |             0% |          23.3% | Passed                 |
| Vite build failure     |              2 |            60% |          39.6% | Passed                 |

Next.js remains experimental because only adapter evidence exists. Yarn Plug'n'Play
and Bun workspaces remain experimental for the same reason.

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
