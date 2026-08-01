import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { createInventory } from "./sandbox.js";

const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const RESOLUTION_SUFFIXES = [
  "",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  "/index.js",
  "/index.mjs",
  "/index.cjs",
  "/index.jsx",
  "/index.ts",
  "/index.mts",
  "/index.cts",
  "/index.tsx",
];

interface AstNode {
  type: string;
  [key: string]: unknown;
}

export interface ImportGraph {
  sourceFiles: Set<string>;
  reachableFiles: Set<string>;
  packageImports: Set<string>;
  importsByFile: Map<string, string[]>;
}

function astNode(value: unknown): AstNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" ? (record as AstNode) : undefined;
}

function literalValue(value: unknown): string | undefined {
  const node = astNode(value);
  return node && typeof node.value === "string" ? node.value : undefined;
}

function collectSpecifiers(value: unknown, specifiers: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) collectSpecifiers(child, specifiers);
    return;
  }
  const node = astNode(value);
  if (!node) return;
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration"
  ) {
    const source = literalValue(node.source);
    if (source) specifiers.add(source);
  } else if (node.type === "ImportExpression") {
    const source = literalValue(node.source);
    if (source) specifiers.add(source);
  } else if (node.type === "CallExpression") {
    const callee = astNode(node.callee);
    const argumentsList = Array.isArray(node.arguments) ? node.arguments : [];
    if (callee?.type === "Identifier" && callee.name === "require") {
      const source = literalValue(argumentsList[0]);
      if (source) specifiers.add(source);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === "type") continue;
    collectSpecifiers(child, specifiers);
  }
}

function packageName(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function resolveProjectImport(
  importer: string,
  specifier: string,
  sourceFiles: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const clean = specifier.replace(/[?#].*$/, "");
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), clean),
  );
  if (base === ".." || base.startsWith("../")) return undefined;
  return RESOLUTION_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
    (candidate) => sourceFiles.has(candidate),
  );
}

export async function analyzeImportGraph(
  root: string,
  entryPaths: Iterable<string>,
): Promise<ImportGraph> {
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  const sourceFiles = new Set(
    inventory.files.filter((file) => SOURCE_PATTERN.test(file)),
  );
  const importsByFile = new Map<string, string[]>();
  const packageImports = new Set<string>();
  for (const relative of sourceFiles) {
    const source = await readFile(path.join(root, relative), "utf8");
    let parsed;
    try {
      parsed = parseSync(relative, source);
    } catch {
      continue;
    }
    if (parsed.errors.length > 0) continue;
    const specifiers = new Set<string>();
    collectSpecifiers(parsed.program, specifiers);
    const resolved: string[] = [];
    for (const specifier of specifiers) {
      const dependency = packageName(specifier);
      if (dependency) packageImports.add(dependency);
      const target = resolveProjectImport(relative, specifier, sourceFiles);
      if (target) resolved.push(target);
    }
    importsByFile.set(relative, [...new Set(resolved)].sort());
  }

  const reachableFiles = new Set<string>();
  const pending = [...entryPaths]
    .map((file) => file.replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter((file) => sourceFiles.has(file));
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachableFiles.has(current)) continue;
    reachableFiles.add(current);
    for (const imported of importsByFile.get(current) ?? []) {
      if (!reachableFiles.has(imported)) pending.push(imported);
    }
  }
  return { sourceFiles, reachableFiles, packageImports, importsByFile };
}
