import { spawn, type ChildProcess } from "node:child_process";
import type { CommandResult } from "./types.js";

const DEFAULT_CAPTURE_LIMIT = 2 * 1024 * 1024;

function appendBounded(
  current: Buffer[],
  chunk: Buffer,
  state: { bytes: number; truncated: boolean },
  limit: number,
): void {
  if (state.bytes >= limit) {
    state.truncated = true;
    return;
  }
  const remaining = limit - state.bytes;
  current.push(chunk.subarray(0, remaining));
  state.bytes += Math.min(chunk.length, remaining);
  if (chunk.length > remaining) state.truncated = true;
}

async function terminateTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process already exited.
    }
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process tree exited after SIGTERM.
    }
  }, 1_500);
  timer.unref();
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  verbose?: boolean;
  captureLimit?: number;
}

export async function runCommand(
  command: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  if (options.signal?.aborted)
    throw new DOMException("Command execution was aborted.", "AbortError");
  const executable = command[0];
  if (!executable) throw new Error("A command executable is required.");
  const started = performance.now();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const combined: Buffer[] = [];
  const stdoutState = { bytes: 0, truncated: false };
  const stderrState = { bytes: 0, truncated: false };
  const combinedState = { bytes: 0, truncated: false };
  const limit = options.captureLimit ?? DEFAULT_CAPTURE_LIMIT;
  let timedOut = false;

  return await new Promise<CommandResult>((resolve, reject) => {
    const child: ChildProcess = spawn(executable, command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, BUGBONSAI: "1", NO_COLOR: "1" },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) void terminateTree(child.pid);
    }, options.timeoutMs);
    timeout.unref();

    const abort = (): void => {
      if (child.pid) void terminateTree(child.pid);
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout?.on("data", (value: Buffer) => {
      appendBounded(stdout, value, stdoutState, limit);
      appendBounded(combined, value, combinedState, limit);
      if (options.verbose) process.stderr.write(value);
    });
    child.stderr?.on("data", (value: Buffer) => {
      appendBounded(stderr, value, stderrState, limit);
      appendBounded(combined, value, combinedState, limit);
      if (options.verbose) process.stderr.write(value);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        command: [...command],
        cwd: options.cwd,
        exitCode,
        signal: signal as NodeJS.Signals | null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        combinedOutput: Buffer.concat(combined).toString("utf8"),
        durationMs: Math.round(performance.now() - started),
        timedOut,
        truncated:
          stdoutState.truncated ||
          stderrState.truncated ||
          combinedState.truncated,
      });
    });
  });
}
