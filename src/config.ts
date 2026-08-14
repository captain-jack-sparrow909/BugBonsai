import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BugBonsaiError } from "./errors.js";
import type { BugBonsaiConfig } from "./types.js";
import { pathExists } from "./utils.js";

const CONFIG_NAME = "bugbonsai.config.mjs";
const ARRAY_FIELDS = [
  "keep",
  "exclude",
  "include",
  "onlyReducers",
  "skipReducers",
  "plugins",
] as const;
const BOOLEAN_FIELDS = [
  "allowInstallScripts",
  "noInstall",
  "verbose",
  "dockerfile",
  "githubIssue",
] as const;
const NUMBER_FIELDS = [
  "exitCode",
  "timeoutMs",
  "stabilityRuns",
  "finalRuns",
  "maxRuns",
] as const;
const STRING_FIELDS = [
  "root",
  "output",
  "match",
  "matchRegex",
  "failOnOutput",
  "oraclePath",
  "pluginOracle",
  "archivePath",
] as const;
const ALLOWED_FIELDS = new Set<string>([
  ...ARRAY_FIELDS,
  ...BOOLEAN_FIELDS,
  ...NUMBER_FIELDS,
  ...STRING_FIELDS,
  "mode",
  "installCommand",
  "outputMode",
  "timeout",
  "reducers",
  "oracle",
]);
const REDUCER_NAMES = {
  files: ["files"],
  packageJson: ["package-json"],
  dependencies: ["dependencies"],
  jsonConfig: ["json-config"],
  source: ["source", "deep-source"],
  tests: ["test-structure"],
} as const;

function invalid(property: string, expected: string): never {
  throw new BugBonsaiError(
    "INVALID_INPUT",
    `Invalid configuration at ${property}: expected ${expected}.`,
  );
}

