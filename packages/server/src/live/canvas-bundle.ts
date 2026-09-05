import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helpersComponentsDir } from "@velloo/helpers/paths";
import type {
  CanvasBundleSpec,
  CanvasComponentFidelity,
  CanvasComponentSource,
  CanvasComponentSpec,
  CanvasStyleRuntime,
} from "@velloo/provider";
import { schemaSrcDir } from "@velloo/schema/paths";
import type { BunPlugin } from "bun";
import { aliasPlugin, type BundleError, type BundleResult, resolveImport } from "./bundle-core.ts";

export type { CanvasBundleSpec };

export interface CanvasComponentDiagnostic {
  id: string;
  status: CanvasComponentFidelity | "unavailable";
  importPath?: string;
  note?: string;
  errors?: string[];
}

export interface CanvasBundleResult extends BundleResult {
  usable: boolean;
  diagnostics: CanvasComponentDiagnostic[];
}

interface ResolvedComponent {
  id: string;
  path: string;
  exportName: string;
}

const EMPTY = "export function mountScreen() {}\n";

/** Build the browser registry for only the component refs used by one screen. */
export async function buildCanvasBundle(
  hostRoot: string,
  spec: CanvasBundleSpec,
  componentIds: readonly string[],
  aliases: { from: string; to: string }[] = [],
  minify = false,
): Promise<CanvasBundleResult> {
  const errors: BundleError[] = [];
  const runtimePaths = resolveRuntime(hostRoot, spec.styleRuntime, errors);
  if (!runtimePaths) return { code: EMPTY, errors, usable: false, diagnostics: [] };

  const overlayIds = new Set(spec.overlayIds ?? []);
  const requested = new Set(componentIds);
  if ([...overlayIds].some((id) => requested.has(id))) {
    requested.add("Paper");
    requested.add("Box");
  }
  let declared: CanvasComponentSpec[];
  try {
    declared = await spec.components([...requested]);
  } catch (error) {
    // `components()` reads the provider's manifest, which can fail on a corrupt
    // host `manifest.json`. The never-throws contract keeps the caller on SSR
    // instead of 500ing the frame render.
    errors.push({ message: messageOf(error) });
    return { code: EMPTY, errors, usable: false, diagnostics: [] };
  }
  const byId = new Map(declared.map((entry) => [entry.id, entry]));
  const diagnostics: CanvasComponentDiagnostic[] = [];
  const resolved: ResolvedComponent[] = [];
  const preflight = new Map<string, Promise<string[]>>();
  const plugins = [
    aliasPlugin(hostRoot, aliases),
    hostRuntimePlugin(hostRoot),
    vellooSourcePlugin(),
  ];

  for (const id of requested) {
    // Overlay ids never read the registry — `build()` routes them to the inline
    // canvas-safe shims — so resolving (and bundling) the real portal-heavy
    // module is dead weight, and a resolve failure must not fail the screen.
    if (overlayIds.has(id)) {
      const note = byId.get(id)?.sources[0]?.note;
      diagnostics.push({ id, status: "adapted", ...(note ? { note } : {}) });
      continue;
    }
    const component = byId.get(id);
    if (!component || component.sources.length === 0) {
      diagnostics.push({
        id,
        status: "unavailable",
        note: "No browser-canvas source is registered; an explicit placeholder is rendered.",
      });
      continue;
    }
    const failures: string[] = [];
    let chosen: { source: CanvasComponentSource; path: string } | undefined;
    for (const source of component.sources) {
      let path: string;
      try {
        path = resolveImport(source.importPath, hostRoot, aliases);
      } catch (error) {
        failures.push(`${source.importPath}: ${messageOf(error)}`);
        continue;
      }
      if (source.preflight) {
        let check = preflight.get(path);
        if (!check) {
          check = preflightSource(path, plugins);
          preflight.set(path, check);
        }
        const compileErrors = await check;
        if (compileErrors.length > 0) {
          failures.push(...compileErrors.map((error) => `${source.importPath}: ${error}`));
          continue;
        }
      }
      chosen = { source, path };
      break;
    }
    if (!chosen) {
      const note = component.sources.at(-1)?.note;
      diagnostics.push({
        id,
        status: "unavailable",
        ...(note ? { note } : {}),
        ...(failures.length > 0 ? { errors: failures } : {}),
      });
      continue;
    }
    resolved.push({ id, path: chosen.path, exportName: chosen.source.exportName ?? id });
    diagnostics.push({
      id,
      status: chosen.source.fidelity,
      importPath: chosen.source.importPath,
      ...(chosen.source.note ? { note: chosen.source.note } : {}),
      ...(failures.length > 0 ? { errors: failures } : {}),
    });
  }

  // A ref the bundle cannot render at all (every source failed, or the ref is
  // an extension the provider knows nothing about) would client-mount as a
  // placeholder box AND hide the SSR body that rendered it correctly. Partial
  // fidelity is fine — `adapted`/`fallback` still render the component — but a
  // hole is strictly worse than staying on SSR, so refuse the whole mount.
  const unavailable = diagnostics.filter((entry) => entry.status === "unavailable");
  if (unavailable.length > 0 || resolved.length === 0) {
    for (const entry of unavailable) {
      errors.push({ message: `${entry.id}: ${entry.errors?.join("; ") ?? "no browser source"}` });
    }
    return { code: EMPTY, errors, usable: false, diagnostics };
  }

  const entrySource = buildCanvasEntry({
    ...runtimePaths,
    styleRuntime: spec.styleRuntime,
    components: resolved,
    overlayIds: spec.overlayIds ?? [],
    diagnostics,
  });
  const key = Bun.hash(
    `${hostRoot}:${JSON.stringify(resolved.map((entry) => [entry.id, entry.path, entry.exportName]))}:${JSON.stringify(spec.styleRuntime)}`,
  ).toString(16);

  try {
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
      plugins,
    });
    if (!result.success) {
      for (const log of result.logs) errors.push({ message: log.message });
      return { code: EMPTY, errors, usable: false, diagnostics };
    }
    const output = result.outputs[0];
    if (!output) {
      errors.push({ message: "Bun.build produced no canvas-bundle artifact." });
      return { code: EMPTY, errors, usable: false, diagnostics };
    }
    return { code: await output.text(), errors, usable: true, diagnostics };
  } catch (error) {
    for (const item of error instanceof AggregateError ? error.errors : [error]) {
      errors.push({ message: messageOf(item) });
    }
    return { code: EMPTY, errors, usable: false, diagnostics };
  }
}

