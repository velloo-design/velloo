import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Page, Variant } from "@velloo/schema";
import { diffFile, type FileDiff } from "../diff.ts";
import { type FormatError, formatTsx } from "../format.ts";
import { ImportSet } from "./imports.ts";
import { emitTree } from "./tree-to-jsx.ts";

export interface EmitCodeOptions {
  /** Required: which variant of the page to emit. */
  variantId: string;
  /** Absolute (or repo-relative) path to write to / diff against. */
  outputPath: string;
  /** Component import prefix; defaults to "@/components/ui". */
  componentsAlias?: string;
  /** Whether to actually write to disk. Default false → returns diff only. */
  apply?: boolean;
}

export interface EmitCodeResult {
  /** The final emitted file contents. */
  code: string;
  /** Diff against the existing file (if any). */
  diff: FileDiff;
  /** True if `apply: true` and the write succeeded. */
  applied: boolean;
  /** Format / lint / parse errors. Non-empty means the code did NOT get written. */
  errors: FormatError[];
}

export class VariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Variant not found: ${JSON.stringify(variantId)}`);
    this.name = "VariantNotFoundError";
  }
}

const DEFAULT_ALIAS = "@/components/ui";

export async function emitCode(page: Page, options: EmitCodeOptions): Promise<EmitCodeResult> {
  const variant = page.variants.find((v) => v.id === options.variantId);
  if (!variant) throw new VariantNotFoundError(options.variantId);

  const componentsAlias = options.componentsAlias ?? DEFAULT_ALIAS;
  const raw = renderFile(page, variant, componentsAlias);
  const { output, errors } = await formatTsx(options.outputPath, raw);
  const diff = await diffFile(options.outputPath, output);

  let applied = false;
  if (options.apply && errors.length === 0 && !diff.identical) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, output, "utf8");
    applied = true;
  }

  return { code: output, diff, applied, errors };
}

function renderFile(page: Page, variant: Variant, componentsAlias: string): string {
  const imports = new ImportSet();
  const ctx = { imports, componentsAlias, indent: (d: number) => "  ".repeat(d) };
  const body = emitTree(variant.tree, ctx);

  const componentName = `${pascal(page.name)}${pascal(variant.name)}`;
  const importBlock = imports.isEmpty() ? "" : `${imports.toCode(componentsAlias)}\n\n`;

  return `${importBlock}export default function ${componentName}() {
  return (
${indent(body, 2)}
  );
}
`;
}

function pascal(input: string): string {
  return (
    input
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Page"
  );
}

function indent(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}
