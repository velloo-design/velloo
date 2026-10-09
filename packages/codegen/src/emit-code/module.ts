/**
 * A screen as a module an app can run: its imports, its snippets as components
 * and the page component itself.
 *
 * `emitCode` is the IR an agent reads and retypes into the app's own file. For
 * a page of a few hundred lines that retyping is most of what handing a design
 * to implementation costs, and it adds nothing: the imports are already known
 * to the emit, down to the file each one comes from. `emitModule` writes those
 * down, so the first version of the page is the design itself and what is left
 * for the agent is what only it can do — data, handlers, the app's wrappers.
 *
 * Still no formatter (a package-wide non-goal): the module is indented
 * consistently and nothing more.
 */
import { ICON_ALIASES, ICON_NODES, LUCIDE_SVG_ATTRIBUTES } from "@velloo/helpers";
import type { Result } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import type { CodegenError } from "../errors.ts";
import {
  type EmitCodeOptions,
  type EmitCodeResult,
  type EmitSnippetIR,
  emitScreen,
} from "./index.ts";

export interface EmitModuleOptions extends EmitCodeOptions {
  /** The page component's name. */
  name: string;
  /** `export default function Name` unless false, which writes `export function Name`. */
  defaultExport?: boolean | undefined;
  /** Type the snippet components' props (a `.tsx` module). */
  typescript?: boolean | undefined;
  /**
   * An import the emit knows relative to the app root (`./src/charts/Spark`),
   * as the module itself must spell it. Absent ⇒ written as given.
   */
  fromAppRoot?: ((specifier: string) => string) | undefined;
  /**
   * Write the icons the page uses into the module as components of their own —
   * the SVG the canvas draws, taking the props lucide-react's take — instead of
   * importing them. For an app that doesn't depend on `lucide-react`: the page
   * builds as written, with nothing to install first.
   */
  inlineIcons?: boolean | undefined;
}

export interface EmitModuleResult {
  /** The module's full text. */
  source: string;
  /** The screen's IR, as `emitCode` returns it. */
  ir: EmitCodeResult;
  /** The specifiers the module imports from, in the order written. */
  imports: string[];
}

interface ImportLine {
  named: Set<string>;
  default?: string;
}

/** Packages first, then the app's aliases, then relative files — each alphabetical. */
function importRank(specifier: string): number {
  if (specifier.startsWith(".")) return 2;
  return /^(@\/|~\/|#)/.test(specifier) ? 1 : 0;
}

const PARAM_TYPES: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  node: "ReactNode",
  icon: "string",
  color: "string",
  enum: "string",
};

function paramDefault(param: EmitSnippetIR["params"][number]): string | null {
  if (param.default === undefined || param.type === "node") return null;
  return param.type === "number" || param.type === "boolean"
    ? param.default
    : JSON.stringify(param.default);
}

/** The index just past the `>` that closes the element opening at the start of `jsx`. */
function openingTagEnd(jsx: string): number {
  let depth = 0;
  for (let i = 0; i < jsx.length; i += 1) {
    const char = jsx[i] as string;
    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < jsx.length && jsx[i] !== char) {
        if (jsx[i] === "\\") i += 1;
        i += 1;
      }
    } else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/**
 * A snippet body whose root also takes the `className` an instance passes —
 * appended to the root's own, the way the canvas applies an instance's extra
 * classes.
 */
function withInstanceClassName(jsx: string): string {
  const end = openingTagEnd(jsx);
  if (end === -1) return jsx;
  const tag = jsx.slice(0, end);
  const quoted = /\sclassName="([^"]*)"/.exec(tag);
  if (quoted) {
    const merged = ` className={\`${quoted[1]} \${className ?? ""}\`}`;
    return tag.replace(quoted[0], merged) + jsx.slice(end);
  }
  // An expression of its own (a `className` param): leave it to the author.
  if (/\sclassName=/.test(tag)) return jsx;
  const name = /^\s*<[A-Za-z_$][\w$.]*/.exec(tag)?.[0];
  if (!name) return jsx;
  return `${name} className={className}${tag.slice(name.length)}${jsx.slice(end)}`;
}

const indented = (jsx: string, by: string): string =>
  jsx
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `${by}${line}`))
    .join("\n");

function component(head: string, jsx: string): string {
  return `${head} {\n  return (\n${indented(jsx, "    ")}\n  );\n}`;
}

