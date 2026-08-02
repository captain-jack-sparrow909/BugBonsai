import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { updateManifestVersion } from "./prerelease-version.js";

const requestedVersion = process.argv[2];
if (!requestedVersion)
  throw new Error("Usage: tsx scripts/prepare-prerelease.ts <x.y.z-beta.n>");

const manifestPath = path.resolve("package.json");
const updated = updateManifestVersion(
  await readFile(manifestPath, "utf8"),
  requestedVersion,
);
await writeFile(manifestPath, updated);
process.stdout.write(
  `Prepared BugBonsai ${requestedVersion} for the beta tag.\n`,
);
