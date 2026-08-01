import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import {
  DeepSourceReducer,
  DependencyReducer,
  FileTreeReducer,
  JsonConfigReducer,
  TestStructureReducer,
} from "../../src/reducers.js";

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
      entryPaths: new Set(),
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
    expect(parseSync("example.test.ts", reduced).errors).toHaveLength(0);
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
      entryPaths: new Set(["src/protected.js"]),
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

  it("prioritizes dependencies absent from the source import graph", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-deps-"));
    created.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: {
          "used-package": "1.0.0",
          "unused-package": "1.0.0",
        },
      }),
    );
    await writeFile(
      path.join(root, "entry.ts"),
      'import "used-package";\nthrow new Error("bug");\n',
    );

    const mutations = await new DependencyReducer().discover({
      root,
      command: ["node", "entry.ts"],
      protectedPaths: new Set(["entry.ts"]),
      mode: "balanced",
      adapterMatches: [],
      entryPaths: new Set(["entry.ts"]),
    });

    expect(mutations[0]?.description).toContain("unused-package");
  });

  it("discovers parse-safe deep source candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-deep-"));
    created.push(root);
    const file = path.join(root, "component.tsx");
    await writeFile(
      file,
      `function render() {
  const config = { unused: true, label: "bug" };
  const values = ["unused", config.label];
  const selected = config.unused ? values[0] : values[1];
  if (selected) { console.log(selected); } else { console.log("fallback"); }
  return <Panel unused={true}><span>{values[1]}</span></Panel>;
}
class Example { unused() { return 1; } keep() { return render(); } }
`,
    );
    const mutations = await new DeepSourceReducer().discover({
      root,
      command: ["node", "component.tsx"],
      protectedPaths: new Set(),
      mode: "thorough",
      adapterMatches: [],
      entryPaths: new Set(),
    });
    const descriptions = mutations.map((mutation) => mutation.description);
    expect(
      descriptions.some((description) =>
        description.includes("block statement"),
      ),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("class member")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("object member")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("array element")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("JSX attribute")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("JSX child")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("if consequent")),
    ).toBe(true);
    expect(
      descriptions.some((description) => description.includes("else branch")),
    ).toBe(true);
    expect(
      descriptions.some((description) =>
        description.includes("conditional branch"),
      ),
    ).toBe(true);

    const objectMutation = mutations.find((mutation) =>
      mutation.description.includes("object member"),
    );
    expect(objectMutation).toBeDefined();
    await objectMutation?.apply(root);
    const reduced = await readFile(file, "utf8");
    expect(parseSync("component.tsx", reduced).errors).toHaveLength(0);
  });

  it("reduces nested JSONC properties and array elements without losing comments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-jsonc-"));
    created.push(root);
    const file = path.join(root, "tsconfig.json");
    await writeFile(
      file,
      `{
  // retain this project comment
  "compilerOptions": {
    "strict": true,
    "plugins": [{ "name": "unused-plugin", "settings": { "noise": true } }]
  },
  "include": ["src", "unused"]
}
`,
    );
    const mutations = await new JsonConfigReducer().discover({
      root,
      command: ["tsc"],
      protectedPaths: new Set(["tsconfig.json"]),
      mode: "balanced",
      adapterMatches: [],
      entryPaths: new Set(),
    });
    expect(
      mutations.some((mutation) =>
        mutation.description.includes(
          "compilerOptions.plugins[0].settings.noise",
        ),
      ),
    ).toBe(true);
    const arrayMutation = mutations.find((mutation) =>
      mutation.description.includes("include[1]"),
    );
    expect(arrayMutation).toBeDefined();
    await arrayMutation?.apply(root);
    const reduced = await readFile(file, "utf8");
    expect(reduced).toContain("retain this project comment");
    expect(reduced).not.toContain('"unused"');
  });
});