function snippetComponent(snippet: EmitSnippetIR, takesClassName: boolean, ts: boolean): string {
  const params = [
    ...snippet.params,
    ...(takesClassName && !snippet.params.some((param) => param.name === "className")
      ? [{ name: "className", type: "string", optional: true }]
      : []),
  ];
  if (params.length === 0) return component(`function ${snippet.componentName}()`, snippet.jsx);
  const names = params.map((param) => {
    const fallback = paramDefault(param);
    return fallback === null ? param.name : `${param.name} = ${fallback}`;
  });
  const types = params.map(
    (param) =>
      `${param.name}${param.optional || param.default !== undefined ? "?" : ""}: ${PARAM_TYPES[param.type] ?? "unknown"}`,
  );
  const signature = ts
    ? `{ ${names.join(", ")} }: { ${types.join("; ")} }`
    : `{ ${names.join(", ")} }`;
  return component(
    `function ${snippet.componentName}(${signature})`,
    takesClassName ? withInstanceClassName(snippet.jsx) : snippet.jsx,
  );
}

const attribute = (name: string, value: string | number): string =>
  `${name}=${typeof value === "number" ? `{${value}}` : JSON.stringify(value)}`;

/** One lucide icon as a component with lucide-react's own defaults and props. */
function iconComponent(name: string, ts: boolean): string | null {
  const nodes = ICON_NODES[ICON_ALIASES[name] ?? ""];
  if (!nodes) return null;
  const { width: _width, height: _height, ...root } = LUCIDE_SVG_ATTRIBUTES;
  const attrs = Object.entries(root).map(([key, value]) => attribute(key, value));
  const children = nodes.map(
    ([tag, own]) =>
      `<${tag} ${Object.entries(own)
        .map(([key, value]) => attribute(key, value))
        .join(" ")} />`,
  );
  const props = ts
    ? "{ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }"
    : "{ size = 24, ...props }";
  return component(
    `function ${name}(${props})`,
    `<svg ${attrs.join(" ")} width={size} height={size} aria-hidden="true" {...props}>\n${indented(children.join("\n"), "  ")}\n</svg>`,
  );
}

/** Emit one screen as a complete module. Pure: the caller decides where it goes. */
export async function emitModule(
  screen: Screen,
  options: EmitModuleOptions,
): Promise<Result<EmitModuleResult, CodegenError>> {
  const emitted = await emitScreen(screen, options);
  if (!emitted.ok) return emitted;
  const { ir, imports: known } = emitted.value;
  const ts = options.typescript === true;

  const lines = new Map<string, ImportLine>();
  const line = (specifier: string): ImportLine => {
    const existing = lines.get(specifier);
    if (existing) return existing;
    const created: ImportLine = { named: new Set() };
    lines.set(specifier, created);
    return created;
  };
  for (const [specifier, names] of known) {
    for (const name of names) line(specifier).named.add(name);
  }
  const icons = options.inlineIcons
    ? ir.iconsUsed.flatMap((icon) => iconComponent(icon, ts) ?? [])
    : [];
  // An icon with no data to inline (none today) would still be imported.
  for (const icon of ir.iconsUsed) {
    if (!options.inlineIcons || !ICON_NODES[ICON_ALIASES[icon] ?? ""]) {
      line("lucide-react").named.add(icon);
    }
  }
  const repoImports = [ir.repoImports, ...ir.snippetsUsed.map((snippet) => snippet.repoImports)];
  for (const entry of repoImports.flat()) {
    const specifier =
      entry.from.startsWith("./") && options.fromAppRoot
        ? options.fromAppRoot(entry.from)
        : entry.from;
    const target = line(specifier);
    for (const name of entry.named ?? []) target.named.add(name);
    if (entry.default) target.default = entry.default;
  }
  const nodeParams = ir.snippetsUsed.some((s) => s.params.some((p) => p.type === "node"));

  const ordered = [...lines.entries()].sort(
    ([a], [b]) => importRank(a) - importRank(b) || a.localeCompare(b),
  );
  const reactTypes = [
    ...(ts && nodeParams ? ["ReactNode"] : []),
    ...(ts && icons.length > 0 ? ["SVGProps"] : []),
  ];
  const importText = [
    ...(reactTypes.length > 0 ? [`import type { ${reactTypes.join(", ")} } from "react";`] : []),
    ...ordered.map(([specifier, { named, default: byDefault }]) => {
      const braces = named.size > 0 ? `{ ${[...named].sort().join(", ")} }` : "";
      const bound = [byDefault, braces].filter(Boolean).join(", ");
      return `import ${bound} from ${JSON.stringify(specifier)};`;
    }),
  ];

  const bodies = [ir.jsx, ...ir.snippetsUsed.map((snippet) => snippet.jsx)].join("\n");
  const snippets = ir.snippetsUsed.map((snippet) =>
    snippetComponent(
      snippet,
      new RegExp(`<${snippet.componentName}\\b[^>]*\\sclassName=`).test(bodies),
      ts,
    ),
  );
  const page = component(
    `export ${options.defaultExport === false ? "" : "default "}function ${options.name}()`,
    ir.jsx,
  );
  const source = `${[importText.join("\n"), ...icons, ...snippets, page].filter(Boolean).join("\n\n")}\n`;
  return { ok: true, value: { source, ir, imports: ordered.map(([specifier]) => specifier) } };
}
