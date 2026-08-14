import { readFile } from "node:fs/promises";
import path from "node:path";
import { BugBonsaiError } from "./errors.js";
import { DefaultFailureOracle } from "./oracle.js";
import { runCommand } from "./process.js";
import {
  PORTABILITY_MANIFEST,
  portableFileEntries,
  portableTreeHash,
  type PortabilityManifest,
} from "./sharing.js";
import type { VerificationResult } from "./types.js";
import { isPathInside } from "./utils.js";

export async function verifyReproduction(
  rootInput: string,
  options: {
    install?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<VerificationResult> {
  const root = path.resolve(rootInput);
  let manifest: PortabilityManifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, PORTABILITY_MANIFEST), "utf8"),
    ) as PortabilityManifest;
  } catch (error) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Unable to read ${PORTABILITY_MANIFEST} in ${root}.`,
      { cause: error },
    );
  }
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.command) ||
    manifest.command.length === 0 ||
    manifest.command.some((part) => typeof part !== "string") ||
    (manifest.installCommand !== null &&
      (!Array.isArray(manifest.installCommand) ||
        manifest.installCommand.length === 0 ||
        manifest.installCommand.some((part) => typeof part !== "string"))) ||
    typeof manifest.invocationDirectory !== "string" ||
    (manifest.oracle !== undefined &&
      (!manifest.oracle ||
        typeof manifest.oracle !== "object" ||
        Array.isArray(manifest.oracle) ||
        Object.keys(manifest.oracle).some(
          (key) =>
            !["match", "matchRegex", "failOnOutput", "exitCode"].includes(key),
        ) ||
        [
          manifest.oracle.match,
          manifest.oracle.matchRegex,
          manifest.oracle.failOnOutput,
        ].some((value) => value !== undefined && typeof value !== "string") ||
        (manifest.oracle.failOnOutput !== undefined &&
          manifest.oracle.failOnOutput.trim().length === 0) ||
        (manifest.oracle.exitCode !== undefined &&
          !Number.isInteger(manifest.oracle.exitCode)))) ||
    !Array.isArray(manifest.files) ||
    manifest.files.some(
      (entry) =>
        !entry ||
        typeof entry.path !== "string" ||
        path.isAbsolute(entry.path) ||
        entry.path.replaceAll("\\", "/").split("/").includes("..") ||
        typeof entry.bytes !== "number" ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256),
    ) ||
    typeof manifest.treeSha256 !== "string"
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "The BugBonsai portability manifest is invalid or unsupported.",
    );
  }
  const manifestPaths = manifest.files.map((entry) => entry.path);
  if (
    new Set(manifestPaths).size !== manifestPaths.length ||
    portableTreeHash(manifest.files) !== manifest.treeSha256
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "The portability manifest file index is inconsistent.",
    );
  }
  const invocationRoot = path.resolve(root, manifest.invocationDirectory);
  if (!isPathInside(root, invocationRoot))
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "The portability manifest invocation directory escapes the reproduction root.",
    );
  const actualFiles = await portableFileEntries(root);
  const actualTreeSha256 = portableTreeHash(actualFiles);
  if (
    actualTreeSha256 !== manifest.treeSha256 ||
    JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)
  ) {
    throw new BugBonsaiError(
      "INVALID_INPUT",
      "Reproduction integrity check failed: files were added, removed, or changed after export.",
      {
        details: {
          expectedTreeSha256: manifest.treeSha256,
          actualTreeSha256,
        },
      },
    );
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  let installed = false;
  if ((options.install ?? true) && manifest.installCommand) {
    const install = await runCommand(manifest.installCommand, {
      cwd: root,
      timeoutMs: Math.max(timeoutMs, 5 * 60_000),
      verbose: options.verbose ?? false,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (install.exitCode !== 0)
      throw new BugBonsaiError(
        "INTERNAL",
        `Verification install failed.\n${install.stderr || install.stdout}`,
      );
    installed = true;
  }
  const execution = await runCommand(manifest.command, {
    cwd: invocationRoot,
    timeoutMs,
    verbose: options.verbose ?? false,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const oracle = new DefaultFailureOracle(manifest.oracle);
  const match = await oracle.matches(manifest.failureSignature, execution);
  if (!match.matches)
    throw new BugBonsaiError(
      "INTERNAL",
      `Reproduction command did not preserve the exported failure: ${match.reason}`,
    );
  return {
    root,
    integrityVerified: true,
    failureVerified: true,
    installed,
    treeSha256: actualTreeSha256,
    signature: match.signature,
  };
}
