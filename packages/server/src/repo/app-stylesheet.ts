import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Node } from "@velloo/schema";
import { hostStylesheetPlugin } from "../live/canvas-bundle.ts";
import { tailwindConfigFor } from "../styles/host-stylesheet.ts";
import type { RepoComponents } from "./catalog.ts";
import { entryStylesheets, hostStylesheetCss } from "./preview-styles.ts";
import { inlineServedFiles, sheetFilesPlugin } from "./stylesheet-files.ts";

/**
 * The app's global CSS as text: the stylesheets its preview entry imports.
 *
 * The canvas bundle carries those sheets too, but only into a page that mounts
 * one — so a screen of plain markup styled by the app's own classes rendered
 * unstyled, and a document with no scripts (the standalone HTML export) never
 * had them at all. As text they go in the server-rendered document itself,
 * which every surface starts from.
 */

interface BuiltSheet {
  css: string;
  /** Every file the sheet was built from, for the staleness check. */
  inputs: string[];
}

async function buildSheet(path: string): Promise<BuiltSheet> {
  const config = tailwindConfigFor(path);
  const inputs = new Set([path, ...(config ? [config] : [])]);
  try {
    const result = await Bun.build({
      entrypoints: [path],
      plugins: [hostStylesheetPlugin(), sheetFilesPlugin()],
      metafile: true,
      throw: false,
    });
    const output = result.outputs.find((artifact) => artifact.path.endsWith(".css"));
    if (result.success && output) {
      for (const input of Object.keys(result.metafile?.inputs ?? {})) inputs.add(resolve(input));
      return { css: await output.text(), inputs: [...inputs] };
    }
  } catch {
    // Falls through to the sheet as written.
  }
  // A sheet the bundler can't take still styles most of the page unbundled.
  return { css: await hostStylesheetCss(path), inputs: [...inputs] };
}

const stampOf = (paths: readonly string[]): string =>
  paths
    .map((path) => {
      try {
        return `${path}:${statSync(path).mtimeMs}`;
      } catch {
        return `${path}:-`;
      }
    })
    .join("|");

const cache = new Map<string, { stamp: string; built: Promise<BuiltSheet> }>();

function sheetCss(path: string): Promise<BuiltSheet> {
  const hit = cache.get(path);
  if (hit) {
    // Stale only once the build that knows its inputs has finished.
    return hit.built.then((built) => {
      if (stampOf(built.inputs) === hit.stamp) return built;
      cache.delete(path);
      return sheetCss(path);
    });
  }
  const built = buildSheet(path);
  const entry = { stamp: "", built };
  cache.set(path, entry);
  return built.then((sheet) => {
    entry.stamp = stampOf(sheet.inputs);
    return sheet;
  });
}

/** The apps a tree's repository components come from. */
function appsOf(value: unknown, out: Set<string | undefined>): void {
  if (Array.isArray(value)) {
    for (const item of value) appsOf(item, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const repo = (value as { $repo?: { importPath?: unknown; app?: unknown } }).$repo;
  if (repo && typeof repo.importPath === "string") {
    out.add(typeof repo.app === "string" ? repo.app : undefined);
  }
  for (const child of Object.values(value)) appsOf(child, out);
}

/**
 * The CSS for a screen: its apps' preview-entry stylesheets, in import order.
 * A screen with no repository component is the default app's — its markup is
 * written against that app's classes. Empty when the folder has no host app
 * or the entry imports no stylesheet.
 */
export async function appStylesheetFor(
  repo: RepoComponents | undefined,
  tree: Node,
): Promise<string> {
  if (!repo) return "";
  const apps = new Set<string | undefined>();
  appsOf(tree, apps);
  if (apps.size === 0) apps.add(undefined);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const app of apps) {
    let hostRoot: string;
    let sheets: string[];
    try {
      hostRoot = repo.host(app).hostRoot;
      sheets = entryStylesheets(repo.preview(app), hostRoot);
    } catch {
      // An unbound app root has no entry to read.
      continue;
    }
    for (const path of sheets) {
      if (seen.has(path) || !path.endsWith(".css") || !isAbsolute(path) || !existsSync(path)) {
        continue;
      }
      seen.add(path);
      parts.push(inlineServedFiles((await sheetCss(path)).css, hostRoot));
    }
  }
  return parts.join("\n");
}
