# Public beta launch kit

Use one relevant channel at a time and stay available to answer replies. Adapt the
opening sentence to the community instead of posting identical copy everywhere.

Canonical links:

- npm: https://www.npmjs.com/package/bugbonsai
- source: https://github.com/captain-jack-sparrow909/BugBonsai
- prerelease: https://github.com/captain-jack-sparrow909/BugBonsai/releases/tag/v0.1.0-beta.0
- five-minute guide: https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/docs/early-adopter-guide.md
- feedback: https://github.com/captain-jack-sparrow909/BugBonsai/issues/9
- compatibility: https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/COMPATIBILITY.md

## Show HN

Title:

```text
Show HN: BugBonsai – prune a failing JS/TS project into a minimal reproduction
```

Body:

```text
I built BugBonsai because turning a real JavaScript or TypeScript failure into a
shareable repository is often slower than fixing the bug.

It takes any failing command, removes files, dependencies, and source structure,
and reruns the command after every accepted change:

    npx bugbonsai@beta --match "DISTINCTIVE_ERROR" -- npm test

It is local-first, has no telemetry, never modifies the source project, and can
resume interrupted reductions. It is deliberately conservative: the result is
the smallest practical reproduction found within a run budget, not a proof of a
global minimum. The executed command is isolated in copied files, but it is not
OS-sandboxed.

The beta has cross-platform corpus evidence for Node 22/24/26 and cases covering
Jest, Vitest, Vite, and TypeScript. I now need evidence from real projects,
especially failed or disappointing runs. Aggregate results are enough; please do
not upload private source or logs.

Source: https://github.com/captain-jack-sparrow909/BugBonsai
Five-minute guide: https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/docs/early-adopter-guide.md
```

## Reddit: r/javascript or r/typescript

Suggested title:

```text
I made a local-first CLI that automatically reduces failing JS/TS projects
```

Suggested body:

```text
Minimal reproductions are valuable, but deleting half a project, rerunning, and
repeating is tedious. BugBonsai automates that loop while checking that the same
failure remains after every accepted deletion.

    npx bugbonsai@beta --match "DISTINCTIVE_ERROR" -- npm test

The project is open source and in public beta. It handles JS, TS, JSX, and TSX;
has reducers for project files, manifests, dependencies, source spans, and common
test structures; and exports a reproduction that recipients can verify.

The honest limitations: reductions run sequentially, Yarn PnP and Bun workspaces
are still experimental, and filesystem isolation is not an OS sandbox. I am
looking for aggregate feedback from stable real-world failures, including cases
where it does not work. You do not need to share source or logs.

Repo: https://github.com/captain-jack-sparrow909/BugBonsai
Safe evaluation guide: https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/docs/early-adopter-guide.md
```

Check each community's current self-promotion rules before posting. Pick the one
whose audience best matches the failure cases you want; do not cross-post both on
the same day.

## Short social post

```text
🌱 I built BugBonsai: give it a failing JS/TS command and it repeatedly prunes the
project while verifying that the same bug survives.

npx bugbonsai@beta --match "YOUR_ERROR" -- npm test

Local-first. No telemetry. Source project stays untouched. Public beta—real-world
successes and failures are welcome, with no private code required.

https://github.com/captain-jack-sparrow909/BugBonsai
```

## Direct maintainer invitation

Use this only for maintainers whose public issue already needs a reproduction.
Personalize the first sentence and send at most one message.

```text
I saw the public issue about [specific failure]. I am building BugBonsai, a
local-first CLI that reduces failing JavaScript and TypeScript projects while
rerunning the failure after every accepted deletion.

If you already have a local deterministic case, would you be willing to try the
public beta? You do not need to send me the reproduction or logs—aggregate
before/after counts and whether it preserved the right failure are enough.

Safe five-minute guide:
https://github.com/captain-jack-sparrow909/BugBonsai/blob/main/docs/early-adopter-guide.md

No worries if this is not useful for this issue.
```

## Demo caption

```text
BugBonsai reduced a failing fixture from 4 files to 3 files in 7 candidate runs,
then reproduced the final failure three times and verified the exported integrity
manifest from a clean published-package consumer. This is an end-to-end workflow
demonstration; broader evidence is tracked in the compatibility scoreboard.
```

## Claims to avoid during beta

- Do not call the result mathematically minimal; it is the smallest practical
  reproduction found within the configured run budget.
- Do not claim universal framework or package-manager support.
- Do not describe command execution as sandboxed.
- Do not imply generated output is automatically safe to share.
- Do not claim stable availability while the published version is a prerelease.
- Do not imply downloads are active users or publication-day installs are organic
  adoption.
