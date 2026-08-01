import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";
import { runCommand } from "../../src/process.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("monorepo invocation", () => {
  it("reduces from an ancestor root while preserving the nested command cwd", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-monorepo-"),
    );
    created.push(temporary);
    const root = path.join(temporary, "workspace");
    const app = path.join(root, "apps", "web");
    const output = path.join(temporary, "repro");
    await mkdir(path.join(root, "packages", "unused"), { recursive: true });
    await mkdir(app, { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true }),
    );
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ private: true }),
    );
    await writeFile(
      path.join(app, "failure.js"),
      "throw new Error('BUGBONSAI_MONOREPO_SENTINEL');\n",
    );
    await writeFile(path.join(app, "unused.js"), "export {};\n");
    await writeFile(
      path.join(root, "packages", "unused", "index.js"),
      "export {};\n",
    );
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    const reduced = await reduceProject({
      root,
      cwd: app,
      command: [process.execPath, "failure.js"],
      output,
      match: "BUGBONSAI_MONOREPO_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 25,
    });
    expect(reduced.invocationDirectory).toBe("apps/web");
    const reproduced = await runCommand([process.execPath, "failure.js"], {
      cwd: path.join(output, reduced.invocationDirectory),
      timeoutMs: 5_000,
    });
    expect(reproduced.combinedOutput).toContain("BUGBONSAI_MONOREPO_SENTINEL");
    expect(await readFile(path.join(output, "BUGBONSAI.md"), "utf8")).toContain(
      "cd apps/web",
    );
  });
});
