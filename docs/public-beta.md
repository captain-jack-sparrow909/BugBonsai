# Public beta

The beta is for developers with a stable failing JavaScript or TypeScript command
who are willing to review and report reduction quality. BugBonsai remains local:
it has no telemetry and does not upload reproductions or error output.

## Install the beta

Install the current public beta:

```bash
npx bugbonsai@beta -- npm test
```

Pin the exact version when recording a reproducible observation:

```bash
npx bugbonsai@0.1.0-beta.0 --version
```

The one-time package bootstrap caused npm's required `latest` tag to point at the
only published version, which is still explicitly a SemVer prerelease. Use the
`beta` tag or the exact version while evaluating BugBonsai. No stable SemVer
release will be published until the stable-release exit criteria are met. Future
publication is a manual, protected workflow using npm Trusted Publishing and
provenance.

## A useful first session

Choose a deterministic failure that runs locally without credentials or external
services. Start with an identifying error fragment and a bounded run count:

```bash
npx bugbonsai@beta \
  --match "DISTINCTIVE_ERROR_TEXT" \
  --max-runs 100 \
  --archive ./bug-repro.zip \
  -- npm test
```

Then verify the exported directory yourself:

```bash
npx bugbonsai@beta verify ./bugbonsai-repro --no-install
```

Review all generated files before sharing them. The integrity manifest proves
whether files changed after export; it does not certify that their contents are
safe to publish.

## Report the outcome

The repository provides separate forms for product bugs, beta experience, and
compatibility evidence. Aggregate file/byte counts, candidate runs, duration,
tool versions, and whether `verify` succeeded are usually enough for initial
triage. Never paste private source, raw customer logs, local paths, tokens, or
environment values.

Use the [public beta feedback thread](https://github.com/captain-jack-sparrow909/BugBonsai/issues/9)
for quick observations, or open the structured **Beta feedback** issue form for a
new environment-specific report. Release scope and known limitations are recorded
in the [v0.1.0-beta.0 prerelease](https://github.com/captain-jack-sparrow909/BugBonsai/releases/tag/v0.1.0-beta.0).

See [the compatibility scoreboard](../COMPATIBILITY.md) for the evidence behind
each support level and [external dogfooding](../dogfood/README.md) for a
privacy-preserving observation workflow.
