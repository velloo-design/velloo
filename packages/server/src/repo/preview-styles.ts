import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveInHost } from "../host-resolve.ts";
import { compileHostStylesheet, needsTailwind } from "../styles/host-stylesheet.ts";
import type { RepoAppSummary } from "./catalog.ts";
import { STYLE_EXTS } from "./discover.ts";
import type { PreviewEntry } from "./preview.ts";
import { scanModule } from "./source-scan.ts";

/**
 * Where a stylesheet import lands: a file path when it resolves, else the
 * specifier itself — so an entry and the app naming the same sheet through
 * different relative paths, or the same package specifier, still match.
 */
function stylesheetKey(specifier: string, fromDir: string): string {
  let path: string;
  try {
    path = specifier.startsWith(".")
      ? resolve(fromDir, specifier)
      : resolveInHost(specifier, fromDir);
  } catch {
    return specifier;
  }
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The stylesheets a preview entry imports for their side effect, resolved. */
export function entryStylesheets(preview: PreviewEntry, hostRoot: string): string[] {
  let source: string;
  let fromDir: string;
  if (preview.kind === "file") {
    try {
      source = readFileSync(preview.path, "utf8");
    } catch {
      return [];
    }
    fromDir = dirname(preview.path);
  } else if (preview.kind === "recipe") {
    source = preview.source;
    fromDir = hostRoot;
  } else {
    return [];
  }
  return scanModule(source)
    .imports.filter((decl) => decl.sideEffect && STYLE_EXTS.test(decl.specifier))
    .map((decl) => stylesheetKey(decl.specifier, fromDir));
}

export interface UnloadedStylesheet {
  specifier: string;
  /** Where the app imports it (`app/layout.tsx:3`). */
  at: string;
  /** The resolved file, when it resolves. */
  path: string | null;
}

/**
 * The app's global stylesheets the preview entry doesn't load. A component can
 * mount cleanly and still render wrong without them — the app's own classes
 * (`.label`, `.blueprint`) and the custom properties they read simply don't
 * exist on the canvas — so a passing probe alone doesn't prove the entry.
 */
export function unloadedAppStylesheets(
  app: RepoAppSummary,
  preview: PreviewEntry,
): UnloadedStylesheet[] {
  const loaded = new Set(entryStylesheets(preview, app.hostRoot));
  const out: UnloadedStylesheet[] = [];
  const seen = new Set<string>();
  for (const style of app.globalStyles) {
    const colon = style.at.lastIndexOf(":");
    const file = colon > 0 ? style.at.slice(0, colon) : style.at;
    const key = stylesheetKey(style.specifier, join(app.hostRoot, dirname(file)));
    if (loaded.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      specifier: style.specifier,
      at: style.at,
      path: key === style.specifier ? null : key,
    });
  }
  return out;
}

/**
 * A stylesheet as the canvas loads it: Tailwind syntax expanded the way the
 * canvas bundle expands it, so `.label { @apply … }` and `@utility` rules are
 * the classes they define. A sheet that can't be read is empty.
 */
export async function hostStylesheetCss(path: string): Promise<string> {
  let css: string;
  try {
    css = readFileSync(path, "utf8");
  } catch {
    return "";
  }
  if (!needsTailwind(css)) return css;
  const expanded = await compileHostStylesheet(path, css);
  return expanded.ok ? expanded.css : css;
}

export interface UnprocessedStylesheet {
  path: string;
  error: string;
}

/**
 * The sheets among `paths` that use Tailwind syntax Velloo's Tailwind can't
 * expand: they load as written, so whatever rides on that syntax — an
 * `@apply`'d class, a config-defined utility — does not render.
 */
export async function unprocessedStylesheets(
  paths: readonly string[],
): Promise<UnprocessedStylesheet[]> {
  const out: UnprocessedStylesheet[] = [];
  for (const path of paths) {
    if (!isAbsolute(path)) continue;
    let css: string;
    try {
      css = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!needsTailwind(css)) continue;
    const expanded = await compileHostStylesheet(path, css);
    if (!expanded.ok) out.push({ path, error: expanded.error });
  }
  return out;
}
