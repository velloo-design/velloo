import { dirname, join, relative, sep } from "node:path";
import type { RepoAppSummary } from "./catalog.ts";
import { packageOf } from "./discover.ts";

type Wrapper = RepoAppSummary["wrappers"][number];

/**
 * A starting preview entry, written from what the app's own entry does: the
 * stylesheets it imports and the providers it wraps the app in, outermost
 * first. Literal props carry over; props the app computes in code are left as
 * comments naming where, because copying code a design folder can't run is
 * the agent's call, not ours. A recipe theme, when there is one, feeds a
 * `theme` prop so Velloo's theme edits restyle the components.
 *
 * Three kinds of provider are not carried over as written, because as written
 * they cannot work on a canvas and every agent has to rediscover why: a router
 * (the app's routes are not loaded, so it becomes an in-memory one that only
 * supplies context), a query client (it needs one made), and an auth provider
 * (it needs a key and the network, so it is left out and said so).
 */
export function suggestPreviewEntry(app: RepoAppSummary, folderRoot: string): string {
  const fromFolder = (target: string): string => {
    const rel = relative(folderRoot, target).split(sep).join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  // A stylesheet import is relative to the file that has it; a wrapper's
  // identity is already relative to the app root.
  const styleImport = (specifier: string, at: string): string => {
    if (!specifier.startsWith(".")) return specifier;
    const [file] = at.split(":");
    return fromFolder(join(app.hostRoot, dirname(file ?? ""), specifier));
  };
  const importFor = (specifier: string): string =>
    specifier.startsWith("./") ? fromFolder(join(app.hostRoot, specifier)) : specifier;
  const styles = [
    ...new Set(app.globalStyles.map((style) => styleImport(style.specifier, style.at))),
  ];

  const wrappers = nestingOrder(app.wrappers);
  const hasRecipe = app.recipes.length > 0;
  const imports = new Map<string, Set<string>>();
  const defaults = new Map<string, string>();
  const need = (from: string, name: string) =>
    imports.set(from, (imports.get(from) ?? new Set()).add(name));
  const setup: string[] = [];
  const leftOut: string[] = [];
  const layers: { open: string; close: string }[] = [];

  for (const wrapper of wrappers) {
    const pkg = wrapper.identity.importPath.startsWith(".")
      ? null
      : packageOf(wrapper.identity.importPath);
    if (pkg && AUTH_PACKAGE.test(pkg)) {
      leftOut.push(
        `${wrapper.name} (${pkg}) is left out: it needs a key and the network. A component that reads it takes a proxy snippet.`,
      );
      continue;
    }
    if (pkg === "@tanstack/react-router" && wrapper.name === "RouterProvider") {
      for (const name of [
        "createMemoryHistory",
        "createRootRoute",
        "createRouter",
        "RouterProvider",
      ]) {
        need(pkg, name);
      }
      need("react", "createContext");
      need("react", "useContext");
      setup.push(
        "// The app's routes are not loaded here: an in-memory router whose one route",
        "// renders the design, so links and navigation hooks have their context.",
        "const Design = createContext(null);",
        "const rootRoute = createRootRoute({",
        "  component: () => useContext(Design),",
        "  notFoundComponent: () => useContext(Design),",
        "});",
        "const router = createRouter({",
        "  routeTree: rootRoute,",
        '  history: createMemoryHistory({ initialEntries: ["/"] }),',
        "});",
        "function MemoryRouter({ children }) {",
        "  return (",
        "    <Design.Provider value={children}>",
        "      <RouterProvider router={router} />",
        "    </Design.Provider>",
        "  );",
        "}",
        "",
      );
      layers.push({ open: "<MemoryRouter>", close: "</MemoryRouter>" });
      continue;
    }
    if (pkg && REACT_ROUTER.test(pkg) && ROUTER_ROOT.test(wrapper.name)) {
      need(pkg, "MemoryRouter");
      layers.push({ open: "<MemoryRouter>", close: "</MemoryRouter>" });
      continue;
    }
    const from = importFor(wrapper.identity.importPath);
    if (wrapper.identity.exportName === "default") defaults.set(from, wrapper.name);
    else need(from, wrapper.identity.exportName);

    const attrs = Object.entries(wrapper.props).map(([name, value]) =>
      typeof value === "string"
        ? `${name}=${JSON.stringify(value)}`
        : `${name}={${JSON.stringify(value)}}`,
    );
    for (const name of wrapper.expressions) {
      if (name === "theme" && hasRecipe) attrs.push("theme={recipeTheme}");
      else if (name === "client" && pkg && QUERY_PACKAGE.test(pkg)) {
        need(pkg, "QueryClient");
        setup.push(
          "// A client of its own: nothing here fetches, and a failed query must not retry.",
          "const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });",
          "",
        );
        attrs.push("client={queryClient}");
      } else attrs.push(`/* ${name}: set in the app at ${wrapper.at} */`);
    }
    if (hasRecipe && layers.length === 0 && /color.?scheme/i.test(attrs.join(" "))) {
      attrs.push("forceColorScheme={colorScheme}");
    }
    // shadcn's SidebarProvider is a full-height flex row: left as it is, every
    // design would be laid out as a child of one.
    if (wrapper.name === "SidebarProvider" && !("className" in wrapper.props)) {
      attrs.push('className="block min-h-0"');
    }
    layers.push({
      open: `<${wrapper.name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`,
      close: `</${wrapper.name}>`,
    });
  }

  const lines = [
    ...styles.map((style) => `import ${JSON.stringify(style)};`),
    ...[...new Set([...imports.keys(), ...defaults.keys()])].map((from) => {
      const named = [...(imports.get(from) ?? [])];
      const parts = [
        ...(defaults.has(from) ? [defaults.get(from) as string] : []),
        ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : []),
      ];
      return `import ${parts.join(", ")} from ${JSON.stringify(from)};`;
    }),
    "",
    ...setup,
    "/**",
    " * Velloo preview entry: the context the app's components need on the canvas.",
    " * Receives { children, colorScheme, theme, recipeTheme }; keep it free of",
    " * network calls and credentials, and use fixtures for data.",
    ...leftOut.map((line) => ` * ${line}`),
    " */",
    "export default function Preview({ children, colorScheme, recipeTheme }) {",
  ];
  const pad = (depth: number) => "    ".concat("  ".repeat(depth));
  const body =
    layers.length > 0
      ? [
          "  return (",
          ...layers.map((layer, depth) => `${pad(depth)}${layer.open}`),
          `${pad(layers.length)}{children}`,
          ...layers.map((layer, depth) => `${pad(depth)}${layer.close}`).reverse(),
          "  );",
        ].join("\n")
      : "  return children;";
  return [...lines, body, "}", ""].join("\n");
}

