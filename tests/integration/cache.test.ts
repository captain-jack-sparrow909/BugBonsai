import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject, resumeProject } from "../../src/engine.js";
import { BugBonsaiError } from "../../src/errors.js";
import { listStates } from "../../src/sandbox.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("candidate cache", () => {
  it("reuses a content-identical rejected candidate without accepting it", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-cache-"));
    created.push(temporary);
    const project = path.join(temporary, "project");
    const output = path.join(temporary, "repro");
    await mkdir(path.join(project, "required"), { recursive: true });
    await writeFile(
      path.join(project, "failure.js"),
      `const fs = require("node:fs");
if (!fs.existsSync("required/a.txt") || !fs.existsSync("required/b.txt")) {
  throw new Error("FILES_MISSING");
}
throw new Error("BUGBONSAI_CACHE_SENTINEL");
`,
    );
    await writeFile(path.join(project, "required", "a.txt"), "a\n");
    await writeFile(path.join(project, "required", "b.txt"), "b\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    const result = await reduceProject({
      cwd: project,
      command: [process.execPath, "failure.js"],
      output,
      match: "BUGBONSAI_CACHE_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 10,
      onlyReducers: ["files"],
    });
    expect(result.cacheHits).toBeGreaterThanOrEqual(1);
    expect(result.attempts.some((attempt) => attempt.cached)).toBe(true);
    expect(result.attempts.filter((attempt) => attempt.cached)).toSatisfy(
      (attempts: typeof result.attempts) =>
        attempts.every((attempt) => !attempt.accepted),
    );
  });

  it("persists rejection entries and reuses them after resume", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-cache-resume-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    await mkdir(path.join(project, "required"), { recursive: true });
    await writeFile(
      path.join(project, "failure.js"),
      `const fs = require("node:fs");
if (!fs.existsSync("required/a.txt") || !fs.existsSync("required/b.txt")) {
  throw new Error("FILES_MISSING");
}
throw new Error("BUGBONSAI_RESUME_CACHE_SENTINEL");
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
        match: "BUGBONSAI_RESUME_CACHE_SENTINEL",
        noInstall: true,
        stabilityRuns: 1,
        finalRuns: 1,
        maxRuns: 10,
        onlyReducers: ["files"],
        signal: abort.signal,
        onProgress: (event) => {
          if (event.phase === "reduce" && event.message.includes("(cached)")) {
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
    expect(Object.keys(paused?.state.cache ?? {})).not.toHaveLength(0);
    const resumed = await resumeProject(paused!.state.runId);
    expect(resumed.cacheHits).toBeGreaterThanOrEqual(1);
  });
});
