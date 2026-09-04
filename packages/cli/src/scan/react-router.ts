import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { idFromRoutePath, nameFromRoutePath } from "./route-names.ts";
import type { ScannedRoute, ScanResult } from "./types.ts";
import { dirExists, walkFiles } from "./walk.ts";

/**
 * Route extraction for config-based React Router apps (`createBrowserRouter`
 * object trees and `<Route>` JSX). Unlike the file-convention scanners, the
 * routes live in code, so this parses source text: deliberately forgiving
 * (a route we can't parse is dropped, never a crash) and structural rather
 * than a full AST — it tracks braces/strings/comments to recover the route
 * tree with correct nesting, which is all the scan needs.
 */

/** One route object/element as parsed from source, before path resolution. */
interface RouteNode {
  path?: string;
  index?: boolean;
  /** Component name from `element: <X …>` / `Component: X`. */
  element?: string;
  children: RouteNode[];
}

const MAX_FILES = 400;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_ROUTES = 200;

/** Files that are never route config, whatever their content matches. */
function isNoiseFile(file: string): boolean {
  const base = basename(file);
  if (/\.(test|spec|stories)\.[jt]sx?$/.test(base)) return true;
  return /\/(__tests__|__mocks__|mocks|stories|e2e|tests)\//.test(file);
}

