# Releasing

BugBonsai uses Changesets and npm Trusted Publishing.

## One-time setup

After the canonical GitHub repository exists:

1. Add its `repository`, `bugs`, and `homepage` URLs to `package.json`.
2. Protect the `main` branch and require the CI workflow.
3. On npm, create or claim the `bugbonsai` package.
4. Configure GitHub Actions as its trusted publisher, restricted to `.github/workflows/release.yml` on the canonical repository.
5. Configure the GitHub Actions deployment environment if npm policy requires one.

No long-lived npm token should be added to repository secrets. The release workflow requests `id-token: write` so npm can validate the GitHub OIDC identity and attach provenance.

## Normal release

Add a Changeset with a user-visible change. Merging the Changesets version pull request lets the release workflow build, test, pack-check, and publish the resulting version.
