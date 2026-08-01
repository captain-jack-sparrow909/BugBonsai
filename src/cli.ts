#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Command, CommanderError, Option } from "commander";
import pc from "picocolors";
import { reduceProject, resumeProject } from "./engine.js";
import { BugBonsaiError, exitCodeForError } from "./errors.js";
import { detectPackageManager } from "./package-manager.js";
import { cacheRoot, listStates } from "./sandbox.js";
import type { ProgressEvent, ReductionMode } from "./types.js";
import { formatBytes, parseDuration } from "./utils.js";

const VERSION = "0.1.0";
const execFileAsync = promisify(execFile);

interface CliOptions {
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
  allowInstallScripts?: boolean;
  noInstall?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function createProgram(): Command {
  return new Command()
    .name("bugbonsai")
    .description("Trim any failing project into a minimal reproduction.")
    .version(VERSION)
    .usage("[options] -- <command> [...arguments]")
    .option("-o, --output <directory>", "output directory", "./bugbonsai-repro")
    .option(
      "--match <text>",
      "require normalized failure output to contain text",
    )
    .option(
      "--match-regex <pattern>",
      "require normalized failure output to match a regular expression",
    )
    .option("--exit-code <number>", "require a specific candidate exit code")
    .option("--timeout <duration>", "per-command timeout", "60s")
    .option("--stability-runs <number>", "baseline stability runs", "2")
    .option("--final-runs <number>", "clean final validation runs", "3")
    .option("--max-runs <number>", "maximum candidate executions", "250")
    .addOption(
      new Option("--mode <mode>", "reduction depth")
        .choices(["fast", "balanced", "thorough"])
        .default("balanced"),
    )
    .option("--keep <glob>", "always retain matching files", collect, [])
    .option(
      "--exclude <glob>",
      "exclude matching files from inventory",
      collect,
      [],
    )
    .option("--include <glob>", "include only matching files", collect, [])
    .option("--skip-reducer <name>", "disable a reducer", collect, [])
    .option("--only-reducer <name>", "run only a reducer", collect, [])
    .option(
      "--install-command <command>",
      "override dependency installation command",
    )
    .option("--allow-install-scripts", "permit dependency lifecycle scripts")
    .option("--no-install", "do not install dependencies")
    .option("--json", "write one machine-readable result to stdout")
    .option("--quiet", "show only the output path")
    .option("--verbose", "stream candidate command output")
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
    process.stderr.write(
      `${icon} ${event.message}${event.accepted ? "" : pc.dim(" — rejected")}\n`,
    );
    return;
  }
  if (event.phase === "complete") return;
  process.stderr.write(`${pc.green("✓")} ${event.message}\n`);
}

async function doctor(json: boolean): Promise<void> {
  const cwd = process.cwd();
  const manager = await detectPackageManager(cwd, {
    allowInstallScripts: false,
  });
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
  const cacheParentWritable = await access(
    path.dirname(cacheRoot()),
    constants.W_OK,
  )
    .then(() => true)
    .catch(() => false);
  const report = {
    bugBonsaiVersion: VERSION,
    nodeVersion: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    projectRoot: cwd,
    gitVersion: await commandVersion("git"),
    packageManager: manager.name,
    packageManagerVersion: await commandVersion(manager.executable),
    lockfile: manager.lockfile ?? null,
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
      `${pc.green("🌱")} ${pc.bold("BugBonsai")}\n\nResuming ${selected.state.runId} from accepted generation ${selected.state.generation}.\n\n`,
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
  if (raw[0] === "doctor") {
    await doctor(raw.includes("--json"));
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
  const program = createProgram();
  program.parse([process.execPath, "bugbonsai", ...optionArgs]);
  const options = program.opts<CliOptions>();
  if (command.length === 0) {
    program.outputHelp();
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Provide a failing command after --.",
    );
  }
  if (options.noColor || process.env.NO_COLOR) pc.isColorSupported = false;

  const abort = new AbortController();
  const interrupt = (): void => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const json = Boolean(options.json);
  const quiet = Boolean(options.quiet);
  if (!json && !quiet) {
    process.stderr.write(`${pc.green("🌱")} ${pc.bold("BugBonsai")}\n\n`);
    process.stderr.write(
      `Project       ${process.cwd()}\nCommand       ${commandLine(command)}\nMode          ${options.mode}\n\n`,
    );
  }
  const result = await reduceProject({
    cwd: process.cwd(),
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
    noInstall: Boolean(options.noInstall),
    outputMode: json ? "json" : quiet ? "quiet" : "human",
    verbose: Boolean(options.verbose),
    signal: abort.signal,
    ...(options.output ? { output: options.output } : {}),
    ...(options.match ? { match: options.match } : {}),
    ...(options.matchRegex ? { matchRegex: options.matchRegex } : {}),
    ...(options.exitCode ? { exitCode: Number(options.exitCode) } : {}),
    ...(options.installCommand
      ? { installCommand: options.installCommand.split(/\s+/) }
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
      `Reproduction: ${result.outputDirectory}\nRun: cd ${result.outputDirectory} && ${commandLine(command)}\n`,
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red("BugBonsai failed:")} ${message}\n`);
  process.exitCode = exitCodeForError(error);
});
