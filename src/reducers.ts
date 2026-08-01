import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { AdapterMatch } from "./adapters.js";
import { createInventory } from "./sandbox.js";
import { sha256 } from "./utils.js";

export interface Mutation {
  id: string;
  reducer: string;
  description: string;
  estimatedImpact: number;
  affectedPaths: string[];
  requiresInstall: boolean;
  apply(candidateRoot: string): Promise<void>;
}

export interface ReducerContext {
  root: string;
  command: string[];
  protectedPaths: Set<string>;
  mode: "fast" | "balanced" | "thorough";
  adapterMatches: AdapterMatch[];
}

export interface Reducer {
  name: string;
  discover(context: ReducerContext): Promise<Mutation[]>;
}

function mutationId(reducer: string, description: string): string {
  return `${reducer}:${sha256(description).slice(0, 12)}`;
}

export class FileTreeReducer implements Reducer {
  readonly name = "files";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    const candidates = inventory.files.filter(
      (file) => !context.protectedPaths.has(file),
    );
    const topLevelCounts = new Map<string, number>();
    for (const file of inventory.files) {
      const top = file.split("/")[0] ?? file;
      topLevelCounts.set(top, (topLevelCounts.get(top) ?? 0) + 1);
    }
    const topLevels = new Map<string, string[]>();
    for (const file of candidates) {
      const top = file.split("/")[0] ?? file;
      const group = topLevels.get(top) ?? [];
      group.push(file);
      topLevels.set(top, group);
    }
    const mutations: Mutation[] = [];
    for (const [top, files] of topLevels) {
      if (files.length < 2 || files.length !== topLevelCounts.get(top))
        continue;
      const description = `remove ${files.length} files under ${top}`;
      mutations.push({
        id: mutationId(this.name, description),
        reducer: this.name,
        description,
        estimatedImpact: files.length * 10_000,
        affectedPaths: files,
        requiresInstall: false,
        apply: async (root) => {
          await rm(path.join(root, top), { recursive: true, force: true });
        },
      });
    }
    for (const file of candidates) {
      const description = `remove ${file}`;
      mutations.push({
        id: mutationId(this.name, description),
        reducer: this.name,
        description,
        estimatedImpact: (await stat(path.join(context.root, file))).size,
        affectedPaths: [file],
        requiresInstall: false,
        apply: async (root) => {
          await rm(path.join(root, file), { force: true });
        },
      });
    }
    return mutations.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }
}

const MANIFEST_FIELDS = [
  "description",
  "keywords",
  "author",
  "contributors",
  "homepage",
  "bugs",
  "repository",
  "funding",
  "license",
  "engines",
  "publishConfig",
  "files",
];

async function editJsonProperty(
  file: string,
  propertyPath: Array<string | number>,
  value: unknown,
): Promise<void> {
  const source = await readFile(file, "utf8");
  const edits = modify(source, propertyPath, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    },
  });
  await writeFile(file, applyEdits(source, edits));
}

export class PackageJsonReducer implements Reducer {
  readonly name = "package-json";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    const mutations: Mutation[] = [];
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    for (const relative of inventory.files.filter(
      (file) => path.posix.basename(file) === "package.json",
    )) {
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(
          await readFile(path.join(context.root, relative), "utf8"),
        ) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const field of MANIFEST_FIELDS.filter((name) => name in manifest)) {
        const description = `remove ${relative} field ${field}`;
        mutations.push({
          id: mutationId(this.name, description),
          reducer: this.name,
          description,
          estimatedImpact: 500,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) =>
            editJsonProperty(path.join(root, relative), [field], undefined),
        });
      }
      const scripts =
        manifest.scripts && typeof manifest.scripts === "object"
          ? Object.keys(manifest.scripts)
          : [];
      const commandText = context.command.join(" ");
      for (const script of scripts.filter(
        (name) => !commandText.includes(name),
      )) {
        const description = `remove ${relative} script ${script}`;
        mutations.push({
          id: mutationId(this.name, description),
          reducer: this.name,
          description,
          estimatedImpact: 200,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) =>
            editJsonProperty(
              path.join(root, relative),
              ["scripts", script],
              undefined,
            ),
        });
      }
    }
    return mutations;
  }
}

export class DependencyReducer implements Reducer {
  readonly name = "dependencies";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    if (context.mode === "fast") return [];
    const mutations: Mutation[] = [];
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    for (const relative of inventory.files.filter(
      (file) => path.posix.basename(file) === "package.json",
    )) {
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(
          await readFile(path.join(context.root, relative), "utf8"),
        ) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const section of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ] as const) {
        const dependencies = manifest[section];
        if (!dependencies || typeof dependencies !== "object") continue;
        for (const name of Object.keys(dependencies)) {
          const description = `remove ${relative} ${section}.${name}`;
          mutations.push({
            id: mutationId(this.name, description),
            reducer: this.name,
            description,
            estimatedImpact: 1_000,
            affectedPaths: [relative],
            requiresInstall: true,
            apply: async (root) =>
              editJsonProperty(
                path.join(root, relative),
                [section, name],
                undefined,
              ),
          });
        }
      }
    }
    return mutations;
  }
}

const JSON_CONFIG_PATTERN =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?|jsconfig|\.eslintrc|\.babelrc|jest\.config)\.jsonc?$/;

