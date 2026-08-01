# Releasing

BugBonsai uses Changesets and npm Trusted Publishing.

## One-time setup

1. Protect the `main` branch and require the CI workflow.
2. On npm, create or claim the `bugbonsai` package.
3. Configure GitHub Actions as its trusted publisher, restricted to
   `.github/workflows/release.yml` on
   `captain-jack-sparrow909/BugBonsai`.
4. Create a protected GitHub Actions environment named `npm`. Require reviewer
   approval for publication if desired.

No long-lived npm token should be added to repository secrets. The release workflow requests `id-token: write` so npm can validate the GitHub OIDC identity and attach provenance.

## Normal release

Add a Changeset with a user-visible change. Merging the Changesets version pull
request lets the release workflow run `pnpm release:check` and publish the
resulting version. That gate includes the compatibility corpus, budgeted
benchmarks, and a clean packed-consumer installation.

The release job runs only in the canonical repository, waits for validation,
uses serialized workflow concurrency, and enters the protected `npm` environment
before receiving `id-token: write` permission. `publishConfig.provenance` and
`NPM_CONFIG_PROVENANCE` both require npm provenance.

If publication needs to be retried after an external outage, manually dispatch
the same release workflow. Never bypass validation with a local `npm publish`.
