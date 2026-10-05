import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Node } from "@velloo/schema";
import type { BunPlugin } from "bun";
import { hostStylesheetPlugin } from "../live/canvas-bundle.ts";
import { tailwindConfigFor } from "../styles/host-stylesheet.ts";
import type { RepoComponents } from "./catalog.ts";
import { entryStylesheets, hostStylesheetCss } from "./preview-styles.ts";

/**
 * The app's global CSS as text: the stylesheets its preview entry imports.
 *
 * The canvas bundle carries those sheets too, but only into a page that mounts
 * one — so a screen of plain markup styled by the app's own classes rendered
 * unstyled, and a document with no scripts (the standalone HTML export) never
 * had them at all. As text they go in the server-rendered document itself,
 * which every surface starts from.
 */

const MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** A font is tens of kilobytes; past this a file is a photograph, and stays a URL. */
const MAX_INLINE_BYTES = 1024 * 1024;

/** The directories a framework serves at the site root. */
const PUBLIC_DIRS = ["public", "static"];

const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/g;

/** A font or image small enough to travel inside the CSS, as a data URI; else null. */
function dataUri(file: string): string | null {
  const type = MIME[extname(file).toLowerCase()];
  try {
    if (!type || statSync(file).size > MAX_INLINE_BYTES) return null;
    return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * A document built from this CSS has no app behind it, so the files a sheet
 * names have to travel inside it. Left to the bundler, a file named by
 * relative path is written out as a separate asset nobody serves, and a path
 * it can't find fails the whole build. So every `url()` is answered here: a
 * font or image beside the sheet becomes a data URI — resolved against the
 * sheet that names it, which is lost once imports are inlined — and anything
 * else stays as the sheet wrote it.
 */
function sheetFilesPlugin(): BunPlugin {
  return {
    name: "velloo-app-stylesheet-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer.endsWith(".css") || args.kind === "import-rule") return undefined;
        const beside = args.path.startsWith(".")
          ? dataUri(resolve(dirname(args.importer), args.path.split(/[?#]/)[0] ?? ""))
          : null;
        return { path: beside ?? args.path, external: true };
      });
    },
  };
}

/**
 * The files a sheet names from the site root (`/fonts/inter.woff2`), which the
 * framework serves out of `public/`: the same data URIs, by the same limits.
 */
function inlineServedFiles(css: string, hostRoot: string): string {
  return css.replace(URL_REF, (whole, double?: string, single?: string, bare?: string) => {
    const ref = double ?? single ?? bare ?? "";
    if (!ref.startsWith("/") || ref.startsWith("//")) return whole;
    const path = ref.split(/[?#]/)[0] ?? "";
    for (const dir of PUBLIC_DIRS) {
      const uri = dataUri(join(hostRoot, dir, path));
      if (uri) return `url("${uri}")`;
    }
    return whole;
  });
}

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
