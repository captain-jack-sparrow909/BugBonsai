import { describe, expect, it } from "vitest";
import {
  DefaultFailureOracle,
  createSignature,
  normalizeOutput,
} from "../../src/oracle.js";
import type { CommandResult } from "../../src/types.js";

function result(output: string, exitCode = 1): CommandResult {
  return {
    command: ["node", "failure.js"],
    cwd: "/tmp/project",
    exitCode,
    signal: null,
    stdout: "",
    stderr: output,
    combinedOutput: output,
    durationMs: 10,
    timedOut: false,
    truncated: false,
  };
}

describe("failure normalization", () => {
  it("is idempotent and removes unstable paths", () => {
    const once = normalizeOutput(
      "\u001b[31mTypeError: broken\u001b[0m\n at run (/tmp/random/a.ts:4:2)",
      { roots: ["/tmp/random"] },
    );
    expect(normalizeOutput(once.join("\n"))).toEqual(once);
    expect(once.join("\n")).not.toContain("/tmp/random");
  });

  it("ignores line drift in stable hashes", () => {
    const first = createSignature(
      result("TypeError: broken\n at run (/tmp/project/a.ts:4:2)"),
    );
    const second = createSignature(
      result("TypeError: broken\n at run (/tmp/project/a.ts:9:7)"),
    );
    expect(first.stableHash).toBe(second.stableHash);
  });
});

describe("DefaultFailureOracle", () => {
  it("accepts the same failure after line drift", async () => {
    const oracle = new DefaultFailureOracle();
    const baseline = await oracle.capture(
      result("TypeError: PAYMENT_BROKEN\n at pay (/tmp/project/pay.ts:10:2)"),
    );
    const match = await oracle.matches(
      baseline,
      result("TypeError: PAYMENT_BROKEN\n at pay (/tmp/project/pay.ts:4:2)"),
    );
    expect(match.matches).toBe(true);
  });

  it("rejects an introduced missing module error", async () => {
    const oracle = new DefaultFailureOracle();
    const baseline = await oracle.capture(
      result("TypeError: PAYMENT_BROKEN\n at pay (/tmp/project/pay.ts:10:2)"),
    );
    const match = await oracle.matches(
      baseline,
      result("Error: Cannot find module 'payment-lib'"),
    );
    expect(match.matches).toBe(false);
    expect(match.reason).toMatch(/setup|missing-module/);
  });

  it("supports an explicit matcher", async () => {
    const oracle = new DefaultFailureOracle({ match: "SENTINEL_VALUE" });
    const baseline = await oracle.capture(result("Error: SENTINEL_VALUE"));
    expect(
      (
        await oracle.matches(
          baseline,
          result("Error: SENTINEL_VALUE with less context"),
        )
      ).matches,
    ).toBe(true);
  });
});
