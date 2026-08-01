import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAdapters } from "../../src/adapters.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("framework adapters", () => {
  it("combines command, dependency, and configuration evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-adapter-"));
    created.push(root);
    await mkdir(path.join(root, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(root, "apps", "web", "package.json"),
      JSON.stringify({
        devDependencies: { vitest: "latest", typescript: "latest" },
      }),
    );
    await writeFile(
      path.join(root, "apps", "web", "vitest.config.ts"),
      "export default {};\n",
    );
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");

    const matches = await detectAdapters({
      root,
      invocationDirectory: "apps/web",
      command: ["pnpm", "vitest"],
    });
    expect(matches.map((match) => match.name)).toEqual(
      expect.arrayContaining(["typescript", "vitest"]),
    );
    expect(
      matches.find((match) => match.name === "vitest")?.testCallNames,
    ).toContain("test");
  });
});
