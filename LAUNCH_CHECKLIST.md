# Public beta launch checklist

## Repository and npm setup

- [ ] Protect `main` and require all CI jobs.
- [ ] Create the protected GitHub environment `npm` with required reviewers.
- [ ] If `bugbonsai` does not exist on npm, complete the documented one-time
      interactive beta bootstrap from a disposable checkout.
- [ ] Configure npm's single Trusted Publisher for
      `captain-jack-sparrow909/BugBonsai`, `release.yml`, and environment `npm`.
- [ ] Require 2FA and disallow token publishing after OIDC is verified.
- [ ] Enable GitHub private vulnerability reporting.
- [ ] Create the `beta-feedback` and `compatibility` repository labels.
- [ ] Confirm the README description, topics, license, and social preview.

## Candidate validation

- [ ] Run `pnpm release:check` from a clean checkout.
- [ ] Review `COMPATIBILITY.md`; do not promote partial support to verified
      without a real-command reduction.
- [x] Complete at least three reviewed external dogfood observations (see
      [`docs/beta-validation.md`](docs/beta-validation.md#external-structural-dogfood)).
- [ ] Confirm all Changesets and beta release notes describe user-visible risk.
- [ ] Confirm `npm view bugbonsai` is either unclaimed or controlled by the
      maintainer account.

## Publish

- [ ] Manually run **Release** with an unused beta version such as
      `0.2.0-beta.0`.
- [ ] Approve the protected `npm` environment only after validation succeeds.
- [ ] Confirm `npm view bugbonsai@beta version` returns the requested version.
- [ ] Confirm the npm package displays provenance for the published tarball.
- [ ] Run `npx bugbonsai@beta --version` in a clean temporary project.
- [ ] Run one complete reduction and recipient verification from the published
      package.

## Announce and learn

- [ ] Publish a GitHub prerelease with scope, known limitations, and upgrade
      instructions.
- [ ] Share the terminal demo and a real before/after result with environment
      details.
- [ ] Link the compatibility scoreboard instead of making broad support claims.
- [ ] Triage beta feedback weekly and convert recurring failures into corpus
      cases before fixing them.
- [ ] Keep `latest` unchanged until the stable-release exit criteria are met.
