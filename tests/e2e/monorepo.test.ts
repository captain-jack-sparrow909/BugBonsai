import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  it("materializes dependency snapshots for hermetic Next.js resolution", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-next-materialized-dependencies-"),
    );
    created.push(temporary);
    const root = path.join(temporary, "project");
    const output = path.join(temporary, "repro");
    await mkdir(path.join(root, "node_modules", "next"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { next: "0.0.0-fixture" },
      }),
    );
    await writeFile(
      path.join(root, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: "0.0.0-fixture" }),
    );
    await writeFile(
      path.join(root, "failure.mjs"),
      [
        'import { realpath } from "node:fs/promises";',
        'import path from "node:path";',
        'const project = await realpath(".");',
        'const dependency = await realpath("node_modules/next/package.json");',
        "const relative = path.relative(project, dependency);",
        'if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {',
        '  console.error("NEXT_DEPENDENCY_ESCAPED_PROJECT_ROOT");',
        "} else {",
        '  console.error("NEXT_MATERIALIZED_DEPENDENCY_SENTINEL");',
        "}",
        "process.exitCode = 1;",
        "",
      ].join("\n"),
    );
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    const reduced = await reduceProject({
      root,
      cwd: root,
      command: [process.execPath, "failure.mjs"],
      output,
      match: "NEXT_MATERIALIZED_DEPENDENCY_SENTINEL",
      noInstall: true,
      onlyReducers: ["files"],
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 10,
    });

    expect(reduced.detectedAdapters).toContain("next");
    expect(reduced.finalSignature.normalizedLines.join("\n")).toContain(
      "NEXT_MATERIALIZED_DEPENDENCY_SENTINEL",
    );
    await expect(
      readFile(path.join(output, "node_modules", "next", "package.json")),
    ).rejects.toThrow();
  });

  it("snapshots existing workspace dependencies when installation is disabled", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-monorepo-no-install-dependencies-"),
    );
    created.push(temporary);
    const root = path.join(temporary, "workspace");
    const output = path.join(temporary, "repro");
    const app = path.join(root, "packages", "app");
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await mkdir(path.join(app, "node_modules", "nested-only"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await writeFile(
      path.join(root, "run.mjs"),
      [
        'import workspace from "workspace-app";',
        "throw new Error(`BUGBONSAI_NO_INSTALL_SENTINEL:${workspace}`);",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({
        name: "workspace-app",
        private: true,
        type: "module",
        main: "index.mjs",
      }),
    );
    await writeFile(
      path.join(app, "index.mjs"),
      'import nested from "nested-only"; export default `workspace:${nested}`;\n',
    );
    await writeFile(
      path.join(app, "node_modules", "nested-only", "package.json"),
      JSON.stringify({
        name: "nested-only",
        type: "module",
        main: "index.mjs",
      }),
    );
    await writeFile(
      path.join(app, "node_modules", "nested-only", "index.mjs"),
      'export default "nested";\n',
    );
    await symlink(
      app,
      path.join(root, "node_modules", "workspace-app"),
      process.platform === "win32" ? "junction" : "dir",
    );
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    const reduced = await reduceProject({
      root,
      cwd: root,
      command: [process.execPath, "run.mjs"],
      output,
      failOnOutput: "BUGBONSAI_NO_INSTALL_SENTINEL:workspace:nested",
      noInstall: true,
      onlyReducers: ["files"],
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 25,
    });

    expect(reduced.baseline.normalizedLines.join("\n")).toContain(
      "BUGBONSAI_NO_INSTALL_SENTINEL:workspace:nested",
    );
    expect(
      reduced.attempts.every((attempt) => attempt.reducer !== "dependencies"),
    ).toBe(true);
  });

  it("recovers a failure that depends on gitignored generated output", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-monorepo-ignored-output-"),
    );
    created.push(temporary);
    const root = path.join(temporary, "workspace");
    const output = path.join(temporary, "repro");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "dist/\n");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await writeFile(
      path.join(root, "run.mjs"),
      [
        'import { writeFile } from "node:fs/promises";',
        'await writeFile("dist/runtime-output.txt", "generated during failure\\n");',
        'await import("./dist/failure.mjs");',
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "dist", "failure.mjs"),
      "throw new Error('BUGBONSAI_IGNORED_OUTPUT_SENTINEL');\n",
    );
    await writeFile(
      path.join(root, "dist", "unused.mjs"),
      "export default 'unused';\n",
    );
    const initialized = await runCommand(["git", "init", "--quiet"], {
      cwd: root,
      timeoutMs: 5_000,
    });
    expect(initialized.exitCode).toBe(0);
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const progress: string[] = [];

    const reduced = await reduceProject({
      root,
      cwd: root,
      command: [process.execPath, "run.mjs"],
      output,
      failOnOutput: "BUGBONSAI_IGNORED_OUTPUT_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 25,
      onProgress: (event) => progress.push(event.message),
    });

    expect(progress).toContain("Retrying with 2 safe gitignored files");
    expect(reduced.originalMetrics.files).toBe(5);
    expect(
      await readFile(path.join(output, "dist", "failure.mjs"), "utf8"),
    ).toContain("BUGBONSAI_IGNORED_OUTPUT_SENTINEL");
    expect(reduced.candidateRuns).toBeLessThan(25);
    await expect(
      readFile(path.join(output, "dist", "runtime-output.txt"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(output, "dist", "unused.mjs"), "utf8"),
    ).rejects.toThrow();
  });

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
