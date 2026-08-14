import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceProject } from "../../src/engine.js";
import { runCommand } from "../../src/process.js";
import type { PortabilityManifest } from "../../src/sharing.js";
import { sha256 } from "../../src/utils.js";
import { verifyReproduction } from "../../src/verify.js";
import { VERSION } from "../../src/version.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("portable sharing artifacts", () => {
  it("exports and verifies a successful command with failure output", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-output-failure-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    await mkdir(project);
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "output-failure-fixture", private: true }),
    );
    await writeFile(
      path.join(project, "warning.js"),
      'console.warn("TYPE_DOC_WARNING: Promise link unresolved");\n',
    );
    await writeFile(path.join(project, "noise.txt"), "remove me\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const output = path.join(temporary, "repro");

    await reduceProject({
      cwd: project,
      command: [process.execPath, "warning.js"],
      output,
      failOnOutput: "TYPE_DOC_WARNING",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 10,
      onlyReducers: ["files"],
    });

    const manifest = JSON.parse(
      await readFile(path.join(output, "bugbonsai-manifest.json"), "utf8"),
    ) as PortabilityManifest;
    expect(manifest.oracle).toEqual({ failOnOutput: "TYPE_DOC_WARNING" });
    await expect(
      verifyReproduction(output, { install: false }),
    ).resolves.toMatchObject({
      integrityVerified: true,
      failureVerified: true,
    });
  });

  it("archives, verifies, and detects tampering before execution", async () => {
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-sharing-"),
    );
    created.push(temporary);
    const project = path.join(temporary, "project");
    await mkdir(project);
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "sharing-fixture", private: true }),
    );
    await writeFile(
      path.join(project, "failure.js"),
      `if (process.env.SHARING_REQUIRED === "never") process.exit(0);
throw new Error("BUGBONSAI_SHARING_SENTINEL");
`,
    );
    await writeFile(path.join(project, "noise.txt"), "remove me\n");
    process.env.BUGBONSAI_CACHE_DIR = path.join(temporary, "cache");
    const output = path.join(temporary, "repro");
    const archive = path.join(temporary, "artifacts", "repro.zip");
    const result = await reduceProject({
      cwd: project,
      command: [process.execPath, "failure.js"],
      output,
      archivePath: archive,
      dockerfile: true,
      githubIssue: true,
      match: "BUGBONSAI_SHARING_SENTINEL",
      noInstall: true,
      stabilityRuns: 1,
      finalRuns: 1,
      maxRuns: 10,
      onlyReducers: ["files"],
    });

    const manifest = JSON.parse(
      await readFile(path.join(output, "bugbonsai-manifest.json"), "utf8"),
    ) as PortabilityManifest;
    expect(manifest.environment.requiredVariables).toEqual([
      "SHARING_REQUIRED",
    ]);
    expect(manifest.command[0]).toBe("node");
    expect(manifest.files.map((file) => file.path)).not.toContain(
      "bugbonsai-manifest.json",
    );
    expect(result.sharingArtifacts).toMatchObject({
      archive,
      dockerfile: "Dockerfile.bugbonsai",
      githubIssue: "BUGBONSAI_GITHUB_ISSUE.md",
      treeSha256: manifest.treeSha256,
    });
    const archiveBytes = await readFile(archive);
    expect(result.sharingArtifacts?.archiveSha256).toBe(sha256(archiveBytes));
    expect(await readFile(`${archive}.sha256`, "utf8")).toContain(
      `${sha256(archiveBytes)}  repro.zip`,
    );
    expect(
      await readFile(path.join(output, "Dockerfile.bugbonsai"), "utf8"),
    ).toContain('CMD ["node","failure.js"]');
    expect(
      await readFile(path.join(output, "BUGBONSAI_GITHUB_ISSUE.md"), "utf8"),
    ).toContain(`npx bugbonsai@${VERSION} verify .`);

    const verified = await verifyReproduction(output, { install: false });
    expect(verified).toMatchObject({
      integrityVerified: true,
      failureVerified: true,
      installed: false,
      treeSha256: manifest.treeSha256,
    });
    if (process.platform !== "win32") {
      const extracted = path.join(temporary, "extracted");
      await mkdir(extracted);
      const unzip = await runCommand(
        ["unzip", "-q", archive, "-d", extracted],
        {
          cwd: temporary,
          timeoutMs: 5_000,
          verbose: false,
        },
      );
      expect(unzip.exitCode).toBe(0);
      await expect(
        verifyReproduction(extracted, { install: false }),
      ).resolves.toMatchObject({
        integrityVerified: true,
        failureVerified: true,
      });
    }
    const cliVerification = await runCommand(
      [
        process.execPath,
        "--import",
        "tsx",
        path.resolve("src/cli.ts"),
        "verify",
        output,
        "--no-install",
        "--json",
      ],
      { cwd: path.resolve("."), timeoutMs: 30_000, verbose: false },
    );
    expect(cliVerification.exitCode).toBe(0);
    expect(JSON.parse(cliVerification.stdout)).toMatchObject({
      integrityVerified: true,
      failureVerified: true,
    });

    await writeFile(
      path.join(output, "bugbonsai-manifest.json"),
      `${JSON.stringify({ ...manifest, invocationDirectory: "../../outside" }, null, 2)}\n`,
    );
    await expect(
      verifyReproduction(output, { install: false }),
    ).rejects.toThrow(/escapes the reproduction root/i);
    await writeFile(
      path.join(output, "bugbonsai-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await writeFile(
      path.join(output, "failure.js"),
      'throw new Error("TAMPERED");\n',
    );
    await expect(
      verifyReproduction(output, { install: false }),
    ).rejects.toThrow(/integrity check failed/i);
  });
});
