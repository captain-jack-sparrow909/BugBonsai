import { describe, expect, it } from "vitest";
import { renderCompatibility } from "../../scripts/compatibility-render.js";

describe("compatibility scoreboard rendering", () => {
  it("renders evidence and escapes table delimiters", () => {
    const rendered = renderCompatibility({
      schemaVersion: 1,
      reviewed: "2026-08-02",
      sections: [
        {
          name: "Frameworks",
          entries: [
            {
              target: "Tool | runner",
              status: "partial",
              evidence: "Detection only",
            },
          ],
        },
      ],
    });
    expect(rendered).toContain(
      "| Tool \\| runner | Partial | Detection only |",
    );
    expect(rendered).toContain("Last reviewed: 2026-08-02");
  });

  it("rejects duplicate sections", () => {
    expect(() =>
      renderCompatibility({
        schemaVersion: 1,
        reviewed: "2026-08-02",
        sections: [
          { name: "Runtime", entries: [] },
          { name: "Runtime", entries: [] },
        ],
      }),
    ).toThrow(/non-empty and unique/);
  });
});
