import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reduceProject, resumeProject } from "../../src/engine.js";
import { BugBonsaiError } from "../../src/errors.js";
import { listStates } from "../../src/sandbox.js";

describe("resume", () => {
  it("continues from the last accepted candidate", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-resume-"),
    );
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const abort = new AbortController();
    const fixture = path.resolve("fixtures/node-basic");

    await expect(
      reduceProject({
        cwd: fixture,
        command: [process.execPath, "failure.js"],
        output: path.join(temporary, "repro"),
        match: "BUGBONSAI_SENTINEL_BASIC",
        noInstall: true,
        signal: abort.signal,
        onProgress: (event) => {
          if (event.phase === "reduce" && event.accepted) abort.abort();
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BugBonsaiError && error.code === "INTERRUPTED",
    );

    const paused = (await listStates()).find(
      ({ state }) => state.status === "paused",
    );
    expect(paused?.state.generation).toBeGreaterThan(0);
    const result = await resumeProject(paused!.state.runId);
    expect(result.finalMetrics.files).toBeLessThan(
      result.originalMetrics.files,
    );
    await rm(temporary, { recursive: true, force: true });
  });
});
