import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInventory } from "./sandbox.js";
import { pathExists } from "./utils.js";

export interface AdapterContext {
  root: string;
  invocationDirectory: string;
  command: string[];
}

export interface AdapterMatch {
  name: string;
  confidence: "command" | "dependency" | "configuration";
  evidence: string[];
  protectedPaths: string[];
  relevantConfig: string[];
  testCallNames: string[];
}

export interface FrameworkAdapter {
  readonly name: string;
  detect(context: AdapterContext): Promise<AdapterMatch | undefined>;
}

interface ProjectEvidence {
  dependencies: Set<string>;
  files: string[];
  commandText: string;
}

async function readDependencies(
  root: string,
  invocation: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const directory of new Set([root, path.join(root, invocation)])) {
    const file = path.join(directory, "package.json");
    if (!(await pathExists(file))) continue;
    try {
      const manifest = JSON.parse(await readFile(file, "utf8")) as Record<
        string,
        unknown
      >;
      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
      ]) {
        const entries = manifest[section];
        if (entries && typeof entries === "object") {
          for (const name of Object.keys(entries)) names.add(name);
        }
      }
    } catch {
      // The failing command will provide the authoritative malformed-manifest error.
    }
  }
  return names;
}

async function gatherEvidence(
  context: AdapterContext,
): Promise<ProjectEvidence> {
  const inventory = await createInventory(context.root, {
    include: [],
    exclude: [],
    keep: [],
  });
  return {
    dependencies: await readDependencies(
      context.root,
      context.invocationDirectory,
    ),
    files: inventory.files,
    commandText: context.command.join(" "),
  };
}

abstract class EvidenceAdapter implements FrameworkAdapter {
  abstract readonly name: string;
  abstract readonly commands: RegExp;
  abstract readonly dependencies: string[];
  abstract readonly configs: RegExp;
  readonly testCallNames: string[] = [];

  async detect(context: AdapterContext): Promise<AdapterMatch | undefined> {
    return this.detectEvidence(await gatherEvidence(context));
  }

  detectEvidence(evidence: ProjectEvidence): AdapterMatch | undefined {
    const commandMatched = this.commands.test(evidence.commandText);
    this.commands.lastIndex = 0;
    const dependencyMatches = this.dependencies.filter((name) =>
      evidence.dependencies.has(name),
    );
    const configMatches = evidence.files.filter((file) =>
      this.configs.test(file),
    );
    this.configs.lastIndex = 0;
    if (
      !commandMatched &&
      dependencyMatches.length === 0 &&
      configMatches.length === 0
    ) {
      return undefined;
    }
    return {
      name: this.name,
      confidence: commandMatched
        ? "command"
        : dependencyMatches.length > 0
          ? "dependency"
          : "configuration",
      evidence: [
        ...(commandMatched ? [`command: ${evidence.commandText}`] : []),
        ...dependencyMatches.map((name) => `dependency: ${name}`),
        ...configMatches.map((file) => `config: ${file}`),
      ],
      protectedPaths: [],
      relevantConfig: configMatches,
      testCallNames: [...this.testCallNames],
    };
  }
}

class TypeScriptAdapter extends EvidenceAdapter {
  readonly name = "typescript";
  readonly commands = /(?:^|\s)(?:npx\s+|pnpm\s+exec\s+)?tsc(?:\s|$)|typecheck/;
  readonly dependencies = ["typescript"];
  readonly configs = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/;
}

class VitestAdapter extends EvidenceAdapter {
  readonly name = "vitest";
  readonly commands = /(?:^|\s)vitest(?:\s|$)/;
  readonly dependencies = ["vitest"];
  readonly configs = /(?:^|\/)vitest\.config\.[cm]?[jt]s$/;
  override readonly testCallNames = [
    "describe",
    "suite",
    "test",
    "it",
    "beforeAll",
    "beforeEach",
    "afterAll",
    "afterEach",
  ];
}

class JestAdapter extends EvidenceAdapter {
  readonly name = "jest";
  readonly commands = /(?:^|\s)jest(?:\s|$)/;
  readonly dependencies = ["jest", "@jest/core"];
  readonly configs =
    /(?:^|\/)jest\.config\.[cm]?[jt]s$|(?:^|\/)jest\.config\.json$/;
  override readonly testCallNames = [
    "describe",
    "test",
    "it",
    "beforeAll",
    "beforeEach",
    "afterAll",
    "afterEach",
  ];
}

class ViteAdapter extends EvidenceAdapter {
  readonly name = "vite";
  readonly commands = /(?:^|\s)vite(?:\s|$)/;
  readonly dependencies = ["vite"];
  readonly configs = /(?:^|\/)vite\.config\.[cm]?[jt]s$/;
}

class NextAdapter extends EvidenceAdapter {
  readonly name = "next";
  readonly commands = /(?:^|\s)next\s+(?:build|dev|start)(?:\s|$)/;
  readonly dependencies = ["next"];
  readonly configs = /(?:^|\/)next\.config\.[cm]?[jt]s$/;
}

export function defaultAdapters(): FrameworkAdapter[] {
  return [
    new TypeScriptAdapter(),
    new VitestAdapter(),
    new JestAdapter(),
    new ViteAdapter(),
    new NextAdapter(),
  ];
}

export async function detectAdapters(
  context: AdapterContext,
): Promise<AdapterMatch[]> {
  const evidence = await gatherEvidence(context);
  const matches = defaultAdapters().map((adapter) =>
    adapter instanceof EvidenceAdapter
      ? adapter.detectEvidence(evidence)
      : undefined,
  );
  return matches.filter((match): match is AdapterMatch => Boolean(match));
}
