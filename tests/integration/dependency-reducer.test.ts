import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";

describe("dependency reducer", () => {
  it("removes an unused direct dependency and refreshes installation metadata", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-dependency-"),
    );
    const project = path.join(temporary, "project");
    const dependency = path.join(project, "unused-package");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(dependency, "package.json"),
      JSON.stringify({
        name: "unused-local-package",
        version: "1.0.0",
        main: "index.js",
      }),
    );
    await writeFile(
      path.join(dependency, "index.js"),
      "module.exports = 42;\n",
    );
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "dependency-reducer-fixture",
        private: true,
        dependencies: { "unused-local-package": "file:./unused-package" },
      }),
    );
    await writeFile(
      path.join(project, "failure.js"),
      'throw new Error("BUGBONSAI_DEPENDENCY_SENTINEL");\n',
    );
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    process.env.npm_config_cache = path.join(temporary, "npm-cache");
    const output = path.join(temporary, "repro");
    const result = await reduceProject({
      cwd: project,
      command: [process.execPath, "failure.js"],
      output,
      match: "BUGBONSAI_DEPENDENCY_SENTINEL",
      onlyReducers: ["dependencies"],
      stabilityRuns: 2,
      finalRuns: 1,
      maxRuns: 5,
    });
    const manifest = JSON.parse(
      await readFile(path.join(output, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).not.toHaveProperty(
      "unused-local-package",
    );
    expect(
      result.attempts.some(
        (attempt) => attempt.reducer === "dependencies" && attempt.accepted,
      ),
    ).toBe(true);
    await rm(temporary, { recursive: true, force: true });
  });
});
