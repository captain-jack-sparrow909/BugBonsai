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
    expect(state.schemaVersion).toBe(3);
    expect(state.cacheHits).toBe(0);
    expect(state.cache).toEqual({});
    await rm(session, { recursive: true, force: true });
  });
});
