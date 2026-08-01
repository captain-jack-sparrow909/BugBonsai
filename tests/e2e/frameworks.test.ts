import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAdapters } from "../../src/adapters.js";
import { reduceProject } from "../../src/engine.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("real framework fixtures", () => {
  it("reduces an actual TypeScript compiler failure", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-tsc-"));
    created.push(temporary);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const fixture = path.resolve("fixtures/typescript-real");
    const result = await reduceProject({
      cwd: fixture,
      command: [
        process.execPath,
        path.resolve("node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--pretty",
        "false",
      ],
      output: path.join(temporary, "repro"),
      match: "TS2322",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 20,
      onlyReducers: ["files", "json-config"],
    });
    expect(result.detectedAdapters).toContain("typescript");
    expect(result.finalMetrics.files).toBeLessThan(
      result.originalMetrics.files,
    );
  });

  it("reduces an actual Vitest suite", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-vitest-"),
    );
    created.push(temporary);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const fixture = path.resolve("fixtures/vitest-real");
    const output = path.join(temporary, "repro");
    const result = await reduceProject({
      cwd: fixture,
      command: [
        process.execPath,
        path.resolve("node_modules/vitest/vitest.mjs"),
        "run",
        "payment.test.ts",
      ],
      output,
      match: "BUGBONSAI_VITEST_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 12,
      onlyReducers: ["test-structure"],
    });
    const reduced = await readFile(
      path.join(output, "payment.test.ts"),
      "utf8",
    );
    expect(reduced).not.toContain("unrelated passing behavior");
    expect(result.detectedAdapters).toContain("vitest");
  });

  it("reduces an actual Vite build failure and detects a Jest fixture", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-vite-"));
    created.push(temporary);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const fixture = path.resolve("fixtures/vite-real");
    const vitestPackage = realpathSync(
      path.resolve("node_modules/vitest/package.json"),
    );
    const viteCli = path.join(
      path.dirname(path.dirname(vitestPackage)),
      "vite",
      "bin",
      "vite.js",
    );
    const result = await reduceProject({
      cwd: fixture,
      command: [process.execPath, viteCli, "build"],
      output: path.join(temporary, "repro"),
      match: "BUGBONSAI_VITE_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 15,
      onlyReducers: ["files"],
    });
    expect(result.detectedAdapters).toContain("vite");
    expect(result.finalMetrics.files).toBeLessThan(
      result.originalMetrics.files,
    );

    const jestFixture = path.resolve("fixtures/jest-real");
    const jestAdapters = await detectAdapters({
      root: jestFixture,
      invocationDirectory: "",
      command: ["jest"],
    });
    expect(jestAdapters.map((adapter) => adapter.name)).toContain("jest");
  });
});
