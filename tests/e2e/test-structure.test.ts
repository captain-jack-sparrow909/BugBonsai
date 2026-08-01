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

describe("test-structure reduction", () => {
  it("removes an unrelated nested test while retaining the failing test", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-tests-"));
    created.push(temporary);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const fixture = path.resolve("fixtures/test-structure");
    const output = path.join(temporary, "repro");
    const result = await reduceProject({
      cwd: fixture,
      command: [process.execPath, "runner.js"],
      output,
      match: "BUGBONSAI_TEST_STRUCTURE_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 10,
      onlyReducers: ["test-structure"],
    });
    const reduced = await readFile(path.join(output, "sample.test.js"), "utf8");
    expect(reduced).not.toContain("unrelated behavior");
    expect(reduced).toContain("BUGBONSAI_TEST_STRUCTURE_SENTINEL");
    expect(result.detectedAdapters).toContain("vitest");
    expect(
      result.attempts.some(
        (attempt) => attempt.reducer === "test-structure" && attempt.accepted,
      ),
    ).toBe(true);
  });
});