/** Cheap content gate before the structural parse runs. */
function looksLikeRouteConfig(content: string): boolean {
  if (/\bcreate(Browser|Hash|Memory)Router\s*\(/.test(content)) return true;
  if (/\bcreateRoutesFromElements\s*\(/.test(content)) return true;
  if (/<Route[\s/>]/.test(content)) return true;
  // A plain route-object module (imported into createBrowserRouter elsewhere).
  return /\bpath\s*:\s*["'`]/.test(content) && /\b(element|Component)\s*:/.test(content);
}

/** True at `i` when the char starts a property position (after `{`, `,` or line start). */
function atPropertyPosition(src: string, i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const c = src[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c === "{" || c === ",";
  }
  return true;
}

/**
 * Parse `{ path: "...", element: <X/>, children: [...] }` route trees out of
 * a source file by tracking brace nesting. Every `{…}` becomes a candidate
 * node; non-route braces (function bodies, JSX expressions, `sx={{…}}`) fall
 * out later because they carry no path/index/element and no route children.
 */
function parseObjectRoutes(src: string): RouteNode[] {
  const roots: RouteNode[] = [];
  const stack: RouteNode[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    // Skip strings (routes only care about structure outside them).
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "{") {
      stack.push({ children: [] });
      i++;
      continue;
    }
    if (c === "}") {
      const node = stack.pop();
      if (node) {
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      i++;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top && c && /[A-Za-z]/.test(c) && atPropertyPosition(src, i)) {
      const rest = src.slice(i, i + 200);
      const path = rest.match(/^path\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/);
      const pathValue = path ? (path[1] ?? path[2] ?? path[3]) : undefined;
      if (path && pathValue !== undefined) {
        top.path = pathValue;
        i += path[0].length;
        continue;
      }
      const index = rest.match(/^index\s*:\s*true/);
      if (index) {
        top.index = true;
        i += index[0].length;
        continue;
      }
      const element = rest.match(/^(?:element|Component)\s*:\s*\(?\s*<?\s*([A-Z][\w.]*)/);
      if (element?.[1] !== undefined) {
        top.element = element[1];
        i += element[0].length;
        continue;
      }
    }
    i++;
  }
  return roots;
}

/**
 * Parse `<Route path="…" element={…}>` JSX trees (the `<Routes>` /
 * `createRoutesFromElements` style). Attribute scanning is brace-aware so an
 * `element={<Navigate to="/" />}` with its inner `/>` doesn't end the tag.
 */
function parseJsxRoutes(src: string): RouteNode[] {
  const roots: RouteNode[] = [];
  const stack: RouteNode[] = [];
  const open = /<Route\b/g;
  const close = /<\/Route\s*>/g;

  interface Tag {
    at: number;
    kind: "open" | "close";
    node?: RouteNode;
    selfClosing?: boolean;
  }
  const tags: Tag[] = [];

  for (const m of src.matchAll(open)) {
    const start = m.index;
    // Scan to the tag's real `>`: braces nest JSX expressions, quotes nest strings.
    let i = start + m[0].length;
    let depth = 0;
    let attrs = "";
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'") {
        const q = c;
        const from = i;
        i++;
        while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
        i++;
        attrs += src.slice(from, i);
        continue;
      }
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (c === ">" && depth === 0) break;
      attrs += c;
      i++;
    }
    const selfClosing = attrs.trimEnd().endsWith("/");
    const node: RouteNode = { children: [] };
    const path = attrs.match(
      /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)')\s*\})/,
    );
    const pathAttr = path ? (path[1] ?? path[2] ?? path[3] ?? path[4]) : undefined;
    if (pathAttr !== undefined) node.path = pathAttr;
    if (/\bindex\b(?!\s*=\s*\{?\s*false)/.test(attrs)) node.index = true;
    const element = attrs.match(/\b(?:element|Component)\s*=\s*\{?\s*<?\s*([A-Z][\w.]*)/);
    if (element?.[1] !== undefined) node.element = element[1];
    tags.push({ at: start, kind: "open", node, selfClosing });
  }
  for (const m of src.matchAll(close)) {
    tags.push({ at: m.index, kind: "close" });
  }
  tags.sort((a, b) => a.at - b.at);

  for (const tag of tags) {
    if (tag.kind === "open" && tag.node) {
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(tag.node);
      else roots.push(tag.node);
      if (!tag.selfClosing) stack.push(tag.node);
    } else if (tag.kind === "close") {
      stack.pop();
    }
  }
  return roots;
}

/** `:id` / `:id?` → `[id]`, matching the bracket convention the id/name logic reads. */
function normalizeParams(path: string): string {
  return path.replace(/:(\w+)\??/g, "[$1]").replace(/\?/g, "");
}

function joinPaths(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  const joined = `${base === "/" ? "" : base}/${path}`;
  return joined.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/**
 * Flatten a parsed node tree into concrete route paths. Layout nodes
 * (element + children, no path) pass their base through; wrapper braces with
 * neither route fields nor route descendants contribute nothing. `Navigate`
 * elements (redirects) and splat paths aren't designable pages.
 */
function collectPaths(nodes: RouteNode[], base: string, out: Map<string, true>): void {
  for (const node of nodes) {
    if (out.size >= MAX_ROUTES) return;
    const resolved = node.path ? joinPaths(base, normalizeParams(node.path)) : base;
    if (node.children.length > 0) {
      collectPaths(node.children, resolved, out);
      // A parent with a path is usually a layout; its index child re-adds the
      // path. When it has an element and no index child, it renders there too.
      if (node.path && node.element && !node.children.some((c) => c.index)) {
        addPath(node, resolved, out);
      }
      continue;
    }
    if (node.index) addPath(node, base, out);
    else if (node.path) addPath(node, resolved, out);
  }
}

function addPath(node: RouteNode, routePath: string, out: Map<string, true>): void {
  if (node.element === "Navigate") return;
  if (routePath.includes("*")) return;
  out.set(routePath, true);
}

/**
 * Scan a config-based React Router app. Returns null when no route config
 * was found — the caller falls back to the generic pages-dir walk.
 */
export async function scanReactRouter(appRoot: string): Promise<ScanResult | null> {
  const srcDir = join(appRoot, "src");
  const root = (await dirExists(srcDir)) ? srcDir : appRoot;

  const paths = new Map<string, true>();
  const sources = new Map<string, string>();
  let seen = 0;
  for await (const file of walkFiles(root)) {
    if (seen >= MAX_FILES || paths.size >= MAX_ROUTES) break;
    if (!/\.[jt]sx?$/.test(file) || isNoiseFile(file)) continue;
    seen++;
    const content = await readFile(file, "utf8").catch(() => null);
    if (!content || content.length > MAX_FILE_BYTES || !looksLikeRouteConfig(content)) continue;

    const before = paths.size;
    collectPaths(parseObjectRoutes(content), "/", paths);
    collectPaths(parseJsxRoutes(content), "/", paths);
    if (paths.size > before) {
      for (const p of paths.keys()) if (!sources.has(p)) sources.set(p, file);
    }
  }
  if (paths.size === 0) return null;

  const routes: ScannedRoute[] = [...paths.keys()].map((routePath) => ({
    id: idFromRoutePath(routePath),
    name: nameFromRoutePath(routePath),
    routePath,
    sourceFile: sources.get(routePath) ?? root,
  }));
  // Same policy as the other scanners: first id wins, index first then alpha.
  const dedupedIds = new Set<string>();
  const deduped = routes.filter((r) => {
    if (dedupedIds.has(r.id)) return false;
    dedupedIds.add(r.id);
    return true;
  });
  deduped.sort((a, b) => {
    if (a.id === "index") return -1;
    if (b.id === "index") return 1;
    return a.id.localeCompare(b.id);
  });
  return { framework: "react-router", routes: deduped, routesRoot: root };
}
