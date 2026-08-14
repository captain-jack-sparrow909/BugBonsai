# Five-minute early-adopter guide

BugBonsai's public beta needs evidence from real projects, including unsuccessful
runs. This guide lets you evaluate it without publishing a reproduction or any
private source.

## Choose a useful first case

Start with a JavaScript or TypeScript project whose failing command:

- fails the same way on at least two consecutive runs;
- finishes in under two minutes;
- prints a distinctive, non-secret error fragment;
- runs without production credentials, customer data, or external services; and
- can tolerate repeated execution in disposable copies.

Commands that exit successfully but print a stable incorrect warning or diagnostic
are also supported with `--fail-on-output "DISTINCTIVE_WARNING"`.

Unit tests, type checks, and local builds are usually good first cases. Intermittent
failures, browser sessions, network-dependent commands, and destructive scripts
are poor first cases.

## Run a bounded evaluation

From the project root, replace the placeholder with a stable fragment from the
failure and replace `npm test` with the real failing command:

```bash
npx bugbonsai@beta \
  --match "DISTINCTIVE_ERROR_TEXT" \
  --max-runs 100 \
  -- npm test
```

BugBonsai copies the project into an isolated workspace and never modifies the
source project. The supplied command itself is not OS-sandboxed: it still has the
same network, process, and inherited-environment access as any local command.

If the baseline is rejected, choose a more distinctive `--match` value or read
the [failure-oracle guide](failure-oracles.md). If interrupted, run
`npx bugbonsai@beta resume` from the original invocation directory.

## Check the result

If a reproduction was exported, verify it before opening any generated file:

```bash
npx bugbonsai@beta verify ./bugbonsai-repro --no-install
```

Then confirm:

1. The reproduction preserves the failure you intended to capture.
2. The output is meaningfully smaller or reveals why further pruning stopped.
3. `verify` succeeds.
4. No file contains source, credentials, customer information, private paths, or
   environment values you did not intend to expose.

Do not upload the reproduction for initial feedback. Aggregate observations are
enough to improve the beta.

## Share a two-minute report

Use the
[feedback thread](https://github.com/captain-jack-sparrow909/BugBonsai/issues/9)
for a short observation or the
[structured feedback form](https://github.com/captain-jack-sparrow909/BugBonsai/issues/new?template=beta-feedback.yml)
for an environment-specific report.

```text
Outcome: useful / too large / wrong failure / could not complete
Ecosystem: Node __, framework __, tool __, package manager __
Original: __ files, __ MB
Reproduction: __ files, __ MB
Candidate runs: __
Duration: __
Verification: passed / failed / not attempted
Most useful or confusing part: __
```

Every outcome is useful. A run that cannot complete often identifies a higher
priority compatibility gap than a successful run.
