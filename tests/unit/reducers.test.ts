import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import { FileTreeReducer, TestStructureReducer } from "../../src/reducers.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("structural reducers", () => {
  it("discovers nested test and suite calls and applies a parse-safe edit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-reducer-"));
    created.push(root);
    const file = path.join(root, "example.test.ts");
    await writeFile(
      file,
      `describe.each([[1]])("suite", () => {
  it("first", () => expect(1).toBe(1));
  test.skip("second", () => expect(2).toBe(2));
});
`,
    );
    const reducer = new TestStructureReducer();
    const mutations = await reducer.discover({
      root,
      command: ["vitest"],
      protectedPaths: new Set(),
      mode: "balanced",
      adapterMatches: [],
    });
    expect(mutations).toHaveLength(3);
    const descriptions = mutations.map((mutation) => mutation.description);
    expect(
      descriptions.some((description) => description.includes("describe")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("remove it")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("remove test")),
    ).toBe(true);
    const smallest = mutations.at(-1);
    expect(smallest).toBeDefined();
    await smallest?.apply(root);
    const reduced = await readFile(file, "utf8");
    expect(() => parseSync("example.test.ts", reduced)).not.toThrow();
  });

  it("does not propose a whole-directory deletion containing a protected file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-protected-"));
    created.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "protected.js"),
      "throw new Error('bug');\n",
    );
    await writeFile(path.join(root, "src", "unused-a.js"), "export {};\n");
    await writeFile(path.join(root, "src", "unused-b.js"), "export {};\n");
    const mutations = await new FileTreeReducer().discover({
      root,
      command: ["node", "protected.js"],
      protectedPaths: new Set(["src/protected.js"]),
      mode: "balanced",
      adapterMatches: [],
    });
    expect(
      mutations.some((mutation) =>
        mutation.affectedPaths.includes("src/protected.js"),
      ),
    ).toBe(false);
    expect(
      mutations.some((mutation) => mutation.description.includes("under src")),
    ).toBe(false);
  });
});
