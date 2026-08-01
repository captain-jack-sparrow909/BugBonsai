import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deep source reduction", () => {
  it("removes nested syntax while preserving the original failure", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-deep-"));
    created.push(temporary);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const fixture = path.resolve("fixtures/deep-source");
    const output = path.join(temporary, "repro");
    const result = await reduceProject({
      cwd: fixture,
      command: [process.execPath, "failure.js"],
      output,
      match: "BUGBONSAI_DEEP_SOURCE_SENTINEL",
      mode: "thorough",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 30,
      onlyReducers: ["deep-source"],
    });
    const reduced = await readFile(path.join(output, "failure.js"), "utf8");
    expect(reduced).not.toContain("this declaration can disappear");
    expect(reduced).toContain("BUGBONSAI_DEEP_SOURCE_SENTINEL");
    expect(
      result.attempts.some(
        (attempt) => attempt.reducer === "deep-source" && attempt.accepted,
      ),
    ).toBe(true);
  });
});
