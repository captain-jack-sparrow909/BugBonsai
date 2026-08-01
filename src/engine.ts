import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BugBonsaiError } from "./errors.js";
import { DefaultFailureOracle } from "./oracle.js";
import {
  detectPackageManager,
  type PackageManagerInfo,
} from "./package-manager.js";
import { runCommand } from "./process.js";
import { defaultReducers, type Mutation, type Reducer } from "./reducers.js";
import { writeReports } from "./report.js";
import {
  copyInventory,
  copyProject,
  cacheRoot,
  createInventory,
  createSession,
  linkDependencies,
  loadState,
  metrics,
  saveState,
} from "./sandbox.js";
import { auditPortability, scanSecurity } from "./security.js";
import type {
  FailureSignature,
  ReductionAttempt,
  ReductionOptions,
  ReductionResult,
  ResolvedOptions,
  RunState,
} from "./types.js";
import { createRunId, pathExists } from "./utils.js";

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
    output,
    command: [...input.command],
    keep: [...(input.keep ?? [])],
    exclude: [...(input.exclude ?? [])],
    include: [...(input.include ?? [])],
    onlyReducers: [...(input.onlyReducers ?? [])],
    skipReducers: [...(input.skipReducers ?? [])],
  };
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

  // v0.1 resumes from the last atomically accepted candidate in a continuation
  // session. Reducer cursor state is intentionally rediscovered from that tree.
  // This preserves all completed reduction work without coupling future versions
  // to the internal ordering of today's reducer implementations.
  const result = await reduceProject({
    ...state.options,
    cwd: best,
    command: [...state.command],
    ...(runtime.signal ? { signal: runtime.signal } : {}),
    ...(runtime.onProgress ? { onProgress: runtime.onProgress } : {}),
    ...(runtime.verbose !== undefined ? { verbose: runtime.verbose } : {}),
  });
  state.status = "completed";
  state.outputDirectory = result.outputDirectory;
  await saveState(session, state);
  return result;
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

async function projectHasDependencies(root: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    return ["dependencies", "devDependencies", "optionalDependencies"].some(
      (key) => {
        const value = manifest[key];
        return Boolean(
          value && typeof value === "object" && Object.keys(value).length > 0,
        );
      },
    );
  } catch {
    return false;
  }
}

async function install(
  root: string,
  manager: PackageManagerInfo,
  options: ResolvedOptions,
  afterManifestChange = false,
): Promise<void> {
  if (options.noInstall || !(await projectHasDependencies(root))) return;
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
}

