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
  root?: string;
  command: string[];
  output?: string;
  mode?: ReductionMode;
  match?: string;
  matchRegex?: string;
  exitCode?: number;
  oraclePath?: string;
  pluginOracle?: string;
  plugins?: string[];
  archivePath?: string;
  dockerfile?: boolean;
  githubIssue?: boolean;
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
  maxRuns?: number;
  remainingRuns?: number;
  progress?: number;
  etaMs?: number;
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
  cached?: boolean;
  dependencySnapshotReused?: boolean;
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
  invocationDirectory: string;
  detectedAdapters: string[];
  loadedPlugins: string[];
  baseline: FailureSignature;
  finalSignature: FailureSignature;
  originalMetrics: ProjectMetrics;
  finalMetrics: ProjectMetrics;
  attempts: ReductionAttempt[];
  candidateRuns: number;
  cacheHits: number;
  durationMs: number;
  securityFindings: SecurityFinding[];
  portabilityFindings: PortabilityFinding[];
  sharingArtifacts?: SharingArtifacts;
}

export interface SharingArtifacts {
  manifest: string;
  treeSha256: string;
  archive?: string;
  archiveSha256?: string;
  archiveBytes?: number;
  checksum?: string;
  dockerfile?: string;
  githubIssue?: string;
}

export interface VerificationResult {
  root: string;
  integrityVerified: boolean;
  failureVerified: boolean;
  installed: boolean;
  treeSha256: string;
  signature: FailureSignature;
}

export interface ResolvedOptions extends Required<
  Pick<
    ReductionOptions,
    | "cwd"
    | "root"
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
    | "plugins"
    | "dockerfile"
    | "githubIssue"
    | "allowInstallScripts"
    | "noInstall"
    | "outputMode"
    | "verbose"
  >
> {
  match?: string;
  matchRegex?: string;
  exitCode?: number;
  oraclePath?: string;
  pluginOracle?: string;
  archivePath?: string;
  installCommand?: string[];
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ReductionCursor {
  reducerIndex: number;
  reducerName?: string;
  generation: number;
  scheduleIds: string[];
  nextMutationIndex: number;
}

export interface RunState {
  schemaVersion: 4;
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
  cacheHits: number;
  cache: Record<string, CandidateCacheEntry>;
  generation: number;
  cursor: ReductionCursor;
  elapsedMs: number;
  originalMetrics?: ProjectMetrics;
  dependencySnapshot?: string;
  pluginFingerprint?: string;
  currentMetrics?: ProjectMetrics;
  outputDirectory?: string;
}

export interface CandidateCacheEntry {
  score: number;
  reason: string;
}

export type ConfigReducerName =
  "files" | "packageJson" | "dependencies" | "jsonConfig" | "source" | "tests";

export interface BugBonsaiConfig extends Omit<
  ReductionOptions,
  "cwd" | "command" | "signal" | "onProgress"
> {
  timeout?: string;
  reducers?: Partial<Record<ConfigReducerName, boolean>>;
  oracle?: {
    match?: string;
    matchRegex?: string;
    exitCode?: number;
    path?: string;
    plugin?: string;
  };
}

export interface CustomOracleContext {
  baseline: FailureSignature;
  result: CommandResult;
  signature: FailureSignature;
}

export type CustomOracleResult =
  | boolean
  | {
      matches: boolean;
      reason?: string;
      score?: number;
    };

export type CustomOracleFunction = (
  context: CustomOracleContext,
) => CustomOracleResult | Promise<CustomOracleResult>;
