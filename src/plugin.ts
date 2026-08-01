import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AdapterContext,
  AdapterMatch,
  FrameworkAdapter,
} from "./adapters.js";
import { BugBonsaiError } from "./errors.js";
import type {
  PackageManagerInfo,
  PackageManagerProvider,
} from "./package-manager.js";
import type { Mutation, Reducer, ReducerContext } from "./reducers.js";
import type { CustomOracleFunction } from "./types.js";
import { sha256 } from "./utils.js";

export const BUGBONSAI_PLUGIN_API_VERSION = 1 as const;

export type PluginMutation = Omit<Mutation, "reducer">;

export interface PluginReducer {
  readonly name: string;
  discover(context: ReducerContext): Promise<PluginMutation[]>;
}

export interface PluginFrameworkAdapter {
  readonly name: string;
  detect(context: AdapterContext): Promise<AdapterMatch | undefined>;
}

export interface BugBonsaiPlugin {
  readonly apiVersion: typeof BUGBONSAI_PLUGIN_API_VERSION;
  readonly name: string;
  readonly reducers?: PluginReducer[];
  readonly adapters?: PluginFrameworkAdapter[];
  readonly packageManagers?: PackageManagerProvider[];
  readonly oracles?: Record<string, CustomOracleFunction>;
}

export interface LoadedPlugins {
  reducers: Reducer[];
  adapters: FrameworkAdapter[];
  packageManagers: PackageManagerProvider[];
  oracles: Map<string, CustomOracleFunction>;
  sourceFiles: string[];
  fingerprint: string;
  names: string[];
}

function pluginError(message: string, cause?: unknown): BugBonsaiError {
  return new BugBonsaiError(
    "INVALID_INPUT",
    `Plugin error: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validName(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw pluginError(
      `${label} must use letters, numbers, dots, dashes, or underscores.`,
    );
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw pluginError(`${label} must be an array of strings.`);
  return value;
}

function wrapReducer(pluginName: string, value: unknown): Reducer {
  const candidate = record(value);
  validName(candidate?.name, `Reducer name in ${pluginName}`);
  if (typeof candidate?.discover !== "function")
    throw pluginError(
      `Reducer ${pluginName}/${candidate?.name} needs discover().`,
    );
  const name = `${pluginName}/${candidate.name}`;
  return {
    name,
    discover: async (context) => {
      let discovered: PluginMutation[];
      try {
        discovered = await (candidate.discover as PluginReducer["discover"])(
          context,
        );
      } catch (error) {
        throw pluginError(
          `Reducer ${name} discover() failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
      if (!Array.isArray(discovered))
        throw pluginError(`Reducer ${name} discover() must return an array.`);
      const mutationIds = new Set<string>();
      return discovered.map((mutation, index) => {
        const item = record(mutation);
        if (!item)
          throw pluginError(
            `Reducer ${name} mutation ${index} must be an object.`,
          );
        validName(item.id, `Reducer ${name} mutation ID`);
        if (mutationIds.has(item.id))
          throw pluginError(
            `Reducer ${name} returned duplicate mutation ID ${item.id}.`,
          );
        mutationIds.add(item.id);
        if (
          typeof item.description !== "string" ||
          item.description.length === 0
        )
          throw pluginError(
            `Reducer ${name} mutation ${item.id} needs a description.`,
          );
        if (
          !Number.isFinite(item.estimatedImpact) ||
          Number(item.estimatedImpact) < 0
        )
          throw pluginError(
            `Reducer ${name} mutation ${item.id} has invalid estimatedImpact.`,
          );
        if (typeof item.requiresInstall !== "boolean")
          throw pluginError(
            `Reducer ${name} mutation ${item.id} needs requiresInstall.`,
          );
        if (typeof item.apply !== "function")
          throw pluginError(
            `Reducer ${name} mutation ${item.id} needs apply().`,
          );
        const affectedPaths = stringArray(
          item.affectedPaths,
          `Reducer ${name} mutation ${item.id} affectedPaths`,
        );
        if (
          affectedPaths.some(
            (file) =>
              path.isAbsolute(file) ||
              file.replaceAll("\\", "/").split("/").includes(".."),
          )
        ) {
          throw pluginError(
            `Reducer ${name} mutation ${item.id} affectedPaths must stay relative to the candidate root.`,
          );
        }
        return {
          id: `${name}:${item.id}`,
          reducer: name,
          description: item.description,
          estimatedImpact: Number(item.estimatedImpact),
          affectedPaths,
          requiresInstall: item.requiresInstall,
          apply: item.apply as Mutation["apply"],
        };
      });
    },
  };
}

function validateAdapterMatch(name: string, value: AdapterMatch): AdapterMatch {
  const match = record(value);
  if (
    !match ||
    !["command", "dependency", "configuration"].includes(
      String(match.confidence),
    )
  )
    throw pluginError(`Adapter ${name} returned an invalid confidence.`);
  const protectedPaths = stringArray(
    match.protectedPaths,
    `Adapter ${name} protectedPaths`,
  );
  const relevantConfig = stringArray(
    match.relevantConfig,
    `Adapter ${name} relevantConfig`,
  );
  if (
    [...protectedPaths, ...relevantConfig].some(
      (file) =>
        path.isAbsolute(file) ||
        file.replaceAll("\\", "/").split("/").includes(".."),
    )
  ) {
    throw pluginError(
      `Adapter ${name} paths must stay relative to the project root.`,
    );
  }
  return {
    name,
    confidence: match.confidence as AdapterMatch["confidence"],
    evidence: stringArray(match.evidence, `Adapter ${name} evidence`),
    protectedPaths,
    relevantConfig,
    testCallNames: stringArray(
      match.testCallNames,
      `Adapter ${name} testCallNames`,
    ),
  };
}