function resolveRuntime(
  hostRoot: string,
  runtime: CanvasStyleRuntime,
  errors: BundleError[],
):
  | {
      reactPath: string;
      reactDomClientPath: string;
      emotionCachePath?: string;
      emotionReactPath?: string;
      stylesPath?: string;
    }
  | undefined {
  const need = (specifier: string): string | undefined => {
    try {
      return Bun.resolveSync(specifier, hostRoot);
    } catch (error) {
      errors.push({ importPath: specifier, message: messageOf(error) });
      return undefined;
    }
  };
  const reactPath = need("react");
  const reactDomClientPath = need("react-dom/client");
  if (!reactPath || !reactDomClientPath) return undefined;
  if (runtime.kind === "none") return { reactPath, reactDomClientPath };
  const emotionCachePath = need("@emotion/cache");
  const emotionReactPath = need("@emotion/react");
  const stylesPath = need(runtime.stylesModule);
  if (!emotionCachePath || !emotionReactPath || !stylesPath) return undefined;
  return { reactPath, reactDomClientPath, emotionCachePath, emotionReactPath, stylesPath };
}

async function preflightSource(path: string, plugins: BunPlugin[]): Promise<string[]> {
  try {
    const result = await Bun.build({
      entrypoints: [path],
      target: "browser",
      format: "esm",
      sourcemap: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins,
    });
    return result.success ? [] : result.logs.map((log) => log.message);
  } catch (error) {
    return (error instanceof AggregateError ? error.errors : [error]).map(messageOf);
  }
}

/**
 * Bare packages the bundle resolves from the HOST app rather than from the
 * importing file. React is mandatory (one copy, the host's — the whole reason
 * this bundles client-side at all). The rest are the peer deps velloo-owned
 * browser sources carry: the shadcn snapshot's components import `radix-ui`,
 * `lucide-react` and `class-variance-authority`, and the helpers' `cn` imports
 * `clsx` + `tailwind-merge`. Those sit in the monorepo's node_modules from
 * source, but the installed binary inlines them into `cli.js` and ships only
 * the bare .tsx under `dist/pkgs/*` — where the importer-relative walk finds
 * nothing. A shadcn host app has all of them, so resolve there.
 */
