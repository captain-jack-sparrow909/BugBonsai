import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import type { ProjectMetrics, ResolvedOptions, RunState } from "./types.js";
import {
  isPathInside,
  pathExists,
  readJson,
  writeJsonAtomic,
} from "./utils.js";

const execFileAsync = promisify(execFile);
const ALWAYS_EXCLUDED = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  ".bugbonsai",
  ".bugbonsai/**",
  "bugbonsai-repro",
  "bugbonsai-repro/**",
  "coverage",
  "coverage/**",
  ".DS_Store",
];
const SECRET_FILES = [
  ".env",
  ".env.*",
  ".npmrc",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  ".aws/**",
  ".ssh/**",
];

export interface Inventory {
  root: string;
  files: string[];
  excludedSensitive: string[];
  source: "git" | "filesystem";
}

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

async function walk(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (
      ALWAYS_EXCLUDED.some((pattern) =>
        minimatch(child, pattern, { dot: true }),
      )
    )
      continue;
    if (entry.isDirectory()) files.push(...(await walk(root, child)));
    else files.push(child);
  }
  return files;
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    minimatch(file, pattern, { dot: true, matchBase: true }),
  );
}

export async function createInventory(
  root: string,
  options: Pick<ResolvedOptions, "include" | "exclude" | "keep">,
): Promise<Inventory> {
  const resolvedRoot = await realpath(root);
  const fromGit = await gitFiles(resolvedRoot);
  const candidates = fromGit ?? (await walk(resolvedRoot));
  const files: string[] = [];
  const excludedSensitive: string[] = [];
  for (const rawFile of candidates) {
    const file = rawFile.replaceAll("\\", "/").replace(/^\.\//, "");
    if (
      !file ||
      file.includes("\0") ||
      path.isAbsolute(file) ||
      file.split("/").includes("..")
    )
      continue;
    if (matchesAny(file, ALWAYS_EXCLUDED)) continue;
    if (matchesAny(file, SECRET_FILES) && !matchesAny(file, options.keep)) {
      excludedSensitive.push(file);
      continue;
    }
    if (
      options.include.length > 0 &&
      !matchesAny(file, options.include) &&
      !matchesAny(file, options.keep)
    )
      continue;
    if (matchesAny(file, options.exclude) && !matchesAny(file, options.keep))
      continue;
    files.push(file);
  }
  return {
    root: resolvedRoot,
    files: [...new Set(files)].sort(),
    excludedSensitive,
    source: fromGit ? "git" : "filesystem",
  };
}

export async function copyInventory(
  inventory: Inventory,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const relative of inventory.files) {
    const source = path.join(inventory.root, relative);
    const target = path.join(destination, relative);
    if (
      !isPathInside(inventory.root, source) ||
      !isPathInside(destination, target)
    )
      throw new Error(`Unsafe inventory path: ${relative}`);
    const info = await lstat(source);
    if (info.isSymbolicLink()) {
      const resolved = await realpath(source);
      if (!isPathInside(inventory.root, resolved)) continue;
      const targetInfo = await stat(resolved);
      if (!targetInfo.isFile()) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await cp(resolved, target, {
        force: false,
        mode: constants.COPYFILE_FICLONE,
      });
      continue;
    }
    if (!info.isFile()) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, {
      force: false,
      preserveTimestamps: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
}

export async function copyProject(
  source: string,
  destination: string,
  options: { includeNodeModules?: boolean } = {},
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, {
    recursive: true,
    force: false,
    preserveTimestamps: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (item) =>
      options.includeNodeModules || path.basename(item) !== "node_modules",
  });
}

export async function linkDependencies(
  dependencies: string,
  candidate: string,
): Promise<void> {
  if (!(await pathExists(dependencies))) return;
  const link = path.join(candidate, "node_modules");
  if (await pathExists(link)) await rm(link, { recursive: true, force: true });
  await symlink(
    dependencies,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
}

export function cacheRoot(): string {
  if (process.env.BUGBONSAI_CACHE_DIR)
    return path.resolve(process.env.BUGBONSAI_CACHE_DIR);
  if (process.env.XDG_CACHE_HOME)
    return path.join(process.env.XDG_CACHE_HOME, "bugbonsai");
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, "BugBonsai");
  return path.join(os.homedir(), ".cache", "bugbonsai");
}

export async function createSession(runId: string): Promise<string> {
  const directory = path.join(cacheRoot(), "runs", runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export async function saveState(
  session: string,
  state: RunState,
): Promise<void> {
  await writeJsonAtomic(path.join(session, "state.json"), {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadState(session: string): Promise<RunState> {
  const raw = await readJson<Record<string, unknown>>(
    path.join(session, "state.json"),
  );
  if (raw.schemaVersion === 1) {
    const legacyOptions = raw.options as Record<string, unknown>;
    return {
      ...raw,
      schemaVersion: 2,
      options: { ...legacyOptions, root: raw.projectRoot },
    } as unknown as RunState;
  }
  if (raw.schemaVersion !== 2)
    throw new Error(`Unsupported session schema: ${String(raw.schemaVersion)}`);
  return raw as unknown as RunState;
}

export async function listStates(): Promise<
  Array<{ session: string; state: RunState }>
> {
  const root = path.join(cacheRoot(), "runs");
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const states: Array<{ session: string; state: RunState }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const session = path.join(root, entry.name);
    try {
      states.push({ session, state: await loadState(session) });
    } catch {
      // Ignore corrupt or incomplete sessions; doctor can report them later.
    }
  }
  return states.sort((a, b) =>
    b.state.updatedAt.localeCompare(a.state.updatedAt),
  );
}

export async function metrics(root: string): Promise<ProjectMetrics> {
  const files = await walk(root);
  let bytes = 0;
  for (const file of files) bytes += (await stat(path.join(root, file))).size;
  let dependencies = 0;
  for (const relative of files.filter(
    (file) => path.posix.basename(file) === "package.json",
  )) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, relative), "utf8"),
      ) as Record<string, unknown>;
      for (const key of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ]) {
        const section = manifest[key];
        if (section && typeof section === "object")
          dependencies += Object.keys(section).length;
      }
    } catch {
      // Invalid JSON will be diagnosed by the command/oracle.
    }
  }
  return { files: files.length, bytes, dependencies };
}
