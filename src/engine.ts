import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { detectAdapters } from "./adapters.js";
import { createDdminSchedule } from "./ddmin.js";
import { BugBonsaiError } from "./errors.js";
import {
  CustomFailureOracle,
  DefaultFailureOracle,
  loadCustomOracle,
} from "./oracle.js";
import {
  detectPackageManager,
  type PackageManagerInfo,
} from "./package-manager.js";
import { runCommand } from "./process.js";
import { loadPlugins } from "./plugin.js";
import { defaultReducers, type Mutation, type Reducer } from "./reducers.js";
import { writeReports } from "./report.js";
import { writeSharingArtifacts } from "./sharing.js";
import {
  copyInventory,
  copyProject,
  cacheRoot,
  createDependencySnapshot,
  createInventory,
  createSession,
  fingerprintProject,
  linkDependencies,
  loadState,
  materializeDependencies,
  metrics,
  normalizeDependencySnapshot,
  removeDependencies,
  saveState,
} from "./sandbox.js";
import { auditPortability, scanSecurity } from "./security.js";
import type {
  FailureSignature,
  FailureOracle,
  CandidateCacheEntry,
  ReductionAttempt,
  ReductionOptions,
  ReductionResult,
  ResolvedOptions,
  RunState,
} from "./types.js";
import { createRunId, isPathInside, pathExists, sha256 } from "./utils.js";
import { VERSION } from "./version.js";

const DEFAULTS = {
  mode: "balanced" as const,
  timeoutMs: 60_000,
  stabilityRuns: 2,
  finalRuns: 3,
  maxRuns: 250,
  keep: [] as string[],
  exclude: [] as string[],
  include: [] as string[],
  onlyReducers: [] as string[],
  skipReducers: [] as string[],
  plugins: [] as string[],
  dockerfile: false,
  githubIssue: false,
  allowInstallScripts: false,
  noInstall: false,
  outputMode: "human" as const,
  verbose: false,
};

