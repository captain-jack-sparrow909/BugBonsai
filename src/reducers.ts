import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyEdits,
  modify,
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { AdapterMatch } from "./adapters.js";
import { analyzeImportGraph } from "./import-graph.js";
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
  entryPaths: Set<string>;
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
    const graph = await analyzeImportGraph(context.root, context.entryPaths);
    const priority = (file: string): number =>
      graph.sourceFiles.has(file) && !graph.reachableFiles.has(file)
        ? 1_000_000_000
        : 0;
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
        estimatedImpact:
          files.length * 10_000 +
          (files.every((file) => !graph.reachableFiles.has(file))
            ? 500_000_000
            : 0),
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
        estimatedImpact:
          priority(file) + (await stat(path.join(context.root, file))).size,
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
  const output = applyEdits(source, edits);
  const errors: ParseError[] = [];
  parseTree(output, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(
      `JSON edit introduced ${errors.length} parser error${errors.length === 1 ? "" : "s"}.`,
    );
  }
  await writeFile(file, output);
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
    const graph = await analyzeImportGraph(context.root, context.entryPaths);
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
            estimatedImpact: graph.packageImports.has(name) ? 1_000 : 1_000_000,
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
    return mutations.sort(
      (left, right) => right.estimatedImpact - left.estimatedImpact,
    );
  }
}

const JSON_CONFIG_PATTERN =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?|jsconfig|\.eslintrc|\.babelrc|jest\.config)\.jsonc?$/;

interface JsonRemoval {
  path: Array<string | number>;
  estimatedImpact: number;
  kind: "property" | "array element";
  range: { start: number; end: number };
}

function jsonListRemovalRange(
  source: string,
  parent: JsonNode,
  children: JsonNode[],
  index: number,
): { start: number; end: number } {
  const child = children[index]!;
  const next = children[index + 1];
  if (next) {
    const comma = source.indexOf(",", child.offset + child.length);
    if (comma >= 0 && comma < next.offset)
      return { start: child.offset, end: comma + 1 };
  }
  const previous = children[index - 1];
  if (previous) {
    const comma = source.lastIndexOf(",", child.offset);
    if (comma >= previous.offset + previous.length)
      return { start: comma, end: child.offset + child.length };
  }
  const trailingComma = source.indexOf(",", child.offset + child.length);
  return {
    start: child.offset,
    end:
      trailingComma >= 0 && trailingComma < parent.offset + parent.length
        ? trailingComma + 1
        : child.offset + child.length,
  };
}

function collectJsonRemovals(
  node: JsonNode,
  currentPath: Array<string | number>,
  removals: JsonRemoval[],
  maximumDepth: number,
  source: string,
): void {
  if (currentPath.length >= maximumDepth || removals.length >= 500) return;
  if (node.type === "object") {
    const properties = node.children ?? [];
    for (const [index, property] of properties.entries()) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      if (typeof keyNode?.value !== "string" || !valueNode) continue;
      const propertyPath = [...currentPath, keyNode.value];
      removals.push({
        path: propertyPath,
        estimatedImpact: property.length,
        kind: "property",
        range: jsonListRemovalRange(source, node, properties, index),
      });
      collectJsonRemovals(
        valueNode,
        propertyPath,
        removals,
        maximumDepth,
        source,
      );
    }
  } else if (node.type === "array") {
    const elements = node.children ?? [];
    for (const [index, child] of elements.entries()) {
      const elementPath = [...currentPath, index];
      removals.push({
        path: elementPath,
        estimatedImpact: child.length,
        kind: "array element",
        range: jsonListRemovalRange(source, node, elements, index),
      });
      collectJsonRemovals(child, elementPath, removals, maximumDepth, source);
    }
  }
}