export class JsonConfigReducer implements Reducer {
  readonly name = "json-config";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    const mutations: Mutation[] = [];
    for (const relative of inventory.files.filter((file) =>
      JSON_CONFIG_PATTERN.test(file),
    )) {
      const source = await readFile(path.join(context.root, relative), "utf8");
      const data = parseJsonc(source) as Record<string, unknown> | undefined;
      if (!data || typeof data !== "object") continue;
      for (const field of Object.keys(data)) {
        const description = `remove ${relative} field ${field}`;
        mutations.push({
          id: mutationId(this.name, description),
          reducer: this.name,
          description,
          estimatedImpact: 300,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) =>
            editJsonProperty(path.join(root, relative), [field], undefined),
        });
      }
    }
    return mutations;
  }
}

const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/;

interface AstNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

function asAstNode(value: unknown): AstNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" ? (record as AstNode) : undefined;
}

function walkAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walkAst(child, visit);
    return;
  }
  const node = asAstNode(value);
  if (!node) return;
  visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walkAst(child, visit);
  }
}

function callRootName(value: unknown): string | undefined {
  const node = asAstNode(value);
  if (!node) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type === "CallExpression") return callRootName(node.callee);
  if (
    node.type === "MemberExpression" ||
    node.type === "StaticMemberExpression" ||
    node.type === "ComputedMemberExpression"
  ) {
    return callRootName(node.object);
  }
  if (node.type === "ChainExpression") return callRootName(node.expression);
  return undefined;
}

export class TestStructureReducer implements Reducer {
  readonly name = "test-structure";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    if (context.mode === "fast") return [];
    const adapterNames = new Set(
      context.adapterMatches.flatMap((adapter) => adapter.testCallNames),
    );
    const defaultNames = [
      "describe",
      "suite",
      "test",
      "it",
      "beforeAll",
      "beforeEach",
      "afterAll",
      "afterEach",
    ];
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    const mutations: Mutation[] = [];
    for (const relative of inventory.files.filter((file) =>
      SOURCE_PATTERN.test(file),
    )) {
      if (adapterNames.size === 0 && !TEST_FILE_PATTERN.test(relative))
        continue;
      const callNames =
        adapterNames.size > 0 ? adapterNames : new Set(defaultNames);
      const absolute = path.join(context.root, relative);
      const source = await readFile(absolute, "utf8");
      if (source.length > 500_000) continue;
      let program: unknown;
      try {
        program = parseSync(relative, source).program;
      } catch {
        continue;
      }
      const spans = new Set<string>();
      walkAst(program, (node) => {
        if (node.type !== "ExpressionStatement") return;
        const rootName = callRootName(node.expression);
        if (!rootName || !callNames.has(rootName)) return;
        if (
          typeof node.start !== "number" ||
          typeof node.end !== "number" ||
          node.end <= node.start
        ) {
          return;
        }
        const { start, end } = node;
        const span = `${start}:${end}`;
        if (spans.has(span)) return;
        spans.add(span);
        const description = `remove ${rootName} block from ${relative}`;
        mutations.push({
          id: mutationId(this.name, `${relative}:${span}:${rootName}`),
          reducer: this.name,
          description,
          estimatedImpact: end - start,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) => {
            const file = path.join(root, relative);
            const current = await readFile(file, "utf8");
            if (current.slice(start, end) !== source.slice(start, end)) {
              throw new Error("Source changed since mutation discovery.");
            }
            const editor = new MagicString(current);
            editor.remove(start, end);
            const output = editor.toString();
            parseSync(relative, output);
            await writeFile(file, output);
          },
        });
      });
    }
    return mutations.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }
}

export class SourceReducer implements Reducer {
  readonly name = "source";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    if (context.mode === "fast") return [];
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    const mutations: Mutation[] = [];
    for (const relative of inventory.files.filter((file) =>
      SOURCE_PATTERN.test(file),
    )) {
      const absolute = path.join(context.root, relative);
      const source = await readFile(absolute, "utf8");
      if (source.length > 500_000) continue;
      let program: {
        body?: Array<{ start?: number; end?: number; type?: string }>;
      };
      try {
        program = parseSync(relative, source).program as typeof program;
      } catch {
        continue;
      }
      for (const [index, node] of (program.body ?? []).entries()) {
        if (
          typeof node.start !== "number" ||
          typeof node.end !== "number" ||
          node.end <= node.start
        )
          continue;
        if (source.startsWith("#!") && node.start === 0) continue;
        const start = node.start;
        const end = node.end;
        const description = `remove ${node.type ?? "statement"} ${index + 1} from ${relative}`;
        mutations.push({
          id: mutationId(this.name, `${description}:${start}:${end}`),
          reducer: this.name,
          description,
          estimatedImpact: end - start,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) => {
            const file = path.join(root, relative);
            const current = await readFile(file, "utf8");
            if (current.slice(start, end) !== source.slice(start, end))
              throw new Error("Source changed since mutation discovery.");
            const editor = new MagicString(current);
            editor.remove(start, end);
            const output = editor.toString();
            parseSync(relative, output);
            await writeFile(file, output);
          },
        });
      }
    }
    return mutations.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }
}

export function defaultReducers(): Reducer[] {
  return [
    new FileTreeReducer(),
    new PackageJsonReducer(),
    new JsonConfigReducer(),
    new DependencyReducer(),
    new TestStructureReducer(),
    new SourceReducer(),
  ];
}