function resolveOptions(input: ReductionOptions): ResolvedOptions {
  if (!input.command.length)
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "A command is required after --.",
    );
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const root = path.resolve(cwd, input.root ?? cwd);
  if (!isPathInside(root, cwd))
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Invocation directory must be inside the project root: ${root}`,
    );
  const output = path.resolve(cwd, input.output ?? "bugbonsai-repro");
  if (output === cwd)
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "The output directory cannot be the source project.",
    );
  const result: ResolvedOptions = {
    ...DEFAULTS,
    ...input,
    cwd,
    root,
    output,
    command: [...input.command],
    keep: [...(input.keep ?? [])],
    exclude: [...(input.exclude ?? [])],
    include: [...(input.include ?? [])],
    onlyReducers: [...(input.onlyReducers ?? [])],
    skipReducers: [...(input.skipReducers ?? [])],
    ...(input.oraclePath
      ? { oraclePath: path.resolve(cwd, input.oraclePath) }
      : {}),
    ...(input.archivePath
      ? { archivePath: path.resolve(cwd, input.archivePath) }
      : {}),
  };
  if (result.archivePath && isPathInside(result.output, result.archivePath)) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "The archive path must be outside the reproduction directory.",
    );
  }
  for (const [name, value] of [
    ["timeoutMs", result.timeoutMs],
    ["stabilityRuns", result.stabilityRuns],
    ["finalRuns", result.finalRuns],
    ["maxRuns", result.maxRuns],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        `${name} must be a positive number.`,
      );
    }
  }
  for (const [name, value] of [
    ["stabilityRuns", result.stabilityRuns],
    ["finalRuns", result.finalRuns],
    ["maxRuns", result.maxRuns],
  ] as const) {
    if (!Number.isInteger(value)) {
      throw new BugBonsaiError("INVALID_INPUT", `${name} must be an integer.`);
    }
  }
  if (result.exitCode !== undefined && !Number.isInteger(result.exitCode)) {
    throw new BugBonsaiError("INVALID_INPUT", "exitCode must be an integer.");
  }
  if (
    result.failOnOutput !== undefined &&
    result.failOnOutput.trim().length === 0
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "failOnOutput must contain non-whitespace text.",
    );
  }
  if (
    result.failOnOutput !== undefined &&
    (result.match !== undefined || result.matchRegex !== undefined)
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Choose --fail-on-output or --match/--match-regex, not both.",
    );
  }
  if (
    result.failOnOutput !== undefined &&
    (result.oraclePath !== undefined || result.pluginOracle !== undefined)
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Choose --fail-on-output or a custom/plugin oracle, not both.",
    );
  }
  if (result.oraclePath && result.pluginOracle) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Choose either a custom oracle path or a plugin oracle, not both.",
    );
  }
  return result;
}

export async function resumeProject(
  runId: string,
  runtime: Pick<ReductionOptions, "signal" | "onProgress" | "verbose"> = {},
): Promise<ReductionResult> {
  const session = path.join(cacheRoot(), "runs", runId);
  const state = await loadState(session);
  if (state.status !== "paused") {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Run ${runId} is ${state.status}, not paused.`,
    );
  }
  const best = path.join(session, "best");
  if (!(await pathExists(best))) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Run ${runId} has no accepted candidate to resume.`,
    );
  }

  return reduceProjectInternal(
    {
      ...state.options,
      root: best,
      cwd: path.join(
        best,
        path.relative(state.projectRoot, state.invocationCwd),
      ),
      command: [...state.command],
      ...(runtime.signal ? { signal: runtime.signal } : {}),
      ...(runtime.onProgress ? { onProgress: runtime.onProgress } : {}),
      ...(runtime.verbose !== undefined ? { verbose: runtime.verbose } : {}),
    },
    state.cache,
    { session, state },
  );
}

interface ResumeContext {
  session: string;
  state: RunState;
}

function serializableOptions(
  options: ResolvedOptions,
): Omit<ResolvedOptions, "signal" | "onProgress"> {
  const { signal: _signal, onProgress: _progress, ...safe } = options;
  return safe;
}

function emit(
  options: ResolvedOptions,
  event: Parameters<NonNullable<ResolvedOptions["onProgress"]>>[0],
): void {
  options.onProgress?.(event);
}

function progressDetails(
  state: RunState,
  options: ResolvedOptions,
): Pick<
  NonNullable<Parameters<NonNullable<ResolvedOptions["onProgress"]>>[0]>,
  "runs" | "maxRuns" | "remainingRuns" | "progress" | "etaMs"
> {
  const remainingRuns = Math.max(0, options.maxRuns - state.candidateRuns);
  const measured = state.attempts.filter(
    (attempt) => !attempt.cached && attempt.durationMs > 0,
  );
  const averageMs =
    measured.length === 0
      ? undefined
      : measured.reduce((total, attempt) => total + attempt.durationMs, 0) /
        measured.length;
  return {
    runs: state.candidateRuns,
    maxRuns: options.maxRuns,
    remainingRuns,
    progress: Number(
      Math.min(1, state.candidateRuns / options.maxRuns).toFixed(4),
    ),
    ...(averageMs === undefined
      ? {}
      : { etaMs: Math.round(averageMs * remainingRuns) }),
  };
}

function throwIfAborted(options: ResolvedOptions): void {
  if (options.signal?.aborted)
    throw new BugBonsaiError("INTERRUPTED", "Reduction was interrupted.");
}

async function projectHasDependencies(root: string): Promise<boolean> {
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  for (const relative of inventory.files.filter(
    (file) => path.posix.basename(file) === "package.json",
  )) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, relative), "utf8"),
      ) as Record<string, unknown>;
      const hasDependencies = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ].some((key) => {
        const value = manifest[key];
        return Boolean(
          value && typeof value === "object" && Object.keys(value).length > 0,
        );
      });
      if (hasDependencies) return true;
    } catch {
      // The command remains authoritative for malformed project manifests.
    }
  }
  return false;
}

async function install(
  root: string,
  manager: PackageManagerInfo,
  options: ResolvedOptions,
  afterManifestChange = false,
): Promise<void> {
  if (options.noInstall) return;
  if (
    !afterManifestChange &&
    !options.installCommand &&
    !(await projectHasDependencies(root))
  )
    return;
  const result = await runCommand(
    afterManifestChange
      ? manager.installAfterManifestChange
      : manager.installCommand,
    {
      cwd: root,
      timeoutMs: Math.max(options.timeoutMs, 5 * 60_000),
      verbose: options.verbose,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (result.exitCode !== 0) {
    throw new BugBonsaiError(
      "INTERNAL",
      `Dependency installation failed in the isolated workspace.\n${result.stderr || result.stdout}`,
    );
  }
  if (
    afterManifestChange &&
    manager.lockfile &&
    !(await pathExists(path.join(root, manager.lockfile)))
  ) {
    throw new BugBonsaiError(
      "INTERNAL",
      `Dependency installation removed the expected lockfile ${manager.lockfile}.`,
    );
  }
}

async function executeWithDependencies(
  root: string,
  dependencies: string,
  options: ResolvedOptions,
): ReturnType<typeof runCommand> {
  await linkDependencies(dependencies, root);
  return runCommand(options.command, {
    cwd: path.join(root, path.relative(options.root, options.cwd)),
    timeoutMs: options.timeoutMs,
    verbose: options.verbose,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function captureBaseline(
  best: string,
  dependencies: string,
  scratch: string,
  options: ResolvedOptions,
  oracle: FailureOracle,
): Promise<FailureSignature> {
  let baseline: FailureSignature | undefined;
  for (let run = 0; run < options.stabilityRuns; run += 1) {
    throwIfAborted(options);
    const candidate = path.join(scratch, `baseline-${run}`);
    await copyProject(best, candidate);
    const result = await executeWithDependencies(
      candidate,
      dependencies,
      options,
    );
    throwIfAborted(options);
    if (!baseline) {
      try {
        baseline = await oracle.capture(result);
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "The baseline did not satisfy the failure oracle.";
        throw new BugBonsaiError(
          "COMMAND_PASSED",
          `The supplied command did not reproduce the requested failure in the isolated workspace: ${reason}`,
          { cause: error },
        );
      }
    } else {
      const match = await oracle.matches(baseline, result);
      if (!match.matches) {
        throw new BugBonsaiError(
          "UNSTABLE_BASELINE",
          `The baseline failure was unstable: ${match.reason}`,
          {
            details: {
              baseline: baseline.stableHash,
              candidate: match.signature.stableHash,
            },
          },
        );
      }
    }
    await rm(candidate, { recursive: true, force: true });
    emit(options, {
      phase: "baseline",
      message: `Failure reproduced ${run + 1}/${options.stabilityRuns}`,
    });
  }
  if (!baseline)
    throw new BugBonsaiError("INTERNAL", "No baseline signature was captured.");
  return baseline;
}

async function evaluateMutation(input: {
  mutation: Mutation;
  best: string;
  candidate: string;
  dependencies: string;
  manager: PackageManagerInfo;
  options: ResolvedOptions;
  oracle: FailureOracle;
  baseline: FailureSignature;
  cache: Record<string, CandidateCacheEntry>;
  executionFingerprint: string;
}): Promise<{
  attempt: ReductionAttempt;
  signature: FailureSignature;
  candidateDependencies?: string;
  dependencyPreparationChanged?: boolean;
  cacheKey: string;
  cacheHit: boolean;
}> {
  const started = performance.now();
  await copyProject(input.best, input.candidate);
  await input.mutation.apply(input.candidate);
  const cacheKey = sha256(
    `${input.executionFingerprint}\0${await fingerprintProject(input.candidate)}`,
  );
  const cached = input.cache[cacheKey];
  if (cached) {
    return {
      attempt: {
        mutationId: input.mutation.id,
        reducer: input.mutation.reducer,
        description: input.mutation.description,
        accepted: false,
        score: cached.score,
        reason: `cached rejection: ${cached.reason}`,
        durationMs: Math.round(performance.now() - started),
        cached: true,
      },
      signature: input.baseline,
      cacheKey,
      cacheHit: true,
    };
  }
  let candidateDependencies: string | undefined;
  let dependencySnapshotReused = false;
  if (input.mutation.requiresInstall) {
    if (await pathExists(input.dependencies)) {
      await materializeDependencies(input.dependencies, input.candidate);
      dependencySnapshotReused = true;
    }
    await install(input.candidate, input.manager, input.options, true);
  } else {
    await linkDependencies(input.dependencies, input.candidate);
  }
  const result = await runCommand(input.options.command, {
    cwd: path.join(
      input.candidate,
      path.relative(input.options.root, input.options.cwd),
    ),
    timeoutMs: input.options.timeoutMs,
    verbose: input.options.verbose,
    ...(input.options.signal ? { signal: input.options.signal } : {}),
  });
  throwIfAborted(input.options);
  const match = await input.oracle.matches(input.baseline, result);
  if (input.mutation.requiresInstall && match.matches) {
    const snapshot = `${input.candidate}.dependency-snapshot`;
    if (await createDependencySnapshot(input.candidate, snapshot))
      candidateDependencies = snapshot;
  }
  return {
    attempt: {
      mutationId: input.mutation.id,
      reducer: input.mutation.reducer,
      description: input.mutation.description,
      accepted: match.matches,
      score: match.score,
      reason: match.reason,
      durationMs: Math.round(performance.now() - started),
      ...(dependencySnapshotReused ? { dependencySnapshotReused: true } : {}),
    },
    signature: match.signature,
    cacheKey,
    cacheHit: false,
    ...(input.mutation.requiresInstall
      ? { dependencyPreparationChanged: true }
      : {}),
    ...(candidateDependencies ? { candidateDependencies } : {}),
  };
}

async function createExecutionFingerprint(
  options: ResolvedOptions,
  baseline: FailureSignature,
  pluginFingerprint = "",
): Promise<string> {
  const environmentHash = sha256(
    JSON.stringify(
      Object.entries(process.env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  let customOracleHash: string | undefined;
  if (options.oraclePath) {
    customOracleHash = sha256(await readFile(options.oraclePath));
  }
  return sha256(
    JSON.stringify({
      version: VERSION,
      command: options.command,
      invocationDirectory: path.relative(options.root, options.cwd),
      baseline: baseline.stableHash,
      match: options.match,
      matchRegex: options.matchRegex,
      failOnOutput: options.failOnOutput,
      exitCode: options.exitCode,
      customOracleHash,
      pluginFingerprint,
      environmentHash,
    }),
  );
}

function cacheRejection(
  cache: Record<string, CandidateCacheEntry>,
  key: string,
  attempt: ReductionAttempt,
): void {
  cache[key] = { score: attempt.score, reason: attempt.reason };
  const keys = Object.keys(cache);
  if (keys.length > 2_000 && keys[0]) delete cache[keys[0]];
}

async function promoteCandidate(
  best: string,
  candidate: string,
): Promise<void> {
  const backup = `${best}.previous`;
  await rm(backup, { recursive: true, force: true });
  await rename(best, backup);
  try {
    await rename(candidate, best);
    await removeDependencies(best);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (await pathExists(backup)) await rename(backup, best);
    throw error;
  }
}

function selectReducers(
  options: ResolvedOptions,
  pluginReducers: Reducer[] = [],
): Reducer[] {
  return [...pluginReducers, ...defaultReducers()].filter((reducer) => {
    if (
      options.onlyReducers.length > 0 &&
      !options.onlyReducers.includes(reducer.name)
    )
      return false;
    return !options.skipReducers.includes(reducer.name);
  });
}

const DDMIN_REDUCERS = new Set([
  "files",
  "package-json",
  "json-config",
  "dependencies",
]);

function scheduleMutations(
  reducer: Reducer,
  mutations: Mutation[],
  mode: ResolvedOptions["mode"],
): Mutation[] {
  if (!DDMIN_REDUCERS.has(reducer.name)) return mutations;
  return createDdminSchedule(mutations, {
    maxGranularity:
      mode === "fast" ? 4 : mode === "balanced" ? 16 : mutations.length,
  });
}

function commandProjectPaths(options: ResolvedOptions): string[] {
  const paths: string[] = [];
  for (const part of options.command) {
    if (part.startsWith("-") || !/[./]/.test(part)) continue;
    const absolute = path.isAbsolute(part)
      ? path.resolve(part)
      : path.resolve(options.cwd, part);
    if (!isPathInside(options.root, absolute)) continue;
    paths.push(path.relative(options.root, absolute).replaceAll("\\", "/"));
  }
  return paths;
}

function failureEntryPaths(baseline: FailureSignature): string[] {
  return baseline.stackFrames
    .map((frame) =>
      frame.file
        .replace(/^<PROJECT>\/?/, "")
        .replace(/^\.\//, "")
        .replaceAll("\\", "/"),
    )
    .filter((file) => file.length > 0 && !path.posix.isAbsolute(file));
}

async function reduceProjectInternal(
  input: ReductionOptions,
  initialCache: Record<string, CandidateCacheEntry> = {},
  resume?: ResumeContext,
): Promise<ReductionResult> {
  const started = performance.now();
  const options = resolveOptions(input);
  if (
    options.archivePath &&
    ((await pathExists(options.archivePath)) ||
      (await pathExists(`${options.archivePath}.sha256`)))
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Archive output already exists: ${options.archivePath}`,
    );
  }
  const runId = resume?.state.runId ?? createRunId();
  const session = resume?.session ?? (await createSession(runId));
  const seed = path.join(session, "seed");
  const best = path.join(session, "best");
  const scratch = path.join(session, "scratch");
  let dependencies = resume?.state.dependencySnapshot
    ? path.join(session, resume.state.dependencySnapshot)
    : path.join(session, "dependency-snapshot-0");
  await mkdir(scratch, { recursive: true });

  const state: RunState = resume?.state ?? {
    schemaVersion: 4,
    runId,
    projectRoot: options.root,
    invocationCwd: options.cwd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "created",
    command: options.command,
    options: serializableOptions(options),
    attempts: [],
    candidateRuns: 0,
    cacheHits: 0,
    cache: { ...initialCache },
    generation: 0,
    cursor: {
      reducerIndex: 0,
      generation: 0,
      scheduleIds: [],
      nextMutationIndex: 0,
    },
    elapsedMs: 0,
  };
  if (resume && state.dependencySnapshot) {
    const normalized = await normalizeDependencySnapshot(dependencies);
    if (normalized !== dependencies) {
      dependencies = normalized;
      state.dependencySnapshot = path.relative(session, dependencies);
    }
  }
  const elapsedBeforeTurn = state.elapsedMs;
  const resumeWasPaused = Boolean(resume && state.status === "paused");
  let exportCreated = false;
  await saveState(session, state);

  try {
    const plugins = await loadPlugins(
      options.plugins,
      resume ? state.invocationCwd : options.cwd,
    );
    if (
      resume &&
      state.pluginFingerprint !== undefined &&
      state.pluginFingerprint !== plugins.fingerprint
    ) {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        "Loaded plugin sources changed after this run was paused. Restore the original plugin versions or start a new reduction.",
      );
    }
    state.pluginFingerprint = plugins.fingerprint;
    await saveState(session, state);
    emit(options, {
      phase: "inventory",
      message: "Creating isolated project inventory",
    });
    const inventory = await createInventory(options.root, options);
    if (!resume) await copyInventory(inventory, seed);
    const workingRoot = resume ? best : seed;
    const originalMetrics =
      state.originalMetrics ?? (await metrics(workingRoot));
    state.originalMetrics = originalMetrics;
    const manager = await detectPackageManager(
      workingRoot,
      options,
      plugins.packageManagers,
    );
    const invocationDirectory = path
      .relative(options.root, options.cwd)
      .replaceAll("\\", "/");
    const adapterMatches = await detectAdapters(
      {
        root: workingRoot,
        invocationDirectory,
        command: options.command,
      },
      plugins.adapters,
    );
    if (!resume) {
      await install(seed, manager, options);
      if (await createDependencySnapshot(seed, dependencies)) {
        state.dependencySnapshot = path.relative(session, dependencies);
      }
      await copyProject(seed, best);
    }
    state.status = "running";
    state.currentMetrics = resume
      ? (state.currentMetrics ?? (await metrics(best)))
      : originalMetrics;
    await saveState(session, state);
    throwIfAborted(options);

    const oracleOptions = {
      ...(options.match ? { match: options.match } : {}),
      ...(options.matchRegex ? { matchRegex: options.matchRegex } : {}),
      ...(options.failOnOutput ? { failOnOutput: options.failOnOutput } : {}),
      ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
    };
    const pluginOracle = options.pluginOracle
      ? plugins.oracles.get(options.pluginOracle)
      : undefined;
    if (options.pluginOracle && !pluginOracle) {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        `Plugin oracle ${options.pluginOracle} was not found. Available plugin oracles: ${[...plugins.oracles.keys()].join(", ") || "none"}.`,
      );
    }
    const oracle: FailureOracle = options.oraclePath
      ? await loadCustomOracle(options.oraclePath, options.cwd, oracleOptions)
      : pluginOracle
        ? new CustomFailureOracle(pluginOracle, oracleOptions)
        : new DefaultFailureOracle(oracleOptions);
    const baseline =
      state.baseline ??
      (await captureBaseline(best, dependencies, scratch, options, oracle));
    state.baseline = baseline;
    await saveState(session, state);
    const executionFingerprint = await createExecutionFingerprint(
      options,
      baseline,
      plugins.fingerprint,
    );

    const protectedPaths = new Set([
      "package.json",
      path.posix.join(
        path.relative(options.root, options.cwd).replaceAll("\\", "/"),
        "package.json",
      ),
      ...manager.lockfiles,
      ...[
        "bugbonsai.config.mjs",
        "pnpm-workspace.yaml",
        "pnpm-workspace.yml",
        ".yarnrc.yml",
      ].filter((file) => inventory.files.includes(file)),
      ...adapterMatches.flatMap((match) => match.relevantConfig),
      ...adapterMatches.flatMap((match) => match.protectedPaths),
      ...plugins.sourceFiles
        .filter((file) => isPathInside(state.projectRoot, file))
        .map((file) =>
          path.relative(state.projectRoot, file).replaceAll("\\", "/"),
        ),
      ...commandProjectPaths(options),
      ...inventory.files.filter((file) =>
        options.keep.some((pattern) =>
          minimatch(file, pattern, { dot: true, matchBase: true }),
        ),
      ),
    ]);
    const entryPaths = new Set([
      ...protectedPaths,
      ...failureEntryPaths(baseline),
    ]);
    const reducers = selectReducers(options, plugins.reducers);
    reduction: for (
      let reducerIndex = state.cursor.reducerIndex;
      reducerIndex < reducers.length;
      reducerIndex += 1
    ) {
      if (state.candidateRuns >= options.maxRuns) break;
      const reducer = reducers[reducerIndex];
      if (!reducer) break;
      if (
        state.cursor.reducerIndex !== reducerIndex ||
        state.cursor.reducerName !== reducer.name
      ) {
        state.cursor = {
          reducerIndex,
          reducerName: reducer.name,
          generation: state.generation,
          scheduleIds: [],
          nextMutationIndex: 0,
        };
        await saveState(session, state);
      }
      let productive = true;
      while (productive && state.candidateRuns < options.maxRuns) {
        throwIfAborted(options);
        productive = false;
        const mutations = scheduleMutations(
          reducer,
          await reducer.discover({
            root: best,
            command: options.command,
            protectedPaths,
            mode: options.mode,
            adapterMatches,
            entryPaths,
          }),
          options.mode,
        );
        if (state.cursor.generation !== state.generation) {
          state.cursor = {
            reducerIndex,
            reducerName: reducer.name,
            generation: state.generation,
            scheduleIds: [],
            nextMutationIndex: 0,
          };
        }
        if (state.cursor.scheduleIds.length === 0) {
          state.cursor.scheduleIds = mutations.map((mutation) => mutation.id);
          state.cursor.nextMutationIndex = 0;
          await saveState(session, state);
        }
        const mutationsById = new Map(
          mutations.map((mutation) => [mutation.id, mutation]),
        );
        let accepted = false;
        while (
          state.cursor.nextMutationIndex < state.cursor.scheduleIds.length
        ) {
          if (state.candidateRuns >= options.maxRuns) break reduction;
          throwIfAborted(options);
          const mutationId =
            state.cursor.scheduleIds[state.cursor.nextMutationIndex];
          const mutation = mutationId
            ? mutationsById.get(mutationId)
            : undefined;
          if (!mutation) {
            state.cursor.nextMutationIndex += 1;
            await saveState(session, state);
            continue;
          }
          const candidate = path.join(
            scratch,
            `candidate-${state.attempts.length + 1}`,
          );
          let evaluation;
          try {
            evaluation = await evaluateMutation({
              mutation,
              best,
              candidate,
              dependencies,
              manager,
              options,
              oracle,
              baseline,
              cache: state.cache,
              executionFingerprint,
            });
          } catch (error) {
            if (options.signal?.aborted) throw error;
            evaluation = {
              attempt: {
                mutationId: mutation.id,
                reducer: mutation.reducer,
                description: mutation.description,
                accepted: false,
                score: 0,
                reason: error instanceof Error ? error.message : String(error),
                durationMs: 0,
              },
              signature: baseline,
              cacheHit: false,
            };
          }
          if (evaluation.cacheHit) state.cacheHits += 1;
          else state.candidateRuns += 1;
          if (
            !evaluation.cacheHit &&
            !evaluation.attempt.accepted &&
            evaluation.cacheKey
          ) {
            cacheRejection(
              state.cache,
              evaluation.cacheKey,
              evaluation.attempt,
            );
          }
          state.attempts.push(evaluation.attempt);
          if (evaluation.attempt.accepted) {
            if (evaluation.dependencyPreparationChanged) {
              if (evaluation.candidateDependencies) {
                const nextDependencies = path.join(
                  session,
                  `dependency-snapshot-${state.generation + 1}`,
                );
                await rename(
                  evaluation.candidateDependencies,
                  nextDependencies,
                );
                dependencies = nextDependencies;
                state.dependencySnapshot = path.relative(session, dependencies);
              } else {
                dependencies = path.join(session, "dependencies-empty");
                delete state.dependencySnapshot;
              }
            }
            await promoteCandidate(best, candidate);
            state.generation += 1;
            state.currentMetrics = await metrics(best);
            state.cursor = {
              reducerIndex,
              reducerName: reducer.name,
              generation: state.generation,
              scheduleIds: [],
              nextMutationIndex: 0,
            };
            productive = true;
            await saveState(session, state);
            emit(options, {
              phase: "reduce",
              message: `${evaluation.attempt.description}${evaluation.cacheHit ? " (cached)" : ""}`,
              reducer: reducer.name,
              accepted: true,
              ...progressDetails(state, options),
            });
            accepted = true;
            break;
          }
          await rm(candidate, { recursive: true, force: true });
          state.cursor.nextMutationIndex += 1;
          await saveState(session, state);
          emit(options, {
            phase: "reduce",
            message: `${evaluation.attempt.description}${evaluation.cacheHit ? " (cached)" : ""}`,
            reducer: reducer.name,
            accepted: false,
            ...progressDetails(state, options),
          });
        }
        if (accepted) continue;
        if (state.candidateRuns >= options.maxRuns) break reduction;
        state.cursor = {
          reducerIndex: reducerIndex + 1,
          generation: state.generation,
          scheduleIds: [],
          nextMutationIndex: 0,
        };
        await saveState(session, state);
      }
    }

    emit(options, {
      phase: "validate",
      message: "Scanning and validating fresh reproduction",
    });
    throwIfAborted(options);
    const preExportSecurity = await scanSecurity(best);
    const blocking = preExportSecurity;
    if (blocking.length > 0) {
      throw new BugBonsaiError(
        "SECURITY_BLOCKED",
        `Possible secrets remain in ${blocking.map((finding) => finding.path).join(", ")}.`,
      );
    }
    if (await pathExists(options.output))
      throw new BugBonsaiError(
        "INVALID_INPUT",
        `Output path already exists: ${options.output}`,
      );
    await copyProject(best, options.output);
    exportCreated = true;
    const validation = path.join(scratch, "final-validation");
    await copyProject(options.output, validation);
    await install(validation, manager, options);
    let finalSignature = baseline;
    for (let run = 0; run < options.finalRuns; run += 1) {
      throwIfAborted(options);
      const result = await runCommand(options.command, {
        cwd: path.join(validation, path.relative(options.root, options.cwd)),
        timeoutMs: options.timeoutMs,
        verbose: options.verbose,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      throwIfAborted(options);
      const match = await oracle.matches(baseline, result);
      if (!match.matches)
        throw new BugBonsaiError(
          "INTERNAL",
          `Final clean validation failed: ${match.reason}`,
        );
      finalSignature = match.signature;
      emit(options, {
        phase: "validate",
        message: `Final failure reproduced ${run + 1}/${options.finalRuns}`,
      });
      throwIfAborted(options);
    }
    const finalMetrics = await metrics(options.output);
    const securityFindings = await scanSecurity(options.output);
    const portabilityFindings = await auditPortability(options.output);
    const durationMs = Math.round(
      elapsedBeforeTurn + performance.now() - started,
    );
    const result: ReductionResult = {
      runId,
      outputDirectory: options.output,
      command: options.command,
      invocationDirectory,
      detectedAdapters: adapterMatches.map((match) => match.name),
      loadedPlugins: plugins.names,
      baseline,
      finalSignature,
      originalMetrics,
      finalMetrics,
      attempts: state.attempts,
      candidateRuns: state.candidateRuns,
      cacheHits: state.cacheHits,
      durationMs,
      securityFindings,
      portabilityFindings,
    };
    await writeReports(result, manager, { noInstall: options.noInstall });
    result.sharingArtifacts = await writeSharingArtifacts(result, manager, {
      installCommand: options.noInstall ? null : manager.installCommand,
      dockerfile: options.dockerfile,
      githubIssue: options.githubIssue,
      oracle: {
        ...(options.match ? { match: options.match } : {}),
        ...(options.matchRegex ? { matchRegex: options.matchRegex } : {}),
        ...(options.failOnOutput ? { failOnOutput: options.failOnOutput } : {}),
        ...(options.exitCode !== undefined
          ? { exitCode: options.exitCode }
          : {}),
      },
      ...(options.archivePath ? { archivePath: options.archivePath } : {}),
    });
    state.status = "completed";
    state.outputDirectory = options.output;
    state.currentMetrics = finalMetrics;
    state.elapsedMs = durationMs;
    await saveState(session, state);
    emit(options, { phase: "complete", message: options.output });
    return result;
  } catch (error) {
    state.elapsedMs = Math.round(
      elapsedBeforeTurn + performance.now() - started,
    );
    state.status =
      options.signal?.aborted || (resumeWasPaused && state.status === "paused")
        ? "paused"
        : "failed";
    if (options.signal?.aborted && exportCreated) {
      await rm(options.output, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    await saveState(session, state).catch(() => undefined);
    if (options.signal?.aborted)
      throw new BugBonsaiError(
        "INTERRUPTED",
        `Reduction paused safely. Resume run ${runId}.`,
        { cause: error },
      );
    throw error;
  }
}

export async function reduceProject(
  input: ReductionOptions,
): Promise<ReductionResult> {
  return reduceProjectInternal(input);
}
