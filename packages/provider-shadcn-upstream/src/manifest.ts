import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ComponentDescriptor, ControlType, Manifest, PropDescriptor } from "@velloo/provider";
import {
  type InterfaceDeclaration,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertySignature,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

const COLOR_NAME = /^(color|background|fg|bg|theme|fill|stroke|tint|accent)/i;

/**
 * Inline-port of the prop-control inference from
 * `packages/shadcn-snapshot/build.ts` so the upstream manifest carries
 * the same `control` shape as the legacy snapshot. The function reads
 * a raw TS type string and decides whether the inspector should render
 * a checkbox / number / string / color swatch / enum / icon picker.
 *
 * If shadcn's upstream shape changes in a way this can't classify,
 * the inspector falls back to a free-form text input (control: "string")
 * — no crashes, just less precise UX.
 */
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

function findVariantPropsConstName(propsInterface: InterfaceDeclaration): string | null {
  for (const extendsClause of propsInterface.getExtends()) {
    const text = extendsClause.getText().replace(/\s+/g, "");
    const match = text.match(/^VariantProps<typeof(\w+)>$/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function collectKeys(obj: ObjectLiteralExpression): string[] {
  const out: string[] = [];
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      out.push(name.replace(/^['"]|['"]$/g, ""));
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      out.push(prop.getName());
    }
  }
  return out;
}

function extractCvaVariantProps(sourceFile: SourceFile, constName: string): PropDescriptor[] {
  const variableDecl = sourceFile.getVariableDeclaration(constName);
  if (!variableDecl) return [];
  const init = variableDecl.getInitializer();
  if (!init || !Node.isCallExpression(init)) return [];
  const args = init.getArguments();
  const config = args[1];
  if (!config || !Node.isObjectLiteralExpression(config)) return [];
  const variantsProp = config.getProperty("variants");
  if (!variantsProp || !Node.isPropertyAssignment(variantsProp)) return [];
  const variantsInit = variantsProp.getInitializer();
  if (!variantsInit || !Node.isObjectLiteralExpression(variantsInit)) return [];

  const defaults: Record<string, string> = {};
  const defaultsProp = config.getProperty("defaultVariants");
  if (defaultsProp && Node.isPropertyAssignment(defaultsProp)) {
    const dInit = defaultsProp.getInitializer();
    if (dInit && Node.isObjectLiteralExpression(dInit)) {
      for (const dp of dInit.getProperties()) {
        if (!Node.isPropertyAssignment(dp)) continue;
        const value = dp.getInitializer();
        if (value && Node.isStringLiteral(value)) {
          defaults[dp.getName()] = value.getLiteralText();
        }
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

/**
 * Walk every fetched .tsx, find every `export function X` / `export const
 * X = ...` plus its matching `<X>Props` interface, and produce one
 * `ComponentDescriptor` per export. Catches the most common shadcn
 * shape; bespoke components without a `<Name>Props` interface produce
 * a descriptor with an empty prop list (the inspector still works, it
 * just can't surface typed controls).
 */
export async function generateManifest(uiDir: string): Promise<Manifest> {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const entries = await readdir(uiDir);
  for (const file of entries) {
    if (extname(file) !== ".tsx") continue;
    project.addSourceFileAtPath(join(uiDir, file));
  }

  const components: ComponentDescriptor[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    // Collect every export name. shadcn typically exposes one or many
    // components per file (Dialog + DialogTrigger + DialogContent + ...).
    const exportNames = new Set<string>();
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (fn.isExported() && name && /^[A-Z]/.test(name)) exportNames.add(name);
    }
    for (const decl of sourceFile.getVariableDeclarations()) {
      const name = decl.getName();
      if (!name || !/^[A-Z]/.test(name)) continue;
      if (decl.isExported()) exportNames.add(name);
    }

    for (const id of exportNames) {
      const propsInterface = sourceFile.getInterface(`${id}Props`);
      let props: PropDescriptor[] = [];

      if (propsInterface) {
        props = propsInterface.getProperties().map(describeProp);
        const cvaConst = findVariantPropsConstName(propsInterface);
        if (cvaConst) {
          const cvaProps = extractCvaVariantProps(sourceFile, cvaConst);
          const explicit = new Set(props.map((p) => p.name));
          for (const cp of cvaProps) if (!explicit.has(cp.name)) props.push(cp);
        }
      } else {
        const propsAlias = sourceFile.getTypeAlias(`${id}Props`);
        if (propsAlias) {
          const literal = propsAlias.getDescendantsOfKind(SyntaxKind.TypeLiteral)[0];
          if (literal) props = literal.getProperties().map(describeProp);
        }
      }

      components.push({ id, category: "ui", source: "shadcn", props });
    }
  }

  components.sort((a, b) => a.id.localeCompare(b.id));
  return components;
}

/** Convenience: generate + write the manifest under a cache directory. */
export async function writeManifest(cacheDir: string): Promise<Manifest> {
  const uiDir = join(cacheDir, "ui");
  const manifest = await generateManifest(uiDir);
  await writeFile(
    join(cacheDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

/** Read the cached manifest into memory; throws if missing. */
export async function readManifest(cacheDir: string): Promise<Manifest> {
  const raw = await readFile(join(cacheDir, "manifest.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}
