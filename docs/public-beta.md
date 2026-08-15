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
npx bugbonsai@0.1.0-beta.4 --version
```

The one-time package bootstrap caused npm's required `latest` tag to point at the
only published version, which is still explicitly a SemVer prerelease. Use the
`beta` tag or the exact version while evaluating BugBonsai. No stable SemVer
release will be published until the promotion criteria below are met. Future
publication is a manual, protected workflow using npm Trusted Publishing and
provenance.

## Promotion to `latest`

The `latest` dist-tag moves only after all of these conditions are documented:

- at least 10 aggregate observations from people outside the project;
- at least 3 real-project reproductions that preserve the intended failure and
  pass recipient-side verification;
- evidence from at least 3 ecosystem combinations beyond the synthetic fixtures;
- at least 2 field-discovered gaps converted into license-safe corpus cases;
- no unresolved report of source-project mutation, secret disclosure, wrong-failure
  acceptance, corrupted resumability state, or recipient verification bypass;
- the full Linux, macOS, and Windows matrix passes on supported Node releases;
- the packed-consumer check passes for the exact promotion candidate; and
- README installation commands, release notes, known limitations, provenance,
  and rollback instructions have been reviewed.

Downloads, stars, impressions, or one successful maintainer-run case do not
satisfy these gates. If a blocker appears, publish another beta and restart the
candidate review instead of moving `latest`.

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

For a five-minute candidate checklist, recovery steps, and a copyable aggregate
report, follow the [early-adopter guide](early-adopter-guide.md).

## Report the outcome

The repository provides separate forms for product bugs, beta experience, and
compatibility evidence. Aggregate file/byte counts, candidate runs, duration,
tool versions, and whether `verify` succeeded are usually enough for initial
triage. Never paste private source, raw customer logs, local paths, tokens, or
environment values.

Use the [public beta feedback thread](https://github.com/captain-jack-sparrow909/BugBonsai/issues/9)
for quick observations, or open the
[structured **Beta feedback** form](https://github.com/captain-jack-sparrow909/BugBonsai/issues/new?template=beta-feedback.yml)
for a new environment-specific report. Release scope and known limitations are recorded
for the current package on the
[`0.1.0-beta.4` npm page](https://www.npmjs.com/package/bugbonsai/v/0.1.0-beta.4).

See [the compatibility scoreboard](../COMPATIBILITY.md) for the evidence behind
each support level and [external dogfooding](../dogfood/README.md) for a
privacy-preserving observation workflow.
