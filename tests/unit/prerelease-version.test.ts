import { describe, expect, it } from "vitest";
import {
  updateManifestVersion,
  validateBetaVersion,
} from "../../scripts/prerelease-version.js";

describe("beta prerelease versioning", () => {
  it("accepts an explicit numeric beta version", () => {
    expect(validateBetaVersion("0.2.0-beta.3")).toBe("0.2.0-beta.3");
    expect(
      JSON.parse(
        updateManifestVersion(
          '{"name":"bugbonsai","version":"0.1.0"}',
          "0.2.0-beta.3",
        ),
      ),
    ).toMatchObject({ name: "bugbonsai", version: "0.2.0-beta.3" });
  });

  it.each([
    "0.2.0",
    "v0.2.0-beta.0",
    "0.2-beta.0",
    "0.2.0-rc.0",
    "0.2.0-beta.latest",
    "0.2.0-beta.0 --access public",
  ])("rejects unsafe or non-beta version %s", (version) => {
    expect(() => validateBetaVersion(version)).toThrow(/0\.2\.0-beta\.0/);
  });

  it("refuses to edit another package", () => {
    expect(() =>
      updateManifestVersion(
        '{"name":"another-package","version":"0.1.0"}',
        "0.2.0-beta.0",
      ),
    ).toThrow(/other than bugbonsai/);
  });
});
