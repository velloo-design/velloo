import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { helpersComponentsDir } from "@velloo/helpers/paths";
import type {
  CanvasBundleSpec,
  CanvasComponentFidelity,
  CanvasComponentSource,
  CanvasComponentSpec,
  CanvasStyleRuntime,
} from "@velloo/provider";
import { parseRepoKey, type RepoComponentRef } from "@velloo/schema";
import { schemaSrcDir } from "@velloo/schema/paths";
import type { BunPlugin } from "bun";
import type { PreviewEntry } from "../repo/preview.ts";
import type { FrameworkRecipe } from "../repo/recipes/index.ts";
import { recipeForSpecifier } from "../repo/recipes/index.ts";
import { scanModule } from "../repo/source-scan.ts";
import { aliasPlugin, type BundleError, type BundleResult, resolveImport } from "./bundle-core.ts";

export type { CanvasBundleSpec };

/**
 * Why a repository component did not render exactly. Stable strings: agents,
 * evaluation reports and the canvas key off them.
 */
type RepoDiagnosticCode =
  | "resolve-failed"
  | "compile-failed"
  | "server-only"
  | "render-threw"
  | "missing-provider"
  | "unstyled"
  | "other-app-runtime"
  | "missing-export"
  | "static-fallback";

type RepoFidelity = "exact" | "adapted" | "unstyled" | "proxy" | "unavailable";

export interface CanvasComponentDiagnostic {
  id: string;
  status: CanvasComponentFidelity | RepoFidelity;
  importPath?: string;
  note?: string;
  errors?: string[];
  /** Repository components only: the JSX name, export, owning app and what stands in on failure. */
  name?: string;
  exportName?: string;
  app?: string;
  preview?: string;
  fallback?: string;
  code?: RepoDiagnosticCode;
  remedy?: string;
}

export interface CanvasBundleResult extends BundleResult {
  usable: boolean;
  diagnostics: CanvasComponentDiagnostic[];
  /**
   * Non-repository refs with no browser source, drawn from their server render
   * inside the mount. Only ever set when the screen has repository components:
   * those have nothing to fall back to on the server, so abandoning the mount
   * over a helper that won't compile would hide every real component.
   */
  staticRefs?: string[];
  /** Build measurements, checked against the budgets below. */
  metrics?: { buildMs: number; bytes: number };
  /** Absolute input files, for invalidating only the bundles an edit touches. */
  inputs?: string[];
}

/**
 * What a screen's repository components need from the daemon: where each app
 * lives, the preview entry wrapping the mount, and the recipes whose
 * adaptations and stylesheet probes apply.
 */
export interface RepoBundleInput {
  host(app: string | undefined): { hostRoot: string; aliases: { from: string; to: string }[] };
  preview(app: string | undefined): PreviewEntry;
  recipes: FrameworkRecipe[];
  /** The app whose React runtime the screen mounts with. */
  primaryApp: string | undefined;
}

/** Past these, a build still succeeds but the diagnostics say why the canvas feels slow. */
const BUNDLE_BUDGET = { buildMs: 8000, bytes: 6_000_000 };

interface ResolvedComponent {
  id: string;
  path: string;
  exportName: string;
}

interface ResolvedRepo {
  key: string;
  identity: RepoComponentRef;
  path: string;
  adaptation?: Record<string, unknown> | undefined;
  recipe?: FrameworkRecipe | undefined;
}

const EMPTY = "export function mountScreen() {}\n";

