import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDeterministicZip } from "./archive.js";
import type { DefaultOracleOptions } from "./oracle.js";
import { createInventory } from "./sandbox.js";
import type {
  FailureSignature,
  ReductionResult,
  SharingArtifacts,
} from "./types.js";
import { sha256, writeJsonAtomic } from "./utils.js";
import { VERSION } from "./version.js";

export const PORTABILITY_MANIFEST = "bugbonsai-manifest.json";

export interface PortabilityManifest {
  schemaVersion: 1;
  bugBonsaiVersion: string;
  command: string[];
  installCommand: string[] | null;
  invocationDirectory: string;
  oracle?: Omit<DefaultOracleOptions, "threshold">;
  failureSignature: FailureSignature;
  environment: {
    platform: string;
    architecture: string;
    node: string;
    nodeMajor: number;
    packageManager: string;
    workspaceType: string;
    requiredVariables: string[];
  };
  files: Array<{ path: string; bytes: number; sha256: string }>;
  treeSha256: string;
}

async function requiredEnvironmentVariables(root: string): Promise<string[]> {
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  const names = new Set<string>();
  for (const relative of inventory.files) {
    if (!/\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|sh)$/.test(relative)) continue;
    const content = await readFile(path.join(root, relative), "utf8").catch(
      () => "",
    );
    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g))
      if (match[1]) names.add(match[1]);
    for (const match of content.matchAll(
      /process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g,
    ))
      if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

export async function portableFileEntries(
  root: string,
): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  const entries = [];
  for (const relative of inventory.files
    .filter((file) => file !== PORTABILITY_MANIFEST)
    .sort()) {
    const content = await readFile(path.join(root, relative));
    entries.push({
      path: relative.replaceAll("\\", "/"),
      bytes: content.length,
      sha256: sha256(content),
    });
  }
  return entries;
}

export function portableTreeHash(
  entries: Array<{ path: string; bytes: number; sha256: string }>,
): string {
  return sha256(
    entries
      .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
      .join("\n"),
  );
}

function jsonCommand(command: string[]): string {
  return JSON.stringify(command);
}

function shellCommand(command: string[]): string {
  return command
    .map((part) =>
      /^[\w./:@=+-]+$/.test(part) ? part : `'${part.replaceAll("'", `'"'"'`)}'`,
    )
    .join(" ");
}

export function portableCommand(command: string[]): string[] {
  const [executable, ...argumentsList] = command;
  if (!executable) return [];
  const normalizedExecutable =
    executable === process.execPath ||
    (path.isAbsolute(executable) && path.basename(executable) === "node")
      ? "node"
      : executable;
  return [normalizedExecutable, ...argumentsList];
}

async function writeDockerfile(
  root: string,
  command: string[],
  invocationDirectory: string,
  installCommand: string[] | null,
): Promise<string> {
  const file = "Dockerfile.bugbonsai";
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 22);
  const workdir = invocationDirectory
    ? `/repro/${invocationDirectory}`
    : "/repro";
  const commandPortable = portableCommand(command);
  const corepack =
    installCommand && ["pnpm", "yarn"].includes(installCommand[0] ?? "")
      ? 'RUN ["corepack","enable"]\n'
      : "";
  const content = `FROM node:${nodeMajor}-bookworm-slim
WORKDIR /repro
COPY . .
${corepack}${installCommand ? `RUN ${jsonCommand(installCommand)}\n` : ""}WORKDIR ${JSON.stringify(workdir)}
CMD ${jsonCommand(commandPortable)}
`;
  await writeFile(path.join(root, file), content);
  return file;
}

async function writeGitHubIssue(
  root: string,
  result: ReductionResult,
): Promise<string> {
  const file = "BUGBONSAI_GITHUB_ISSUE.md";
  const command = portableCommand(result.command);
  const content = `## Minimal reproduction

<!-- Attach the BugBonsai ZIP and its .sha256 file. -->

### Reproduce

\`\`\`bash
${result.invocationDirectory ? `cd ${result.invocationDirectory}\n` : ""}${shellCommand(command)}
\`\`\`

### Observed failure

${result.finalSignature.errorName ?? "Command failure"}${result.finalSignature.primaryMessage ? `: ${result.finalSignature.primaryMessage}` : ""}

### Environment

- Node: ${process.version}
- Platform: ${os.platform()}-${os.arch()}
- BugBonsai: ${VERSION}

### Reduction

- Files: ${result.originalMetrics.files} → ${result.finalMetrics.files}
- Dependencies: ${result.originalMetrics.dependencies} → ${result.finalMetrics.dependencies}

### Verification

\`\`\`bash
npx bugbonsai@${VERSION} verify .
\`\`\`
`;
  await writeFile(path.join(root, file), content);
  return file;
}

export async function writeSharingArtifacts(
  result: ReductionResult,
  packageManager: { name: string; workspaceType: string },
  options: {
    installCommand: string[] | null;
    archivePath?: string;
    dockerfile: boolean;
    githubIssue: boolean;
    oracle: Omit<DefaultOracleOptions, "threshold">;
  },
): Promise<SharingArtifacts> {
  const artifacts: SharingArtifacts = {
    manifest: PORTABILITY_MANIFEST,
    treeSha256: "",
  };
  if (options.dockerfile)
    artifacts.dockerfile = await writeDockerfile(
      result.outputDirectory,
      result.command,
      result.invocationDirectory,
      options.installCommand,
    );
  if (options.githubIssue)
    artifacts.githubIssue = await writeGitHubIssue(
      result.outputDirectory,
      result,
    );

  const files = await portableFileEntries(result.outputDirectory);
  const treeSha256 = portableTreeHash(files);
  artifacts.treeSha256 = treeSha256;
  const manifest: PortabilityManifest = {
    schemaVersion: 1,
    bugBonsaiVersion: VERSION,
    command: portableCommand(result.command),
    installCommand: options.installCommand,
    invocationDirectory: result.invocationDirectory,
    ...(Object.keys(options.oracle).length > 0
      ? { oracle: options.oracle }
      : {}),
    failureSignature: result.finalSignature,
    environment: {
      platform: os.platform(),
      architecture: os.arch(),
      node: process.version,
      nodeMajor: Number(process.versions.node.split(".")[0] ?? 22),
      packageManager: packageManager.name,
      workspaceType: packageManager.workspaceType,
      requiredVariables: await requiredEnvironmentVariables(
        result.outputDirectory,
      ),
    },
    files,
    treeSha256,
  };
  await writeJsonAtomic(
    path.join(result.outputDirectory, PORTABILITY_MANIFEST),
    manifest,
  );

  if (options.archivePath) {
    await createDeterministicZip(result.outputDirectory, options.archivePath);
    const archiveContent = await readFile(options.archivePath);
    const archiveSha256 = sha256(archiveContent);
    const checksumPath = `${options.archivePath}.sha256`;
    await writeFile(
      checksumPath,
      `${archiveSha256}  ${path.basename(options.archivePath)}\n`,
      { flag: "wx" },
    );
    artifacts.archive = options.archivePath;
    artifacts.archiveSha256 = archiveSha256;
    artifacts.checksum = checksumPath;
    artifacts.archiveBytes = (await stat(options.archivePath)).size;
  }
  return artifacts;
}
