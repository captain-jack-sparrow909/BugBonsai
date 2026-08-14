# Failure oracles

Failure equivalence is more important than raw reduction size. The default oracle normalizes unstable paths, timestamps, durations, process identifiers, UUIDs, and ANSI styling while retaining error codes and source identity.

It then evaluates:

1. failure versus success, or preserved successful exit behavior for `--fail-on-output`;
2. exit, signal, and timeout behavior;
3. explicit text or regex constraints;
4. introduced setup-failure categories;
5. error-name compatibility;
6. stack-frame overlap;
7. deterministic token similarity.

When a baseline is unstable, stop and provide a distinctive `--match` value rather than lowering the oracle threshold blindly.

Explicit text, regular-expression, and exit-code constraints are checked while capturing the first baseline, not only against later candidates. This prevents an installation or configuration error from being accepted as the starting failure when it does not contain the requested bug identity.

## Successful commands with incorrect output

Some tools report warnings or broken generated output but still exit with code `0`. Use a stable output fragment as the failure signal:

```bash
bugbonsai --fail-on-output "Failed to resolve link" -- npm run docs
```

The fragment must appear in every baseline and accepted candidate. BugBonsai also preserves the successful exit behavior, so deleting code cannot replace the warning with a crash or missing-module error. The rule is stored in the portability manifest and reused by `bugbonsai verify`.

## Custom oracle

For failures whose identity cannot be expressed with text, a regular expression, or an exit code, pass an explicit trusted ESM module:

```bash
bugbonsai --oracle ./bugbonsai.oracle.mjs -- npm test
```

```js
export default async function oracle({ result }) {
  return {
    matches:
      result.exitCode === 1 &&
      result.stderr.includes("PAYMENT_STATE_CORRUPTED"),
    reason: "Expected payment-state failure remains",
    score: 1,
  };
}
```

The function may return a boolean or `{ matches, reason?, score? }`. Successful commands are always rejected before the custom predicate runs. The module is loaded in the BugBonsai process and therefore must be treated as trusted project code; it is never uploaded.