/** Build the browser registry for only the component refs used by one screen. */
export async function buildCanvasBundle(
  hostRoot: string,
  spec: CanvasBundleSpec | undefined,
  componentIds: readonly string[],
  aliases: { from: string; to: string }[] = [],
  minify = false,
  repo?: RepoBundleInput,
): Promise<CanvasBundleResult> {
  const started = performance.now();
  const errors: BundleError[] = [];
  const styleRuntime: CanvasStyleRuntime = spec?.styleRuntime ?? { kind: "none" };
  const runtimePaths = resolveRuntime(hostRoot, styleRuntime, errors);
  if (!runtimePaths) return { code: EMPTY, errors, usable: false, diagnostics: [] };

  const repoIds = componentIds.filter((id) => id.startsWith("repo:"));
  const hasRepo = repo !== undefined && repoIds.length > 0;
  const overlayIds = new Set(spec?.overlayIds ?? []);
  const requested = new Set(
    componentIds.filter((id) => !id.startsWith("repo:") && id !== STATIC_REF),
  );
  if ([...overlayIds].some((id) => requested.has(id))) {
    requested.add("Paper");
    requested.add("Box");
  }
  let declared: CanvasComponentSpec[] = [];
  try {
    declared = spec ? await spec.components([...requested]) : [];
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
    ...(radixShimPlugin(hostRoot) ?? []),
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
        note: "No browser-canvas source is registered for this ref, so the screen keeps its server render instead of client-mounting.",
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
        const compileErrors = await preflightOnce(preflight, path, plugins);
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

  const repoResolved = hasRepo
    ? await resolveRepoEntries(repoIds, repo, hostRoot, plugins, preflight, diagnostics)
    : [];

  // A non-repo ref the bundle cannot render at all (every source failed, or the
  // ref is an extension the provider knows nothing about) would client-mount as
  // a placeholder box AND hide the SSR body that rendered it correctly, so a
  // screen of provider components refuses the whole mount. A screen with
  // repository components has nothing better on the server for those, so the
  // blocked refs are drawn from their server render inside the mount instead.
  const unavailable = diagnostics.filter(
    (entry) => entry.status === "unavailable" && !entry.id.startsWith("repo:"),
  );
  const staticRefs = hasRepo ? unavailable.map((entry) => entry.id) : [];
  if (hasRepo) {
    for (const entry of unavailable) {
      entry.status = "fallback";
      entry.code = "static-fallback";
      entry.note =
        "No browser source compiles, so the canvas draws this component's server render inside the mount.";
    }
  } else if (unavailable.length > 0 || resolved.length === 0) {
    for (const entry of unavailable) {
      errors.push({ message: `${entry.id}: ${entry.errors?.join("; ") ?? "no browser source"}` });
    }
    return { code: EMPTY, errors, usable: false, diagnostics };
  }

  const previews = hasRepo ? previewImports(repo, repoResolved) : [];
  const build = async (repoEntries: ResolvedRepo[]) => {
    const entrySource = buildCanvasEntry({
      ...runtimePaths,
      styleRuntime,
      components: resolved,
      repo: repoEntries,
      previews,
      primaryApp: repo?.primaryApp,
      probes: probesFor(repoEntries),
      overlayIds: spec?.overlayIds ?? [],
      diagnostics,
    });
    const key = Bun.hash(
      `${hostRoot}:${JSON.stringify(resolved.map((entry) => [entry.id, entry.path, entry.exportName]))}:${JSON.stringify(repoEntries.map((entry) => [entry.key, entry.path]))}:${JSON.stringify(previews.map((p) => p.path))}:${JSON.stringify(styleRuntime)}`,
    ).toString(16);
    const dir = join(tmpdir(), "velloo-canvas", key);
    await mkdir(dir, { recursive: true });
    for (const preview of previews) {
      if (preview.source === undefined) continue;
      await mkdir(dirname(preview.path), { recursive: true });
      await writeFile(preview.path, preview.source, "utf8");
    }
    const entryPath = join(dir, "entry.tsx");
    await writeFile(entryPath, entrySource, "utf8");
    return Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
      minify,
      sourcemap: "none",
      metafile: true,
      define: {
        "process.env.NODE_ENV": '"production"',
        // Vite apps read `import.meta.env`; an empty public env keeps them from
        // throwing without handing any private variable to the browser.
        "import.meta.env": '{"MODE":"production","DEV":false,"PROD":true,"SSR":false}',
      },
      plugins: [...plugins, ...previewPlugins(previews, repo)],
    });
  };

  try {
    let result = await build(repoResolved);
    if (!result.success && repoResolved.length > 0) {
      // A repository module that passed preflight alone can still break the
      // shared build (a transitive edit since). Drop the repository entries
      // rather than the whole mount: they fall back per node like any other.
      const message = result.logs.map((log) => log.message).join("; ");
      for (const entry of repoResolved) {
        markRepo(diagnostics, entry.key, "unavailable", "compile-failed", message);
      }
      result = await build([]);
    }
    if (!result.success) {
      for (const log of result.logs) errors.push({ message: log.message });
      return { code: EMPTY, errors, usable: false, diagnostics };
    }
    const output = result.outputs.find((artifact) => artifact.kind === "entry-point");
    if (!output) {
      errors.push({ message: "Bun.build produced no canvas-bundle artifact." });
      return { code: EMPTY, errors, usable: false, diagnostics };
    }
    const css = (
      await Promise.all(
        result.outputs
          .filter((artifact) => artifact.kind !== "entry-point" && artifact.path.endsWith(".css"))
          .map((artifact) => artifact.text()),
      )
    ).join("\n");
    const code = (css ? injectCss(css) : "") + (await output.text());
    const metrics = { buildMs: Math.round(performance.now() - started), bytes: code.length };
    if (metrics.buildMs > BUNDLE_BUDGET.buildMs || metrics.bytes > BUNDLE_BUDGET.bytes) {
      errors.push({
        message: `The canvas bundle for this screen is over budget (${metrics.buildMs} ms, ${(metrics.bytes / 1e6).toFixed(1)} MB; budget ${BUNDLE_BUDGET.buildMs} ms, ${(BUNDLE_BUDGET.bytes / 1e6).toFixed(1)} MB). Split the screen or exclude heavy components with hostApp.components.exclude.`,
      });
    }
    const inputs = Object.keys(
      (result as { metafile?: { inputs?: Record<string, unknown> } }).metafile?.inputs ?? {},
    ).map((input) => (input.startsWith("/") ? input : join(process.cwd(), input)));
    return {
      code,
      errors,
      usable: true,
      diagnostics,
      ...(staticRefs.length > 0 ? { staticRefs } : {}),
      metrics,
      inputs,
    };
  } catch (error) {
    for (const item of error instanceof AggregateError ? error.errors : [error]) {
      errors.push({ message: messageOf(item) });
    }
    return { code: EMPTY, errors, usable: false, diagnostics };
  }
}

