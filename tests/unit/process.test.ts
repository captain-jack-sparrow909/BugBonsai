import { mkdtemp } from "node:fs/promises";
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
});
