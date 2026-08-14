import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
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
  "**/.git",
  "**/.git/**",
  "node_modules",
  "node_modules/**",
  "**/node_modules",
  "**/node_modules/**",
  ".npm-cache",
  ".npm-cache/**",
  "**/.npm-cache",
  "**/.npm-cache/**",
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
  for (const entry of await dependencySnapshotEntries(dependencies)) {
    const parent = path.dirname(path.join(candidate, entry.relative));
    if (!(await pathExists(parent))) continue;
    const target = path.join(candidate, entry.relative);
    await rm(target, { recursive: true, force: true });
    await linkDependencyDirectory(
      entry.source,
      target,
      candidate,
      entry.relative,
      entry.workspaceLinks,
    );
  }
}

const DEPENDENCY_SNAPSHOT_MARKER = ".bugbonsai-dependency-snapshot.json";

interface DependencySnapshotMarker {
  version: 1;
  directories: string[];
  workspaceLinks?: Record<string, string>;
}

interface DependencySnapshotEntry {
  relative: string;
  source: string;
  workspaceLinks: Record<string, string>;
}

async function findDependencyDirectories(
  root: string,
  relative = "",
): Promise<string[]> {
  const directory = path.join(root, relative);
  if (!(await pathExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.name === "node_modules") {
      found.push(child);
      continue;
    }
    if (entry.name === ".git" || entry.name === ".npm-cache") continue;
    if (entry.isDirectory())
      found.push(...(await findDependencyDirectories(root, child)));
  }
  return found;
}

function validSnapshotRelative(relative: string): boolean {
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !relative.split("/").includes("..") &&
    path.posix.basename(relative) === "node_modules"
  );
}

async function dependencySnapshotEntries(
  snapshot: string,
): Promise<DependencySnapshotEntry[]> {
  const markerPath = path.join(snapshot, DEPENDENCY_SNAPSHOT_MARKER);
  if (!(await pathExists(markerPath))) {
    return [{ relative: "node_modules", source: snapshot, workspaceLinks: {} }];
  }
  const marker = await readJson<DependencySnapshotMarker>(markerPath);
  if (
    marker.version !== 1 ||
    !Array.isArray(marker.directories) ||
    marker.directories.some(
      (relative) =>
        typeof relative !== "string" || !validSnapshotRelative(relative),
    ) ||
    (marker.workspaceLinks !== undefined &&
      (marker.workspaceLinks === null ||
        typeof marker.workspaceLinks !== "object" ||
        Object.entries(marker.workspaceLinks).some(
          ([link, target]) =>
            !validSnapshotPath(link) || !validSnapshotPath(target),
        )))
  ) {
    throw new Error(`Invalid dependency snapshot marker: ${markerPath}`);
  }
  return marker.directories.map((relative) => ({
    relative,
    source: path.join(snapshot, relative),
    workspaceLinks: marker.workspaceLinks ?? {},
  }));
}

function validSnapshotPath(relative: string): boolean {
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !relative.replaceAll("\\", "/").split("/").includes("..")
  );
}

async function dependencyLinkType(
  source: string,
  target: string,
  linkTarget: string,
): Promise<"dir" | "file" | "junction" | undefined> {
  for (const resolved of [
    path.resolve(path.dirname(source), linkTarget),
    path.resolve(path.dirname(target), linkTarget),
  ]) {
    try {
      const info = await stat(resolved);
      if (info.isDirectory())
        return process.platform === "win32" ? "junction" : "dir";
      return "file";
    } catch {
      // Try the candidate-relative target before falling back to auto-detection.
    }
  }
  return undefined;
}

async function linkDependencyEntry(
  source: string,
  target: string,
  workspaceTarget?: string,
): Promise<void> {
  if (workspaceTarget) {
    const type = process.platform === "win32" ? "junction" : "dir";
    const linkTarget =
      process.platform === "win32"
        ? workspaceTarget
        : path.relative(path.dirname(target), workspaceTarget);
    await symlink(linkTarget, target, type);
    return;
  }
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(source);
    const type = await dependencyLinkType(source, target, linkTarget);
    await symlink(linkTarget, target, type);
    return;
  }
  await symlink(
    source,
    target,
    info.isDirectory()
      ? process.platform === "win32"
        ? "junction"
        : "dir"
      : "file",
  );
}

async function linkDependencyDirectory(
  source: string,
  target: string,
  candidate: string,
  relative: string,
  workspaceLinks: Record<string, string>,
): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);
    if (
      entry.name.startsWith("@") &&
      entry.isDirectory() &&
      !entry.isSymbolicLink()
    ) {
      await mkdir(targetEntry, { recursive: true });
      for (const scoped of await readdir(sourceEntry, {
        withFileTypes: true,
      })) {
        const workspaceTarget =
          workspaceLinks[`${relative}/${entry.name}/${scoped.name}`];
        await linkDependencyEntry(
          path.join(sourceEntry, scoped.name),
          path.join(targetEntry, scoped.name),
          workspaceTarget ? path.join(candidate, workspaceTarget) : undefined,
        );
      }
      continue;
    }
    const workspaceTarget = workspaceLinks[`${relative}/${entry.name}`];
    await linkDependencyEntry(
      sourceEntry,
      targetEntry,
      workspaceTarget ? path.join(candidate, workspaceTarget) : undefined,
    );
  }
}

