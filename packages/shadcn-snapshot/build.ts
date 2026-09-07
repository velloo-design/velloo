#!/usr/bin/env bun
/**
 * Builds packages/shadcn-snapshot/dist/manifest.json.
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
import { HELPER_DESCRIPTORS, ICON_ALIASES } from "@velloo/helpers";
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

/**
 * Pull the list of lucide icon names from the helpers' generated icon data
 * (the same data the Icon component resolves against, so no drift). Filters
 * to the PascalCase names lucide-react itself exports — the alias map also
 * carries kebab-case ids and Icon-suffixed variants, which the manifest's
 * enum never listed.
 */
function loadLucideIconNames(): string[] {
  return Object.keys(ICON_ALIASES)
    .filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !k.endsWith("Icon"))
    .sort();
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

const VARIANT_PROPS_RE = /^VariantProps<typeof(\w+)>$/;

/**
 * Props from an upstream-shaped component, which annotates its parameter
 * inline rather than declaring a `<Name>Props` interface:
 *
 *   function Button({ … }: React.ComponentProps<"button"> &
 *     VariantProps<typeof buttonVariants> & { asChild?: boolean }) {}
 *
 * Only the two authored parts are interesting: the `VariantProps` reference
 * (expanded from the cva table) and any inline object members. The
 * `ComponentProps<…>` arm is the whole DOM/Radix surface, which the manifest
 * has never enumerated — the inspector shows authored props, not every
 * attribute React would accept.
 */
function extractInlinePropTypes(typeNode: Node, sourceFile: SourceFile): PropDescriptor[] {
  const arms = Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
  const props: PropDescriptor[] = [];
  const seen = new Set<string>();

  const push = (descriptor: PropDescriptor): void => {
    if (seen.has(descriptor.name)) return;
    seen.add(descriptor.name);
    props.push(descriptor);
  };

  for (const arm of arms) {
    if (Node.isTypeLiteral(arm)) {
      for (const member of arm.getProperties()) push(describeProp(member));
      continue;
    }
    const variantConst = arm.getText().replace(/\s+/g, "").match(VARIANT_PROPS_RE)?.[1];
    if (variantConst) {
      for (const cvaProp of extractCvaVariantProps(sourceFile, variantConst)) push(cvaProp);
    }
  }

  return props;
}

/**
 * The parameter type node of a component declaration, whether it was written
 * as `function X(props: T)` or `const X = (props: T) => …`.
 */
function propsTypeNode(decl: Node): Node | undefined {
  const fn = Node.isVariableDeclaration(decl) ? decl.getInitializer() : decl;
  if (!fn || !(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn))) return undefined;
  return fn.getParameters()[0]?.getTypeNode();
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

interface ExportedComponent {
  sourceFile: SourceFile;
  declaration: Node;
}

/**
 * Map every exported component name to its declaration. Resolving through the
 * type system rather than grepping for `export function X` is what lets a
 * clean upstream vendor work: shadcn declares components unexported and lists
 * them in a trailing `export { Button, buttonVariants }` block.
 */
function indexExports(project: Project): Map<string, ExportedComponent> {
  const index = new Map<string, ExportedComponent>();
  for (const sourceFile of project.getSourceFiles()) {
    for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
      const declaration = declarations[0];
      if (!declaration || index.has(name)) continue;
      index.set(name, { sourceFile, declaration });
    }
  }
  return index;
}

async function buildManifest(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: join(here, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(`${componentsDir}/**/*.tsx`);

  const lucideNames = loadLucideIconNames();
  const helperById = new Map(HELPER_DESCRIPTORS.map((d) => [d.id, d]));
  const components: ComponentDescriptor[] = [];
  const exportsById = indexExports(project);

  for (const id of Object.keys(registry).sort()) {
    // The velloo helpers live in `@velloo/helpers` (outside this package's
    // component sources), and their canonical descriptors ship with them —
    // splice those in rather than ts-morph-extracting. `Icon.name` gets the
    // live lucide name list so the inspector's typeahead never drifts from
    // the installed lucide-react.
    const helperDescriptor = helperById.get(id);
    if (helperDescriptor) {
      const descriptor = structuredClone(helperDescriptor);
      if (id === "Icon") {
        for (const p of descriptor.props) {
          if (p.name === "name") p.enumValues = lucideNames;
        }
      }
      components.push(descriptor);
      continue;
    }

    const exported = exportsById.get(id);
    if (!exported) {
      console.warn(`! manifest: no source file found for ${id}, skipping`);
      continue;
    }
    const { sourceFile: srcFile, declaration } = exported;

    const source = "shadcn" as const;
    const category = "ui" as const;
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
      const literal = propsAlias?.getDescendantsOfKind(SyntaxKind.TypeLiteral)[0];
      if (literal) {
        props = literal.getProperties().map(describeProp);
      } else {
        const typeNode = propsTypeNode(declaration);
        if (typeNode) props = extractInlinePropTypes(typeNode, srcFile);
      }
    }

    const example = COMPONENT_EXAMPLES[id];
    components.push({
      id,
      category,
      source,
      props,
      ...(example ? { example } : {}),
    });
  }

  await mkdir(distDir, { recursive: true });
  const out = join(distDir, "manifest.json");
  await writeFile(out, `${JSON.stringify(components satisfies Manifest, null, 2)}\n`, "utf8");
  console.log(`✓ wrote ${out} (${components.length} components)`);
}

await buildManifest();
