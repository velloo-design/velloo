/**
 * The host app's own files an HTML design is styled by: its stylesheets and the
 * images and fonts its trees and stylesheets point at (`/static/hero.jpg`,
 * `url(../fonts/x.woff2)`). Each is read once from a `HostFileSource` — the
 * app's source on disk, a capture, or the copies the design already keeps —
 * placed under `assets/host/`, and every reference re-pointed at that copy.
 * Never fetched from the running app.
 */
import { isComponentNode, type Node, type Screen, type Snippet } from "@velloo/schema";
import { sanitizeSvgMarkup } from "@velloo/schema/svg-sanitize";

/**
 * What the cloud accepts, by extension — its upload check rejects the whole
 * version over one file it won't store (an animated GIF spinner, say), so
 * anything else stays pointing at the host and simply doesn't load.
 */
const SHIPPABLE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

/** Whether the bytes are what the extension claims — the cloud checks, and one miss fails the publish. */
function looksLike(type: string, bytes: Uint8Array): boolean {
  const starts = (...magic: number[]) => magic.every((byte, i) => bytes[i] === byte);
  switch (type) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45;
    case "font/woff2":
      return starts(0x77, 0x4f, 0x46, 0x32);
    case "image/svg+xml":
      return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.slice(0, 4096)));
    default:
      return false;
  }
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 200;

/** Props whose string value the browser loads as a file (never `href`: that's a page). */
const FILE_PROPS = new Set(["src", "poster", "srcset", "srcSet"]);

/**
 * Where host files come from, by the path the app serves them at
 * (`static/site.css`, no leading slash): the bytes, or null when the source
 * has no such file. `label` names it in warnings.
 */
export interface HostFileSource {
  label: string;
  read(path: string): Promise<Uint8Array | null>;
}

interface HostFile {
  path: string;
  bytes: Uint8Array;
  type: string;
}

export interface HostFilesResult {
  screens: Screen[];
  snippets: Snippet[];
  files: HostFile[];
  /** Bundle-relative stylesheet paths and https URLs, in the app's cascade order. */
  stylesheets: string[];
}

