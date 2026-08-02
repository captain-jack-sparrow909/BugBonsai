export function validateBetaVersion(value: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version))
    throw new Error(
      "Beta version must use the form 0.2.0-beta.0 with numeric components.",
    );
  return version;
}

export function updateManifestVersion(
  source: string,
  requestedVersion: string,
): string {
  const manifest = JSON.parse(source) as Record<string, unknown>;
  if (manifest.name !== "bugbonsai")
    throw new Error("Refusing to version a package other than bugbonsai.");
  manifest.version = validateBetaVersion(requestedVersion);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
