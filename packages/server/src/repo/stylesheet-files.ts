import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { BunPlugin } from "bun";

/**
 * The files an app's stylesheets name with `url()`. Wherever Velloo puts that
 * CSS — the canvas bundle, a server-rendered document, a standalone export —
 * there is no app behind it serving `/fonts/inter.woff2`, so the fonts and
 * images have to travel inside the CSS as data URIs.
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
 * What a stylesheet's `url()` can name: a URL, a path from the site root, or a
 * file with an extension that is not a script's or a stylesheet's.
 *
 * Not a match-everything filter, though the hook below acts only on a
 * stylesheet's imports — a filter cannot ask who is importing, and in Bun
 * merely being offered a script's relative import costs something even when
 * the hook declines it. A module some other plugin resolved (the host's
 * `lucide-react`) loses its package's `sideEffects` for every import this hook
 * was shown, so one icon imported from its ES barrel shipped all 1,540 icon
 * modules.
 */
export const SHEET_REF =
  /^(?:[a-z][a-z0-9+.-]*:|\/)|\.(?!(?:[cm]?[jt]sx?|json|css)(?:[?#]|$))[a-z0-9]+(?:[?#].*)?$/i;

/**
 * Answer every `url()` in a stylesheet before the bundler does. Left to it, a
 * file named by relative path is written out as a separate asset nobody
 * serves, and a path it can't find fails the whole build. Here a font or image
 * beside the sheet becomes a data URI — resolved against the sheet that names
 * it, which is lost once imports are inlined — and anything else stays as the
 * sheet wrote it. Another stylesheet (`@import`, a CSS-module `composes`) is
 * the bundler's to follow.
 */
export function sheetFilesPlugin(): BunPlugin {
  return {
    name: "velloo-stylesheet-files",
    setup(build) {
      build.onResolve({ filter: SHEET_REF }, (args) => {
        if (!args.importer.endsWith(".css") || args.kind === "import-rule") return undefined;
        const path = args.path.split(/[?#]/)[0] ?? "";
        if (path.endsWith(".css")) return undefined;
        const beside = path.startsWith(".") ? dataUri(resolve(dirname(args.importer), path)) : null;
        return { path: beside ?? args.path, external: true };
      });
    },
  };
}

/**
 * The files a sheet names from the site root (`/fonts/inter.woff2`), which the
 * framework serves out of `public/`: the same data URIs, by the same limits.
 */
export function inlineServedFiles(css: string, hostRoot: string): string {
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