/** `/static/a.png?v=2` → `static/a.png`, or null for anything that isn't a plain host path. */
function hostPath(ref: string): string | null {
  if (!ref.startsWith("/") || ref.startsWith("//") || ref.startsWith("/assets/")) return null;
  const path = decodeURIComponent(ref.split(/[?#]/)[0] ?? "").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => part === ".." || part === ".")) return null;
  return /^[A-Za-z0-9._@~+/-]+$/.test(path) ? path : null;
}

const extension = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";

/** Read the host files `screens`, `snippets` and `stylesheets` reference from `source`. */
export async function shipHostFiles(opts: {
  source: HostFileSource;
  stylesheets: string[];
  screens: Screen[];
  snippets: Snippet[];
  warn: (message: string) => void;
}): Promise<HostFilesResult> {
  const { source, warn } = opts;
  const files: HostFile[] = [];
  const shipped = new Map<string, Promise<string | null>>();
  let total = 0;
  let overBudget = false;

  /** The stored `/assets/host/…` URL for a host path, reading it the first time. */
  const ship = (path: string): Promise<string | null> => {
    // One read per file, however many references reach it at once.
    let pending = shipped.get(path);
    if (!pending) {
      pending = readOnce(path);
      shipped.set(path, pending);
    }
    return pending;
  };
  const readOnce = async (path: string): Promise<string | null> => {
    const type = SHIPPABLE[extension(path)];
    if (!type || files.length >= MAX_FILES) return null;
    let bytes = await source.read(path);
    if (!bytes) {
      warn(`host file /${path} isn't in ${source.label}; the design won't show it.`);
      return null;
    }
    if (!looksLike(type, bytes)) {
      warn(`host file /${path} isn't a ${type} file; it's left out.`);
      return null;
    }
    if (bytes.byteLength > MAX_FILE_BYTES || total + bytes.byteLength > MAX_TOTAL_BYTES) {
      if (!overBudget) warn("host files exceed the size budget; the rest are left out.");
      overBudget = true;
      return null;
    }
    // The share page inlines SVG, and a host SVG was never sanitized.
    if (type === "image/svg+xml") {
      bytes = new TextEncoder().encode(sanitizeSvgMarkup(new TextDecoder().decode(bytes)));
    }
    total += bytes.byteLength;
    files.push({ path: `assets/host/${path}`, bytes, type });
    return `/assets/host/${path}`;
  };

  /** Rewrite every `url(…)` in CSS text that resolves to a host file, relative to `base`. */
  const rewriteCss = async (css: string, base: string): Promise<string> => {
    const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
    let out = css;
    for (const [match, , ref] of refs) {
      if (!ref || /^(?:data:|https?:|\/\/|#)/i.test(ref)) continue;
      const path = hostPath(new URL(ref, `http://host${base}`).pathname);
      const url = path ? await ship(path) : null;
      if (url) out = out.replace(match, `url("${url}")`);
    }
    return out;
  };

  const rewriteValue = async (key: string, value: unknown): Promise<unknown> => {
    if (typeof value === "string") {
      if (key === "style") return rewriteCss(value, "/");
      if (!FILE_PROPS.has(key)) return value;
      if (key.toLowerCase() === "srcset") {
        const parts = await Promise.all(
          value.split(",").map(async (candidate) => {
            const [ref = "", ...descriptor] = candidate.trim().split(/\s+/);
            const path = hostPath(ref);
            const url = path ? await ship(path) : null;
            return [url ?? ref, ...descriptor].join(" ");
          }),
        );
        return parts.join(", ");
      }
      const path = hostPath(value);
      return (path ? await ship(path) : null) ?? value;
    }
    if (key === "style" && value && typeof value === "object" && !Array.isArray(value)) {
      const style: Record<string, unknown> = {};
      for (const [name, v] of Object.entries(value)) {
        style[name] = typeof v === "string" && v.includes("url(") ? await rewriteCss(v, "/") : v;
      }
      return style;
    }
    return value;
  };

  const rewriteNode = async (node: Node): Promise<Node> => {
    if (!isComponentNode(node)) return node;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.props ?? {})) {
      if (key === "children" && Array.isArray(value)) {
        props.children = await Promise.all(
          value.map((run) =>
            run && typeof run === "object" ? rewriteNode(run as Node) : Promise.resolve(run),
          ),
        );
      } else if (key === "children" && value && typeof value === "object") {
        props.children = await rewriteNode(value as Node);
      } else {
        props[key] = await rewriteValue(key, value);
      }
    }
    return {
      ...node,
      ...(node.props ? { props } : {}),
      ...(node.children ? { children: await Promise.all(node.children.map(rewriteNode)) } : {}),
    };
  };

  const screens: Screen[] = [];
  for (const screen of opts.screens)
    screens.push({ ...screen, tree: await rewriteNode(screen.tree) });
  const snippets: Snippet[] = [];
  for (const snippet of opts.snippets) {
    snippets.push({ ...snippet, tree: await rewriteNode(snippet.tree) });
  }

  const stylesheets: string[] = [];
  for (const sheet of opts.stylesheets) {
    if (/^https:\/\//.test(sheet)) {
      stylesheets.push(sheet);
      continue;
    }
    // Only CSS is a stylesheet: the path is committed config, and a
    // repository must not be able to have some other file of the app's
    // stored as "the app's styles".
    const path = hostPath(sheet);
    if (!path || !/\.css$/i.test(path)) {
      warn(`host stylesheet ${sheet} isn't a .css path; it's left out.`);
      continue;
    }
    const bytes = await source.read(path);
    if (!bytes) {
      warn(`host stylesheet ${sheet} isn't in ${source.label}; the design is unstyled by it.`);
      continue;
    }
    const css = await rewriteCss(new TextDecoder().decode(bytes), `/${path}`);
    const shippedPath = `assets/host/${path}`;
    const encoded = new TextEncoder().encode(css);
    total += encoded.byteLength;
    files.push({ path: shippedPath, bytes: encoded, type: "text/css" });
    stylesheets.push(shippedPath);
  }
  return { screens, snippets, files, stylesheets };
}