const HOST_PACKAGES = [
  "react",
  "react-dom",
  "radix-ui",
  "@radix-ui",
  "lucide-react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
];

function hostRuntimePlugin(hostRoot: string): BunPlugin {
  // Narrow the filter to packages the host actually has. A matched-but-undefined
  // onResolve is the hazard called out in packages/cli/build.ts — it defeats
  // Bun's importer-relative resolution — so never match what we can't answer.
  const available = HOST_PACKAGES.filter((name) => {
    try {
      Bun.resolveSync(name === "@radix-ui" ? "@radix-ui/react-slot" : name, hostRoot);
      return true;
    } catch {
      return false;
    }
  });
  return {
    name: "velloo-host-packages",
    setup(build) {
      if (available.length === 0) return;
      const filter = new RegExp(
        `^(${available.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?:/.*)?$`,
      );
      build.onResolve({ filter }, (args) => ({ path: Bun.resolveSync(args.path, hostRoot) }));
    },
  };
}

/**
 * Resolve the `@velloo/*` specifiers that velloo-owned browser sources import.
 * The shadcn snapshot's `lib/utils` re-exports `cn` from `@velloo/helpers`, and
 * the helpers import zero-dependency leaves from `@velloo/schema/*`. Both are
 * plain source on disk, but the installed binary inlines every `@velloo/*`
 * package into `cli.js` and ships only the bare `.tsx` under `dist/pkgs` — so
 * the importer-relative walk finds no node_modules and the whole screen bundle
 * fails. Mapping them to the shipped source keeps the client mount working from
 * the binary exactly as it does from the monorepo.
 *
 * Only the leaf subpaths are mapped: `@velloo/schema` proper pulls the zod
 * graph, which has no business in a browser bundle. An import of the bare index
 * fails loudly here and the caller cleanly stays on SSR.
 */
