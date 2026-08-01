import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import type {
  CommandResult,
  CustomOracleFunction,
  FailureOracle,
  FailureSignature,
  NormalizedStackFrame,
  OracleMatch,
} from "./types.js";
import { BugBonsaiError } from "./errors.js";

const STACK_PATTERN = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const ERROR_PATTERN = /\b([A-Za-z][\w]*(?:Error|Exception))(?::\s*(.*))?/;
const SETUP_ERRORS = [
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /cannot find module/i,
  /module not found/i,
  /ERR_MODULE_NOT_FOUND/,
  /could not determine executable/i,
  /failed to load config/i,
];

export interface NormalizeOptions {
  roots?: string[];
}

export function normalizeOutput(
  output: string,
  options: NormalizeOptions = {},
): string[] {
  let value = stripVTControlCharacters(output)
    .replaceAll("\\", "/")
    .replaceAll("\r\n", "\n");
  for (const root of options.roots ?? []) {
    value = value.replaceAll(root.replaceAll("\\", "/"), "<PROJECT>");
  }
  value = value
    .replace(/\/private\/var\/folders\/[^\s:]+/g, "<TMP>")
    .replace(/\/tmp\/[\w./-]+/g, "<TMP>")
    .replace(/\bbb_[a-z0-9_]+\b/gi, "<RUN_ID>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<UUID>",
    )
    .replace(/\b(?:pid|process)\s*[=:]?\s*\d+\b/gi, "pid=<PID>")
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?)\b/gi,
      "<DURATION>",
    )
    .replace(/\b(?:port\s*[=:]?\s*)\d{4,5}\b/gi, "port=<PORT>");

  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-200);
}

