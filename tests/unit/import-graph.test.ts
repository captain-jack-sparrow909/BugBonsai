import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeImportGraph } from "../../src/import-graph.js";

describe("import graph", () => {
  it("resolves local modules and records direct package usage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-imports-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "entry.ts"),
      `import { value } from "./reachable";
import "used-package/subpath";
const scoped = require("@scope/tool/runtime");
console.log(value, scoped);
`,
    );
    await writeFile(
      path.join(root, "src", "reachable.ts"),
      `export { value } from "./value";
`,
    );
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 42;\n",
    );
    await writeFile(
      path.join(root, "src", "unreachable.ts"),
      'import "unused-package";\n',
    );

    const graph = await analyzeImportGraph(root, ["src/entry.ts"]);
    expect([...graph.reachableFiles].sort()).toEqual([
      "src/entry.ts",
      "src/reachable.ts",
      "src/value.ts",
    ]);
    expect(graph.reachableFiles.has("src/unreachable.ts")).toBe(false);
    expect(graph.packageImports).toEqual(
      new Set(["@scope/tool", "unused-package", "used-package"]),
    );
    await rm(root, { recursive: true, force: true });
  });
});
