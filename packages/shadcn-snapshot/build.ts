#!/usr/bin/env bun
/**
 * Builds packages/shadcn-snapshot/dist/{styles.css, manifest.json}.
 *
 * Run via `bun run build` from this package.
 *
 * Components are vendored manually following the patterns at
 * https://ui.shadcn.com/docs/components — each component file carries a
 * provenance comment. The shadcn snapshotVersion is recorded in package.json's
 * `snapshotVersion` field; bump it when re-syncing from upstream.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InterfaceDeclaration,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertySignature,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { COMPONENT_EXAMPLES } from "./src/examples.ts";
import type { ComponentDescriptor, ControlType, Manifest, PropDescriptor } from "./src/manifest.ts";
import { registry } from "./src/registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");
const componentsDir = join(here, "src", "components");

function categorize(
  filePath: string,
  id: string,
): {
  source: "shadcn" | "velloo";
  category: "ui" | "typography";
} {
  const rel = filePath.startsWith(componentsDir)
    ? filePath.slice(componentsDir.length).replace(/^\/+/, "")
    : filePath;
  if (rel.startsWith("velloo/")) {
    // Typography helpers are `Text` and `Heading`. Everything else
    // under `velloo/` (Icon, Placeholder, SVG, Image, Layer, Divider,
    // Gradient, …) is a UI primitive.
    const isTypography = id === "Text" || id === "Heading";
    return { source: "velloo", category: isTypography ? "typography" : "ui" };
  }
  return { source: "shadcn", category: "ui" };
}

/**
 * Pull the list of lucide icon names. We exec a tiny script under bun so
 * we get the same `lucide-react` install the snapshot will ship with —
 * no need to maintain a parallel list. Filters to PascalCase function
 * exports that aren't internal helpers.
 */
async function loadLucideIconNames(): Promise<string[]> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      "import * as L from 'lucide-react';" +
        " const skip = new Set(['LucideProvider', 'createLucideIcon', 'LucideIcon', 'Icon']);" +
        " const names = Object.keys(L).filter(k => /^[A-Z][A-Za-z0-9]*$/.test(k) && !k.endsWith('Icon') && !skip.has(k) && L[k]).sort();" +
        " console.log(JSON.stringify(names));",
    ],
    { stdout: "pipe", stderr: "pipe", cwd: here },
  );
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  if (exit !== 0) throw new Error("failed to enumerate lucide icons");
  const last = stdout.trim().split("\n").pop() ?? "[]";
  return JSON.parse(last) as string[];
}

const COLOR_NAME = /^(color|background|fg|bg|theme|fill|stroke|tint|accent)/i;

function inferControl(
  name: string,
  rawType: string,
): { control: ControlType; enumValues?: (string | number)[] } {
  const type = rawType.replace(/\s+/g, " ").trim();
  const stripped = type
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s !== "undefined" && s !== "null")
    .join(" | ");

  if (stripped === "boolean") return { control: "boolean" };
  if (stripped === "number") return { control: "number" };

  const numLit = stripped.split("|").map((s) => s.trim());
  if (numLit.length > 1 && numLit.every((s) => /^-?\d+(\.\d+)?$/.test(s))) {
    return { control: "enum", enumValues: numLit.map(Number) };
  }

  if (
    numLit.length > 1 &&
    numLit.every(
      (s) => (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")),
    )
  ) {
    return { control: "enum", enumValues: numLit.map((s) => s.slice(1, -1)) };
  }

  if (stripped === "string") {
    if (COLOR_NAME.test(name)) return { control: "color" };
    return { control: "string" };
  }

  return { control: "string" };
}

function describeProp(prop: PropertySignature): PropDescriptor {
  const name = prop.getName();
  const type = prop.getType().getText(prop).replace(/\s+/g, " ");
  const inferred = inferControl(name, type);
  return {
    name,
    type,
    optional: prop.hasQuestionToken(),
    control: inferred.control,
    ...(inferred.enumValues ? { enumValues: inferred.enumValues } : {}),
  };
}

/**
 * Walk the interface's `extends` clauses for `VariantProps<typeof X>` and
 * return X. Returns the const name we should look up in the same file.
 */