/** The ref a statically-rendered node serializes to (renderer's `STATIC_REF`). */
const STATIC_REF = "velloo:static";

function preflightOnce(
  cache: Map<string, Promise<string[]>>,
  path: string,
  plugins: BunPlugin[],
): Promise<string[]> {
  let check = cache.get(path);
  if (!check) {
    check = preflightSource(path, plugins);
    cache.set(path, check);
  }
  return check;
}

/**
 * Resolve each repository key against its owning app, compile the module in
 * isolation, and report per component — so one broken import costs exactly
 * that component, never its neighbours.
 */
async function resolveRepoEntries(
  keys: string[],
  repo: RepoBundleInput,
  primaryHostRoot: string,
  plugins: BunPlugin[],
  preflight: Map<string, Promise<string[]>>,
  diagnostics: CanvasComponentDiagnostic[],
): Promise<ResolvedRepo[]> {
  const out: ResolvedRepo[] = [];
  const primaryReact = safeResolve("react", primaryHostRoot);
  for (const key of keys) {
    const identity = parseRepoKey(key);
    const name = identity ? [identity.exportName, identity.member].filter(Boolean).join(".") : key;
    const base: CanvasComponentDiagnostic = {
      id: key,
      status: "unavailable",
      name,
      ...(identity ? { importPath: identity.importPath, exportName: identity.exportName } : {}),
      ...(identity?.app ? { app: identity.app } : {}),
      preview: repo.preview(identity?.app).label,
      fallback: "the node's proxy snippet, or a labelled frame around its children",
    };
    if (!identity) {
      diagnostics.push({
        ...base,
        code: "resolve-failed",
        note: "The key does not name a valid repository component.",
      });
      continue;
    }
    const { hostRoot, aliases } = repo.host(identity.app);
    if (identity.app !== repo.primaryApp && safeResolve("react", hostRoot) !== primaryReact) {
      diagnostics.push({
        ...base,
        code: "other-app-runtime",
        note: `This component belongs to the "${identity.app ?? "default"}" app, which has its own React; one screen mounts with a single React runtime.`,
        remedy:
          "Keep a screen's repository components from one app, or hoist a shared React in the monorepo.",
      });
      continue;
    }
    let path: string;
    try {
      path = identity.importPath.startsWith("./")
        ? Bun.resolveSync(identity.importPath, hostRoot)
        : resolveImport(identity.importPath, hostRoot, aliases);
    } catch (error) {
      diagnostics.push({
        ...base,
        code: "resolve-failed",
        errors: [messageOf(error)],
        note: `${identity.importPath} does not resolve from ${hostRoot}.`,
        remedy:
          "Check the import path and the host app's aliases (hostApp.aliases), or pick the component again from list_components.",
      });
      continue;
    }
    if (isServerOnly(path)) {
      diagnostics.push({
        ...base,
        code: "server-only",
        note: `${identity.importPath} is a server-only module and never runs in a browser.`,
        remedy: "Use a client component, or keep this node as a proxy.",
      });
      continue;
    }
    const compileErrors = path.includes("/node_modules/")
      ? []
      : await preflightOnce(preflight, path, plugins);
    if (compileErrors.length > 0) {
      diagnostics.push({
        ...base,
        code: "compile-failed",
        errors: compileErrors,
        note: `${identity.importPath} does not compile for the browser canvas.`,
        remedy: "Fix the compile error above, or mark browser-only imports in the preview entry.",
      });
      continue;
    }
    const recipe = recipeForSpecifier(identity.importPath);
    const activeRecipe = recipe && repo.recipes.includes(recipe) ? recipe : undefined;
    // Keyed by the exact part: `Menu`'s portal props mean nothing on `Menu.Item`.
    const adaptation = activeRecipe?.adaptations[name];
    out.push({ key, identity, path, adaptation: adaptation?.props, recipe: activeRecipe });
    diagnostics.push({
      ...base,
      status: adaptation ? "adapted" : "exact",
      fallback: "",
      note: adaptation?.note ?? `Rendered by the app's own ${identity.importPath}.`,
    });
  }
  return out;
}

