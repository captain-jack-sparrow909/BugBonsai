import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPackageManager } from "../../src/package-manager.js";

describe("detectPackageManager", () => {
  it("prefers a declared package manager and provides a mutable install", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-pm-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.9.0" }),
    );
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    const manager = await detectPackageManager(root, {
      allowInstallScripts: false,
    });
    expect(manager.name).toBe("pnpm");
    expect(manager.installCommand).toContain("--frozen-lockfile");
    expect(manager.installAfterManifestChange).toContain(
      "--no-frozen-lockfile",
    );
    expect(manager.installAfterManifestChange).toContain("--ignore-scripts");
    expect(manager.lockfiles).toEqual(["pnpm-lock.yaml"]);
    expect(manager.workspaceType).toBe("none");
  });

  it("rejects ambiguous lockfiles without an explicit package manager", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-pm-ambiguous-"),
    );
    await writeFile(path.join(root, "package.json"), '{"private":true}\n');
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await expect(
      detectPackageManager(root, { allowInstallScripts: false }),
    ).rejects.toThrow(/Several package-manager lockfiles/);
  });

  it("uses a declaration to resolve multiple lockfiles and detects workspaces", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bugbonsai-pm-workspace-"),
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, packageManager: "pnpm@11.9.0" }),
    );
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      "packages: ['apps/*']\n",
    );
    const manager = await detectPackageManager(root, {
      allowInstallScripts: false,
    });
    expect(manager.name).toBe("pnpm");
    expect(manager.lockfile).toBe("pnpm-lock.yaml");
    expect(manager.workspaceType).toBe("pnpm");
    expect(manager.warnings).toHaveLength(1);
  });
});