function formatJsonPath(parts: Array<string | number>): string {
  return parts
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : `${index === 0 ? "" : "."}${part}`,
    )
    .join("");
}

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
      const errors: ParseError[] = [];
      const tree = parseTree(source, errors, { allowTrailingComma: true });
      if (!tree || errors.length > 0) continue;
      const removals: JsonRemoval[] = [];
      collectJsonRemovals(
        tree,
        [],
        removals,
        context.mode === "fast" ? 1 : context.mode === "balanced" ? 5 : 10,
        source,
      );
      for (const removal of removals) {
        const renderedPath = formatJsonPath(removal.path);
        const description = `remove ${relative} ${removal.kind} ${renderedPath}`;
        mutations.push({
          id: mutationId(this.name, description),
          reducer: this.name,
          description,
          estimatedImpact: removal.estimatedImpact,
          affectedPaths: [relative],
          requiresInstall: false,
          apply: async (root) => {
            const file = path.join(root, relative);
            const current = await readFile(file, "utf8");
            if (
              current.slice(removal.range.start, removal.range.end) !==
              source.slice(removal.range.start, removal.range.end)
            ) {
              throw new Error("JSON changed since mutation discovery.");
            }
            const editor = new MagicString(current);
            editor.remove(removal.range.start, removal.range.end);
            const output = editor.toString();
            const outputErrors: ParseError[] = [];
            parseTree(output, outputErrors, { allowTrailingComma: true });
            if (outputErrors.length > 0) {
              throw new Error(
                `JSON edit introduced ${outputErrors.length} parser error${outputErrors.length === 1 ? "" : "s"}.`,
              );
            }
            await writeFile(file, output);
          },
        });
      }
    }
    return mutations.sort(
      (left, right) => right.estimatedImpact - left.estimatedImpact,
    );
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

function parseProgram(relative: string, source: string): unknown | undefined {
  try {
    const parsed = parseSync(relative, source);
    return parsed.errors.length === 0 ? parsed.program : undefined;
  } catch {
    return undefined;
  }
}

function assertSourceParses(relative: string, source: string): void {
  const parsed = parseSync(relative, source);
  if (parsed.errors.length > 0) {
    throw new Error(
      `Source edit introduced ${parsed.errors.length} parser error${parsed.errors.length === 1 ? "" : "s"}.`,
    );
  }
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

interface AstRelation {
  parent?: AstNode;
  key?: string;
  index?: number;
  siblings?: AstNode[];
}

function walkAstRelations(
  value: unknown,
  visit: (node: AstNode, relation: AstRelation) => void,
  relation: AstRelation = {},
): void {
  const node = asAstNode(value);
  if (!node) return;
  visit(node, relation);
  for (const [key, child] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (Array.isArray(child)) {
      const siblings = child
        .map((entry) => asAstNode(entry))
        .filter((entry): entry is AstNode => Boolean(entry));
      for (const [index, sibling] of siblings.entries()) {
        walkAstRelations(sibling, visit, {
          parent: node,
          key,
          index,
          siblings,
        });
      }
    } else {
      walkAstRelations(child, visit, { parent: node, key });
    }
  }
}

function listRemovalRange(
  node: AstNode,
  relation: AstRelation,
): { start: number; end: number } | undefined {
  if (typeof node.start !== "number" || typeof node.end !== "number")
    return undefined;
  const siblings = relation.siblings;
  const index = relation.index;
  if (!siblings || index === undefined)
    return { start: node.start, end: node.end };
  const next = siblings[index + 1];
  if (next && typeof next.start === "number") {
    return { start: node.start, end: next.start };
  }
  const previous = siblings[index - 1];
  if (previous && typeof previous.end === "number") {
    return { start: previous.end, end: node.end };
  }
  return { start: node.start, end: node.end };
}

function sourceEditMutation(input: {
  reducer: string;
  relative: string;
  source: string;
  start: number;
  end: number;
  replacement?: string;
  description: string;
}): Mutation {
  const replacement = input.replacement ?? "";
  return {
    id: mutationId(
      input.reducer,
      `${input.relative}:${input.start}:${input.end}:${replacement}`,
    ),
    reducer: input.reducer,
    description: input.description,
    estimatedImpact: Math.max(1, input.end - input.start - replacement.length),
    affectedPaths: [input.relative],
    requiresInstall: false,
    apply: async (root) => {
      const file = path.join(root, input.relative);
      const current = await readFile(file, "utf8");
      if (
        current.slice(input.start, input.end) !==
        input.source.slice(input.start, input.end)
      ) {
        throw new Error("Source changed since mutation discovery.");
      }
      const editor = new MagicString(current);
      editor.overwrite(input.start, input.end, replacement);
      const output = editor.toString();
      assertSourceParses(input.relative, output);
      await writeFile(file, output);
    },
  };
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
      const program = parseProgram(relative, source);
      if (!program) continue;
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
            assertSourceParses(relative, output);
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
      const program = parseProgram(relative, source) as
        | {
            body?: Array<{ start?: number; end?: number; type?: string }>;
          }
        | undefined;
      if (!program) continue;
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
            assertSourceParses(relative, output);
            await writeFile(file, output);
          },
        });
      }
    }
    return mutations.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }
}

