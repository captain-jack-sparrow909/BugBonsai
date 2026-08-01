#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Command, CommanderError, Option } from "commander";
import pc from "picocolors";
import { detectAdapters } from "./adapters.js";
import { loadConfig } from "./config.js";
import { reduceProject, resumeProject } from "./engine.js";
import { BugBonsaiError, exitCodeForError } from "./errors.js";
import { detectPackageManager } from "./package-manager.js";
import { loadPlugins } from "./plugin.js";
import { cacheRoot, listStates } from "./sandbox.js";
import type { BugBonsaiConfig, ProgressEvent, ReductionMode } from "./types.js";
import { formatBytes, isPathInside, parseDuration } from "./utils.js";
import { VERSION } from "./version.js";

const execFileAsync = promisify(execFile);

interface CliOptions {
  root?: string;
  output?: string;
  match?: string;
  matchRegex?: string;
  exitCode?: string;
  timeout: string;
  stabilityRuns: string;
  finalRuns: string;
  maxRuns: string;
  mode: ReductionMode;
  keep: string[];
  exclude: string[];
  include: string[];
  skipReducer: string[];
  onlyReducer: string[];
  installCommand?: string;
  oracle?: string;
  pluginOracle?: string;
  plugin: string[];
  allowInstallScripts?: boolean;
  install: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createProgram(config: BugBonsaiConfig): Command {
  return new Command()
    .name("bugbonsai")
    .description("Trim any failing project into a minimal reproduction.")
    .version(VERSION)
    .usage("[options] -- <command> [...arguments]")
    .option(
      "--root <directory>",
      "project root (cwd may be inside it)",
      config.root,
    )
    .option(
      "-o, --output <directory>",
      "output directory",
      config.output ?? "./bugbonsai-repro",
    )
    .option(
      "--match <text>",
      "require normalized failure output to contain text",
      config.match,
    )
    .option(
      "--match-regex <pattern>",
      "require normalized failure output to match a regular expression",
      config.matchRegex,
    )
    .option(
      "--exit-code <number>",
      "require a specific candidate exit code",
      config.exitCode === undefined ? undefined : String(config.exitCode),
    )
    .option(
      "--oracle <file>",
      "trusted custom failure oracle module",
      config.oraclePath,
    )
    .option(
      "--plugin <specifier>",
      "load a trusted BugBonsai plugin (repeatable)",
      collect,
      [...(config.plugins ?? [])],
    )
    .option(
      "--plugin-oracle <name>",
      "use a namespaced oracle from a loaded plugin",
      config.pluginOracle,
    )
    .option(
      "--timeout <duration>",
      "per-command timeout",
      config.timeoutMs === undefined ? "60s" : `${config.timeoutMs}ms`,
    )
    .option(
      "--stability-runs <number>",
      "baseline stability runs",
      String(config.stabilityRuns ?? 2),
    )
    .option(
      "--final-runs <number>",
      "clean final validation runs",
      String(config.finalRuns ?? 3),
    )
    .option(
      "--max-runs <number>",
      "maximum candidate executions",
      String(config.maxRuns ?? 250),
    )
    .addOption(
      new Option("--mode <mode>", "reduction depth")
        .choices(["fast", "balanced", "thorough"])
        .default(config.mode ?? "balanced"),
    )
    .option("--keep <glob>", "always retain matching files", collect, [
      ...(config.keep ?? []),
    ])
    .option(
      "--exclude <glob>",
      "exclude matching files from inventory",
      collect,
      [...(config.exclude ?? [])],
    )
    .option("--include <glob>", "include only matching files", collect, [
      ...(config.include ?? []),
    ])
    .option("--skip-reducer <name>", "disable a reducer", collect, [
      ...(config.skipReducers ?? []),
    ])
    .option("--only-reducer <name>", "run only a reducer", collect, [
      ...(config.onlyReducers ?? []),
    ])
    .option(
      "--install-command <command>",
      "override dependency installation command",
    )
    .option(
      "--allow-install-scripts",
      "permit dependency lifecycle scripts",
      config.allowInstallScripts ?? false,
    )
    .option(
      "--no-install",
      "do not install dependencies",
      !(config.noInstall ?? false),
    )
    .option(
      "--json",
      "write one machine-readable result to stdout",
      config.outputMode === "json",
    )
    .option(
      "--quiet",
      "show only the output path",
      config.outputMode === "quiet",
    )
    .option(
      "--verbose",
      "stream candidate command output",
      config.verbose ?? false,
    )
    .option("--no-color", "disable colors")
    .addHelpText(
      "after",
      `\nExamples:\n  $ bugbonsai -- npm test\n  $ bugbonsai --match "Hydration failed" -- pnpm build\n  $ bugbonsai --mode fast -- node failing-script.js`,
    )
    .exitOverride();
}

function commandLine(command: string[]): string {
  return command
    .map((part) => (/^[\w./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function humanProgress(event: ProgressEvent): void {
  if (event.phase === "reduce") {
    const icon = event.accepted ? pc.green("✓") : pc.dim("·");
    const budget =
      event.runs !== undefined && event.maxRuns !== undefined
        ? pc.dim(` [${event.runs}/${event.maxRuns} runs]`)
        : "";
    const eta =
      event.etaMs !== undefined && event.etaMs > 0
        ? pc.dim(
            ` [budget ETA ~${event.etaMs < 60_000 ? `${Math.max(1, Math.round(event.etaMs / 1000))}s` : `${Math.max(1, Math.round(event.etaMs / 60_000))}m`}]`,
          )
        : "";
    process.stderr.write(
      `${icon} ${event.message}${event.accepted ? "" : pc.dim(" — rejected")}${budget}${eta}\n`,
    );
    return;
  }
  if (event.phase === "complete") return;
  process.stderr.write(`${pc.green("✓")} ${event.message}\n`);
}

async function doctor(
  json: boolean,
  config: BugBonsaiConfig,
  configPath?: string,
): Promise<void> {
  const cwd = process.cwd();
  const root = path.resolve(cwd, config.root ?? cwd);
  if (!isPathInside(root, cwd)) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Invocation directory must be inside the project root: ${root}`,
    );
  }
  const plugins = await loadPlugins(config.plugins ?? [], cwd);
  const manager = await detectPackageManager(
    root,
    { allowInstallScripts: false },
    plugins.packageManagers,
  );
  const invocationDirectory = path.relative(root, cwd).replaceAll("\\", "/");
  const adapters = await detectAdapters(
    { root, invocationDirectory, command: [] },
    plugins.adapters,
  );
  const commandVersion = async (
    executable: string,
  ): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync(executable, ["--version"], {
        timeout: 3_000,
      });
      return stdout.trim();
    } catch {
      return undefined;
    }
  };
  let writableProbe = path.dirname(cacheRoot());
  while (true) {
    const exists = await access(writableProbe, constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (exists) break;
    const parent = path.dirname(writableProbe);
    if (parent === writableProbe) break;
    writableProbe = parent;
  }
  const cacheParentWritable = await access(writableProbe, constants.W_OK)
    .then(() => true)
    .catch(() => false);
  const report = {
    bugBonsaiVersion: VERSION,
    nodeVersion: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    projectRoot: root,
    invocationDirectory: invocationDirectory || ".",
    configFile: configPath ?? null,
    detectedAdapters: adapters.map((adapter) => adapter.name),
    loadedPlugins: plugins.names,
    gitVersion: await commandVersion("git"),
    packageManager: manager.name,
    packageManagerVersion: await commandVersion(manager.executable),
    lockfile: manager.lockfile ?? null,
    lockfiles: manager.lockfiles,
    workspaceType: manager.workspaceType,
    packageManagerWarnings: manager.warnings,
    cacheDirectory: cacheRoot(),
    cacheWritable: cacheParentWritable,
  };
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`${pc.bold("BugBonsai doctor")}\n\n`);
    for (const [key, value] of Object.entries(report))
      process.stdout.write(`${key.padEnd(24)} ${String(value)}\n`);
  }
}

async function resumeRun(runId?: string, json = false): Promise<void> {
  const sessions = (await listStates()).filter(({ state }) => {
    if (state.status !== "paused") return false;
    return runId ? state.runId === runId : state.projectRoot === process.cwd();
  });
  if (sessions.length === 0)
    throw new BugBonsaiError(
      "INVALID_INPUT",
      runId ? `No run found with ID ${runId}.` : "No resumable runs found.",
    );
  if (sessions.length > 1 && !runId) {
    process.stdout.write(`${pc.bold("Paused BugBonsai sessions")}\n\n`);
    for (const { state } of sessions) {
      process.stdout.write(
        `${state.runId}  ${state.updatedAt}\n  ${commandLine(state.command)}\n`,
      );
    }
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Several paused runs match this project; provide a run ID.",
    );
  }
  const selected = sessions[0];
  if (!selected)
    throw new BugBonsaiError("INTERNAL", "Unable to select a paused run.");
  const abort = new AbortController();
  const interrupt = (): void => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  if (!json) {
    process.stderr.write(
      `${pc.green("🌱")} ${pc.bold("BugBonsai")}\n\nResuming ${selected.state.runId} from accepted generation ${selected.state.generation}, reducer ${selected.state.cursor.reducerIndex + 1}, mutation ${selected.state.cursor.nextMutationIndex + 1}. ${Math.max(0, selected.state.options.maxRuns - selected.state.candidateRuns)} candidate runs remain.\n\n`,
    );
  }
  const result = await resumeProject(selected.state.runId, {
    signal: abort.signal,
    ...(!json ? { onProgress: humanProgress } : {}),
  });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`\nReproduction: ${result.outputDirectory}\n`);
}

async function cleanSessions(all: boolean): Promise<void> {
  const sessions = await listStates();
  const removable = sessions.filter(
    ({ state }) => all || ["completed", "failed"].includes(state.status),
  );
  for (const { session, state } of removable) {
    await rm(session, { recursive: true, force: true });
    process.stdout.write(`Removed ${state.runId}\n`);
  }
  if (removable.length === 0)
    process.stdout.write("No inactive sessions to remove.\n");
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const loadedConfig = await loadConfig(process.cwd());
  if (raw[0] === "doctor") {
    await doctor(
      raw.includes("--json"),
      loadedConfig.config,
      loadedConfig.path,
    );
    return;
  }
  if (raw[0] === "resume") {
    await resumeRun(
      raw[1]?.startsWith("bb_") ? raw[1] : undefined,
      raw.includes("--json"),
    );
    return;
  }
  if (raw[0] === "clean") {
    await cleanSessions(raw.includes("--all"));
    return;
  }

  const separator = raw.indexOf("--");
  const optionArgs = separator === -1 ? raw : raw.slice(0, separator);
  const command = separator === -1 ? [] : raw.slice(separator + 1);
  const program = createProgram(loadedConfig.config);
  program.parse([process.execPath, "bugbonsai", ...optionArgs]);
  const options = program.opts<CliOptions>();
  if (command.length === 0) {
    program.outputHelp();
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Provide a failing command after --.",
    );
  }
  if (!options.color || process.env.NO_COLOR) pc.isColorSupported = false;

  const abort = new AbortController();
  const interrupt = (): void => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let json = Boolean(options.json);
  let quiet = Boolean(options.quiet);
  const explicitJson = program.getOptionValueSource("json") === "cli";
  const explicitQuiet = program.getOptionValueSource("quiet") === "cli";
  const explicitOracle = program.getOptionValueSource("oracle") === "cli";
  const explicitPluginOracle =
    program.getOptionValueSource("pluginOracle") === "cli";
  if (explicitJson && explicitQuiet) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Choose either --json or --quiet, not both.",
    );
  }
  if (explicitJson) quiet = false;
  if (explicitQuiet) json = false;
  if (explicitOracle && explicitPluginOracle) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Choose either --oracle or --plugin-oracle, not both.",
    );
  }
  if (!json && !quiet) {
    process.stderr.write(`${pc.green("🌱")} ${pc.bold("BugBonsai")}\n\n`);
    process.stderr.write(
      `Project       ${process.cwd()}\nCommand       ${commandLine(command)}\nMode          ${options.mode}\n\n`,
    );
  }
  const result = await reduceProject({
    cwd: process.cwd(),
    ...(options.root ? { root: options.root } : {}),
    command,
    mode: options.mode,
    timeoutMs: parseDuration(options.timeout),
    stabilityRuns: Number(options.stabilityRuns),
    finalRuns: Number(options.finalRuns),
    maxRuns: Number(options.maxRuns),
    keep: options.keep,
    exclude: options.exclude,
    include: options.include,
    onlyReducers: options.onlyReducer,
    skipReducers: options.skipReducer,
    allowInstallScripts: Boolean(options.allowInstallScripts),
    noInstall: !options.install,
    outputMode: json ? "json" : quiet ? "quiet" : "human",
    verbose: Boolean(options.verbose),
    signal: abort.signal,
    ...(options.output ? { output: options.output } : {}),
    ...(options.match ? { match: options.match } : {}),
    ...(options.matchRegex ? { matchRegex: options.matchRegex } : {}),
    ...(options.exitCode !== undefined
      ? { exitCode: Number(options.exitCode) }
      : {}),
    ...(options.oracle && !explicitPluginOracle
      ? { oraclePath: options.oracle }
      : {}),
    ...(options.pluginOracle && !explicitOracle
      ? { pluginOracle: options.pluginOracle }
      : {}),
    plugins: options.plugin,
    ...(options.installCommand
      ? { installCommand: options.installCommand.split(/\s+/) }
      : loadedConfig.config.installCommand
        ? { installCommand: [...loadedConfig.config.installCommand] }
        : {}),
    ...(!json && !quiet ? { onProgress: humanProgress } : {}),
  });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);

  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (quiet) process.stdout.write(`${result.outputDirectory}\n`);
  else {
    process.stdout.write(`\n${pc.green(pc.bold("Reproduction verified"))}\n\n`);
    process.stdout.write(
      `Original        ${result.originalMetrics.files} project files, ${formatBytes(result.originalMetrics.bytes)}\n`,
    );
    process.stdout.write(
      `Reproduction    ${result.finalMetrics.files} project files, ${formatBytes(result.finalMetrics.bytes)}\n\n`,
    );
    process.stdout.write(
      `Executions      ${result.candidateRuns} candidate runs, ${result.cacheHits} cached rejections\n\n`,
    );
    process.stdout.write(
      `Reproduction: ${result.outputDirectory}\nRun: cd ${path.join(result.outputDirectory, result.invocationDirectory)} && ${commandLine(command)}\n`,
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href ===
    import.meta.url
) {
  main().catch((error: unknown) => {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${pc.red("BugBonsai failed:")} ${message}\n`);
    process.exitCode = exitCodeForError(error);
  });
}
