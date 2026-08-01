import type { Mutation } from "./reducers.js";
import { sha256 } from "./utils.js";

export interface DdminOptions {
  maxGranularity: number;
}

function partition<T>(items: T[], parts: number): T[][] {
  const groups: T[][] = [];
  const size = Math.ceil(items.length / parts);
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function compoundMutation(mutations: Mutation[]): Mutation {
  const reducer = mutations[0]?.reducer ?? "ddmin";
  const identity = mutations.map((mutation) => mutation.id).join("\0");
  const affectedPaths = [
    ...new Set(mutations.flatMap((mutation) => mutation.affectedPaths)),
  ];
  return {
    id: `${reducer}:ddmin:${sha256(identity).slice(0, 12)}`,
    reducer,
    description: `remove a group of ${mutations.length} ${reducer} candidates`,
    estimatedImpact: mutations.reduce(
      (total, mutation) => total + mutation.estimatedImpact,
      0,
    ),
    affectedPaths,
    requiresInstall: mutations.some((mutation) => mutation.requiresInstall),
    apply: async (root) => {
      for (const mutation of mutations) await mutation.apply(root);
    },
  };
}

/**
 * Produces deterministic coarse-to-fine removal partitions followed by the
 * original single mutations. A productive engine pass rediscovers the current
 * candidate and starts coarse again, matching classic adaptive ddmin behavior.
 */
export function createDdminSchedule(
  mutations: Mutation[],
  options: DdminOptions,
): Mutation[] {
  if (mutations.length < 2 || options.maxGranularity < 2) return mutations;
  const groups: Mutation[] = [];
  const seen = new Set<string>();
  const maximum = Math.min(mutations.length, options.maxGranularity);
  for (let granularity = 2; granularity <= maximum; granularity *= 2) {
    for (const candidate of partition(mutations, granularity)) {
      if (candidate.length < 2) continue;
      const key = candidate.map((mutation) => mutation.id).join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push(compoundMutation(candidate));
    }
  }
  return [...groups, ...mutations];
}
