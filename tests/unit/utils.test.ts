import { describe, expect, it } from "vitest";
import { isPathInside, parseDuration } from "../../src/utils.js";

describe("parseDuration", () => {
  it.each([
    ["500ms", 500],
    ["30s", 30_000],
    ["5m", 300_000],
    ["1h", 3_600_000],
  ])("parses %s", (input, expected) =>
    expect(parseDuration(input)).toBe(expected),
  );

  it("rejects ambiguous durations", () =>
    expect(() => parseDuration("30")).toThrow(/Invalid duration/));
});

describe("isPathInside", () => {
  it("allows descendants", () =>
    expect(isPathInside("/tmp/root", "/tmp/root/a/b")).toBe(true));
  it("rejects sibling-prefix paths", () =>
    expect(isPathInside("/tmp/root", "/tmp/root-other/a")).toBe(false));
  it("rejects traversal", () =>
    expect(isPathInside("/tmp/root", "/tmp/escape")).toBe(false));
});
