import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { HostApp } from "@velloo/schema";
import { resolveAppPath } from "../project-location.ts";
import type { FrameworkRecipe } from "./recipes/index.ts";

/**
 * The wrapper mounted repository components render inside: the app's own
 * preview entry when it has written one, else a built-in recipe's default for
 * the framework it uses, else none. A preview entry is a module whose default
 * export receives `{ children, colorScheme, theme, recipeTheme }` and returns
 * the providers, global CSS and fixtures the components need.
 */
export type PreviewEntry =
  | { kind: "file"; path: string; label: string }
  | { kind: "recipe"; recipe: FrameworkRecipe; source: string; label: string }
  | { kind: "none"; label: string };

const EXTENSIONS = ["tsx", "jsx", "ts", "js"];

export function previewFileCandidates(folderRoot: string, app: string | undefined): string[] {
  const names = app ? [`preview.${app}`, "preview"] : ["preview"];
  return names.flatMap((name) => EXTENSIONS.map((ext) => join(folderRoot, `${name}.${ext}`)));
}

export function resolvePreviewEntry(opts: {
  folderRoot: string;
  hostRoot: string;
  hostApp: HostApp | undefined;
  app: string | undefined;
  recipes: FrameworkRecipe[];
}): PreviewEntry {
  const label = (path: string) => relative(opts.folderRoot, path).split(sep).join("/");
  if (opts.hostApp?.preview) {
    const path = resolveAppPath(opts.folderRoot, opts.hostApp.preview);
    if (existsSync(path)) return { kind: "file", path, label: label(path) };
  }
  for (const path of previewFileCandidates(opts.folderRoot, opts.app)) {
    if (existsSync(path)) return { kind: "file", path, label: label(path) };
  }
  const resolve = (specifier: string): string | null => {
    try {
      return Bun.resolveSync(specifier, opts.hostRoot);
    } catch {
      return null;
    }
  };
  for (const recipe of opts.recipes) {
    const source = recipe.previewModule(resolve);
    if (source) return { kind: "recipe", recipe, source, label: `${recipe.label} recipe default` };
  }
  return { kind: "none", label: "no preview entry" };
}
