export interface DogfoodCase {
  schemaVersion: 1;
  id: string;
  project: string;
  upstream: {
    repository: string;
    commit: string;
    license: string;
    issue?: string;
  };
  command: string[];
  match?: string;
  matchRegex?: string;
  timeoutMs?: number;
  maxRuns?: number;
  mode?: "fast" | "balanced" | "thorough";
  onlyReducers?: string[];
}

export function canonicalGitHubRepository(value: string): string {
  return value
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export function validateDogfoodCase(value: unknown): DogfoodCase {
  const candidate = value as Partial<DogfoodCase> | null;
  if (
    !candidate ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(candidate.id) ||
    typeof candidate.project !== "string" ||
    candidate.project.length === 0 ||
    !candidate.upstream ||
    typeof candidate.upstream.repository !== "string" ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
      candidate.upstream.repository,
    ) ||
    typeof candidate.upstream.commit !== "string" ||
    !/^[a-f0-9]{7,64}$/.test(candidate.upstream.commit) ||
    typeof candidate.upstream.license !== "string" ||
    candidate.upstream.license.length === 0 ||
    (candidate.upstream.issue !== undefined &&
      (typeof candidate.upstream.issue !== "string" ||
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+$/.test(
          candidate.upstream.issue,
        ))) ||
    !Array.isArray(candidate.command) ||
    candidate.command.length === 0 ||
    candidate.command.some(
      (part) => typeof part !== "string" || part.length === 0,
    ) ||
    (!candidate.match && !candidate.matchRegex)
  )
    throw new Error(
      "Invalid dogfood case: provide a slug ID, local project, pinned GitHub source and license, command, and failure matcher.",
    );
  if (
    candidate.timeoutMs !== undefined &&
    (!Number.isSafeInteger(candidate.timeoutMs) || candidate.timeoutMs < 1)
  )
    throw new Error("Dogfood timeoutMs must be a positive integer.");
  if (
    candidate.maxRuns !== undefined &&
    (!Number.isSafeInteger(candidate.maxRuns) || candidate.maxRuns < 1)
  )
    throw new Error("Dogfood maxRuns must be a positive integer.");
  return candidate as DogfoodCase;
}
