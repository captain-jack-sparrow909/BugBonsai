import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedOptions } from "./types.js";
import { pathExists } from "./utils.js";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageManagerInfo {
  name: PackageManagerName;
  executable: string;
  lockfile?: string;
  installCommand: string[];
  installAfterManifestChange: string[];
}

export async function detectPackageManager(
  root: string,
  options: Pick<ResolvedOptions, "installCommand" | "allowInstallScripts">,
): Promise<PackageManagerInfo> {
  let declared: string | undefined;
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { packageManager?: string };
    declared = manifest.packageManager?.split("@")[0];
  } catch {
    // Package metadata is optional for the generic command path.
  }
  const locks: Array<[PackageManagerName, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["npm", "package-lock.json"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
  ];
  let lock: [PackageManagerName, string] | undefined;
  for (const candidate of locks) {
    if (await pathExists(path.join(root, candidate[1]))) {
      lock = candidate;
      break;
    }
  }
  const name = (
    declared && ["npm", "pnpm", "yarn", "bun"].includes(declared)
      ? declared
      : (lock?.[0] ?? "npm")
  ) as PackageManagerName;
  if (options.installCommand) {
    return {
      name,
      executable: name,
      installCommand: options.installCommand,
      installAfterManifestChange: options.installCommand,
      ...(lock ? { lockfile: lock[1] } : {}),
    };
  }

  const scripts = options.allowInstallScripts ? [] : ["--ignore-scripts"];
  const installCommand =
    name === "pnpm"
      ? ["pnpm", "install", ...(lock ? ["--frozen-lockfile"] : []), ...scripts]
      : name === "npm"
        ? [
            "npm",
            lock ? "ci" : "install",
            "--no-audit",
            "--no-fund",
            ...scripts,
          ]
        : name === "yarn"
          ? ["yarn", "install", ...(lock ? ["--immutable"] : []), ...scripts]
          : [
              "bun",
              "install",
              ...(lock ? ["--frozen-lockfile"] : []),
              ...scripts,
            ];
  const installAfterManifestChange =
    name === "pnpm"
      ? ["pnpm", "install", "--no-frozen-lockfile", ...scripts]
      : name === "npm"
        ? ["npm", "install", "--no-audit", "--no-fund", ...scripts]
        : name === "yarn"
          ? ["yarn", "install", ...scripts]
          : ["bun", "install", ...scripts];
  const result: PackageManagerInfo = {
    name,
    executable: name,
    installCommand,
    installAfterManifestChange,
  };
  if (lock) result.lockfile = lock[1];
  return result;
}