async function executeWithDependencies(
  root: string,
  dependencies: string,
  options: ResolvedOptions,
): ReturnType<typeof runCommand> {
  await linkDependencies(dependencies, root);
  return runCommand(options.command, {
    cwd: root,
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
  oracle: DefaultFailureOracle,
): Promise<FailureSignature> {
  let baseline: FailureSignature | undefined;
  for (let run = 0; run < options.stabilityRuns; run += 1) {
    const candidate = path.join(scratch, `baseline-${run}`);
    await copyProject(best, candidate);
    const result = await executeWithDependencies(
      candidate,
      dependencies,
      options,
    );
    if (!baseline) {
      try {
        baseline = await oracle.capture(result);
      } catch (error) {
        throw new BugBonsaiError(
          "COMMAND_PASSED",
          "The supplied command succeeded in the isolated workspace.",
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
  oracle: DefaultFailureOracle;
  baseline: FailureSignature;
}): Promise<{
  attempt: ReductionAttempt;
  signature: FailureSignature;
  candidateDependencies?: string;
}> {
  const started = performance.now();
  await copyProject(input.best, input.candidate);
  await input.mutation.apply(input.candidate);
  let candidateDependencies: string | undefined;
  if (input.mutation.requiresInstall) {
    await install(input.candidate, input.manager, input.options, true);
    const installed = path.join(input.candidate, "node_modules");
    if (await pathExists(installed)) candidateDependencies = installed;
  } else {
    await linkDependencies(input.dependencies, input.candidate);
  }
  const result = await runCommand(input.options.command, {
    cwd: input.candidate,
    timeoutMs: input.options.timeoutMs,
    verbose: input.options.verbose,
    ...(input.options.signal ? { signal: input.options.signal } : {}),
  });
  const match = await input.oracle.matches(input.baseline, result);
  return {
    attempt: {
      mutationId: input.mutation.id,
      reducer: input.mutation.reducer,
      description: input.mutation.description,
      accepted: match.matches,
      score: match.score,
      reason: match.reason,
      durationMs: Math.round(performance.now() - started),
    },
    signature: match.signature,
    ...(candidateDependencies ? { candidateDependencies } : {}),
  };
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
    const linkedModules = path.join(best, "node_modules");
    if (await pathExists(linkedModules))
      await rm(linkedModules, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (await pathExists(backup)) await rename(backup, best);
    throw error;
  }
}

function selectReducers(options: ResolvedOptions): Reducer[] {
  return defaultReducers().filter((reducer) => {
    if (
      options.onlyReducers.length > 0 &&
      !options.onlyReducers.includes(reducer.name)
    )
      return false;
    return !options.skipReducers.includes(reducer.name);
  });
}

export async function reduceProject(
  input: ReductionOptions,
): Promise<ReductionResult> {
  const started = performance.now();
  const options = resolveOptions(input);
  const runId = createRunId();
  const session = await createSession(runId);
  const seed = path.join(session, "seed");
  const best = path.join(session, "best");
  const scratch = path.join(session, "scratch");
  let dependencies = path.join(session, "dependencies");
  await mkdir(scratch, { recursive: true });

  const state: RunState = {
    schemaVersion: 1,
    runId,
    projectRoot: options.cwd,
    invocationCwd: options.cwd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "created",
    command: options.command,
    options: serializableOptions(options),
    attempts: [],
    candidateRuns: 0,
    generation: 0,
  };
  await saveState(session, state);

  try {
    emit(options, {
      phase: "inventory",
      message: "Creating isolated project inventory",
    });
    const inventory = await createInventory(options.cwd, options);
    await copyInventory(inventory, seed);
    const originalMetrics = await metrics(seed);
    const manager = await detectPackageManager(seed, options);
    await install(seed, manager, options);
    const installed = path.join(seed, "node_modules");
    if (await pathExists(installed)) await rename(installed, dependencies);
    await copyProject(seed, best);
    state.status = "running";
    state.currentMetrics = originalMetrics;
    await saveState(session, state);

    const oracle = new DefaultFailureOracle({
      ...(options.match ? { match: options.match } : {}),
      ...(options.matchRegex ? { matchRegex: options.matchRegex } : {}),
      ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
    });
    const baseline = await captureBaseline(
      best,
      dependencies,
      scratch,
      options,
      oracle,
    );
    state.baseline = baseline;
    await saveState(session, state);

    const protectedPaths = new Set([
      "package.json",
      manager.lockfile ?? "",
      ...options.command.filter(
        (part) => !part.startsWith("-") && /[./]/.test(part),
      ),
    ]);
    for (const reducer of selectReducers(options)) {
      if (state.candidateRuns >= options.maxRuns) break;
      let productive = true;
      while (productive && state.candidateRuns < options.maxRuns) {
        productive = false;
        const mutations = await reducer.discover({
          root: best,
          command: options.command,
          protectedPaths,
          mode: options.mode,
        });
        for (const mutation of mutations) {
          if (state.candidateRuns >= options.maxRuns) break;
          if (options.signal?.aborted)
            throw new BugBonsaiError(
              "INTERRUPTED",
              "Reduction was interrupted.",
            );
          const candidate = path.join(
            scratch,
            `candidate-${state.candidateRuns + 1}`,
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
            });
          } catch (error) {
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
            };
          }
          state.candidateRuns += 1;
          state.attempts.push(evaluation.attempt);
          emit(options, {
            phase: "reduce",
            message: evaluation.attempt.description,
            reducer: reducer.name,
            accepted: evaluation.attempt.accepted,
            runs: state.candidateRuns,
          });
          if (evaluation.attempt.accepted) {
            if (evaluation.candidateDependencies) {
              const nextDependencies = path.join(
                session,
                `dependencies-${state.generation + 1}`,
              );
              await rename(evaluation.candidateDependencies, nextDependencies);
              dependencies = nextDependencies;
            }
            await promoteCandidate(best, candidate);
            state.generation += 1;
            state.currentMetrics = await metrics(best);
            productive = true;
            await saveState(session, state);
            break;
          }
          await rm(candidate, { recursive: true, force: true });
          await saveState(session, state);
        }
      }
    }

    emit(options, {
      phase: "validate",
      message: "Scanning and validating fresh reproduction",
    });
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
    const validation = path.join(scratch, "final-validation");
    await copyProject(options.output, validation);
    await install(validation, manager, options);
    let finalSignature = baseline;
    for (let run = 0; run < options.finalRuns; run += 1) {
      const result = await runCommand(options.command, {
        cwd: validation,
        timeoutMs: options.timeoutMs,
        verbose: options.verbose,
        ...(options.signal ? { signal: options.signal } : {}),
      });
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
    }
    const finalMetrics = await metrics(options.output);
    const securityFindings = await scanSecurity(options.output);
    const portabilityFindings = await auditPortability(options.output);
    const result: ReductionResult = {
      runId,
      outputDirectory: options.output,
      command: options.command,
      baseline,
      finalSignature,
      originalMetrics,
      finalMetrics,
      attempts: state.attempts,
      candidateRuns: state.candidateRuns,
      durationMs: Math.round(performance.now() - started),
      securityFindings,
      portabilityFindings,
    };
    await writeReports(result, manager);
    state.status = "completed";
    state.outputDirectory = options.output;
    state.currentMetrics = finalMetrics;
    await saveState(session, state);
    emit(options, { phase: "complete", message: options.output });
    return result;
  } catch (error) {
    state.status = options.signal?.aborted ? "paused" : "failed";
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
