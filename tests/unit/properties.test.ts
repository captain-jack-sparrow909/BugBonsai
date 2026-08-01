import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeOutput } from "../../src/oracle.js";
import { isPathInside } from "../../src/utils.js";

describe("property invariants", () => {
  it("normalization is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const once = normalizeOutput(value);
        expect(normalizeOutput(once.join("\n"))).toEqual(once);
      }),
    );
  });

  it("a resolved parent traversal never remains contained", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {
          minLength: 1,
          maxLength: 5,
        }),
        (segments) => {
          const root = path.resolve("/tmp/bugbonsai-root");
          const escaped = path.resolve(root, "..", ...segments);
          expect(isPathInside(root, escaped)).toBe(false);
        },
      ),
    );
  });
});