export class DeepSourceReducer implements Reducer {
  readonly name = "deep-source";

  async discover(context: ReducerContext): Promise<Mutation[]> {
    if (context.mode !== "thorough") return [];
    const inventory = await createInventory(context.root, {
      include: [],
      exclude: [],
      keep: [],
    });
    const mutations: Mutation[] = [];
    for (const relative of inventory.files.filter((file) =>
      SOURCE_PATTERN.test(file),
    )) {
      const source = await readFile(path.join(context.root, relative), "utf8");
      if (source.length > 500_000) continue;
      const program = parseProgram(relative, source);
      if (!program) continue;
      const seen = new Set<string>();
      const addCandidate = (
        range: { start: number; end: number },
        description: string,
        replacement = "",
      ): void => {
        if (range.end <= range.start) return;
        const identity = `${range.start}:${range.end}:${replacement}`;
        if (seen.has(identity)) return;
        seen.add(identity);
        mutations.push(
          sourceEditMutation({
            reducer: this.name,
            relative,
            source,
            start: range.start,
            end: range.end,
            replacement,
            description,
          }),
        );
      };
      walkAstRelations(program, (node, relation) => {
        if (node.type === "IfStatement") {
          const consequent = asAstNode(node.consequent);
          if (
            consequent &&
            typeof consequent.start === "number" &&
            typeof consequent.end === "number"
          ) {
            addCandidate(
              { start: consequent.start, end: consequent.end },
              `empty if consequent (${consequent.type}) in ${relative}`,
              "{}",
            );
            const alternate = asAstNode(node.alternate);
            if (
              alternate &&
              typeof alternate.end === "number" &&
              /\belse\b/.test(source.slice(consequent.end, alternate.end))
            ) {
              addCandidate(
                { start: consequent.end, end: alternate.end },
                `remove else branch (${alternate.type}) from ${relative}`,
              );
            }
          }
        } else if (node.type === "ConditionalExpression") {
          for (const branch of [node.consequent, node.alternate]) {
            const branchNode = asAstNode(branch);
            if (
              branchNode &&
              typeof branchNode.start === "number" &&
              typeof branchNode.end === "number"
            ) {
              addCandidate(
                { start: branchNode.start, end: branchNode.end },
                `replace conditional branch (${branchNode.type}) in ${relative}`,
                "undefined",
              );
            }
          }
        }

        const parentType = relation.parent?.type;
        const key = relation.key;
        let range: { start: number; end: number } | undefined;
        let kind: string | undefined;

        if (
          (parentType === "BlockStatement" && key === "body") ||
          (parentType === "ClassBody" && key === "body") ||
          (parentType === "SwitchStatement" && key === "cases")
        ) {
          range = listRemovalRange(node, {});
          kind =
            parentType === "BlockStatement"
              ? "block statement"
              : parentType === "ClassBody"
                ? "class member"
                : "switch case";
        } else if (
          (parentType === "ObjectExpression" && key === "properties") ||
          (parentType === "ArrayExpression" && key === "elements") ||
          (parentType === "JSXOpeningElement" && key === "attributes")
        ) {
          range = listRemovalRange(node, relation);
          kind =
            parentType === "ObjectExpression"
              ? "object member"
              : parentType === "ArrayExpression"
                ? "array element"
                : "JSX attribute";
        } else if (
          (parentType === "JSXElement" || parentType === "JSXFragment") &&
          key === "children"
        ) {
          range = listRemovalRange(node, {});
          kind = "JSX child";
        }

        if (!range || !kind) return;
        addCandidate(range, `remove ${kind} (${node.type}) from ${relative}`);
      });
    }
    return mutations.sort((left, right) =>
      right.estimatedImpact === left.estimatedImpact
        ? left.id.localeCompare(right.id)
        : right.estimatedImpact - left.estimatedImpact,
    );
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
    new DeepSourceReducer(),
  ];
}
