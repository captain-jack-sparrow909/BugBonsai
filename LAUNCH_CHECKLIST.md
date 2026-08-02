# Public beta launch checklist

## Repository and npm setup

- [ ] Protect `main` and require all CI jobs.
- [x] Create the protected GitHub environment `npm` with required reviewers.
- [x] If `bugbonsai` does not exist on npm, complete the documented one-time
      interactive beta bootstrap from a disposable checkout.
- [x] Configure npm's single Trusted Publisher for
      `captain-jack-sparrow909/BugBonsai`, `release.yml`, and environment `npm`.
- [x] Require 2FA and disallow token publishing after OIDC is verified.
- [ ] Enable GitHub private vulnerability reporting.
- [x] Create the `beta-feedback` and `compatibility` repository labels.
- [ ] Confirm the README description, topics, license, and social preview.

## Candidate validation

- [x] Run `pnpm release:check` from a clean checkout.
- [ ] Review `COMPATIBILITY.md`; do not promote partial support to verified
      without a real-command reduction.
- [x] Complete at least three reviewed external dogfood observations (see
      [`docs/beta-validation.md`](docs/beta-validation.md#external-structural-dogfood)).
- [ ] Confirm all Changesets and beta release notes describe user-visible risk.
- [x] Confirm `npm view bugbonsai` is either unclaimed or controlled by the
      maintainer account.

## Publish

- [ ] Manually run **Release** with an unused beta version such as
      `0.2.0-beta.0`.
- [ ] Approve the protected `npm` environment only after validation succeeds.
- [x] Confirm `npm view bugbonsai@beta version` returns the requested version.
- [ ] Confirm the npm package displays provenance for the published tarball.
- [x] Run `npx bugbonsai@beta --version` in a clean temporary project.
- [x] Run one complete reduction and recipient verification from the published
      package.

## Announce and learn

- [x] Publish a GitHub prerelease with scope, known limitations, and upgrade
      instructions.
- [ ] Share the terminal demo and a real before/after result with environment
      details.
- [x] Link the compatibility scoreboard instead of making broad support claims.
- [ ] Triage beta feedback weekly and convert recurring failures into corpus
      cases before fixing them.
- [x] Keep stable SemVer publication gated until the stable-release exit criteria
      are met. npm's bootstrap-created `latest` tag currently resolves to the only
      published version, which is explicitly `0.1.0-beta.0`.
