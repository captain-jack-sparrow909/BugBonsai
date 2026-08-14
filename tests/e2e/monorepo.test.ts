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

  it("preserves ESM dependency resolution, workspace links, and nested installs", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-monorepo-dependencies-"),
    );
    created.push(temporary);
    const root = path.join(temporary, "workspace");
    const output = path.join(temporary, "repro");
    await mkdir(path.join(root, "packages", "app"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "dependency-snapshot-workspace",
        private: true,
        type: "module",
        dependencies: { fixture: "1.0.0" },
      }),
    );
    await writeFile(
      path.join(root, "packages", "app", "package.json"),
      JSON.stringify({
        name: "workspace-app",
        private: true,
        type: "module",
        main: "index.mjs",
      }),
    );
    await writeFile(
      path.join(root, "packages", "app", "index.mjs"),
      'import nested from "nested-only"; export default `workspace:${nested}`;\n',
    );
    await writeFile(
      path.join(root, "run.mjs"),
      [
        'import runner from "esm-runner";',
        'import workspace from "workspace-app";',
        'if (runner === "runner:sibling" && workspace === "workspace:nested") {',
        '  console.error("BUGBONSAI_WORKSPACE_DEPENDENCY_SENTINEL");',
        "}",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "install.mjs"),
      [
        'import { mkdir, rm, symlink, writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        "const root = process.cwd();",
        'const modules = path.join(root, "node_modules");',
        'const appModules = path.join(root, "packages", "app", "node_modules");',
        "await rm(modules, { recursive: true, force: true });",
        "await rm(appModules, { recursive: true, force: true });",
        'await mkdir(path.join(modules, "esm-runner"), { recursive: true });',
        'await mkdir(path.join(modules, "sibling-only"), { recursive: true });',
        'await mkdir(path.join(appModules, "nested-only"), { recursive: true });',
        'await writeFile(path.join(modules, "esm-runner", "package.json"), JSON.stringify({ name: "esm-runner", type: "module", main: "index.mjs" }));',
        'await writeFile(path.join(modules, "esm-runner", "index.mjs"), \'import sibling from "sibling-only"; export default `runner:${sibling}`;\\n\');',
        'await writeFile(path.join(modules, "sibling-only", "package.json"), JSON.stringify({ name: "sibling-only", type: "module", main: "index.mjs" }));',
        'await writeFile(path.join(modules, "sibling-only", "index.mjs"), \'export default "sibling";\\n\');',
        'await writeFile(path.join(appModules, "nested-only", "package.json"), JSON.stringify({ name: "nested-only", type: "module", main: "index.mjs" }));',
        'await writeFile(path.join(appModules, "nested-only", "index.mjs"), \'export default "nested";\\n\');',
        'await symlink(path.join(root, "packages", "app"), path.join(modules, "workspace-app"), process.platform === "win32" ? "junction" : "dir");',
        "",
      ].join("\n"),
    );
    await writeFile(path.join(root, "unused.js"), "export {};\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    const reduced = await reduceProject({
      root,
      cwd: root,
      command: [process.execPath, "run.mjs"],
      output,
      failOnOutput: "BUGBONSAI_WORKSPACE_DEPENDENCY_SENTINEL",
      installCommand: [process.execPath, "install.mjs"],
      onlyReducers: ["dependencies"],
      keep: ["install.mjs", "run.mjs", "packages/app/**"],
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 1,
    });

    expect(reduced.baseline.normalizedLines.join("\n")).toContain(
      "BUGBONSAI_WORKSPACE_DEPENDENCY_SENTINEL",
    );
    expect(
      reduced.attempts.some(
        (attempt) => attempt.accepted && attempt.dependencySnapshotReused,
      ),
    ).toBe(true);
    const installed = await runCommand([process.execPath, "install.mjs"], {
      cwd: output,
      timeoutMs: 5_000,
    });
    expect(installed.exitCode).toBe(0);
    const reproduced = await runCommand([process.execPath, "run.mjs"], {
      cwd: output,
      timeoutMs: 5_000,
    });
    expect(reproduced.exitCode).toBe(0);
    expect(reproduced.combinedOutput).toContain(
      "BUGBONSAI_WORKSPACE_DEPENDENCY_SENTINEL",
    );
  });
});