const AUTH_PACKAGE = /^(@clerk\/|@auth0\/|next-auth$|@kinde-oss\/|@supabase\/auth-|@descope\/)/;
const QUERY_PACKAGE = /^(@tanstack\/react-query|react-query)$/;
const REACT_ROUTER = /^(react-router|react-router-dom|@remix-run\/react)$/;
const ROUTER_ROOT = /^(BrowserRouter|HashRouter|RouterProvider|Router)$/;

const fileOf = (wrapper: Wrapper): string => wrapper.at.split(":")[0] ?? "";
const lineOf = (wrapper: Wrapper): number => Number(wrapper.at.split(":").at(-1)) || 0;

/**
 * The providers in the order they nest. Discovery finds them file by file, and
 * a line number only orders the ones in the same file: the file that wraps the
 * app in the most providers is its entry and goes outermost, with the rest —
 * the ones a layout or a feature adds inside the routes — after it.
 *
 * Left out: a second provider of a name already taken (an app with several
 * entries wraps each the same way, and reaches one module by more than one
 * spelling), and a provider found inside the file that defines one already
 * listed — that is the listed one's own implementation, not another layer.
 */
function nestingOrder(found: readonly Wrapper[]): Wrapper[] {
  const perFile = new Map<string, number>();
  for (const wrapper of found)
    perFile.set(fileOf(wrapper), (perFile.get(fileOf(wrapper)) ?? 0) + 1);
  const files = [...perFile.keys()];
  const rank = (wrapper: Wrapper) => files.indexOf(fileOf(wrapper));
  const sorted = [...found].sort(
    (a, b) =>
      (perFile.get(fileOf(b)) ?? 0) - (perFile.get(fileOf(a)) ?? 0) ||
      rank(a) - rank(b) ||
      lineOf(a) - lineOf(b),
  );
  const stem = (path: string) =>
    path.replace(/\.(tsx|jsx|ts|js|mts|mjs)$/, "").replace(/^(\.\/|@\/|~\/)/, "");
  const named = new Set<string>();
  const kept: Wrapper[] = [];
  for (const wrapper of sorted) {
    if (named.has(wrapper.name)) continue;
    const within = stem(fileOf(wrapper));
    const implementsListed = kept.some((other) => {
      const module = stem(other.identity.importPath);
      return module !== "" && within.endsWith(module);
    });
    if (implementsListed) continue;
    named.add(wrapper.name);
    kept.push(wrapper);
  }
  return kept;
}
