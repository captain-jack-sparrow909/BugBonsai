import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/process.js";

describe("runCommand", () => {
  it("preserves arguments without a shell", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-process-"));
    const result = await runCommand(
      [
        process.execPath,
        "-e",
        "console.log(JSON.stringify(process.argv.slice(1)))",
        "hello world",
        "$HOME",
      ],
      {
        cwd,
        timeoutMs: 5_000,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["hello world", "$HOME"]);
  });

  it("distinguishes a timeout", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-timeout-"));
    const result = await runCommand(
      [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
      { cwd, timeoutMs: 30 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("bounds hostile output and reports truncation", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-output-"));
    const result = await runCommand(
      [process.execPath, "-e", 'process.stdout.write("x".repeat(10000))'],
      { cwd, timeoutMs: 5_000, captureLimit: 128 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(Buffer.byteLength(result.combinedOutput)).toBe(128);
    await rm(cwd, { recursive: true, force: true });
  });

  it("rejects a missing executable without hanging", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-spawn-"));
    await expect(
      runCommand(["bugbonsai-command-that-does-not-exist"], {
        cwd,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await rm(cwd, { recursive: true, force: true });
  });
});
