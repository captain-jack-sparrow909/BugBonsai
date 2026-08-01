import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";
import { BugBonsaiError } from "../../src/errors.js";
import { listStates } from "../../src/sandbox.js";

const created: string[] = [];
afterEach(async () => {
  delete process.env.BUGBONSAI_FAULT_COUNTER;
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("fault injection", () => {
  it("rejects an unstable baseline and never publishes a partial output", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-unstable-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    const counter = path.join(temporary, "counter.txt");
    const output = path.join(temporary, "repro");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "failure.js"),
      `const fs = require("node:fs");
const counter = process.env.BUGBONSAI_FAULT_COUNTER;
const next = Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : "0") + 1;
fs.writeFileSync(counter, String(next));
if (next % 2) throw new Error("INJECTED_FAILURE_ALPHA");
console.log("injected intermittent success");
`,
    );
    process.env.BUGBONSAI_FAULT_COUNTER = counter;
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    await expect(
      reduceProject({
        cwd: project,
        command: [process.execPath, "failure.js"],
        output,
        noInstall: true,
        stabilityRuns: 2,
        finalRuns: 1,
        maxRuns: 1,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BugBonsaiError && error.code === "UNSTABLE_BASELINE",
    );
    await expect(access(output)).rejects.toBeDefined();
    const state = (await listStates()).find(
      ({ state }) => state.projectRoot === project,
    );
    expect(state?.state.status).toBe("failed");
  });

  it("contains an injected installer failure inside the isolated workspace", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-install-fault-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    const output = path.join(temporary, "repro");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: { "injected-package": "1.0.0" },
      }),
    );
    await writeFile(
      path.join(project, "failure.js"),
      'throw new Error("INSTALL_FAULT_SENTINEL");\n',
    );
    const original = await readFile(path.join(project, "package.json"), "utf8");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");

    await expect(
      reduceProject({
        cwd: project,
        command: [process.execPath, "failure.js"],
        output,
        match: "INSTALL_FAULT_SENTINEL",
        installCommand: [
          process.execPath,
          "-e",
          'process.stderr.write("INJECTED_INSTALL_FAILURE"); process.exit(19)',
        ],
        stabilityRuns: 1,
        finalRuns: 1,
        maxRuns: 1,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BugBonsaiError &&
        error.code === "INTERNAL" &&
        error.message.includes("INJECTED_INSTALL_FAILURE"),
    );
    expect(await readFile(path.join(project, "package.json"), "utf8")).toBe(
      original,
    );
    await expect(access(output)).rejects.toBeDefined();
  });
});