export function extractStackFrames(lines: string[]): NormalizedStackFrame[] {
  const frames: NormalizedStackFrame[] = [];
  for (const line of lines) {
    const match = STACK_PATTERN.exec(line);
    if (!match?.[2]) continue;
    const frame: NormalizedStackFrame = {
      file: match[2].replace(/[?#].*$/, ""),
      line: Number(match[3]),
      column: Number(match[4]),
    };
    if (match[1]) frame.functionName = match[1];
    frames.push(frame);
  }
  return frames.slice(0, 20);
}

export function tokenize(lines: string[]): string[] {
  const tokens = lines
    .filter(
      (line) =>
        !line.includes("node:internal/") && !/^Node\.js v\d+/i.test(line),
    )
    .join("\n")
    .toLowerCase()
    .match(/[a-z_][a-z0-9_.-]{2,}|\b\d{3,5}\b/g);
  return [...new Set(tokens ?? [])].sort();
}

export function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

function findError(lines: string[]): {
  errorName?: string;
  primaryMessage?: string;
} {
  let fallbackName: string | undefined;
  for (const line of lines) {
    const match = ERROR_PATTERN.exec(line);
    if (!match) continue;
    if (match[2])
      return {
        ...(match[1] ? { errorName: match[1] } : {}),
        primaryMessage: match[2].trim(),
      };
    if (match[1]) fallbackName = match[1];
  }
  if (fallbackName) return { errorName: fallbackName };
  const last = [...lines].reverse().find((line) => !/^\s*at\s/.test(line));
  return last ? { primaryMessage: last.trim() } : {};
}

export function createSignature(result: CommandResult): FailureSignature {
  const normalizedLines = normalizeOutput(result.combinedOutput, {
    roots: [result.cwd],
  });
  const identity = findError(normalizedLines);
  const stackFrames = extractStackFrames(normalizedLines);
  const tokenFingerprint = tokenize(normalizedLines);
  const stableMaterial = JSON.stringify({
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    errorName: identity.errorName,
    primaryMessage: identity.primaryMessage,
    tokens: tokenFingerprint,
    frames: stackFrames.map(
      (frame) => `${frame.functionName ?? ""}:${frame.file}`,
    ),
  });
  const signature: FailureSignature = {
    exitCode: result.exitCode,
    signal: result.signal,
    normalizedLines,
    stackFrames,
    tokenFingerprint,
    stableHash: createHash("sha256").update(stableMaterial).digest("hex"),
    timedOut: result.timedOut,
  };
  if (identity.errorName) signature.errorName = identity.errorName;
  if (identity.primaryMessage)
    signature.primaryMessage = identity.primaryMessage;
  return signature;
}

function hasSetupError(signature: FailureSignature): boolean {
  const output = signature.normalizedLines.join("\n");
  return SETUP_ERRORS.some((pattern) => pattern.test(output));
}

function frameOverlap(
  left: NormalizedStackFrame[],
  right: NormalizedStackFrame[],
): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const applicationFrames = (frames: NormalizedStackFrame[]) =>
    frames.filter(
      (frame) =>
        !frame.file.startsWith("node:internal/") &&
        !frame.file.includes("/node_modules/"),
    );
  const leftMeaningful = applicationFrames(left);
  const rightMeaningful = applicationFrames(right);
  const aFrames = leftMeaningful.length > 0 ? leftMeaningful : left;
  const bFrames = rightMeaningful.length > 0 ? rightMeaningful : right;
  return aFrames.some((a) =>
    bFrames.some((b) => {
      const fileMatches = a.file.endsWith(b.file) || b.file.endsWith(a.file);
      return (
        fileMatches &&
        (!a.functionName ||
          !b.functionName ||
          a.functionName === b.functionName)
      );
    }),
  );
}

export interface DefaultOracleOptions {
  match?: string;
  matchRegex?: string;
  exitCode?: number;
  threshold?: number;
}

export class DefaultFailureOracle implements FailureOracle {
  readonly #options: DefaultOracleOptions;
  readonly #regex?: RegExp;

  constructor(options: DefaultOracleOptions = {}) {
    this.#options = options;
    if (options.matchRegex) this.#regex = new RegExp(options.matchRegex);
  }

  async capture(result: CommandResult): Promise<FailureSignature> {
    if (result.exitCode === 0 && !result.timedOut && !result.signal) {
      throw new Error(
        "The supplied command succeeded; BugBonsai needs a failing command.",
      );
    }
    return createSignature(result);
  }

  async matches(
    baseline: FailureSignature,
    candidate: CommandResult,
  ): Promise<OracleMatch> {
    const signature = createSignature(candidate);
    if (candidate.exitCode === 0 && !candidate.timedOut && !candidate.signal) {
      return {
        matches: false,
        score: 0,
        reason: "candidate command succeeded",
        signature,
      };
    }
    if (baseline.timedOut !== signature.timedOut) {
      return {
        matches: false,
        score: 0,
        reason: "timeout behavior changed",
        signature,
      };
    }
    if (
      this.#options.exitCode !== undefined &&
      signature.exitCode !== this.#options.exitCode
    ) {
      return {
        matches: false,
        score: 0,
        reason: `expected exit code ${this.#options.exitCode}`,
        signature,
      };
    }
    const normalized = signature.normalizedLines.join("\n");
    if (this.#options.match && !normalized.includes(this.#options.match)) {
      return {
        matches: false,
        score: 0,
        reason: `required text was not present: ${this.#options.match}`,
        signature,
      };
    }
    if (this.#regex && !this.#regex.test(normalized)) {
      this.#regex.lastIndex = 0;
      return {
        matches: false,
        score: 0,
        reason: `required regular expression did not match`,
        signature,
      };
    }
    if (this.#regex) this.#regex.lastIndex = 0;
    if (!hasSetupError(baseline) && hasSetupError(signature)) {
      return {
        matches: false,
        score: 0,
        reason: "candidate introduced a setup or missing-module failure",
        signature,
      };
    }

    const score = jaccard(
      baseline.tokenFingerprint,
      signature.tokenFingerprint,
    );
    const identityMatches =
      !baseline.errorName ||
      !signature.errorName ||
      baseline.errorName === signature.errorName;
    const stackMatches = frameOverlap(
      baseline.stackFrames,
      signature.stackFrames,
    );
    const explicit = Boolean(this.#options.match || this.#regex);
    const threshold = this.#options.threshold ?? (explicit ? 0.12 : 0.42);
    const matches = identityMatches && stackMatches && score >= threshold;
    const reason = !identityMatches
      ? `error identity changed from ${baseline.errorName} to ${signature.errorName}`
      : !stackMatches
        ? "no meaningful stack-frame overlap"
        : score < threshold
          ? `failure similarity ${score.toFixed(2)} was below ${threshold.toFixed(2)}`
          : `failure matched with similarity ${score.toFixed(2)}`;
    return { matches, score, reason, signature };
  }
}

export class CustomFailureOracle implements FailureOracle {
  readonly #captureOracle: DefaultFailureOracle;
  readonly #custom: CustomOracleFunction;

  constructor(
    custom: CustomOracleFunction,
    options: DefaultOracleOptions = {},
  ) {
    this.#captureOracle = new DefaultFailureOracle(options);
    this.#custom = custom;
  }

  async capture(result: CommandResult): Promise<FailureSignature> {
    return this.#captureOracle.capture(result);
  }

  async matches(
    baseline: FailureSignature,
    candidate: CommandResult,
  ): Promise<OracleMatch> {
    const signature = createSignature(candidate);
    if (candidate.exitCode === 0 && !candidate.signal && !candidate.timedOut) {
      return {
        matches: false,
        score: 0,
        reason: "candidate command succeeded",
        signature,
      };
    }
    let result;
    try {
      result = await this.#custom({ baseline, result: candidate, signature });
    } catch (error) {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        `Custom oracle failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (typeof result === "boolean") {
      return {
        matches: result,
        score: result ? 1 : 0,
        reason: result
          ? "custom oracle matched"
          : "custom oracle rejected candidate",
        signature,
      };
    }
    if (!result || typeof result.matches !== "boolean") {
      throw new BugBonsaiError(
        "INVALID_INPUT",
        "Custom oracle must return a boolean or { matches, reason?, score? }.",
      );
    }
    return {
      matches: result.matches,
      score: result.score ?? (result.matches ? 1 : 0),
      reason:
        result.reason ??
        (result.matches
          ? "custom oracle matched"
          : "custom oracle rejected candidate"),
      signature,
    };
  }
}

export async function loadCustomOracle(
  oraclePath: string,
  cwd: string,
  options: DefaultOracleOptions = {},
): Promise<CustomFailureOracle> {
  const absolute = path.resolve(cwd, oraclePath);
  try {
    const imported = (await import(
      `${pathToFileURL(absolute).href}?run=${Date.now()}`
    )) as { default?: unknown };
    if (typeof imported.default !== "function") {
      throw new TypeError("default export is not a function");
    }
    return new CustomFailureOracle(
      imported.default as CustomOracleFunction,
      options,
    );
  } catch (error) {
    if (error instanceof BugBonsaiError) throw error;
    throw new BugBonsaiError(
      "INVALID_INPUT",
      `Unable to load custom oracle ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
