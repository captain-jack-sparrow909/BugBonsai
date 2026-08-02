# Public beta launch kit

Canonical links:

- npm: https://www.npmjs.com/package/bugbonsai
- prerelease: https://github.com/captain-jack-sparrow909/BugBonsai/releases/tag/v0.1.0-beta.0
- feedback: https://github.com/captain-jack-sparrow909/BugBonsai/issues/9
- compatibility: https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/COMPATIBILITY.md

## Primary announcement

🌱 BugBonsai is now in public beta.

Give it a failing JavaScript or TypeScript command and it prunes the project into
a small, shareable reproduction, rerunning the failure after every accepted
deletion.

```bash
npx bugbonsai@beta -- npm test
```

It is local-first, framework-independent, resumable, and deliberately
conservative. It never modifies the source project or uploads code. Every export
can be integrity-checked and rerun by its recipient.

This first beta has passed 90 automated tests, cross-platform CI, public-source
dogfooding, a clean npm consumer install, and a complete reduction plus
recipient-side verification from the published package.

BugBonsai is beta software, not an OS sandbox. Review every generated file before
sharing it. Compatibility claims are backed by the public scoreboard rather than
broad promises.

Try it, then share aggregate results or blockers in the feedback thread:
https://github.com/captain-jack-sparrow909/BugBonsai/issues/9

Prune everything except the bug.

## Short post

🌱 BugBonsai is in public beta.

```bash
npx bugbonsai@beta -- npm test
```

It repeatedly reruns a failing command while pruning files, dependencies, and
source structure—then exports a verified minimal reproduction. Local-first, no
telemetry, framework-independent.

Try it: https://www.npmjs.com/package/bugbonsai
Feedback: https://github.com/captain-jack-sparrow909/BugBonsai/issues/9

## Hacker News or Reddit title

Show HN: BugBonsai – prune a failing JS/TS project into a minimal reproduction

## Demo caption

BugBonsai reduced a failing fixture from 4 files to 3 files in 7 candidate runs,
then reproduced the final failure three times and verified the exported integrity
manifest from a clean published-package consumer. The small fixture validates the
end-to-end workflow; broader compatibility evidence lives in the scoreboard.

## Claims to avoid during beta

- Do not call the result mathematically minimal; it is the smallest practical
  reproduction found within the configured run budget.
- Do not claim universal framework or package-manager support.
- Do not describe command execution as sandboxed.
- Do not imply generated output is automatically safe to share.
- Do not claim stable availability while the published version is a prerelease.