function findVariantPropsConstName(propsInterface: InterfaceDeclaration): string | null {
  for (const extendsClause of propsInterface.getExtends()) {
    const text = extendsClause.getText().replace(/\s+/g, "");
    const match = text.match(/^VariantProps<typeof(\w+)>$/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Given a const initialized to `cva("...", { variants: {...}, defaultVariants: {...} })`,
 * extract one PropDescriptor per variant key. Each descriptor's enumValues are
 * the variant's keys (e.g. variant: { default: "...", destructive: "..." } →
 * enum ["default", "destructive"]).
 */
function extractCvaVariantProps(sourceFile: SourceFile, constName: string): PropDescriptor[] {
  const variableDecl = sourceFile.getVariableDeclaration(constName);
  if (!variableDecl) return [];
  const init = variableDecl.getInitializer();
  if (!init || !Node.isCallExpression(init)) return [];

  // cva(base, { variants: {...}, defaultVariants: {...} })
  const args = init.getArguments();
  const config = args[1];
  if (!config || !Node.isObjectLiteralExpression(config)) return [];

  const variantsProp = config.getProperty("variants");
  if (!variantsProp || !Node.isPropertyAssignment(variantsProp)) return [];
  const variantsInit = variantsProp.getInitializer();
  if (!variantsInit || !Node.isObjectLiteralExpression(variantsInit)) return [];

  // Collect default values from defaultVariants if present.
  const defaults: Record<string, string> = {};
  const defaultsProp = config.getProperty("defaultVariants");
  if (defaultsProp && Node.isPropertyAssignment(defaultsProp)) {
    const dInit = defaultsProp.getInitializer();
    if (dInit && Node.isObjectLiteralExpression(dInit)) {
      for (const dp of dInit.getProperties()) {
        if (!Node.isPropertyAssignment(dp)) continue;
        const name = dp.getName();
        const value = dp.getInitializer();
        if (value && Node.isStringLiteral(value)) defaults[name] = value.getLiteralText();
      }
    }
  }

  const props: PropDescriptor[] = [];
  for (const prop of variantsInit.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    const valuesObj = prop.getInitializer();
    if (!valuesObj || !Node.isObjectLiteralExpression(valuesObj)) continue;
    const enumValues = collectKeys(valuesObj);
    if (enumValues.length === 0) continue;
    const typeStr = enumValues.map((v) => `"${v}"`).join(" | ");
    props.push({
      name,
      type: `${typeStr} | undefined`,
      optional: true,
      control: "enum",
      enumValues,
      ...(defaults[name] ? { defaultValue: defaults[name] } : {}),
    });
  }

  return props;
}

function collectKeys(obj: ObjectLiteralExpression): string[] {
  const out: string[] = [];
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      // Strip surrounding quotes if present (shouldn't typically happen for cva keys).
      out.push(name.replace(/^['"]|['"]$/g, ""));
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      out.push(prop.getName());
    }
  }
  return out;
}

async function buildManifest(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: join(here, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(`${componentsDir}/**/*.tsx`);

  const lucideNames = await loadLucideIconNames();
  const components: ComponentDescriptor[] = [];

  for (const id of Object.keys(registry).sort()) {
    // Word-bounded match so e.g. "Text" doesn't accidentally hit
    // "Textarea" in another file. Anchor on the identifier boundary.
    const identifierRe = new RegExp(`export\\s+(?:const|function)\\s+${id}\\b`);
    const srcFile = project.getSourceFiles().find((f) => identifierRe.test(f.getFullText()));
    if (!srcFile) {
      console.warn(`! manifest: no source file found for ${id}, skipping`);
      continue;
    }

    const { source, category } = categorize(srcFile.getFilePath(), id);
    const propsInterface = srcFile.getInterface(`${id}Props`);
    let props: PropDescriptor[] = [];

    if (propsInterface) {
      props = propsInterface.getProperties().map(describeProp);
      // Augment with variant props derived from `extends VariantProps<typeof X>`.
      const cvaConstName = findVariantPropsConstName(propsInterface);
      if (cvaConstName) {
        const cvaProps = extractCvaVariantProps(srcFile, cvaConstName);
        // Skip cva props whose names collide with explicit interface props.
        const explicitNames = new Set(props.map((p) => p.name));
        for (const cp of cvaProps) {
          if (!explicitNames.has(cp.name)) props.push(cp);
        }
      }
    } else {
      const propsAlias = srcFile.getTypeAlias(`${id}Props`);
      if (propsAlias) {
        const literal = propsAlias.getDescendantsOfKind(SyntaxKind.TypeLiteral)[0];
        if (literal) {
          props = literal.getProperties().map(describeProp);
        }
      }
    }

    // Icon.name is a free-form string at the type level, but we want the
    // inspector to surface a typeahead picker over the live lucide set.
    if (id === "Icon") {
      for (const p of props) {
        if (p.name === "name") {
          p.control = "icon";
          p.enumValues = lucideNames;
          if (!p.defaultValue) p.defaultValue = "Heart";
        }
      }
    }

    const example = COMPONENT_EXAMPLES[id];
    components.push({ id, category, source, props, ...(example ? { example } : {}) });
  }

  await mkdir(distDir, { recursive: true });
  const out = join(distDir, "manifest.json");
  await writeFile(out, `${JSON.stringify(components satisfies Manifest, null, 2)}\n`, "utf8");
  console.log(`✓ wrote ${out} (${components.length} components)`);
}

await buildManifest();
