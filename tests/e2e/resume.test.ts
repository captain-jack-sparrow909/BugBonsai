import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const pausedRunId = paused!.state.runId;
    const result = await resumeProject(paused!.state.runId);
    expect(result.runId).toBe(pausedRunId);
    expect(result.finalMetrics.files).toBeLessThan(
      result.originalMetrics.files,
    );
    await rm(temporary, { recursive: true, force: true });
  });

  it("resumes at the next persisted mutation without resetting maxRuns", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-cursor-"),
    );
    const project = path.join(temporary, "project");
    await mkdir(path.join(project, "required"), { recursive: true });
    await writeFile(
      path.join(project, "failure.js"),
      `const fs = require("node:fs");
if (!fs.existsSync("required/a.txt") || !fs.existsSync("required/b.txt")) {
  throw new Error("REQUIRED_FILE_MISSING");
}
throw new Error("BUGBONSAI_CURSOR_SENTINEL");
`,
    );
    await writeFile(path.join(project, "required", "a.txt"), "a\n");
    await writeFile(path.join(project, "required", "b.txt"), "b\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const abort = new AbortController();

    await expect(
      reduceProject({
        cwd: project,
        command: [process.execPath, "failure.js"],
        output: path.join(temporary, "repro"),
        match: "BUGBONSAI_CURSOR_SENTINEL",
        noInstall: true,
        stabilityRuns: 1,
        finalRuns: 1,
        maxRuns: 3,
        onlyReducers: ["files"],
        signal: abort.signal,
        onProgress: (event) => {
          if (event.phase === "reduce" && event.accepted === false) {
            expect(event.maxRuns).toBe(3);
            expect(event.remainingRuns).toBe(2);
            expect(event.progress).toBeCloseTo(1 / 3, 3);
            abort.abort();
          }
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BugBonsaiError && error.code === "INTERRUPTED",
    );

    const paused = (await listStates()).find(
      ({ state }) => state.status === "paused",
    );
    expect(paused?.state.candidateRuns).toBe(1);
    expect(paused?.state.cursor.nextMutationIndex).toBe(1);
    const firstMutationId = paused!.state.attempts[0]!.mutationId;
    const resumed = await resumeProject(paused!.state.runId);
    expect(resumed.candidateRuns).toBe(3);
    expect(
      resumed.attempts.filter(
        (attempt) => attempt.mutationId === firstMutationId,
      ),
    ).toHaveLength(1);
    await rm(temporary, { recursive: true, force: true });
  });

  for (const boundary of [
    "inventory",
    "baseline",
    "validate-start",
    "validate-run",
  ] as const) {
    it(`resumes safely after interruption at the ${boundary} boundary`, async () => {
      const temporary = await mkdtemp(
        path.join(os.tmpdir(), `bugbonsai-${boundary}-`),
      );
      process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
      const output = path.join(temporary, "repro");
      const abort = new AbortController();
      let triggered = false;

      await expect(
        reduceProject({
          cwd: path.resolve("fixtures/node-basic"),
          command: [process.execPath, "failure.js"],
          output,
          match: "BUGBONSAI_SENTINEL_BASIC",
          noInstall: true,
          stabilityRuns: 2,
          finalRuns: 2,
          maxRuns: 4,
          onlyReducers: ["files"],
          signal: abort.signal,
          onProgress: (event) => {
            const matches =
              boundary === "inventory"
                ? event.phase === "inventory"
                : boundary === "baseline"
                  ? event.phase === "baseline"
                  : boundary === "validate-start"
                    ? event.phase === "validate" &&
                      event.message.includes("Scanning")
                    : event.phase === "validate" &&
                      event.message.includes("Final failure reproduced 1/");
            if (matches && !triggered) {
              triggered = true;
              abort.abort();
            }
          },
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof BugBonsaiError && error.code === "INTERRUPTED",
      );

      expect(triggered).toBe(true);
      const paused = (await listStates()).find(
        ({ state }) => state.status === "paused",
      );
      expect(paused).toBeDefined();
      await expect(access(output)).rejects.toBeDefined();
      const result = await resumeProject(paused!.state.runId);
      expect(result.runId).toBe(paused!.state.runId);
      expect(result.candidateRuns).toBeLessThanOrEqual(4);
      await rm(temporary, { recursive: true, force: true });
    });
  }
});
