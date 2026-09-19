import { dirname, join, relative, sep } from "node:path";
import type { RepoAppSummary } from "./catalog.ts";

/**
 * A starting preview entry, written from what the app's own entry does: the
 * stylesheets it imports and the providers it wraps the app in, outermost
 * first. Literal props carry over; props the app computes in code are left as
 * comments naming where, because copying code a design folder can't run is
 * the agent's call, not ours. A recipe theme, when there is one, feeds a
 * `theme` prop so Velloo's theme edits restyle the components.
 */
export function suggestPreviewEntry(app: RepoAppSummary, folderRoot: string): string {
  const fromFolder = (target: string): string => {
    const rel = relative(folderRoot, target).split(sep).join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  // A stylesheet import is relative to the file that has it; a wrapper's
  // identity is already relative to the app root.
  const styleImport = (specifier: string, at: string): string => {
    if (!specifier.startsWith(".")) return specifier;
    const [file] = at.split(":");
    return fromFolder(join(app.hostRoot, dirname(file ?? ""), specifier));
  };
  const importFor = (specifier: string, _at: string): string =>
    specifier.startsWith("./") ? fromFolder(join(app.hostRoot, specifier)) : specifier;
  const styles = [
    ...new Set(app.globalStyles.map((style) => styleImport(style.specifier, style.at))),
  ];
  const wrappers = [...app.wrappers].sort((a, b) => lineOf(a.at) - lineOf(b.at));
  const bySource = new Map<string, string[]>();
  for (const wrapper of wrappers) {
    const from = importFor(wrapper.identity.importPath, wrapper.at);
    const names = bySource.get(from) ?? [];
    if (wrapper.identity.exportName !== "default") names.push(wrapper.identity.exportName);
    bySource.set(from, names);
  }
  const hasRecipe = app.recipes.length > 0;
  const lines = [
    ...styles.map((style) => `import ${JSON.stringify(style)};`),
    ...[...bySource.entries()].map(([from, names]) =>
      names.length > 0
        ? `import { ${[...new Set(names)].join(", ")} } from ${JSON.stringify(from)};`
        : `import ${wrappers.find((w) => importFor(w.identity.importPath, w.at) === from)?.name ?? "Provider"} from ${JSON.stringify(from)};`,
    ),
    "",
    "/**",
    " * Velloo preview entry: the context the app's components need on the canvas.",
    " * Receives { children, colorScheme, theme, recipeTheme }; keep it free of",
    " * network calls and credentials, and use fixtures for data.",
    " */",
    "export default function Preview({ children, colorScheme, recipeTheme }) {",
  ];
  let open = "  return (\n";
  let close = "";
  wrappers.forEach((wrapper, depth) => {
    const pad = "    ".concat("  ".repeat(depth));
    const attrs = Object.entries(wrapper.props).map(([name, value]) =>
      typeof value === "string"
        ? `${name}=${JSON.stringify(value)}`
        : `${name}={${JSON.stringify(value)}}`,
    );
    for (const name of wrapper.expressions) {
      if (name === "theme" && hasRecipe) attrs.push("theme={recipeTheme}");
      else attrs.push(`/* ${name}: set in the app at ${wrapper.at} */`);
    }
    if (hasRecipe && depth === 0 && /color.?scheme/i.test(Object.keys(wrapper.props).join(" "))) {
      attrs.push("forceColorScheme={colorScheme}");
    }
    open += `${pad}<${wrapper.name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>\n`;
    close = `${pad}</${wrapper.name}>\n${close}`;
  });
  const inner = "    ".concat("  ".repeat(wrappers.length));
  const body =
    wrappers.length > 0 ? `${open}${inner}{children}\n${close}  );` : "  return children;";
  return [...lines, body, "}", ""].join("\n");
}

function lineOf(at: string): number {
  return Number(at.split(":").at(-1)) || 0;
}
