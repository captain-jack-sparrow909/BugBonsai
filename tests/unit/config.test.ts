import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../../src/config.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("BugBonsai configuration", () => {
  it("loads the trusted local ESM configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-config-"));
    created.push(root);
    await writeFile(
      path.join(root, "bugbonsai.config.mjs"),
      "export default { mode: 'thorough', timeout: '90s', noInstall: true, keep: ['fixture/**'], reducers: { tests: false }, oracle: { match: 'SENTINEL' } };\n",
    );
    const loaded = await loadConfig(root);
    expect(loaded.path).toBe(path.join(root, "bugbonsai.config.mjs"));
    expect(loaded.config).toMatchObject({
      mode: "thorough",
      noInstall: true,
      keep: ["fixture/**"],
      timeoutMs: 90_000,
      match: "SENTINEL",
      skipReducers: ["test-structure"],
    });
  });

  it("rejects unknown and incorrectly typed properties", () => {
    expect(() => validateConfig({ mystery: true })).toThrow(
      /Unknown configuration property: mystery/,
    );
    expect(() => validateConfig({ maxRuns: "many" })).toThrow(/maxRuns/);
    expect(() => validateConfig({ outputMode: "stream" })).toThrow(
      /outputMode/,
    );
  });

  it("disables both source depths through the source reducer switch", () => {
    expect(
      validateConfig({ reducers: { source: false } }).skipReducers,
    ).toEqual(["source", "deep-source"]);
  });

  it("accepts plugin specifiers and a namespaced plugin oracle", () => {
    expect(
      validateConfig({
        plugins: ["./bugbonsai.plugin.mjs", "@scope/bugbonsai-plugin"],
        oracle: { plugin: "scope/sentinel" },
      }),
    ).toMatchObject({
      plugins: ["./bugbonsai.plugin.mjs", "@scope/bugbonsai-plugin"],
      pluginOracle: "scope/sentinel",
    });
  });
});
