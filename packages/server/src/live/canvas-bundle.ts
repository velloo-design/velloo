import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanvasBundleSpec } from "@velloo/provider";
import type { BundleError, BundleResult } from "./bundle-core.ts";

export type { CanvasBundleSpec };

/**
 * The framework-native canvas bundle (#18 — render the project's *actually
 * installed* components). Where `bundleComponents` bundles opt-in `render:"live"`
 * extensions, this bundles a whole framework's component set from the host app's
 * `node_modules` into one self-contained browser ESM exporting `mountScreen` —
 * so the canvas can client-render a screen against the user's EXACT installed
 * version, not velloo's pre-bundled copy.
 *
 * Self-contained on purpose: the generated entry imports ONLY host packages
 * (the framework + React + emotion) and inlines its own tiny tree interpreter +
 * overlay shims. It links no velloo package, so it builds the same whether
 * velloo runs from source or the installed binary (which can't resolve
 * `@velloo/*` for a runtime `Bun.build`). The render path falls back to
 * in-process SSR whenever the host package isn't installed or the build fails.
 */

/** Resolve a specifier from the host app, or record a structured error. */
function tryResolve(spec: string, hostRoot: string): { path?: string; error?: BundleError } {
  try {
    return { path: Bun.resolveSync(spec, hostRoot) };
  } catch (err) {
    return {
      error: { importPath: spec, message: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Build the canvas bundle for `spec` against the host app at `hostRoot`. Returns
 * the empty module + structured errors (never throws) when the framework, React,
 * or emotion can't be resolved — the caller then keeps the SSR output.
 */
export async function buildCanvasBundle(
  hostRoot: string,
  spec: CanvasBundleSpec,
  minify = false,
): Promise<BundleResult> {
  const errors: BundleError[] = [];
  const need = (s: string): string | undefined => {
    const r = tryResolve(s, hostRoot);
    if (r.error) errors.push(r.error);
    return r.path;
  };

  const reactPath = need("react");
  const reactDomClientPath = need("react-dom/client");
  const emotionCachePath = need("@emotion/cache");
  const emotionReactPath = need("@emotion/react");
  const stylesPath = need(spec.stylesModule);
  if (!reactPath || !reactDomClientPath || !emotionCachePath || !emotionReactPath || !stylesPath) {
    return { code: "export function mountScreen() {}\n", errors };
  }

  // Standard components resolve to `<moduleBase>/<id>`; overlays are inline shims.
  const real = spec.componentIds.filter((id) => !spec.overlayIds.includes(id));
  const resolved: { id: string; path: string }[] = [];
  for (const id of real) {
    const r = tryResolve(`${spec.moduleBase}/${id}`, hostRoot);
    if (r.path) resolved.push({ id, path: r.path });
    else if (r.error) errors.push(r.error);
  }
  if (resolved.length === 0) return { code: "export function mountScreen() {}\n", errors };

  const entrySource = buildCanvasEntry({
    reactPath,
    reactDomClientPath,
    emotionCachePath,
    emotionReactPath,
    stylesPath,
    emotionKey: spec.emotionKey,
    components: resolved,
    overlayIds: spec.overlayIds,
  });

  const key = Bun.hash(`${hostRoot}:${spec.moduleBase}`).toString(16);
  const dir = join(tmpdir(), "velloo-canvas", key);
  await mkdir(dir, { recursive: true });
  const entryPath = join(dir, "entry.tsx");
  await writeFile(entryPath, entrySource, "utf8");

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    format: "esm",
    minify,
    sourcemap: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) {
    for (const log of result.logs)
      errors.push({ message: typeof log === "string" ? log : log.message });
    return { code: "export function mountScreen() {}\n", errors };
  }
  const output = result.outputs[0];
  if (!output) {
    errors.push({ message: "Bun.build produced no canvas-bundle artifact." });
    return { code: "export function mountScreen() {}\n", errors };
  }
  return { code: await output.text(), errors };
}

/**
 * The self-contained entry: import the host React + emotion + framework
 * components, define inline canvas-safe overlays + a tree interpreter that turns
 * a resolved screen JSON (snippets/params already inlined server-side) into a
 * React tree, and export `mountScreen({ tree, themeOptions, el })`.
 */
function buildCanvasEntry(opts: {
  reactPath: string;
  reactDomClientPath: string;
  emotionCachePath: string;
  emotionReactPath: string;
  stylesPath: string;
  emotionKey: string;
  components: { id: string; path: string }[];
  overlayIds: string[];
}): string {
  const imports = opts.components
    .map((c, i) => `import __c${i} from ${JSON.stringify(c.path)};`)
    .join("\n");
  const registry = opts.components.map((c, i) => `  ${JSON.stringify(c.id)}: __c${i},`).join("\n");
  return `import * as React from ${JSON.stringify(opts.reactPath)};
import { createRoot } from ${JSON.stringify(opts.reactDomClientPath)};
import createCache from ${JSON.stringify(opts.emotionCachePath)};
import { CacheProvider } from ${JSON.stringify(opts.emotionReactPath)};
import { ThemeProvider, createTheme } from ${JSON.stringify(opts.stylesPath)};
${imports}

var registry = {
${registry}
};

function chrome(p) {
  return { className: typeof p.className === "string" ? p.className : undefined, "data-node-path": p["data-node-path"] };
}
function msx(base, sx) {
  return sx && typeof sx === "object" && !Array.isArray(sx) ? Object.assign({}, base, sx) : base;
}
function el(Comp, props, kids) {
  return React.createElement.apply(React, [Comp, props].concat(kids));
}
// Canvas-safe overlay shims (rendered open + inline; no portal/backdrop).
var Paper = registry.Paper, Box = registry.Box;
var DW = { xs: 360, sm: 480, md: 600, lg: 800, xl: 960 };
var overlays = {
  Dialog: function (p) {
    var w = (typeof p.maxWidth === "string" && DW[p.maxWidth]) || 600;
    return el(Paper, Object.assign({ elevation: 8 }, chrome(p), { sx: msx({ width: "100%", maxWidth: w, mx: "auto", my: 2, borderRadius: 2, overflow: "hidden" }, p.sx) }), p.__kids || []);
  },
  Menu: function (p) {
    return el(Paper, Object.assign({ elevation: 3 }, chrome(p), { sx: msx({ display: "inline-block", minWidth: 180, py: 1, borderRadius: 1.5 }, p.sx) }), p.__kids || []);
  },
  Popover: function (p) {
    return el(Paper, Object.assign({ elevation: 3 }, chrome(p), { sx: msx({ display: "inline-block", p: 2, borderRadius: 1.5 }, p.sx) }), p.__kids || []);
  },
  Drawer: function (p) {
    return el(Paper, Object.assign({ elevation: 2, square: true }, chrome(p), { sx: msx({ width: 280, height: "100%", p: 2 }, p.sx) }), p.__kids || []);
  },
  Snackbar: function (p) {
    var body = p.message !== undefined ? p.message : p.__kids;
    return el(Box, Object.assign({}, chrome(p), { sx: msx({ display: "inline-flex", alignItems: "center", px: 2, py: 1.25, bgcolor: "grey.900", color: "common.white", borderRadius: 1, fontSize: 14 }, p.sx) }), body || []);
  },
};

// Tree interpreter: a resolved node is { ref, props, children } (snippets/params
// already inlined server-side); a string/number is text content.
function build(node) {
  if (node == null) return null;
  if (typeof node === "string" || typeof node === "number") return node;
  var ref = node.ref;
  var props = Object.assign({}, node.props);
  var kids = (node.children || []).map(build);
  var overlay = overlays[ref];
  if (overlay) {
    props.__kids = kids;
    return React.createElement(overlay, props);
  }
  var Comp = registry[ref] || ref;
  return el(Comp, props, kids);
}

export function mountScreen(opts) {
  var cache = createCache({ key: ${JSON.stringify(opts.emotionKey)}, prepend: true });
  var theme = createTheme(opts.themeOptions || {});
  var root = createRoot(opts.el);
  root.render(
    React.createElement(CacheProvider, { value: cache },
      React.createElement(ThemeProvider, { theme: theme }, build(opts.tree))),
  );
  return root;
}
export { React };
`;
}
