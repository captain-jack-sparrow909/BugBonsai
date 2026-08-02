# Releasing

BugBonsai uses Changesets and npm Trusted Publishing.

## One-time setup

1. Protect the `main` branch and require the CI workflow.
2. If the package does not exist on npm yet, bootstrap it once from a disposable
   clean checkout using an interactive maintainer login and 2FA:

   ```bash
   pnpm release:check
   pnpm prepare:beta 0.1.0-beta.0
   pnpm build
   pnpm pack:check
   npm publish --tag beta --access public
   ```

   This bootstrap is necessary because npm requires a package to exist before a
   Trusted Publisher can be configured. It is the only publication that does not
   use OIDC provenance; delete the disposable checkout afterward.

3. Configure GitHub Actions as the package's single trusted publisher, restricted to
   `.github/workflows/release.yml` on
   `captain-jack-sparrow909/BugBonsai`, environment `npm`, with `npm publish`
   permission.
4. Create a protected GitHub Actions environment named `npm`. Require reviewer
   approval for publication if desired.
5. Require 2FA and disallow token publishing in the npm package settings.

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

If stable publication fails because of an external outage, re-run the failed
workflow job. Never bypass validation with a local `npm publish`.

## Beta release

Manually dispatch the **Release** workflow with an exact numeric version such as
`0.2.0-beta.0`. It validates the unchanged checkout first, applies the version
inside the ephemeral runner, rebuilds and pack-checks that candidate, then
publishes it under the `beta` dist-tag with provenance. It never moves `latest`.

Stable and beta publication intentionally live in the same workflow because npm
allows only one Trusted Publisher configuration per package. Pushes to `main`
run the Changesets stable path; manual dispatch runs only the beta path. Both
publication jobs pin npm 11.19.0, above npm's 11.5.1 Trusted Publishing minimum,
rather than depending on the runner's bundled CLI.

Treat the version input as immutable: npm will reject a repeated version. Follow
[the launch checklist](../LAUNCH_CHECKLIST.md) before approving the protected
`npm` environment.
