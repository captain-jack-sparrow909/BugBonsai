import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAdapters } from "../../src/adapters.js";
import { reduceProject, resumeProject } from "../../src/engine.js";
import { detectPackageManager } from "../../src/package-manager.js";
import { loadPlugins } from "../../src/plugin.js";
import { listStates } from "../../src/sandbox.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("plugin API", () => {
  it("loads and namespaces every supported extension point", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-plugin-"));
    created.push(root);
    await writeFile(path.join(root, "acme.lock"), "lock\n");
    const loaded = await loadPlugins(
      [path.resolve("examples/plugins/full-example.mjs")],
      root,
    );

    expect(loaded.names).toEqual(["full-example"]);
    expect(loaded.reducers[0]?.name).toBe("full-example/debug-noise");
    expect(loaded.adapters[0]?.name).toBe("full-example/custom-tool");
    expect(loaded.oracles.has("full-example/sentinel")).toBe(true);
    const manager = await detectPackageManager(
      root,
      { allowInstallScripts: false },
      loaded.packageManagers,
    );
    expect(manager.name).toBe("acme");
    expect(manager.installCommand).toContain("--ignore-scripts");
    const adapters = await detectAdapters(
      { root, invocationDirectory: "", command: ["custom-tool", "check"] },
      loaded.adapters,
    );
    expect(adapters.map((adapter) => adapter.name)).toContain(
      "full-example/custom-tool",
    );
  });

  it("rejects incompatible API versions with an actionable error", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-plugin-version-"),
    );
    created.push(root);
    await writeFile(
      path.join(root, "plugin.mjs"),
      "export default { apiVersion: 99, name: 'future-plugin' };\n",
    );
    await expect(loadPlugins(["./plugin.mjs"], root)).rejects.toThrow(
      /targets API 99.*supports API 1/,
    );
  });

  it("validates reducer mutations before they reach the engine", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-plugin-mutation-"),
    );
    created.push(root);
    await writeFile(
      path.join(root, "plugin.mjs"),
      `export default {
  apiVersion: 1,
  name: "invalid-mutation",
  reducers: [{ name: "unsafe", async discover() { return [{ id: "escape", description: "escape", estimatedImpact: 1, affectedPaths: ["../outside"], requiresInstall: false, apply() {} }]; } }]
};
`,
    );
    const loaded = await loadPlugins(["./plugin.mjs"], root);
    await expect(
      loaded.reducers[0]!.discover({
        root,
        command: ["node"],
        protectedPaths: new Set(),
        mode: "balanced",
        adapterMatches: [],
        entryPaths: new Set(),
      }),
    ).rejects.toThrow(/affectedPaths must stay relative/);
  });

  it("runs a plugin reducer and plugin oracle through the engine", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-plugin-engine-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    await mkdir(project);
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "plugin-fixture", private: true }),
    );
    await writeFile(
      path.join(project, "failure.js"),
      'throw new Error("PLUGIN_EXAMPLE_SENTINEL");\n',
    );
    await writeFile(path.join(project, "debug-noise.txt"), "remove me\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const output = path.join(temporary, "repro");
    const result = await reduceProject({
      cwd: project,
      command: [process.execPath, "failure.js"],
      output,
      plugins: [path.resolve("examples/plugins/full-example.mjs")],
      pluginOracle: "full-example/sentinel",
      onlyReducers: ["full-example/debug-noise"],
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 3,
    });

    expect(result.loadedPlugins).toEqual(["full-example"]);
    expect(result.attempts[0]).toMatchObject({
      reducer: "full-example/debug-noise",
      accepted: true,
    });
    await expect(
      readFile(path.join(output, "debug-noise.txt"), "utf8"),
    ).rejects.toBeDefined();
  });

  it("refuses to resume after a loaded plugin source changes", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-plugin-resume-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    const pluginFile = path.join(temporary, "plugin.mjs");
    await mkdir(project);
    await writeFile(
      path.join(project, "failure.js"),
      'throw new Error("PLUGIN_RESUME_SENTINEL");\n',
    );
    await writeFile(path.join(project, "noise.txt"), "noise\n");
    const pluginSource = `import { rm } from "node:fs/promises";
import path from "node:path";
export default {
  apiVersion: 1,
  name: "resume-plugin",
  reducers: [{
    name: "noise",
    async discover() {
      return [{ id: "noise", description: "remove noise", estimatedImpact: 1, affectedPaths: ["noise.txt"], requiresInstall: false, apply: root => rm(path.join(root, "noise.txt"), { force: true }) }];
    }
  }]
};
`;
    await writeFile(pluginFile, pluginSource);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const abort = new AbortController();
    await expect(
      reduceProject({
        cwd: project,
        command: [process.execPath, "failure.js"],
        output: path.join(temporary, "repro"),
        plugins: [pluginFile],
        onlyReducers: ["resume-plugin/noise"],
        match: "PLUGIN_RESUME_SENTINEL",
        noInstall: true,
        stabilityRuns: 1,
        finalRuns: 1,
        maxRuns: 3,
        signal: abort.signal,
        onProgress: (event) => {
          if (event.phase === "reduce" && event.accepted) abort.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "INTERRUPTED" });
    const paused = (await listStates()).find(
      ({ state }) => state.status === "paused",
    );
    await writeFile(pluginFile, `${pluginSource}\n// changed after pause\n`);
    await expect(resumeProject(paused!.state.runId)).rejects.toThrow(
      /plugin sources changed/i,
    );
    expect(
      (await listStates()).find(
        ({ state }) => state.runId === paused!.state.runId,
      )?.state.status,
    ).toBe("paused");
    await writeFile(pluginFile, pluginSource);
    const resumed = await resumeProject(paused!.state.runId);
    expect(resumed.loadedPlugins).toEqual(["resume-plugin"]);
  });
});
