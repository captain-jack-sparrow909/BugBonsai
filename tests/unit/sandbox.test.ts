import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/process.js";
import {
  createInventory,
  linkDependencies,
  listStates,
  loadState,
  normalizeDependencySnapshot,
} from "../../src/sandbox.js";

describe("session state migration", () => {
  it("migrates schema 2 sessions with an empty candidate cache", async () => {
    const session = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-state-"));
    await writeFile(
      path.join(session, "state.json"),
      JSON.stringify({
        schemaVersion: 2,
        runId: "bb_legacy",
        projectRoot: "/project",
        invocationCwd: "/project",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "paused",
        command: ["npm", "test"],
        options: { root: "/project" },
        attempts: [],
        candidateRuns: 2,
        generation: 1,
      }),
    );
    const state = await loadState(session);
    expect(state.schemaVersion).toBe(4);
    expect(state.cacheHits).toBe(0);
    expect(state.cache).toEqual({});
    expect(state.cursor).toMatchObject({
      reducerIndex: 0,
      generation: 1,
      scheduleIds: [],
      nextMutationIndex: 0,
    });
    await rm(session, { recursive: true, force: true });
  });

  it("migrates schema 3 counters into an empty durable cursor", async () => {
    const session = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-state3-"));
    await writeFile(
      path.join(session, "state.json"),
      JSON.stringify({
        schemaVersion: 3,
        runId: "bb_schema3",
        projectRoot: "/project",
        invocationCwd: "/project",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "paused",
        command: ["npm", "test"],
        options: { root: "/project" },
        attempts: [],
        candidateRuns: 7,
        cacheHits: 2,
        cache: {},
        generation: 3,
      }),
    );
    const state = await loadState(session);
    expect(state.schemaVersion).toBe(4);
    expect(state.candidateRuns).toBe(7);
    expect(state.cursor).toMatchObject({
      reducerIndex: 0,
      generation: 3,
      nextMutationIndex: 0,
    });
    await rm(session, { recursive: true, force: true });
  });

  it("quarantines corrupt and half-written session state from listings", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-corrupt-state-"),
    );
    process.env.BUGBONSAI_CACHE_DIR = temporary;
    const corrupt = path.join(temporary, "runs", "bb_corrupt");
    const partial = path.join(temporary, "runs", "bb_partial");
    await mkdir(corrupt, { recursive: true });
    await mkdir(partial, { recursive: true });
    await writeFile(path.join(corrupt, "state.json"), "{not-json");
    await writeFile(path.join(partial, "state.json.123.tmp"), "{}");
    expect(await listStates()).toEqual([]);
    await rm(temporary, { recursive: true, force: true });
  });
});

describe("dependency isolation", () => {
  it("recursively excludes dependency trees and npm caches from inventory", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-inventory-dependencies-"),
    );
    await mkdir(path.join(root, "packages", "app", "node_modules", "hidden"), {
      recursive: true,
    });
    await mkdir(path.join(root, "packages", "app", ".npm-cache"), {
      recursive: true,
    });
    await mkdir(path.join(root, "packages", "app", ".git"), {
      recursive: true,
    });
    await writeFile(path.join(root, "packages", "app", "index.js"), "ok\n");
    await writeFile(
      path.join(root, "packages", "app", "node_modules", "hidden", "index.js"),
      "hidden\n",
    );
    await writeFile(
      path.join(root, "packages", "app", ".npm-cache", "cache.json"),
      "{}\n",
    );
    await writeFile(
      path.join(root, "packages", "app", ".git", "config"),
      "hidden\n",
    );

    const inventory = await createInventory(root, {
      include: [],
      exclude: [],
      keep: [],
    });
    expect(inventory.files).toEqual(["packages/app/index.js"]);
    await rm(root, { recursive: true, force: true });
  });

  it("migrates legacy snapshots into an ESM-safe node_modules layout", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-legacy-dependencies-"),
    );
    const legacy = path.join(temporary, "dependencies");
    const candidate = path.join(temporary, "candidate");
    await mkdir(path.join(legacy, "esm-runner"), { recursive: true });
    await mkdir(path.join(legacy, "sibling-only"), { recursive: true });
    await mkdir(candidate, { recursive: true });
    await writeFile(
      path.join(legacy, "esm-runner", "package.json"),
      JSON.stringify({ name: "esm-runner", type: "module", main: "index.mjs" }),
    );
    await writeFile(
      path.join(legacy, "esm-runner", "index.mjs"),
      'import sibling from "sibling-only"; console.log(`runner:${sibling}`);\n',
    );
    await writeFile(
      path.join(legacy, "sibling-only", "package.json"),
      JSON.stringify({
        name: "sibling-only",
        type: "module",
        main: "index.mjs",
      }),
    );
    await writeFile(
      path.join(legacy, "sibling-only", "index.mjs"),
      'export default "sibling";\n',
    );

    const normalized = await normalizeDependencySnapshot(legacy);
    await linkDependencies(normalized, candidate);
    const result = await runCommand(
      [process.execPath, "node_modules/esm-runner/index.mjs"],
      { cwd: candidate, timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.combinedOutput).toContain("runner:sibling");
    await rm(temporary, { recursive: true, force: true });
  });
});