function wrapAdapter(pluginName: string, value: unknown): FrameworkAdapter {
  const candidate = record(value);
  validName(candidate?.name, `Adapter name in ${pluginName}`);
  if (typeof candidate?.detect !== "function")
    throw pluginError(
      `Adapter ${pluginName}/${candidate?.name} needs detect().`,
    );
  const name = `${pluginName}/${candidate.name}`;
  return {
    name,
    detect: async (context) => {
      let match: AdapterMatch | undefined;
      try {
        match = await (candidate.detect as PluginFrameworkAdapter["detect"])(
          context,
        );
      } catch (error) {
        throw pluginError(
          `Adapter ${name} detect() failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
      return match ? validateAdapterMatch(name, match) : undefined;
    },
  };
}

function wrapPackageManager(
  pluginName: string,
  value: unknown,
): PackageManagerProvider {
  const candidate = record(value);
  validName(candidate?.name, `Package-manager provider name in ${pluginName}`);
  if (typeof candidate?.detect !== "function")
    throw pluginError(
      `Package-manager provider ${pluginName}/${candidate?.name} needs detect().`,
    );
  return {
    name: `${pluginName}/${candidate.name}`,
    detect: candidate.detect as PackageManagerProvider["detect"],
  };
}

async function resolvePlugin(
  specifier: string,
  cwd: string,
): Promise<{ file: string; source: Buffer }> {
  try {
    const local =
      path.isAbsolute(specifier) ||
      specifier.startsWith("./") ||
      specifier.startsWith("../");
    const file = local
      ? path.resolve(cwd, specifier)
      : createRequire(path.join(cwd, "package.json")).resolve(specifier);
    return { file, source: await readFile(file) };
  } catch (error) {
    throw pluginError(`Unable to resolve ${specifier} from ${cwd}.`, error);
  }
}

export async function loadPlugins(
  specifiers: string[],
  cwd: string,
): Promise<LoadedPlugins> {
  const reducers: Reducer[] = [];
  const adapters: FrameworkAdapter[] = [];
  const packageManagers: PackageManagerProvider[] = [];
  const oracles = new Map<string, CustomOracleFunction>();
  const sourceFiles: string[] = [];
  const fingerprints: string[] = [];
  const names = new Set<string>();

  for (const specifier of specifiers) {
    const resolved = await resolvePlugin(specifier, cwd);
    const sourceHash = sha256(resolved.source);
    let imported: Record<string, unknown>;
    try {
      imported = (await import(
        `${pathToFileURL(resolved.file).href}?bugbonsai=${sourceHash.slice(0, 16)}`
      )) as Record<string, unknown>;
    } catch (error) {
      throw pluginError(`Unable to load ${specifier}.`, error);
    }
    const plugin = record(imported.default ?? imported.plugin);
    if (!plugin) throw pluginError(`${specifier} must export a plugin object.`);
    if (plugin.apiVersion !== BUGBONSAI_PLUGIN_API_VERSION)
      throw pluginError(
        `${specifier} targets API ${String(plugin.apiVersion)}; BugBonsai supports API ${BUGBONSAI_PLUGIN_API_VERSION}.`,
      );
    validName(plugin.name, `Plugin name in ${specifier}`);
    const pluginName = plugin.name;
    if (names.has(pluginName))
      throw pluginError(`Plugin name ${pluginName} was loaded more than once.`);
    names.add(pluginName);
    sourceFiles.push(resolved.file);
    fingerprints.push(`${specifier}\0${resolved.file}\0${sourceHash}`);

    if (plugin.reducers !== undefined) {
      if (!Array.isArray(plugin.reducers))
        throw pluginError(`Plugin ${pluginName} reducers must be an array.`);
      reducers.push(
        ...plugin.reducers.map((reducer) => wrapReducer(pluginName, reducer)),
      );
    }
    if (plugin.adapters !== undefined) {
      if (!Array.isArray(plugin.adapters))
        throw pluginError(`Plugin ${pluginName} adapters must be an array.`);
      adapters.push(
        ...plugin.adapters.map((adapter) => wrapAdapter(pluginName, adapter)),
      );
    }
    if (plugin.packageManagers !== undefined) {
      if (!Array.isArray(plugin.packageManagers))
        throw pluginError(
          `Plugin ${pluginName} packageManagers must be an array.`,
        );
      packageManagers.push(
        ...plugin.packageManagers.map((provider) =>
          wrapPackageManager(pluginName, provider),
        ),
      );
    }
    if (plugin.oracles !== undefined) {
      const values = record(plugin.oracles);
      if (!values)
        throw pluginError(`Plugin ${pluginName} oracles must be an object.`);
      for (const [oracleName, oracle] of Object.entries(values)) {
        validName(oracleName, `Oracle name in ${pluginName}`);
        if (typeof oracle !== "function")
          throw pluginError(
            `Oracle ${pluginName}/${oracleName} must be a function.`,
          );
        oracles.set(
          `${pluginName}/${oracleName}`,
          oracle as CustomOracleFunction,
        );
      }
    }
  }

  for (const [label, components] of [
    ["reducer", reducers],
    ["adapter", adapters],
    ["package-manager provider", packageManagers],
  ] as const) {
    const componentNames = new Set<string>();
    for (const component of components) {
      if (componentNames.has(component.name))
        throw pluginError(`Duplicate ${label} name ${component.name}.`);
      componentNames.add(component.name);
    }
  }

  return {
    reducers,
    adapters,
    packageManagers,
    oracles,
    sourceFiles,
    fingerprint: sha256(fingerprints.sort().join("\n")),
    names: [...names],
  };
}

export function definePlugin(plugin: BugBonsaiPlugin): BugBonsaiPlugin {
  return plugin;
}

export type { PackageManagerInfo, ReducerContext };