async function findWorkspaceLinks(
  project: string,
  directories: string[],
): Promise<Record<string, string>> {
  const resolvedProject = await realpath(project);
  const links: Record<string, string> = {};
  for (const relative of directories) {
    const modules = path.join(project, relative);
    for (const entry of await readdir(modules, { withFileTypes: true })) {
      const candidates =
        entry.name.startsWith("@") &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
          ? (
              await readdir(path.join(modules, entry.name), {
                withFileTypes: true,
              })
            ).map((scoped) => path.join(entry.name, scoped.name))
          : [entry.name];
      for (const candidate of candidates) {
        const link = path.join(modules, candidate);
        if (!(await lstat(link)).isSymbolicLink()) continue;
        try {
          const resolved = await realpath(link);
          if (!isPathInside(resolvedProject, resolved)) continue;
          const target = path
            .relative(resolvedProject, resolved)
            .replaceAll("\\", "/");
          if (
            !validSnapshotPath(target) ||
            target.split("/").includes("node_modules")
          )
            continue;
          links[`${relative}/${candidate.replaceAll("\\", "/")}`] = target;
        } catch {
          // Broken package links remain ordinary snapshot symlinks.
        }
      }
    }
  }
  return links;
}

export async function createDependencySnapshot(
  project: string,
  snapshot: string,
): Promise<boolean> {
  const directories = (await findDependencyDirectories(project)).sort(
    (left, right) => left.localeCompare(right),
  );
  if (directories.length === 0) return false;
  const workspaceLinks = await findWorkspaceLinks(project, directories);
  await mkdir(snapshot, { recursive: true });
  for (const relative of directories) {
    const target = path.join(snapshot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(project, relative), target);
  }
  await writeJsonAtomic(path.join(snapshot, DEPENDENCY_SNAPSHOT_MARKER), {
    version: 1,
    directories,
    ...(Object.keys(workspaceLinks).length > 0 ? { workspaceLinks } : {}),
  } satisfies DependencySnapshotMarker);
  return true;
}

export async function materializeDependencies(
  dependencies: string,
  candidate: string,
): Promise<void> {
  if (!(await pathExists(dependencies))) return;
  for (const entry of await dependencySnapshotEntries(dependencies)) {
    const parent = path.dirname(path.join(candidate, entry.relative));
    if (!(await pathExists(parent))) continue;
    await copyProject(entry.source, path.join(candidate, entry.relative), {
      includeNodeModules: true,
    });
    for (const [link, target] of Object.entries(entry.workspaceLinks)) {
      if (link !== entry.relative && !link.startsWith(`${entry.relative}/`))
        continue;
      const targetLink = path.join(candidate, link);
      await rm(targetLink, { recursive: true, force: true });
      await mkdir(path.dirname(targetLink), { recursive: true });
      await linkDependencyEntry(
        path.join(dependencies, link),
        targetLink,
        path.join(candidate, target),
      );
    }
  }
}

export async function removeDependencies(project: string): Promise<void> {
  const directories = (await findDependencyDirectories(project)).sort(
    (left, right) => right.length - left.length,
  );
  for (const relative of directories)
    await rm(path.join(project, relative), { recursive: true, force: true });
}

export async function normalizeDependencySnapshot(
  snapshot: string,
): Promise<string> {
  if (
    !(await pathExists(snapshot)) ||
    (await pathExists(path.join(snapshot, DEPENDENCY_SNAPSHOT_MARKER)))
  )
    return snapshot;
  const normalized = `${snapshot}-layout`;
  await mkdir(path.join(normalized), { recursive: true });
  await rename(snapshot, path.join(normalized, "node_modules"));
  await writeJsonAtomic(path.join(normalized, DEPENDENCY_SNAPSHOT_MARKER), {
    version: 1,
    directories: ["node_modules"],
  } satisfies DependencySnapshotMarker);
  return normalized;
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
      schemaVersion: 4,
      options: { ...legacyOptions, root: raw.projectRoot },
      cacheHits: 0,
      cache: {},
      cursor: {
        reducerIndex: 0,
        generation: Number(raw.generation ?? 0),
        scheduleIds: [],
        nextMutationIndex: 0,
      },
      elapsedMs: 0,
    } as unknown as RunState;
  }
  if (raw.schemaVersion === 2) {
    return {
      ...raw,
      schemaVersion: 4,
      cacheHits: 0,
      cache: {},
      cursor: {
        reducerIndex: 0,
        generation: Number(raw.generation ?? 0),
        scheduleIds: [],
        nextMutationIndex: 0,
      },
      elapsedMs: 0,
    } as unknown as RunState;
  }
  if (raw.schemaVersion === 3) {
    return {
      ...raw,
      schemaVersion: 4,
      cursor: {
        reducerIndex: 0,
        generation: Number(raw.generation ?? 0),
        scheduleIds: [],
        nextMutationIndex: 0,
      },
      elapsedMs: 0,
    } as unknown as RunState;
  }
  if (raw.schemaVersion !== 4)
    throw new Error(`Unsupported session schema: ${String(raw.schemaVersion)}`);
  return raw as unknown as RunState;
}

export async function fingerprintProject(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of (await walk(root)).sort()) {
    const absolute = path.join(root, relative);
    hash.update(relative);
    hash.update("\0");
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await readlink(absolute));
    } else {
      hash.update(await readFile(absolute));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
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
