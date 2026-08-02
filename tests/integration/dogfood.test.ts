import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("external dogfood runner", () => {
  it("checks provenance and emits only aggregate verified observations", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-dogfood-test-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "failure.js"),
      'throw new Error("PUBLIC_DOGFOOD_SENTINEL");\n',
    );
    await writeFile(path.join(project, "unused.js"), "export {};\n");
    await writeFile(
      path.join(project, "package.json"),
      '{"name":"public-dogfood-fixture","private":true}\n',
    );
    await execFileAsync("git", ["init"], { cwd: project });
    await execFileAsync("git", ["add", "."], { cwd: project });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=BugBonsai Test",
        "-c",
        "user.email=bugbonsai@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: project },
    );
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:example/project.git"],
      { cwd: project },
    );
    const { stdout: commit } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: project },
    );
    const descriptor = path.join(temporary, "case.json");
    const observation = path.join(temporary, "observation.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        schemaVersion: 1,
        id: "public-dogfood-fixture",
        project: "./project",
        upstream: {
          repository: "https://github.com/example/project",
          commit: commit.trim(),
          license: "MIT",
        },
        command: ["{node}", "failure.js"],
        match: "PUBLIC_DOGFOOD_SENTINEL",
        maxRuns: 10,
        onlyReducers: ["files"],
      }),
    );

    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/dogfood.ts",
        "--case",
        descriptor,
        "--output",
        observation,
      ],
      { cwd: path.resolve("."), timeout: 20_000 },
    );
    const recorded = JSON.parse(await readFile(observation, "utf8")) as {
      caseId: string;
      project?: string;
      result: { verified: boolean; finalMetrics: { files: number } };
    };
    expect(recorded.caseId).toBe("public-dogfood-fixture");
    expect(recorded.project).toBeUndefined();
    expect(recorded.result.verified).toBe(true);
    expect(recorded.result.finalMetrics.files).toBeLessThan(3);
    expect(await readFile(path.join(project, "unused.js"), "utf8")).toBe(
      "export {};\n",
    );
  });
});
