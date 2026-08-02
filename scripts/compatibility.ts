import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "prettier";
import {
  renderCompatibility,
  type CompatibilityMatrix,
} from "./compatibility-render.js";

const root = process.cwd();
const target = path.join(root, "COMPATIBILITY.md");
const matrix = JSON.parse(
  await readFile(path.join(root, "compatibility", "matrix.json"), "utf8"),
) as CompatibilityMatrix;
const rendered = await format(renderCompatibility(matrix), {
  parser: "markdown",
});

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== rendered)
    throw new Error(
      "COMPATIBILITY.md is stale. Run pnpm compatibility:generate.",
    );
  process.stdout.write("Compatibility scoreboard is current.\n");
} else {
  await writeFile(target, rendered);
  process.stdout.write("Generated COMPATIBILITY.md.\n");
}
