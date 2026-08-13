import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { $, DoAsync, type Result } from "@velloo/result";
import {
  isComponentNode,
  isSnippetInstance,
  type Node,
  type Screen,
  type Snippet,
} from "@velloo/schema";
import { diffFile, type FileDiff } from "../diff.ts";
import type { CodegenError } from "../errors.ts";
import { type FormatError, formatTsx } from "../format.ts";
import { ImportSet } from "./imports.ts";
import { emitTree } from "./tree-to-jsx.ts";

export interface EmitCodeOptions {
  /** Absolute (or repo-relative) path to write to / diff against. */
  outputPath: string;
  componentsAlias?: string;
  snippetsAlias?: string;
  snippets?: Map<string, Snippet>;
  apply?: boolean;
}

export interface EmitCodeResult {
  code: string;
  diff: FileDiff;
  applied: boolean;
  errors: FormatError[];
}

const DEFAULT_ALIAS = "@/components/ui";

function pascal(input: string): string {
  return (
    input
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Screen"
  );
}

function indent(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

function buildSnippetPascalMap(snippets: Map<string, Snippet> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!snippets) return out;
  for (const [id, snippet] of snippets) out.set(id, pascal(snippet.name || id));
  return out;
}

export async function emitCode(
  screen: Screen,
  options: EmitCodeOptions,
): Promise<Result<EmitCodeResult, CodegenError>> {
  const componentsAlias = options.componentsAlias ?? DEFAULT_ALIAS;
  return DoAsync<EmitCodeResult, CodegenError>(async function* () {
    const raw = yield* $(renderScreenFile(screen, componentsAlias, options));
    const { output, errors } = await formatTsx(options.outputPath, raw);
    const diff = await diffFile(options.outputPath, output);

    let applied = false;
    if (options.apply && errors.length === 0 && !diff.identical) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, output, "utf8");
      applied = true;
    }

    return { code: output, diff, applied, errors };
  });
}

function renderScreenFile(
  screen: Screen,
  componentsAlias: string,
  options: EmitCodeOptions,
): Result<string, CodegenError> {
  const imports = new ImportSet();
  const snippetPascalById = buildSnippetPascalMap(options.snippets);
  const ctx = {
    imports,
    componentsAlias,
    snippetsAlias: options.snippetsAlias,
    snippetPascalById,
    indent: (d: number) => "  ".repeat(d),
  };
  const bodyR = emitTree(screen.tree, ctx);
  if (!bodyR.ok) return bodyR;

  const componentName = pascal(screen.name);
  const importBlock = imports.isEmpty() ? "" : `${imports.toCode(componentsAlias)}\n\n`;

  return {
    ok: true,
    value: `${importBlock}export default function ${componentName}() {
  return (
${indent(bodyR.value, 2)}
  );
}
`,
  };
}

// --- Snippet emission ----------------------------------------------------

export interface EmitSnippetOptions {
  outputPath: string;
  componentsAlias?: string;
  snippetsAlias?: string;
  snippets?: Map<string, Snippet>;
  apply?: boolean;
}

export async function emitSnippet(
  snippet: Snippet,
  options: EmitSnippetOptions,
): Promise<Result<EmitCodeResult, CodegenError>> {
  const componentsAlias = options.componentsAlias ?? DEFAULT_ALIAS;
  return DoAsync<EmitCodeResult, CodegenError>(async function* () {
    const raw = yield* $(renderSnippetFile(snippet, componentsAlias, options));
    const { output, errors } = await formatTsx(options.outputPath, raw);
    const diff = await diffFile(options.outputPath, output);

    let applied = false;
    if (options.apply && errors.length === 0 && !diff.identical) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, output, "utf8");
      applied = true;
    }

    return { code: output, diff, applied, errors };
  });
}

function renderSnippetFile(
  snippet: Snippet,
  componentsAlias: string,
  options: EmitSnippetOptions,
): Result<string, CodegenError> {
  const imports = new ImportSet();
  const componentName = pascal(snippet.name || snippet.id);
  const paramNames = new Set(snippet.params.map((p) => p.name));
  const snippetPascalById = buildSnippetPascalMap(options.snippets);
  const injectClassNameAtRoot = { varName: "className", used: false };
  const ctx = {
    imports,
    componentsAlias,
    snippetsAlias: options.snippetsAlias,
    snippetPascalById,
    snippetParamNames: paramNames,
    injectClassNameAtRoot,
    indent: (d: number) => "  ".repeat(d),
  };
  const bodyR = emitTree(snippet.tree, ctx);
  if (!bodyR.ok) return bodyR;

  const propLines = snippet.params.map((p) => `  ${p.name}: ${tsTypeFor(p.type)};`);
  propLines.push("  className?: string;");
  const propsType = propLines.join("\n");
  const destructuredNames = [...snippet.params.map((p) => p.name), "className"];
  const destructured = `{ ${destructuredNames.join(", ")} }`;
  const propsAnnotation = `: ${componentName}Props`;
  const importBlock = imports.isEmpty() ? "" : `${imports.toCode(componentsAlias)}\n\n`;
  const interfaceBlock = `export interface ${componentName}Props {\n${propsType}\n}\n\n`;

  return {
    ok: true,
    value: `${importBlock}${interfaceBlock}export function ${componentName}(${destructured}${propsAnnotation}) {
  return (
${indent(bodyR.value, 2)}
  );
}
`,
  };
}

function tsTypeFor(t: import("@velloo/schema").SnippetParam["type"]): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "node":
      return "React.ReactNode";
  }
}

/** Walk a screen tree and collect snippet ids referenced. */
export function snippetIdsReferenced(screen: Screen): Set<string> {
  const out = new Set<string>();
  walk(screen.tree, out);
  return out;
}

function walk(node: Node, out: Set<string>): void {
  if (isSnippetInstance(node)) {
    out.add(node.$snippet);
    return;
  }
  if (isComponentNode(node) && node.children) {
    for (const child of node.children) walk(child, out);
  }
}
