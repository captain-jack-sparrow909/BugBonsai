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
  });
});