function markRepo(
  diagnostics: CanvasComponentDiagnostic[],
  key: string,
  status: RepoFidelity,
  code: RepoDiagnosticCode,
  message: string,
): void {
  const entry = diagnostics.find((item) => item.id === key);
  if (!entry) return;
  entry.status = status;
  entry.code = code;
  entry.errors = [message];
}

function isServerOnly(path: string): boolean {
  if (/\.server\.[jt]sx?$/.test(path)) return true;
  if (path.includes("/node_modules/")) return false;
  try {
    return scanModule(readFileSync(path, "utf8")).serverOnly;
  } catch {
    return false;
  }
}

function safeResolve(specifier: string, from: string): string | null {
  try {
    return Bun.resolveSync(specifier, from);
  } catch {
    return null;
  }
}

interface PreviewImport {
  app: string | undefined;
  /** Module path the entry imports. */
  path: string;
  /** Generated module source (recipe defaults); absent for the app's own file. */
  source?: string;
  recipe?: FrameworkRecipe | undefined;
  label: string;
}

/** One preview wrapper per app that owns a mounted repository component. */
function previewImports(repo: RepoBundleInput, entries: ResolvedRepo[]): PreviewImport[] {
  const apps = new Set<string | undefined>([
    repo.primaryApp,
    ...entries.map((entry) => entry.identity.app),
  ]);
  const out: PreviewImport[] = [];
  for (const app of apps) {
    const entry = repo.preview(app);
    if (entry.kind === "file") out.push({ app, path: entry.path, label: entry.label });
    else if (entry.kind === "recipe") {
      const hash = Bun.hash(entry.source).toString(16);
      const dir = join(tmpdir(), "velloo-canvas", "previews");
      out.push({
        app,
        path: join(dir, `${entry.recipe.id}-${hash}.mjs`),
        source: entry.source,
        recipe: entry.recipe,
        label: entry.label,
      });
    }
  }
  return out;
}

/**
 * Let an app-written preview entry import the app's packages even when the
 * design folder sits outside the app (a local design): only the exact bare
 * specifiers it imports are matched, and each resolves beside its importer
 * first, then from the host root — a matched specifier is always answered.
 */
function previewPlugins(previews: PreviewImport[], repo: RepoBundleInput | undefined): BunPlugin[] {
  if (!repo) return [];
  const plugins: BunPlugin[] = [];
  for (const preview of previews) {
    if (preview.source !== undefined) continue;
    let specifiers: string[];
    try {
      specifiers = new Bun.Transpiler({ loader: "tsx" })
        .scanImports(readFileSync(preview.path, "utf8"))
        .map((entry) => entry.path)
        .filter((path) => !path.startsWith(".") && !path.startsWith("/"));
    } catch {
      continue;
    }
    const { hostRoot } = repo.host(preview.app);
    const answerable = specifiers.filter((specifier) => safeResolve(specifier, hostRoot) !== null);
    if (answerable.length === 0) continue;
    const filter = new RegExp(
      `^(${answerable.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`,
    );
    plugins.push({
      name: `velloo-preview-imports-${preview.app ?? "default"}`,
      setup(build) {
        build.onResolve({ filter }, (args) => ({
          path:
            safeResolve(args.path, dirname(args.importer)) ??
            (safeResolve(args.path, hostRoot) as string),
        }));
      },
    });
  }
  return plugins;
}

