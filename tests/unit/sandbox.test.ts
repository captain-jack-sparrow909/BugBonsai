import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadState } from "../../src/sandbox.js";

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
});
