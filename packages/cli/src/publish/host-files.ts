/**
 * The host app's own files a published HTML design needs once the app isn't
 * there to serve them: the images and fonts its trees and stylesheets point at
 * (`/static/hero.jpg`, `url(../fonts/x.woff2)`) and the stylesheets
 * themselves. Each is fetched once from `hostApp.previewUrl`, shipped under
 * `assets/host/`, and every reference re-pointed at the shipped copy — the
 * viewer already resolves `/assets/…` against the share.
 */
import { isComponentNode, type Node, type Screen, type Snippet } from "@velloo/schema";
import { sanitizeSvgMarkup } from "@velloo/schema/svg-sanitize";

/** What the cloud stores, by extension. Anything else stays pointing at the host (and 404s). */
const SHIPPABLE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 200;
const FETCH_TIMEOUT_MS = 15_000;

/** Props whose string value the browser loads as a file (never `href`: that's a page). */
const FILE_PROPS = new Set(["src", "poster", "srcset", "srcSet"]);

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

/**
 * Ship the host files `screens`, `snippets` and `stylesheets` reference.
 * `origin` is the app's local preview URL; with none, nothing is fetched and
 * the trees travel unchanged.
 */
export async function shipHostFiles(opts: {
  origin: URL | null;
  stylesheets: string[];
  screens: Screen[];
  snippets: Snippet[];
  warn: (message: string) => void;
  fetch?: typeof fetch;
}): Promise<HostFilesResult> {
  const { origin, warn } = opts;
  const get = opts.fetch ?? fetch;
  const files: HostFile[] = [];
  const shipped = new Map<string, Promise<string | null>>();
  let total = 0;
  let overBudget = false;

  const fetchHost = async (path: string): Promise<Response | null> => {
    if (!origin) return null;
    const url = new URL(`/${path.split("/").map(encodeURIComponent).join("/")}`, origin);
    try {
      const response = await get(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  };

  /** The shipped `/assets/host/…` URL for a host path, fetching it the first time. */
  const ship = (path: string): Promise<string | null> => {
    // One fetch per file, however many references reach it at once.
    let pending = shipped.get(path);
    if (!pending) {
      pending = fetchOnce(path);
      shipped.set(path, pending);
    }
    return pending;
  };
  const fetchOnce = async (path: string): Promise<string | null> => {
    const type = SHIPPABLE[extension(path)];
    if (!type || files.length >= MAX_FILES) return null;
    const response = await fetchHost(path);
    if (!response) {
      warn(
        `host file /${path} could not be fetched from the app; the published page won't show it.`,
      );
      return null;
    }
    let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES || total + bytes.byteLength > MAX_TOTAL_BYTES) {
      if (!overBudget) warn("host files exceed the publish budget; the rest stay unpublished.");
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

  if (!origin) return { screens: opts.screens, snippets: opts.snippets, files, stylesheets: [] };

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
    const path = hostPath(sheet);
    const response = path ? await fetchHost(path) : null;
    if (!path || !response) {
      warn(
        `host stylesheet ${sheet} could not be fetched from the app; the published page is unstyled by it.`,
      );
      continue;
    }
    const css = await rewriteCss(await response.text(), `/${path}`);
    const shippedPath = `assets/host/${path.replace(/\.css$/i, "")}.css`;
    const bytes = new TextEncoder().encode(css);
    total += bytes.byteLength;
    files.push({ path: shippedPath, bytes, type: "text/css" });
    stylesheets.push(shippedPath);
  }
  return { screens, snippets, files, stylesheets };
}
