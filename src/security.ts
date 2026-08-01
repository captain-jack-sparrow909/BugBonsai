import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PortabilityFinding, SecurityFinding } from "./types.js";
import { createInventory, type Inventory } from "./sandbox.js";

const CONTENT_PATTERNS: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  [
    "authorization",
    /(?:authorization|api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}/i,
  ],
];

export function redactText(value: string): string {
  let redacted = value;
  for (const [, pattern] of CONTENT_PATTERNS)
    redacted = redacted.replace(
      new RegExp(pattern.source, `${pattern.flags}g`),
      "<REDACTED>",
    );
  return redacted;
}

export async function scanSecurity(root: string): Promise<SecurityFinding[]> {
  const inventory: Inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  const findings: SecurityFinding[] = inventory.excludedSensitive.map(
    (file) => ({
      path: file,
      kind: "sensitive-file",
      message: "Sensitive file is excluded from exported reproductions.",
    }),
  );
  for (const file of inventory.files) {
    const absolute = path.join(root, file);
    const content = await readFile(absolute).catch(() => undefined);
    if (!content || content.includes(0) || content.byteLength > 2 * 1024 * 1024)
      continue;
    const text = content.toString("utf8");
    for (const [kind, pattern] of CONTENT_PATTERNS) {
      if (pattern.test(text))
        findings.push({
          path: file,
          kind,
          message: `Possible ${kind} detected.`,
        });
      pattern.lastIndex = 0;
    }
  }
  return findings;
}

export async function auditPortability(
  root: string,
): Promise<PortabilityFinding[]> {
  const findings: PortabilityFinding[] = [];
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  for (const file of inventory.files) {
    if (
      !/\.(?:json|jsonc|js|cjs|mjs|ts|tsx|jsx|yaml|yml|sh)$/.test(file) &&
      file !== "package.json"
    )
      continue;
    const content = await readFile(path.join(root, file), "utf8").catch(
      () => "",
    );
    if (/\b(?:file|link):\.\.\//.test(content))
      findings.push({
        path: file,
        kind: "external-link",
        message: "References a package or file outside the reproduction.",
      });
    if (
      /\/(?:Users|home)\/[^\s"']+/.test(content) ||
      /[A-Z]:\\Users\\[^\s"']+/i.test(content)
    ) {
      findings.push({
        path: file,
        kind: "absolute-path",
        message: "Contains a machine-specific absolute path.",
      });
    }
    if (/process\.env\.[A-Z][A-Z0-9_]*/.test(content))
      findings.push({
        path: file,
        kind: "environment",
        message: "Reads environment variables; document required names.",
      });
  }
  return findings;
}
