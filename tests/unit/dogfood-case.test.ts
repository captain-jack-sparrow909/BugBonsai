import { describe, expect, it } from "vitest";
import {
  canonicalGitHubRepository,
  validateDogfoodCase,
} from "../../scripts/dogfood-case.js";

const valid = {
  schemaVersion: 1,
  id: "public-runtime-failure",
  project: "../../checkout",
  upstream: {
    repository: "https://github.com/example/project",
    commit: "0123456789abcdef0123456789abcdef01234567",
    license: "MIT",
  },
  command: ["{node}", "failure.js"],
  match: "PUBLIC_FAILURE_SENTINEL",
};

describe("dogfood case validation", () => {
  it("accepts a pinned public case", () => {
    expect(validateDogfoodCase(valid)).toMatchObject({
      id: "public-runtime-failure",
    });
  });

  it("normalizes HTTPS and SSH GitHub remotes", () => {
    expect(
      canonicalGitHubRepository("git@github.com:Example/Project.git"),
    ).toBe("https://github.com/example/project");
    expect(
      canonicalGitHubRepository("git+https://github.com/example/project.git"),
    ).toBe("https://github.com/example/project");
  });

  it("rejects unpinned, non-GitHub, or matcher-free cases", () => {
    expect(() =>
      validateDogfoodCase({
        ...valid,
        upstream: { ...valid.upstream, commit: "main" },
      }),
    ).toThrow(/Invalid dogfood case/);
    expect(() =>
      validateDogfoodCase({
        ...valid,
        upstream: { ...valid.upstream, repository: "file:///private/repo" },
      }),
    ).toThrow(/Invalid dogfood case/);
    const { match: _match, ...withoutMatcher } = valid;
    expect(() => validateDogfoodCase(withoutMatcher)).toThrow(
      /Invalid dogfood case/,
    );
  });
});