function vellooSourcePlugin(): BunPlugin {
  return {
    name: "velloo-owned-source",
    setup(build) {
      build.onResolve({ filter: /^@velloo\/helpers$/ }, () => ({
        path: join(helpersComponentsDir, "index.ts"),
      }));
      build.onResolve({ filter: /^@velloo\/schema\/[a-z-]+$/ }, (args) => ({
        path: join(schemaSrcDir, `${args.path.slice("@velloo/schema/".length)}.ts`),
      }));
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildCanvasEntry(opts: {
  reactPath: string;
  reactDomClientPath: string;
  emotionCachePath?: string;
  emotionReactPath?: string;
  stylesPath?: string;
  styleRuntime: CanvasStyleRuntime;
  components: ResolvedComponent[];
  overlayIds: string[];
  diagnostics: CanvasComponentDiagnostic[];
}): string {
  const imports = opts.components
    .map((component, index) => `import * as __m${index} from ${JSON.stringify(component.path)};`)
    .join("\n");
  const registry = opts.components
    .map(
      (component, index) =>
        `  ${JSON.stringify(component.id)}: pick(__m${index}, ${JSON.stringify(component.exportName)}),`,
    )
    .join("\n");
  const emotionImports =
    opts.styleRuntime.kind === "emotion"
      ? `import createCache from ${JSON.stringify(opts.emotionCachePath)};\nimport { CacheProvider } from ${JSON.stringify(opts.emotionReactPath)};\nimport { ThemeProvider, createTheme } from ${JSON.stringify(opts.stylesPath)};`
      : "";
  const renderBody =
    opts.styleRuntime.kind === "emotion"
      ? `var cache = createCache({ key: ${JSON.stringify(opts.styleRuntime.cacheKey)}, prepend: true });
  var theme = createTheme(opts.themeOptions || {});
  root.render(React.createElement(ErrorBoundary, { onError: opts.onError },
    React.createElement(CacheProvider, { value: cache },
      React.createElement(ThemeProvider, { theme: theme },
        React.createElement(React.Fragment, null, build(opts.tree), React.createElement(Ready, { onReady: opts.onReady }))))));`
      : `root.render(React.createElement(ErrorBoundary, { onError: opts.onError },
    React.createElement(React.Fragment, null, build(opts.tree), React.createElement(Ready, { onReady: opts.onReady }))));`;

  return `import * as React from ${JSON.stringify(opts.reactPath)};
import { createRoot } from ${JSON.stringify(opts.reactDomClientPath)};
${emotionImports}
${imports}

function pick(mod, id) {
  var direct = mod && mod[id];
  if (typeof direct === "function" || (direct && direct.$$typeof)) return direct;
  var value = mod;
  for (var i = 0; i < 4; i++) {
    if (typeof value === "function" || (value && value.$$typeof)) return value;
    if (value && typeof value === "object" && value.default !== undefined) { value = value.default; continue; }
    break;
  }
  return value;
}
var registry = {
${registry}
};
export const __velloo_canvas_diagnostics = ${JSON.stringify(opts.diagnostics)};

function chrome(props) { return { className: typeof props.className === "string" ? props.className : undefined, "data-node-path": props["data-node-path"] }; }
function mergeSx(base, sx) { return sx && typeof sx === "object" && !Array.isArray(sx) ? Object.assign({}, base, sx) : base; }
function element(Component, props, children) { return React.createElement.apply(React, [Component, props].concat(children)); }
var Paper = registry.Paper, MuiBox = registry.Box;
var widths = { xs: 360, sm: 480, md: 600, lg: 800, xl: 960 };
var overlays = {
  Dialog: function (p) { return element(Paper || "div", Object.assign({ elevation: 8 }, chrome(p), { sx: mergeSx({ width: "100%", maxWidth: widths[p.maxWidth] || 600, mx: "auto", my: 2, borderRadius: 2, overflow: "hidden" }, p.sx) }), p.__kids || []); },
  Menu: function (p) { return element(Paper || "div", Object.assign({ elevation: 3 }, chrome(p), { sx: mergeSx({ display: "inline-block", minWidth: 180, py: 1, borderRadius: 1.5 }, p.sx) }), p.__kids || []); },
  Popover: function (p) { return element(Paper || "div", Object.assign({ elevation: 3 }, chrome(p), { sx: mergeSx({ display: "inline-block", p: 2, borderRadius: 1.5 }, p.sx) }), p.__kids || []); },
  Drawer: function (p) { return element(Paper || "div", Object.assign({ elevation: 2, square: true }, chrome(p), { sx: mergeSx({ width: 280, height: "100%", p: 2 }, p.sx) }), p.__kids || []); },
  Snackbar: function (p) { return element(MuiBox || "div", Object.assign({}, chrome(p), { sx: mergeSx({ display: "inline-flex", alignItems: "center", px: 2, py: 1.25, bgcolor: "grey.900", color: "common.white", borderRadius: 1, fontSize: 14 }, p.sx) }), p.message !== undefined ? [p.message] : (p.__kids || [])); },
};
var overlayIds = new Set(${JSON.stringify(opts.overlayIds)});
function Missing(props) {
  // NB: never name this prop \`ref\` — React <=18 strips it into element.ref and a
  // string ref with no owner throws during reconciliation, taking down the mount.
  return React.createElement("div", { "data-velloo-component-fallback": props.componentId, "data-node-path": props["data-node-path"], style: { border: "1px dashed currentColor", borderRadius: 6, padding: 12, opacity: .7, font: "12px ui-monospace, monospace" } }, props.children && props.children.length ? props.children : "Unavailable component: " + props.componentId);
}
function build(node) {
  if (node == null) return null;
  if (typeof node === "string" || typeof node === "number") return node;
  var ref = node.ref;
  var props = Object.assign({}, node.props);
  var children = (node.children || []).map(build);
  if (overlayIds.has(ref) && overlays[ref]) { props.__kids = children; return React.createElement(overlays[ref], props); }
  var Component = registry[ref];
  return Component ? element(Component, props, children) : React.createElement(Missing, Object.assign({}, props, { componentId: ref, children: children }));
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { if (this.props.onError) this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function Ready(props) { React.useEffect(function () { if (props.onReady) props.onReady(); }, []); return null; }
export function mountScreen(opts) {
  var root = createRoot(opts.el);
  ${renderBody}
  return root;
}
export { React };
`;
}
