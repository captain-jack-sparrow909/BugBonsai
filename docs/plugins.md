# Plugin authoring

BugBonsai plugins are explicitly loaded trusted ESM modules. They run inside the BugBonsai process with the invoking user's filesystem, environment, and network privileges. Never load a plugin you would not execute directly with Node.js.

Load a local module or an installed package:

```bash
bugbonsai --plugin ./bugbonsai.plugin.mjs -- npm test
bugbonsai --plugin @acme/bugbonsai-react -- npm test
```

Or configure plugins once:

```js
import { defineConfig } from "bugbonsai";

export default defineConfig({
  plugins: ["./bugbonsai.plugin.mjs"],
  oracle: { plugin: "acme-react/hydration" },
});
```

Package specifiers are resolved from the invocation project. Plugins are never auto-discovered: installation alone does not execute one.

## Contract

API version `1` supports reducers, framework adapters, package-manager providers, and failure oracles. Use `definePlugin` for editor and TypeScript checking:

```js
import { rm } from "node:fs/promises";
import path from "node:path";
import { definePlugin } from "bugbonsai";

export default definePlugin({
  apiVersion: 1,
  name: "acme-react",
  reducers: [
    {
      name: "generated-routes",
      async discover({ root, protectedPaths }) {
        const relative = "src/generated-routes.ts";
        if (protectedPaths.has(relative)) return [];
        return [
          {
            id: "generated-routes-v1",
            description: "remove generated route table",
            estimatedImpact: 10_000,
            affectedPaths: [relative],
            requiresInstall: false,
            apply: (candidateRoot) =>
              rm(path.join(candidateRoot, relative), { force: true }),
          },
        ];
      },
    },
  ],
  oracles: {
    hydration({ result }) {
      return result.stderr.includes("HYDRATION_STATE_CORRUPTED");
    },
  },
});
```

Plugin and component names accept letters, numbers, dots, dashes, and underscores. Components are exposed as `plugin/component`, such as `acme-react/generated-routes`; plugin oracles use the same namespace. This prevents collisions with built-ins and other plugins.

Reducer mutation IDs must be stable for identical candidate content. A reducer should only discover possibilities; its `apply` function edits the disposable candidate root. Plugin reducers run before generic built-in reducers so domain-specific high-value work is available under small execution budgets. Every mutation still executes the configured command and must pass the same failure oracle. A plugin cannot directly accept its own reducer mutation.

Adapters return evidence, protected paths, relevant configuration, and optional test-call names through the public `FrameworkAdapter` shape. Package-manager providers receive the root, lifecycle-script policy, and optional install override, and return complete immutable/mutable install commands plus lockfile metadata. Providers are tried in configured plugin order before built-in npm, pnpm, Yarn, and Bun detection.

See [`examples/plugins/full-example.mjs`](../examples/plugins/full-example.mjs) for all four extension points in one module.

## Compatibility and resume

BugBonsai rejects plugins whose `apiVersion` is not exactly supported. API version changes follow semantic versioning and will be documented in release notes.

The content and resolved location of every plugin contribute to candidate-cache and session fingerprints. A paused run refuses to resume if any loaded plugin changed. Restore the original plugin version or start a new reduction; never force an old scheduler cursor across changed plugin logic.

Plugin exceptions fail the run with component context. Plugin reducers and adapters should remain deterministic, avoid global mutation, and return actionable errors. Network calls during discovery are strongly discouraged because they make resume and reproducibility dependent on external state.