export function validateConfig(value: unknown): BugBonsaiConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("default export", "an object");
  }
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        `Unknown configuration property: ${key}.`,
      );
    }
  }
  for (const key of ARRAY_FIELDS) {
    const item = config[key];
    if (
      item !== undefined &&
      (!Array.isArray(item) || item.some((entry) => typeof entry !== "string"))
    ) {
      invalid(key, "an array of strings");
    }
  }
  for (const key of BOOLEAN_FIELDS) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") {
      invalid(key, "a boolean");
    }
  }
  for (const key of NUMBER_FIELDS) {
    if (
      config[key] !== undefined &&
      (typeof config[key] !== "number" || !Number.isFinite(config[key]))
    ) {
      invalid(key, "a finite number");
    }
  }
  for (const key of STRING_FIELDS) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      invalid(key, "a string");
    }
  }
  if (
    config.mode !== undefined &&
    !["fast", "balanced", "thorough"].includes(String(config.mode))
  ) {
    invalid("mode", '"fast", "balanced", or "thorough"');
  }
  if (
    config.installCommand !== undefined &&
    (!Array.isArray(config.installCommand) ||
      config.installCommand.some((entry) => typeof entry !== "string"))
  ) {
    invalid("installCommand", "an argument array");
  }
  if (
    config.outputMode !== undefined &&
    !["human", "json", "quiet"].includes(String(config.outputMode))
  ) {
    invalid("outputMode", '"human", "json", or "quiet"');
  }
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== "string")
      invalid("timeout", "a duration string");
    if (!/^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(config.timeout)) {
      invalid("timeout", "a duration such as 500ms, 30s, 5m, or 1h");
    }
  }
  if (config.reducers !== undefined) {
    if (
      !config.reducers ||
      typeof config.reducers !== "object" ||
      Array.isArray(config.reducers)
    ) {
      invalid("reducers", "an object");
    }
    for (const [name, enabled] of Object.entries(config.reducers)) {
      if (!(name in REDUCER_NAMES)) {
        throw new BugBonsaiError(
          "INVALID_INPUT",
          `Unknown configuration property: reducers.${name}.`,
        );
      }
      if (typeof enabled !== "boolean")
        invalid(`reducers.${name}`, "a boolean");
    }
  }
  if (config.oracle !== undefined) {
    if (
      !config.oracle ||
      typeof config.oracle !== "object" ||
      Array.isArray(config.oracle)
    ) {
      invalid("oracle", "an object");
    }
    const oracle = config.oracle as Record<string, unknown>;
    const allowedOracle = new Set([
      "match",
      "matchRegex",
      "failOnOutput",
      "exitCode",
      "path",
      "plugin",
    ]);
    for (const name of Object.keys(oracle)) {
      if (!allowedOracle.has(name)) {
        throw new BugBonsaiError(
          "INVALID_INPUT",
          `Unknown configuration property: oracle.${name}.`,
        );
      }
    }
    for (const name of [
      "match",
      "matchRegex",
      "failOnOutput",
      "path",
      "plugin",
    ] as const) {
      if (oracle[name] !== undefined && typeof oracle[name] !== "string") {
        invalid(`oracle.${name}`, "a string");
      }
    }
    if (
      oracle.exitCode !== undefined &&
      (typeof oracle.exitCode !== "number" || !Number.isFinite(oracle.exitCode))
    ) {
      invalid("oracle.exitCode", "a finite number");
    }
  }
  const typed = config as BugBonsaiConfig;
  const normalized: BugBonsaiConfig = { ...typed };
  if (typed.timeoutMs === undefined && typed.timeout !== undefined) {
    const unit = typed.timeout.endsWith("ms") ? "ms" : typed.timeout.slice(-1);
    const amount = Number.parseFloat(typed.timeout);
    normalized.timeoutMs = Math.round(
      amount *
        { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
          unit as "ms" | "s" | "m" | "h"
        ],
    );
  }
  if (typed.oracle) {
    if (normalized.match === undefined && typed.oracle.match !== undefined)
      normalized.match = typed.oracle.match;
    if (
      normalized.matchRegex === undefined &&
      typed.oracle.matchRegex !== undefined
    )
      normalized.matchRegex = typed.oracle.matchRegex;
    if (
      normalized.failOnOutput === undefined &&
      typed.oracle.failOnOutput !== undefined
    )
      normalized.failOnOutput = typed.oracle.failOnOutput;
    if (
      normalized.exitCode === undefined &&
      typed.oracle.exitCode !== undefined
    )
      normalized.exitCode = typed.oracle.exitCode;
    if (normalized.oraclePath === undefined && typed.oracle.path !== undefined)
      normalized.oraclePath = typed.oracle.path;
    if (
      normalized.pluginOracle === undefined &&
      typed.oracle.plugin !== undefined
    )
      normalized.pluginOracle = typed.oracle.plugin;
  }
  if (typed.reducers) {
    const disabled = Object.entries(typed.reducers)
      .filter(([, enabled]) => !enabled)
      .flatMap(([name]) => REDUCER_NAMES[name as keyof typeof REDUCER_NAMES]);
    normalized.skipReducers = [...(typed.skipReducers ?? []), ...disabled];
  }
  return normalized;
}

export async function loadConfig(
  cwd: string,
): Promise<{ config: BugBonsaiConfig; path?: string }> {
  const file = path.join(cwd, CONFIG_NAME);
  if (!(await pathExists(file))) return { config: {} };
  try {
    const sourceHash = Buffer.from(await readFile(file))
      .toString("base64url")
      .slice(0, 16);
    const imported = (await import(
      `${pathToFileURL(file).href}?v=${sourceHash}`
    )) as {
      default?: unknown;
    };
    return { config: validateConfig(imported.default), path: file };
  } catch (error) {
    if (error instanceof BugBonsaiError) throw error;
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Unable to load ${CONFIG_NAME}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function defineConfig(config: BugBonsaiConfig): BugBonsaiConfig {
  return config;
}
