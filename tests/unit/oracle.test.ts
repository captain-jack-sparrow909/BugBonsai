import { describe, expect, it } from "vitest";
import {
  CustomFailureOracle,
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

describe("CustomFailureOracle", () => {
  it("uses a trusted project predicate as the final match decision", async () => {
    const oracle = new CustomFailureOracle(({ result: candidate }) => ({
      matches: candidate.combinedOutput.includes("DOMAIN_SENTINEL"),
      reason: "domain sentinel comparison",
    }));
    const baseline = await oracle.capture(result("Error: DOMAIN_SENTINEL"));
    expect(
      (await oracle.matches(baseline, result("DOMAIN_SENTINEL"))).matches,
    ).toBe(true);
    expect(
      (await oracle.matches(baseline, result("OTHER_FAILURE"))).matches,
    ).toBe(false);
  });
});

describe("DefaultFailureOracle", () => {
  it("rejects a baseline that does not satisfy an explicit match", async () => {
    const oracle = new DefaultFailureOracle({ match: "EXPECTED_SENTINEL" });

    await expect(
      oracle.capture(result("Error: a different failure")),
    ).rejects.toThrow(/baseline did not contain required text/i);
  });

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

  it("treats matching output from a successful command as the failure", async () => {
    const oracle = new DefaultFailureOracle({
      failOnOutput: "TYPE_DOC_WARNING",
    });
    const baseline = await oracle.capture(result("TYPE_DOC_WARNING", 0));

    expect(
      (await oracle.matches(baseline, result("TYPE_DOC_WARNING", 0))).matches,
    ).toBe(true);
    await expect(oracle.capture(result("ordinary success", 0))).rejects.toThrow(
      /did not contain failure output/i,
    );
    expect(
      (await oracle.matches(baseline, result("ordinary success", 0))).matches,
    ).toBe(false);
  });

  it("does not replace an output-detected success with a crashing command", async () => {
    const oracle = new DefaultFailureOracle({
      failOnOutput: "TYPE_DOC_WARNING",
    });
    const baseline = await oracle.capture(result("TYPE_DOC_WARNING", 0));
    const match = await oracle.matches(
      baseline,
      result("Error: TYPE_DOC_WARNING", 1),
    );

    expect(match.matches).toBe(false);
    expect(match.reason).toMatch(/exit behavior changed/i);
  });
});
