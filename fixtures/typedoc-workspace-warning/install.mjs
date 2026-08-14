import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const modules = path.join(root, "node_modules");
const docsModules = path.join(root, "packages", "docs", "node_modules");
await rm(modules, { recursive: true, force: true });
await rm(docsModules, { recursive: true, force: true });
await mkdir(path.join(modules, "typedoc-lite"), { recursive: true });
await mkdir(path.join(modules, "typescript-lite"), { recursive: true });
await mkdir(path.join(docsModules, "mdn-links-lite"), { recursive: true });

await writeFile(
  path.join(modules, "typedoc-lite", "package.json"),
  JSON.stringify({ name: "typedoc-lite", type: "module", main: "index.mjs" }),
);
await writeFile(
  path.join(modules, "typedoc-lite", "index.mjs"),
  'import typescript from "typescript-lite"; export default `typedoc:${typescript}`;\n',
);
await writeFile(
  path.join(modules, "typescript-lite", "package.json"),
  JSON.stringify({
    name: "typescript-lite",
    type: "module",
    main: "index.mjs",
  }),
);
await writeFile(
  path.join(modules, "typescript-lite", "index.mjs"),
  'export default "typescript";\n',
);
await writeFile(
  path.join(docsModules, "mdn-links-lite", "package.json"),
  JSON.stringify({
    name: "mdn-links-lite",
    type: "module",
    main: "index.mjs",
  }),
);
await writeFile(
  path.join(docsModules, "mdn-links-lite", "index.mjs"),
  'export default "mdn-links";\n',
);
await symlink(
  path.join(root, "packages", "docs"),
  path.join(modules, "docs-workspace"),
  process.platform === "win32" ? "junction" : "dir",
);
