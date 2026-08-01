import { access, rm } from "node:fs/promises";
import path from "node:path";

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

export default {
  apiVersion: 1,
  name: "full-example",

  reducers: [
    {
      name: "debug-noise",
      async discover({ root, protectedPaths }) {
        const relative = "debug-noise.txt";
        if (
          protectedPaths.has(relative) ||
          !(await exists(path.join(root, relative)))
        ) {
          return [];
        }
        return [
          {
            id: "remove-debug-noise",
            description: "remove framework-specific debug noise",
            estimatedImpact: 100,
            affectedPaths: [relative],
            requiresInstall: false,
            apply: async (candidateRoot) => {
              await rm(path.join(candidateRoot, relative), { force: true });
            },
          },
        ];
      },
    },
  ],

  adapters: [
    {
      name: "custom-tool",
      async detect({ root, command }) {
        const config = "custom-tool.config.json";
        if (
          !command.some((part) => part.includes("custom-tool")) &&
          !(await exists(path.join(root, config)))
        ) {
          return undefined;
        }
        return {
          name: "custom-tool",
          confidence: command.some((part) => part.includes("custom-tool"))
            ? "command"
            : "configuration",
          evidence: ["custom-tool project evidence"],
          protectedPaths: [],
          relevantConfig: [config],
          testCallNames: ["scenario"],
        };
      },
    },
  ],

  packageManagers: [
    {
      name: "acme",
      async detect({ root, allowInstallScripts }) {
        if (!(await exists(path.join(root, "acme.lock")))) return undefined;
        const scripts = allowInstallScripts ? [] : ["--ignore-scripts"];
        return {
          name: "acme",
          executable: "acmepm",
          lockfile: "acme.lock",
          lockfiles: ["acme.lock"],
          workspaceType: "none",
          warnings: ["Example provider; replace commands with a real manager."],
          installCommand: ["acmepm", "install", "--frozen", ...scripts],
          installAfterManifestChange: ["acmepm", "install", ...scripts],
        };
      },
    },
  ],

  oracles: {
    sentinel({ result }) {
      return {
        matches: result.combinedOutput.includes("PLUGIN_EXAMPLE_SENTINEL"),
        reason: "example sentinel remains",
        score: 1,
      };
    },
  },
};
