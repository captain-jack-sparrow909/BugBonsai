import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";
import { runCommand } from "../../src/process.js";

const created: string[] = [];
afterEach(async () =>
  Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe("end-to-end reduction", () => {
  it("prunes unrelated files, preserves the failure, and leaves the fixture unchanged", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-e2e-"));
    const output = path.join(temporary, "repro");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    created.push(temporary);
    const fixture = path.resolve("fixtures/node-basic");
    const before = await readFile(path.join(fixture, "failure.js"), "utf8");
    const result = await reduceProject({
      cwd: fixture,
      command: [process.execPath, "failure.js"],
      output,
      mode: "balanced",
      match: "BUGBONSAI_SENTINEL_BASIC",
      stabilityRuns: 2,
      finalRuns: 2,
      maxRuns: 40,
      noInstall: true,
    });
    expect(result.finalMetrics.files).toBeLessThan(
      result.originalMetrics.files,
    );
    expect(await readFile(path.join(fixture, "failure.js"), "utf8")).toBe(
      before,
    );
    const report = await readFile(path.join(output, "BUGBONSAI.md"), "utf8");
    expect(report).toContain("BUGBONSAI_SENTINEL_BASIC");
    expect(report).toContain("No dependency installation was requested.");
    const reproduced = await runCommand([process.execPath, "failure.js"], {
      cwd: output,
      timeoutMs: 5_000,
    });
    expect(reproduced.combinedOutput).toContain("BUGBONSAI_SENTINEL_BASIC");
  });
});
