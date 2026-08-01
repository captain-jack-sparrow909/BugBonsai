import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli.js";

describe("CLI option resolution", () => {
  it("maps Commander's negated install and color options correctly", () => {
    const configured = createProgram({ noInstall: true });
    configured.parse([process.execPath, "bugbonsai"]);
    expect(configured.opts()).toMatchObject({ install: false, color: true });

    const explicit = createProgram({});
    explicit.parse([
      process.execPath,
      "bugbonsai",
      "--no-install",
      "--no-color",
    ]);
    expect(explicit.opts()).toMatchObject({ install: false, color: false });
  });

  it("uses configuration as defaults and lets scalar CLI values win", () => {
    const program = createProgram({ mode: "fast", maxRuns: 10 });
    program.parse([
      process.execPath,
      "bugbonsai",
      "--mode",
      "thorough",
      "--max-runs",
      "20",
    ]);
    expect(program.opts()).toMatchObject({ mode: "thorough", maxRuns: "20" });
  });

  it("records whether an output-mode flag came from the CLI", () => {
    const program = createProgram({ outputMode: "json" });
    program.parse([process.execPath, "bugbonsai", "--quiet"]);
    expect(program.getOptionValueSource("json")).toBe("default");
    expect(program.getOptionValueSource("quiet")).toBe("cli");
  });
});
