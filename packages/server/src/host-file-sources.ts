/**
 * Where an HTML design's copies of the app's files come from — never the
 * running app itself. The app's source on disk serves what is committed there;
 * a capture (the page as the app served it, built CSS included) serves the
 * rest; and the copies the design already keeps serve publishing.
 */
import { type Dirent, readdirSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { HostFileSource } from "./host-files.ts";
import { HOST_FILES_DIR } from "./routes/host-files.ts";

const readBytes = async (file: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
};

/** The copies the design keeps under `assets/host/`. */
export function storedHostSource(root: string): HostFileSource {
  return {
    label: "the design's stored copies",
    read: (path) => readBytes(join(root, HOST_FILES_DIR, ...path.split("/"))),
  };
}

/** Kinds of file an app serves that a design can use; nothing else is indexed. */
const HOST_FILE_EXTENSIONS = new Set([".css", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff2"]);
const SKIP_DIRS = new Set(["node_modules", "venv", ".venv", "env", "__pycache__", "vendor"]);
const MAX_INDEXED = 20_000;
const MAX_DEPTH = 10;

/**
 * The app's files on disk, found by the path it serves them at. Apps mount
 * their static directory under a URL prefix of their own choosing
 * (`/static/site.css` ← `app/static/site.css`, `/build/style.min.css` ←
 * `internal/view/static/build/style.min.css`), so a URL path matches the file
 * whose path ends with the most of its segments — at least two, unless the URL
 * has only one — the shortest such path winning a tie. `exclude` keeps
 * directories out of the index: the design folder, whose own stored copies
 * would otherwise match themselves.
 */
export function appSourceHostFiles(appRoot: string, exclude: string[] = []): HostFileSource {
  let index: Map<string, string[]> | null = null;
  const excluded = exclude.map((dir) => canonical(dir));
  const build = (): Map<string, string[]> => {
    const byName = new Map<string, string[]>();
    let count = 0;
    const walk = (dir: string, depth: number): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (count >= MAX_INDEXED) return;
        if (entry.name.startsWith(".")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || depth >= MAX_DEPTH) continue;
          if (excluded.includes(canonical(path))) continue;
          walk(path, depth + 1);
        } else if (entry.isFile() && HOST_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          count++;
          const list = byName.get(entry.name) ?? [];
          list.push(relative(appRoot, path).split(sep).join("/"));
          byName.set(entry.name, list);
        }
      }
    };
    walk(appRoot, 0);
    return byName;
  };
  return {
    label: "the app's source",
    read: async (path) => {
      index ??= build();
      const wanted = path.split("/");
      let best: { file: string; score: number } | null = null;
      for (const file of index.get(wanted[wanted.length - 1] ?? "") ?? []) {
        const have = file.split("/");
        let score = 0;
        while (
          score < wanted.length &&
          score < have.length &&
          wanted[wanted.length - 1 - score] === have[have.length - 1 - score]
        ) {
          score++;
        }
        if (score < Math.min(2, wanted.length)) continue;
        if (
          !best ||
          score > best.score ||
          (score === best.score && file.length < best.file.length)
        ) {
          best = { file, score };
        }
      }
      return best ? readBytes(join(appRoot, best.file)) : null;
    },
  };
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

interface MhtmlPart {
  type: string;
  location: string;
  bytes: Uint8Array;
}

const BOUNDARY = /boundary="?([^";\r\n]+)"?/i;

function decodeQuotedPrintable(body: string): Uint8Array {
  const soft = body.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const char = soft.charCodeAt(i);
    if (char === 0x3d && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(char & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * The parts of an MHTML archive (what Chromium's `Page.captureSnapshot`
 * writes): each resource's type, original URL and decoded bytes. `text` is
 * the archive read as latin1, so every byte survives.
 */
export function parseMhtml(text: string): MhtmlPart[] {
  const boundary = BOUNDARY.exec(text.slice(0, 4096))?.[1];
  if (!boundary) return [];
  const parts: MhtmlPart[] = [];
  for (const chunk of text.split(`--${boundary}`).slice(1)) {
    if (chunk.startsWith("--")) break;
    const split = /\r?\n\r?\n/.exec(chunk);
    if (!split) continue;
    const headers = chunk.slice(0, split.index);
    const body = chunk.slice(split.index + split[0].length).replace(/\r?\n$/, "");
    const header = (name: string) =>
      new RegExp(`^${name}:\\s*(.+)$`, "im").exec(headers)?.[1]?.trim() ?? "";
    const encoding = header("Content-Transfer-Encoding").toLowerCase();
    const bytes =
      encoding === "base64"
        ? new Uint8Array(Buffer.from(body.replace(/\s+/g, ""), "base64"))
        : encoding === "quoted-printable"
          ? decodeQuotedPrintable(body)
          : new Uint8Array(Buffer.from(body, "latin1"));
    parts.push({
      type: header("Content-Type").split(";")[0]?.toLowerCase() ?? "",
      location: header("Content-Location"),
      bytes,
    });
  }
  return parts;
}

const LINK_TAG = /<link\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find(Boolean);

/** `hostApp.stylesheets` entries from a page's `<link rel="stylesheet">`s, resolved against `base`. */
export function stylesheetsInPage(html: string, base: URL): string[] {
  const sheets: string[] = [];
  for (const [tag] of html.matchAll(LINK_TAG)) {
    if (!/\bstylesheet\b/i.test(attr(tag, "rel") ?? "")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    // A same-origin query is a build's cache-buster: stale after the next build.
    const entry =
      url.origin === base.origin ? url.pathname : url.protocol === "https:" ? url.href : null;
    if (entry && !sheets.includes(entry)) sheets.push(entry);
  }
  return sheets;
}

/**
 * The files a capture holds, by the path the app served them at: every
 * same-origin resource in its MHTML archive, then the images it downloaded.
 * `stylesheets` are the ones the captured page linked, in cascade order.
 */
export async function captureHostSource(
  dir: string,
  pageUrl: string,
): Promise<HostFileSource & { stylesheets: string[] }> {
  const base = new URL(pageUrl);
  const files = new Map<string, Uint8Array>();
  let stylesheets: string[] = [];
  let archive: string | null = null;
  try {
    archive = await readFile(join(dir, "snapshot.mhtml"), "latin1");
  } catch {
    // An older capture, or one whose archive failed: the downloaded images remain.
  }
  for (const part of archive ? parseMhtml(archive) : []) {
    let url: URL;
    try {
      url = new URL(part.location);
    } catch {
      continue;
    }
    if (part.type === "text/html" && stylesheets.length === 0 && url.href === base.href) {
      stylesheets = stylesheetsInPage(new TextDecoder().decode(part.bytes), base);
    }
    if (url.origin !== base.origin) continue;
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (path && !files.has(path)) files.set(path, part.bytes);
  }
  try {
    const listed = JSON.parse(await readFile(join(dir, "assets.json"), "utf8")) as {
      assets?: Array<{ url?: string; file?: string }>;
    };
    for (const asset of listed.assets ?? []) {
      if (!asset.url || !asset.file) continue;
      const url = new URL(asset.url);
      if (url.origin !== base.origin) continue;
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (files.has(path)) continue;
      const bytes = await readBytes(join(dir, "assets", asset.file));
      if (bytes) files.set(path, bytes);
    }
  } catch {
    // No downloaded images.
  }
  return {
    label: "the capture",
    stylesheets,
    read: async (path) => files.get(path) ?? null,
  };
}