/** Stylesheet probes for the recipes whose components this screen mounts. */
function probesFor(
  entries: ResolvedRepo[],
): { recipe: string; probe: NonNullable<FrameworkRecipe["stylesheetProbe"]>; keys: string[] }[] {
  const byRecipe = new Map<string, { recipe: FrameworkRecipe; keys: string[] }>();
  for (const entry of entries) {
    if (!entry.recipe?.stylesheetProbe) continue;
    const group = byRecipe.get(entry.recipe.id) ?? { recipe: entry.recipe, keys: [] };
    group.keys.push(entry.key);
    byRecipe.set(entry.recipe.id, group);
  }
  return [...byRecipe.values()].map(({ recipe, keys }) => ({
    recipe: recipe.label,
    probe: recipe.stylesheetProbe as NonNullable<FrameworkRecipe["stylesheetProbe"]>,
    keys,
  }));
}

/** Stylesheets the build extracted, injected before the components evaluate. */
function injectCss(css: string): string {
  return `(function(){var s=document.createElement("style");s.setAttribute("data-velloo-canvas-css","");s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n`;
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
      build.onResolve({ filter }, (args) => {
        // An installed package's own dependency is that package's to resolve.
        // Under an isolated linker (bun's `node_modules/.bun` store, pnpm) the
        // `@radix-ui/react-compose-refs` that `@radix-ui/react-slot` imports is
        // linked beside it and nowhere under the host root, so forcing it there
        // fails every component that reaches radix. React is the exception: it
        // must stay the host's one copy wherever it is imported from.
        if (INSTALLED.test(args.importer) && !HOST_SINGLETONS.has(packageName(args.path))) {
          try {
            return { path: Bun.resolveSync(args.path, dirname(args.importer)) };
          } catch {
            // Not linked beside the importer — a peer dep the host provides.
          }
        }
        return { path: Bun.resolveSync(args.path, hostRoot) };
      });
    },
  };
}

const INSTALLED = /[\\/]node_modules[\\/]/;
const HOST_SINGLETONS = new Set(["react", "react-dom"]);

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
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

/**
 * The namespaces the bundled shadcn snapshot imports from the unified
 * `radix-ui` package. Each mirrors a scoped `@radix-ui/react-<kebab>` package.
 */
const RADIX_NAMESPACES = [
  "Accordion",
  "AlertDialog",
  "Avatar",
  "Checkbox",
  "Collapsible",
  "Dialog",
  "DropdownMenu",
  "Label",
  "Popover",
  "Progress",
  "RadioGroup",
  "ScrollArea",
  "Select",
  "Separator",
  "Slider",
  "Slot",
  "Switch",
  "Tabs",
  "Toggle",
  "ToggleGroup",
  "Tooltip",
];

/**
 * Stand in for the unified `radix-ui` package when the host app doesn't have it.
 *
 * The snapshot's components import `{ Dialog as DialogPrimitive } from "radix-ui"`,
 * but that consolidated package is new — the overwhelming majority of shadcn apps
 * depend on the scoped `@radix-ui/react-*` packages and never pull the barrel.
 * Without this, every fallback-rendered component fails to compile from the
 * installed binary (which has no node_modules of its own to walk up into) and the
 * client mount silently never engages on an ordinary app. None of the eval
 * real-world fixtures carry `radix-ui`.
 *
 * The unified package is itself only a re-export barrel, so synthesize that shape
 * from whichever scoped packages the host actually has.
 */
