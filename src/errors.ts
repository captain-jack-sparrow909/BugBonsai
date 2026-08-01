export type BugBonsaiErrorCode =
  | "COMMAND_PASSED"
  | "UNSTABLE_BASELINE"
  | "INVALID_INPUT"
  | "SECURITY_BLOCKED"
  | "RUN_LIMIT"
  | "INTERRUPTED"
  | "INTERNAL";

export class BugBonsaiError extends Error {
  readonly code: BugBonsaiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BugBonsaiErrorCode,
    message: string,
    options?: ErrorOptions & { details?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = "BugBonsaiError";
    this.code = code;
    if (options?.details) this.details = options.details;
  }
}

export function exitCodeForError(error: unknown): number {
  if (!(error instanceof BugBonsaiError)) return 1;
  return {
    COMMAND_PASSED: 2,
    UNSTABLE_BASELINE: 3,
    SECURITY_BLOCKED: 4,
    RUN_LIMIT: 5,
    INVALID_INPUT: 6,
    INTERRUPTED: 130,
    INTERNAL: 1,
  }[error.code];
}
