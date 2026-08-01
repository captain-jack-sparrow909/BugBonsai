import { describe, expect, it, vi } from "vitest";
import { createDdminSchedule } from "../../src/ddmin.js";
import type { Mutation } from "../../src/reducers.js";

function mutation(index: number, apply = vi.fn()): Mutation {
  return {
    id: `files:${index}`,
    reducer: "files",
    description: `remove file ${index}`,
    estimatedImpact: index + 1,
    affectedPaths: [`file-${index}.js`],
    requiresInstall: false,
    apply: async () => apply(index),
  };
}

describe("ddmin scheduling", () => {
  it("orders deterministic coarse partitions before individual mutations", () => {
    const mutations = Array.from({ length: 8 }, (_, index) => mutation(index));
    const schedule = createDdminSchedule(mutations, { maxGranularity: 8 });
    expect(schedule.slice(-8)).toEqual(mutations);
    expect(schedule[0]?.affectedPaths).toEqual([
      "file-0.js",
      "file-1.js",
      "file-2.js",
      "file-3.js",
    ]);
    expect(new Set(schedule.map((candidate) => candidate.id)).size).toBe(
      schedule.length,
    );
  });

  it("applies every member of a compound mutation exactly once", async () => {
    const applied = vi.fn();
    const schedule = createDdminSchedule(
      Array.from({ length: 4 }, (_, index) => mutation(index, applied)),
      { maxGranularity: 2 },
    );
    await schedule[0]?.apply("/candidate");
    expect(applied.mock.calls).toEqual([[0], [1]]);
  });

  it("falls back to singles when no partition is possible", () => {
    const only = mutation(0);
    expect(createDdminSchedule([only], { maxGranularity: 16 })).toEqual([only]);
  });
});
