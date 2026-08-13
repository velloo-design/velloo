/**
 * Manifest builder: walks a design folder's on-disk components with ts-morph
 * and produces the prop manifest the inspector + MCP `list_components` use.
 *
 * Same algorithm as packages/shadcn-snapshot/build.ts (the original snapshot
 * build); reproduced here so the manifest reflects the user's actual on-disk
 * copy — including any edits they've made.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ComponentDescriptor, Manifest, PropDescriptor } from "@velloo/shadcn-snapshot";
import {
  type InterfaceDeclaration,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertySignature,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

type ControlType = "boolean" | "number" | "string" | "color" | "enum" | "icon";

const COLOR_NAME = /^(color|background|fg|bg|theme|fill|stroke|tint|accent)/i;

function categorize(
  rel: string,
  id: string,
): { source: "shadcn" | "velloo"; category: "ui" | "typography" } {
  if (rel.startsWith("velloo/")) {
    const category = id === "Icon" || id === "Placeholder" ? "ui" : "typography";
    return { source: "velloo", category };
  }
  return { source: "shadcn", category: "ui" };
}

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
      out.push(prop.getName().replace(/^['"]|['"]$/g, ""));
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      out.push(prop.getName());
    }
  }
  return out;
}

/**
 * Best-effort detection of exported component names in a source file. Looks
 * for `export const Foo = ...`, `export function Foo(...)`, or
 * `export { Foo }`. Skips lowercase identifiers and known helpers (cn, cva).
 */
function exportedComponentNames(sourceFile: SourceFile): string[] {
  const found = new Set<string>();
  for (const decl of sourceFile.getVariableDeclarations()) {
    if (!decl.isExported()) continue;
    const name = decl.getName();
    if (/^[A-Z]/.test(name)) found.add(name);
  }
  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (name && /^[A-Z]/.test(name)) found.add(name);
  }
  for (const ex of sourceFile.getExportDeclarations()) {
    for (const spec of ex.getNamedExports()) {
      const name = spec.getAliasNode()?.getText() ?? spec.getName();
      if (/^[A-Z]/.test(name)) found.add(name);
    }
  }
  return [...found];
}

interface BuildManifestOpts {
  /** Absolute path to the design folder's components directory. */
  componentsRoot: string;
  /** Where to write `<designFolder>/.design/manifest.json`. */
  outPath: string;
  /** Optional: lucide icon names (so Icon's `name` prop becomes a typeahead). */
  lucideNames?: string[];
}

/**
 * Build a manifest from on-disk component files and persist it. The renderer +
 * MCP `list_components` read this file rather than the bundled shadcn-snapshot
 * manifest — so user edits in `<designFolder>/components/` flow through.
 */
export async function buildAndWriteManifest(opts: BuildManifestOpts): Promise<Manifest> {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(`${opts.componentsRoot}/**/*.tsx`);

  const components: ComponentDescriptor[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const absPath = sourceFile.getFilePath();
    const rel = absPath.startsWith(opts.componentsRoot)
      ? absPath.slice(opts.componentsRoot.length).replace(/^\/+/, "")
      : absPath;

    for (const id of exportedComponentNames(sourceFile)) {
      const { source, category } = categorize(rel, id);
      let props: PropDescriptor[] = [];

      const propsInterface = sourceFile.getInterface(`${id}Props`);
      if (propsInterface) {
        props = propsInterface.getProperties().map(describeProp);
        const cvaConstName = findVariantPropsConstName(propsInterface);
        if (cvaConstName) {
          const cvaProps = extractCvaVariantProps(sourceFile, cvaConstName);
          const explicitNames = new Set(props.map((p) => p.name));
          for (const cp of cvaProps) {
            if (!explicitNames.has(cp.name)) props.push(cp);
          }
        }
      } else {
        const propsAlias = sourceFile.getTypeAlias(`${id}Props`);
        if (propsAlias) {
          const literal = propsAlias.getDescendantsOfKind(SyntaxKind.TypeLiteral)[0];
          if (literal) {
            props = literal.getProperties().map(describeProp);
          }
        }
      }

      if (id === "Icon" && opts.lucideNames) {
        for (const p of props) {
          if (p.name === "name") {
            p.control = "icon";
            p.enumValues = opts.lucideNames;
            if (!p.defaultValue) p.defaultValue = "Heart";
          }
        }
      }

      components.push({ id, category, source, props });
    }
  }

  components.sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(dirname(opts.outPath), { recursive: true });
  await writeFile(
    opts.outPath,
    `${JSON.stringify(components satisfies Manifest, null, 2)}\n`,
    "utf8",
  );
  return components;
}

/**
 * Lazy import of lucide names — returns null if the package isn't installed
 * in the design folder's runtime (the manifest will still be valid, Icon's
 * `name` field just stays a free-form string).
 */
export async function loadLucideNames(): Promise<string[] | null> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: third-party module shape
    const L = (await import("lucide-react")) as Record<string, any>;
    const skip = new Set(["LucideProvider", "createLucideIcon", "LucideIcon", "Icon"]);
    return Object.keys(L)
      .filter(
        (k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !k.endsWith("Icon") && !skip.has(k) && L[k],
      )
      .sort();
  } catch {
    return null;
  }
}