function radixShimPlugin(hostRoot: string): BunPlugin[] | null {
  try {
    Bun.resolveSync("radix-ui", hostRoot);
    return null; // The host has the real thing.
  } catch {
    // Fall through and synthesize it.
  }
  const lines: string[] = [];
  for (const name of RADIX_NAMESPACES) {
    const kebab = name.replace(/(?!^)([A-Z])/g, "-$1").toLowerCase();
    try {
      const path = Bun.resolveSync(`@radix-ui/react-${kebab}`, hostRoot);
      lines.push(`export * as ${name} from ${JSON.stringify(path)};`);
    } catch {
      // The app doesn't use this primitive. A component needing it fails to
      // compile and takes its own named fallback — the correct outcome.
    }
  }
  if (lines.length === 0) return null;
  const contents = lines.join("\n");
  return [
    {
      name: "velloo-radix-shim",
      setup(build) {
        build.onResolve({ filter: /^radix-ui$/ }, () => ({
          path: "radix-ui",
          namespace: "velloo-radix",
        }));
        build.onLoad({ filter: /.*/, namespace: "velloo-radix" }, () => ({
          contents,
          loader: "js" as const,
        }));
      },
    },
  ];
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
  repo: ResolvedRepo[];
  previews: PreviewImport[];
  primaryApp: string | undefined;
  probes: ReturnType<typeof probesFor>;
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
  const repoPaths = [...new Set(opts.repo.map((entry) => entry.path))];
  const repoImports = repoPaths
    .map((path, index) => `import * as __r${index} from ${JSON.stringify(path)};`)
    .join("\n");
  const repoRegistry = opts.repo
    .map(
      (entry) =>
        `  ${JSON.stringify(entry.key)}: member(pick(__r${repoPaths.indexOf(entry.path)}, ${JSON.stringify(entry.identity.exportName)}), ${JSON.stringify(entry.identity.member ?? "")}),`,
    )
    .join("\n");
  const adaptations = Object.fromEntries(
    opts.repo.filter((entry) => entry.adaptation).map((entry) => [entry.key, entry.adaptation]),
  );
  const previewImportLines = opts.previews
    .map((preview, index) => `import __p${index} from ${JSON.stringify(preview.path)};`)
    .join("\n");
  const previewMap = opts.previews
    .map((preview, index) => `  ${JSON.stringify(preview.app ?? "")}: __p${index},`)
    .join("\n");
  const previewLabels = Object.fromEntries(opts.previews.map((p) => [p.app ?? "", p.label]));
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
        React.createElement(React.Fragment, null, screen(opts.tree), React.createElement(Ready, { onReady: opts.onReady }))))));`
      : `root.render(React.createElement(ErrorBoundary, { onError: opts.onError },
    React.createElement(React.Fragment, null, screen(opts.tree), React.createElement(Ready, { onReady: opts.onReady }))));`;

  return `import * as React from ${JSON.stringify(opts.reactPath)};
import { createRoot } from ${JSON.stringify(opts.reactDomClientPath)};
${emotionImports}
${imports}
${repoImports}
${previewImportLines}

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
function member(value, path) {
  if (!path) return value;
  var parts = path.split(".");
  for (var i = 0; i < parts.length && value != null; i++) value = value[parts[i]];
  return value;
}
var registry = {
${registry}
};
var repoRegistry = {
${repoRegistry}
};
var adaptations = ${JSON.stringify(adaptations)};
var previews = {
${previewMap}
};
var previewLabels = ${JSON.stringify(previewLabels)};
var primaryApp = ${JSON.stringify(opts.primaryApp ?? "")};
var probes = ${JSON.stringify(opts.probes)};
export const __velloo_canvas_diagnostics = ${JSON.stringify(opts.diagnostics)};

var report = function () {};
var previewInput = {};

