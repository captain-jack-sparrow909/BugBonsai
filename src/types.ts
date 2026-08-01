export type ReductionMode = "fast" | "balanced" | "thorough";

export interface CommandResult {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface NormalizedStackFrame {
  functionName?: string;
  file: string;
  line?: number;
  column?: number;
}

export interface FailureSignature {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorName?: string;
  primaryMessage?: string;
  normalizedLines: string[];
  stackFrames: NormalizedStackFrame[];
  tokenFingerprint: string[];
  stableHash: string;
  timedOut: boolean;
}

export interface OracleMatch {
  matches: boolean;
  score: number;
  reason: string;
  signature: FailureSignature;
}

export interface FailureOracle {
  capture(result: CommandResult): Promise<FailureSignature>;
  matches(
    baseline: FailureSignature,
    candidate: CommandResult,
  ): Promise<OracleMatch>;
}

export interface ReductionOptions {
  cwd?: string;
  command: string[];
  output?: string;
  mode?: ReductionMode;
  match?: string;
  matchRegex?: string;
  exitCode?: number;
  timeoutMs?: number;
  stabilityRuns?: number;
  finalRuns?: number;
  maxRuns?: number;
  keep?: string[];
  exclude?: string[];
  include?: string[];
  onlyReducers?: string[];
  skipReducers?: string[];
  installCommand?: string[];
  allowInstallScripts?: boolean;
  noInstall?: boolean;
  outputMode?: "human" | "json" | "quiet";
  verbose?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: "inventory" | "baseline" | "reduce" | "validate" | "complete";
  message: string;
  reducer?: string;
  accepted?: boolean;
  runs?: number;
}

export interface ProjectMetrics {
  files: number;
  bytes: number;
  dependencies: number;
}

export interface ReductionAttempt {
  mutationId: string;
  reducer: string;
  description: string;
  accepted: boolean;
  score: number;
  reason: string;
  durationMs: number;
}

export interface SecurityFinding {
  path: string;
  kind: string;
  message: string;
}

export interface PortabilityFinding {
  path?: string;
  kind: string;
  message: string;
}

export interface ReductionResult {
  runId: string;
  outputDirectory: string;
  command: string[];
  baseline: FailureSignature;
  finalSignature: FailureSignature;
  originalMetrics: ProjectMetrics;
  finalMetrics: ProjectMetrics;
  attempts: ReductionAttempt[];
  candidateRuns: number;
  durationMs: number;
  securityFindings: SecurityFinding[];
  portabilityFindings: PortabilityFinding[];
}

export interface ResolvedOptions extends Required<
  Pick<
    ReductionOptions,
    | "cwd"
    | "command"
    | "output"
    | "mode"
    | "timeoutMs"
    | "stabilityRuns"
    | "finalRuns"
    | "maxRuns"
    | "keep"
    | "exclude"
    | "include"
    | "onlyReducers"
    | "skipReducers"
    | "allowInstallScripts"
    | "noInstall"
    | "outputMode"
    | "verbose"
  >
> {
  match?: string;
  matchRegex?: string;
  exitCode?: number;
  installCommand?: string[];
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  projectRoot: string;
  invocationCwd: string;
  createdAt: string;
  updatedAt: string;
  status: "created" | "running" | "paused" | "completed" | "failed";
  command: string[];
  options: Omit<ResolvedOptions, "signal" | "onProgress">;
  baseline?: FailureSignature;
  attempts: ReductionAttempt[];
  candidateRuns: number;
  generation: number;
  currentMetrics?: ProjectMetrics;
  outputDirectory?: string;
}
