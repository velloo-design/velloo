import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
      : Bun.resolveSync(specifier, fromDir);
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
