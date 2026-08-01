import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
) as { version: string };
const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-pack-"));
let archivePath: string | undefined;

try {
  await execFileAsync("pnpm", ["build"], { cwd: root });
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--ignore-scripts"],
    {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_cache: path.join(temporary, "npm-cache"),
      },
    },
  );
  const packed = JSON.parse(stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const archive = packed[0];
  if (!archive) throw new Error("npm pack did not produce an archive.");
  archivePath = path.join(root, archive.filename);
  const paths = new Set(archive.files.map((file) => file.path));
  for (const required of [
    "dist/cli.js",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/plugin.d.ts",
    "dist/verify.d.ts",
    "dist/sharing.d.ts",
    "docs/configuration.md",
    "docs/plugins.md",
    "docs/sharing.md",
    "examples/plugins/full-example.mjs",
    "README.md",
    "LICENSE",
  ]) {
    if (!paths.has(required))
      throw new Error(`Packed archive is missing ${required}.`);
  }

  const consumer = path.join(temporary, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    path.join(consumer, "package.json"),
    '{"name":"pack-check","private":true}\n',
  );
  await execFileAsync("npm", ["install", "--ignore-scripts", archivePath], {
    cwd: consumer,
    env: {
      ...process.env,
      npm_config_cache: path.join(temporary, "npm-cache"),
    },
  });
  const { stdout: version } = await execFileAsync(
    path.join(consumer, "node_modules", ".bin", "bugbonsai"),
    ["--version"],
    { cwd: consumer },
  );
  if (version.trim() !== manifest.version)
    throw new Error(`Unexpected CLI version: ${version.trim()}`);
  const cli = await readFile(
    path.join(consumer, "node_modules", "bugbonsai", "dist", "cli.js"),
    "utf8",
  );
  if (!cli.startsWith("#!/usr/bin/env node"))
    throw new Error("Built CLI is missing its shebang.");
  const { stdout: verifyHelp } = await execFileAsync(
    path.join(consumer, "node_modules", ".bin", "bugbonsai"),
    ["verify", "--help"],
    { cwd: consumer },
  );
  if (!verifyHelp.includes("bugbonsai verify"))
    throw new Error("Packed CLI is missing verify help.");
  await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import { BUGBONSAI_PLUGIN_API_VERSION, PORTABILITY_MANIFEST, definePlugin, verifyReproduction } from "bugbonsai"; if (BUGBONSAI_PLUGIN_API_VERSION !== 1 || PORTABILITY_MANIFEST !== "bugbonsai-manifest.json" || definePlugin({ apiVersion: 1, name: "pack-check" }).name !== "pack-check" || typeof verifyReproduction !== "function") process.exit(1);',
    ],
    { cwd: consumer },
  );
  process.stdout.write(
    `Packed ${archive.filename}; installed CLI reports ${version.trim()}.\n`,
  );
} finally {
  if (archivePath) await rm(archivePath, { force: true });
  await rm(temporary, { recursive: true, force: true });
}
