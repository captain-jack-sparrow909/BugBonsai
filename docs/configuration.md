# Configuration

BugBonsai loads `bugbonsai.config.mjs` from the directory where it is invoked. The module is trusted project code and can execute JavaScript during loading; do not run BugBonsai with configuration from an untrusted repository outside an operating-system sandbox.

```js
/** @type {import("bugbonsai").BugBonsaiConfig} */
export default {
  root: "../..",
  output: "./bugbonsai-repro",
  mode: "balanced",
  timeout: "90s",
  stabilityRuns: 2,
  finalRuns: 3,
  maxRuns: 300,
  keep: ["fixtures/**"],
  exclude: ["docs/**"],
  plugins: ["./bugbonsai.plugin.mjs"],
  reducers: {
    files: true,
    packageJson: true,
    dependencies: true,
    jsonConfig: true,
    source: true,
    tests: true,
  },
  oracle: {
    plugin: "acme/payment-state",
  },
};
```

Precedence is CLI arguments, then configuration, then built-in defaults. Configuration validation rejects unknown properties and reports nested paths such as `oracle.pattern` or `reducers.test`.

The flattened programmatic names `timeoutMs`, `match`, `matchRegex`, `exitCode`, `oraclePath`, `pluginOracle`, `plugins`, `onlyReducers`, and `skipReducers` are also accepted. A `false` reducer entry adds its internal reducer to `skipReducers`; a `true` entry leaves it enabled.

Plugin paths are resolved from the invocation directory. Installed package specifiers are supported. A plugin oracle is mutually exclusive with `oraclePath`; an explicit CLI oracle selection overrides the configured oracle kind. See [plugins.md](plugins.md).

Use `defineConfig` when authoring the file in a JavaScript editor that understands imported types:

```js
import { defineConfig } from "bugbonsai";

export default defineConfig({
  mode: "thorough",
  oracle: { matchRegex: "TS\\d{4}" },
});
```