function chrome(props) { return { className: typeof props.className === "string" ? props.className : undefined, "data-node-path": props["data-node-path"], "data-snippet-id": props["data-snippet-id"], "data-snippet-path": props["data-snippet-path"] }; }
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
  return React.createElement("div", { "data-velloo-component-fallback": props.componentId, "data-node-path": props["data-node-path"], "data-snippet-id": props["data-snippet-id"], "data-snippet-path": props["data-snippet-path"] , style: { border: "1px dashed currentColor", borderRadius: 6, padding: 12, opacity: .7, font: "12px ui-monospace, monospace" } }, props.children && props.children.length ? props.children : "Unavailable component: " + props.componentId);
}
// Server-rendered markup for a component with no browser source; its identity
// attributes are already in the HTML, so selection resolves inside it.
function Static(props) { return React.createElement("div", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: props.html || "" } }); }
// Mirrors the renderer's SSR frame for a repository component without a proxy.
var FRAME = { position: "relative", border: "1px dashed var(--color-border, #d4d4d8)", borderRadius: "0.5rem", padding: "1.5rem 0.75rem 0.75rem", minHeight: "2.5rem" };
var LABEL = { position: "absolute", top: "0.25rem", left: "0.5rem", color: "var(--color-muted-foreground, #71717a)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.6875rem", lineHeight: 1.4, pointerEvents: "none" };
var REASON = { color: "var(--color-muted-foreground, #71717a)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.6875rem", lineHeight: 1.4, overflowWrap: "anywhere" };
// \`error\`: the component threw, so the frame says why instead of passing for
// a deliberate placeholder.
function repoFrame(node, props, children, error) {
  var text = props.children;
  var kids = children.length ? children : (typeof text === "string" || typeof text === "number" ? [text] : []);
  var reason = error ? [React.createElement("div", { style: REASON, "data-velloo-repo-error": "" }, "Didn't render: " + String(error && error.message || error).slice(0, 200))] : [];
  return element("div", { "data-node-path": props["data-node-path"], "data-snippet-id": props["data-snippet-id"], "data-snippet-path": props["data-snippet-path"], "data-velloo-repo": node.repo.name, title: node.repo.name + " from " + node.repo.importPath, style: FRAME }, [React.createElement("span", { style: LABEL }, "<" + node.repo.name + ">")].concat(reason, kids));
}
function classify(error) {
  var message = error && error.message ? String(error.message) : String(error);
  return /provider|context|must be used within|was not found in (the )?component tree/i.test(message) ? "missing-provider" : "render-threw";
}
class RepoBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false, error: null }; }
  static getDerivedStateFromError(error) { return { failed: true, error: error }; }
  componentDidCatch(error) {
    var code = classify(error);
    report({ id: this.props.id, name: this.props.name, status: this.props.hasProxy ? "proxy" : "unavailable", code: code, note: String(error && error.message || error).slice(0, 400), remedy: code === "missing-provider" ? "Wrap the preview entry in the provider this component needs (preview_status shows the app's own wrappers)." : "Check the component's required props; the proxy or frame stands in until it renders." });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(anchor);
  }
  render() { return this.state.failed ? this.props.fallback(this.state.error) : this.props.children; }
}
function previewProps(app) {
  return { colorScheme: previewInput.colorScheme || "light", theme: previewInput.theme, recipeTheme: (previewInput.recipeTheme || {})[app] };
}
function slotProps(props) {
  for (var name in props) {
    var value = props[name];
    if (value && typeof value === "object" && value.$node) props[name] = build(value.$node);
    else if (Array.isArray(value) && value.some(function (item) { return item && item.$node; })) {
      props[name] = value.map(function (item) { return item && item.$node ? build(item.$node) : item; });
    }
  }
}
// \`bare\`: the node is its repository parent's only child. Target-style parts
// (Tooltip, Menu.Target, Popover.Target) clone that child and attach a ref, so
// it must be the element itself — no anchor fragment, no boundary component.
// A throw inside it is then caught by the parent's boundary instead.
function buildRepo(node, props, children, bare) {
  var Component = repoRegistry[node.ref];
  var fallback = function (error) { return node.proxy ? build(node.proxy) : repoFrame(node, props, children, error); };
  if (!Component) {
    // In the registry but undefined: the module loaded and has no such export.
    if (node.ref in repoRegistry) report({ id: node.ref, name: node.repo.name, status: node.proxy ? "proxy" : "unavailable", code: "missing-export", note: node.repo.importPath + " has no export " + node.repo.exportName + (node.repo.member ? "." + node.repo.member : "") + ".", remedy: "Pick the component again from list_components; the app may have renamed it." });
    else if (node.proxy) report({ id: node.ref, name: node.repo.name, status: "proxy" });
    return fallback();
  }
  var own = Object.assign({}, props);
  slotProps(own);
  var el = element(Component, Object.assign({}, adaptations[node.ref] || {}, own), children);
  var app = node.repo.app || "";
  if (app !== primaryApp && previews[app]) el = React.createElement(previews[app], previewProps(app), el);
  if (bare) return el;
  return React.createElement(React.Fragment, null,
    React.createElement("template", { "data-velloo-anchor": props["data-node-path"] || "" }),
    React.createElement(RepoBoundary, { id: node.ref, name: node.repo.name, hasProxy: Boolean(node.proxy), fallback: fallback }, el));
}
function build(node, bare) {
  if (node == null) return null;
  if (typeof node === "string" || typeof node === "number") return node;
  var ref = node.ref;
  if (ref === ${JSON.stringify(STATIC_REF)}) return React.createElement(Static, { html: node.props && node.props.html });
  var props = Object.assign({}, node.props);
  var only = Boolean(node.repo) && (node.children || []).length === 1;
  var children = (node.children || []).map(function (child) { return build(child, only); });
  if (node.repo) return buildRepo(node, props, children, bare);
  if (overlayIds.has(ref) && overlays[ref]) { props.__kids = children; return React.createElement(overlays[ref], props); }
  var Component = registry[ref];
  return Component ? element(Component, props, children) : React.createElement(Missing, Object.assign({}, props, { componentId: ref, children: children }));
}
// A component that doesn't forward \`data-node-path\` to its DOM still has to be
// selectable: its anchor's next element is its root, so give it the path.
var CHROME = { SCRIPT: 1, STYLE: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1 };
function anchor() {
  var marks = document.querySelectorAll("template[data-velloo-anchor]");
  var inPlaceless = [];
  for (var i = 0; i < marks.length; i++) {
    var path = marks[i].getAttribute("data-velloo-anchor");
    var next = marks[i].nextElementSibling;
    if (path && next && next.tagName !== "TEMPLATE" && !next.hasAttribute("data-node-path")) next.setAttribute("data-node-path", path);
    else if (path && (!next || next.tagName === "TEMPLATE")) inPlaceless.push(path);
  }
  // A component that rendered nothing in place portaled its output to <body>
  // (an app's own dialog or popover): give what landed there its identity, in
  // order, so clicking the overlay selects the node that opened it.
  if (!inPlaceless.length) return;
  var landed = [];
  for (var j = 0; j < document.body.children.length; j++) {
    var el = document.body.children[j];
    // Velloo's own chrome: the mount, the SSR copy, the scroll thumb, the fidelity badge.
    if (CHROME[el.tagName] || el.id === "velloo-canvas-root" || el.id === "velloo-ssr" || String(el.className).indexOf("__velloo") === 0 || el.getAttribute("aria-label") === "Canvas component fidelity") continue;
    if (el.hasAttribute("data-node-path") || el.querySelector("[data-node-path]")) continue;
    landed.push(el);
  }
  landed.forEach(function (el, k) { el.setAttribute("data-node-path", inPlaceless[Math.min(k, inPlaceless.length - 1)]); });
}
// An app's modal (Radix, Headless UI, react-aria) sets pointer-events:none on
// <body> while it is open, which would leave every node on the screen
// unselectable. A stylesheet !important outranks that inline style.
function unlockPointer() {
  var style = document.createElement("style");
  style.setAttribute("data-velloo-pointer", "");
  style.textContent = "html,body{pointer-events:auto!important}";
  document.head.appendChild(style);
  if (typeof MutationObserver === "function") {
    new MutationObserver(function () { if (typeof requestAnimationFrame === "function") requestAnimationFrame(anchor); }).observe(document.body, { childList: true });
  }
}
function probe() {
  probes.forEach(function (entry) {
    var host = document.createElement("div");
    host.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px";
    host.innerHTML = entry.probe.html;
    document.body.appendChild(host);
    var target = host.querySelector(entry.probe.selector);
    var styled = target && getComputedStyle(target).getPropertyValue(entry.probe.property) === entry.probe.expect;
    host.remove();
    if (styled) return;
    entry.keys.forEach(function (key) {
      report({ id: key, status: "unstyled", code: "unstyled", note: entry.recipe + " components rendered without " + entry.probe.stylesheet + ", so they are unstyled.", remedy: "Import " + entry.probe.stylesheet + " in the preview entry." });
    });
  });
}
class PreviewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false, error: null }; }
  static getDerivedStateFromError(error) { return { failed: true, error: error }; }
  componentDidCatch(error) {
    report({ id: "preview", name: previewLabels[primaryApp] || "preview entry", status: "unavailable", code: "render-threw", note: "The preview entry threw: " + String(error && error.message || error).slice(0, 400), remedy: "Fix the preview entry; components render without it until then." });
  }
  render() { return this.state.failed ? this.props.bare() : this.props.children; }
}
function screen(tree) {
  var Primary = previews[primaryApp];
  if (!Primary) return build(tree);
  return React.createElement(PreviewBoundary, { bare: function () { return build(tree); } },
    React.createElement(Primary, previewProps(primaryApp), build(tree)));
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false, error: null }; }
  static getDerivedStateFromError(error) { return { failed: true, error: error }; }
  componentDidCatch(error) { if (this.props.onError) this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function Ready(props) { React.useEffect(function () { anchor(); probe(); if (props.onReady) props.onReady(); }, []); return null; }
export function mountScreen(opts) {
  if (typeof opts.onDiagnostic === "function") report = opts.onDiagnostic;
  unlockPointer();
  previewInput = opts.preview || {};
  var root = createRoot(opts.el);
  ${renderBody}
  return root;
}
export { React };
`;
}
