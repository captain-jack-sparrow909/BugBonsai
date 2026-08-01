import { readFile } from "node:fs/promises";
import path from "node:path";
import { BugBonsaiError } from "./errors.js";
import type { ResolvedOptions } from "./types.js";
import { pathExists } from "./utils.js";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageManagerInfo {
  name: PackageManagerName;
  executable: string;
  lockfile?: string;
  lockfiles: string[];
  workspaceType: "none" | "package-json" | "pnpm";
  warnings: string[];
  installCommand: string[];
  installAfterManifestChange: string[];
}

export async function detectPackageManager(
  root: string,
  options: Pick<ResolvedOptions, "installCommand" | "allowInstallScripts">,
): Promise<PackageManagerInfo> {
  let declared: string | undefined;
  let hasManifestWorkspaces = false;
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { packageManager?: string; workspaces?: unknown };
    declared = manifest.packageManager?.split("@")[0];
    hasManifestWorkspaces =
      Array.isArray(manifest.workspaces) ||
      Boolean(manifest.workspaces && typeof manifest.workspaces === "object");
  } catch {
    // Package metadata is optional for the generic command path.
  }
  const locks: Array<[PackageManagerName, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["npm", "package-lock.json"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
  ];
  const foundLocks: Array<[PackageManagerName, string]> = [];
  for (const candidate of locks) {
    if (await pathExists(path.join(root, candidate[1])))
      foundLocks.push(candidate);
  }
  const validDeclared =
    declared && ["npm", "pnpm", "yarn", "bun"].includes(declared)
      ? (declared as PackageManagerName)
      : undefined;
  if (foundLocks.length > 1 && !validDeclared && !options.installCommand) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Several package-manager lockfiles were found (${foundLocks.map((entry) => entry[1]).join(", ")}). Declare packageManager in package.json or provide --install-command.`,
    );
  }
  const lock = validDeclared
    ? foundLocks.find(([manager]) => manager === validDeclared)
    : foundLocks[0];
  const name = (
    validDeclared ? validDeclared : (lock?.[0] ?? "npm")
  ) as PackageManagerName;
  const warnings =
    foundLocks.length > 1
      ? [
          `Multiple lockfiles detected; using ${lock?.[1] ?? `${name} conventions`} because ${validDeclared ? `packageManager declares ${validDeclared}` : "a custom install command was supplied"}.`,
        ]
      : [];
  const workspaceType =
    (await pathExists(path.join(root, "pnpm-workspace.yaml"))) ||
    (await pathExists(path.join(root, "pnpm-workspace.yml")))
      ? "pnpm"
      : hasManifestWorkspaces
        ? "package-json"
        : "none";
  const shared = {
    lockfiles: foundLocks.map((entry) => entry[1]),
    workspaceType,
    warnings,
  } as const;
  if (options.installCommand) {
    return {
      name,
      executable: name,
      installCommand: options.installCommand,
      installAfterManifestChange: options.installCommand,
      ...shared,
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
    ...shared,
  };
  if (lock) result.lockfile = lock[1];
  return result;
}
