import { describe, expect, test } from "bun:test";
import type { RepoAppSummary } from "../catalog.ts";
import { suggestPreviewEntry } from "../suggest-preview.ts";

/**
 * The preview entry is the hardest step of setting a design up, and the
 * suggestion is where most agents start. What it gets wrong — a router with no
 * routes, a query provider with no client, an auth provider with no key — each
 * one costs a round trip, or the agent gives up on the components that need it.
 */
type Wrapper = RepoAppSummary["wrappers"][number];

const wrapper = (
  name: string,
  importPath: string,
  at: string,
  extra: Partial<Wrapper> = {},
): Wrapper => ({
  name,
  identity: { importPath, exportName: name },
  at,
  props: {},
  expressions: [],
  ...extra,
});

function app(wrappers: Wrapper[]): RepoAppSummary {
  return {
    hostRoot: "/app",
    recipes: [],
    preview: { kind: "none", label: "no preview entry" },
    wrappers,
    globalStyles: [{ specifier: "./styles/index.css", at: "src/main.tsx:19" }],
    entries: ["src/main.tsx"],
    skipped: [],
  };
}

// As discovery reports them for a TanStack Router app: by file, in no nesting order.
const ADMIN = app([
  wrapper("TasksProvider", "./src/features/tasks/provider", "src/features/tasks/index.tsx:15"),
  wrapper("QueryClientProvider", "@tanstack/react-query", "src/main.tsx:96", {
    expressions: ["client"],
  }),
  wrapper("ThemeProvider", "./src/context/theme-provider", "src/main.tsx:97"),
  wrapper("DirectionProvider", "./src/context/direction-provider", "src/main.tsx:99"),
  wrapper("RouterProvider", "@tanstack/react-router", "src/main.tsx:100", {
    expressions: ["router"],
  }),
  wrapper("ClerkProvider", "@clerk/react", "src/routes/clerk/route.tsx:26", {
    expressions: ["publishableKey"],
  }),
  wrapper(
    "DirectionProvider",
    "@radix-ui/react-direction",
    "src/context/direction-provider.tsx:49",
  ),
  wrapper("SidebarProvider", "@/components/ui/sidebar", "src/components/layout/shell.tsx:19"),
]);

const lineOf = (source: string, text: string): number =>
  source.split("\n").findIndex((line) => line.includes(text));

describe("suggestPreviewEntry", () => {
  const source = suggestPreviewEntry(ADMIN, "/app/velloo");

  test("nests the entry's providers outermost, in their own order, and the rest inside them", () => {
    const order = [
      "<QueryClientProvider",
      "<ThemeProvider",
      "<DirectionProvider",
      "<MemoryRouter>",
    ];
    const at = order.map((tag) => lineOf(source, tag));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((line) => line > 0)).toBe(true);
    // A provider a feature adds inside the routes goes inside the router.
    expect(lineOf(source, "<TasksProvider")).toBeGreaterThan(lineOf(source, "<MemoryRouter>"));
  });

  test("a router becomes an in-memory one that only supplies context", () => {
    expect(source).toContain("createMemoryHistory");
    expect(source).toContain("<RouterProvider router={router} />");
    expect(source).not.toContain("router: set in the app");
  });

  test("a query provider gets a client of its own", () => {
    expect(source).toContain(
      'import { QueryClientProvider, QueryClient } from "@tanstack/react-query";',
    );
    expect(source).toContain("<QueryClientProvider client={queryClient}>");
  });

  test("an auth provider is left out, and the entry says so", () => {
    expect(source).not.toContain("<ClerkProvider");
    expect(source).not.toContain('from "@clerk/react"');
    expect(source).toContain("ClerkProvider (@clerk/react) is left out");
  });

  test("a provider found inside the file that defines a listed one is that one's own implementation", () => {
    expect(source).not.toContain("@radix-ui/react-direction");
    expect(source.match(/<DirectionProvider/g)).toHaveLength(1);
  });

  test("shadcn's full-height sidebar provider does not lay every design out as its child", () => {
    expect(source).toContain('<SidebarProvider className="block min-h-0">');
  });

  test("react-router's browser router becomes a memory router", () => {
    const spa = suggestPreviewEntry(
      app([wrapper("BrowserRouter", "react-router-dom", "src/main.jsx:8")]),
      "/app/velloo",
    );
    expect(spa).toContain('import { MemoryRouter } from "react-router-dom";');
    expect(spa).not.toContain("BrowserRouter");
  });

  test("an app with no providers needs only its stylesheet", () => {
    const plain = suggestPreviewEntry(app([]), "/app/velloo");
    expect(plain).toContain('import "../src/styles/index.css";');
    expect(plain).toContain("return children;");
  });
});
