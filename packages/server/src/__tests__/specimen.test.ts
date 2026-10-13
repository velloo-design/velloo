import { describe, expect, test } from "bun:test";
import type { ComponentProvider } from "@velloo/provider";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { type ComponentNode, isComponentNode, type Node } from "@velloo/schema";
import type { RepoCatalogEntry } from "../repo/catalog.ts";
import { appSpecimenNodes, specimenScreen } from "../specimen.ts";
import { type DesignConfigOverrides, designConfig, testContext } from "../testing/design-folder.ts";

function nodes(node: Node, out: ComponentNode[] = []): ComponentNode[] {
  if (!isComponentNode(node)) return out;
  out.push(node);
  for (const child of node.children ?? []) nodes(child, out);
  return out;
}

async function specimenFor(provider?: ComponentProvider, config: DesignConfigOverrides = {}) {
  const t = await testContext({
    label: "specimen",
    config: designConfig(config),
    ...(provider ? { provider } : {}),
  });
  return { t, all: nodes((await specimenScreen(t.ctx)).tree) };
}

/**
 * The specimen has to be written in the folder's own idiom. A Tailwind class on
 * an `sx` or inline-style folder renders as nothing at all — the page would
 * look blank rather than wrong, which is the failure this guards.
 */
describe("specimenScreen", () => {
  test("shadcn: Tailwind classes and real components", async () => {
    const { t, all } = await specimenFor();
    try {
      expect(typeof all[0]?.props?.className).toBe("string");
      expect(all.every((n) => n.props?.style === undefined && n.props?.sx === undefined)).toBe(
        true,
      );
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
      // A theme-defined role is drawn with the utility that follows the theme.
      expect(all.some((n) => String(n.props?.className).includes("bg-primary"))).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  test("no CSS framework: inline styles on theme variables, and no class anywhere", async () => {
    const { t, all } = await specimenFor(createNoneProvider(), {
      library: { id: "none" },
      styling: { framework: "none" },
    });
    try {
      expect(all[0]?.props?.style).toMatchObject({ background: "var(--color-background)" });
      expect(all.every((n) => n.props?.className === undefined)).toBe(true);
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  test("MUI: sx on its own Box", async () => {
    const { t, all } = await specimenFor(createMuiProvider(), { library: { id: "mui" } });
    try {
      expect(all[0]?.$ref).toBe("Box");
      expect(all[0]?.props?.sx).toMatchObject({ background: "var(--color-background)" });
      expect(all.every((n) => n.props?.className === undefined)).toBe(true);
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  /** The no-library provider as a library that ships fewer of the type helpers. */
  const without = (...ids: string[]): ComponentProvider => {
    const base = createNoneProvider();
    return {
      ...base,
      loadManifest: async () => (await base.loadManifest()).filter((d) => !ids.includes(d.id)),
    };
  };
  const inline: DesignConfigOverrides = {
    library: { id: "none" },
    styling: { framework: "none" },
  };

  test("the type section is a prose region, where the typeset's faces and flow apply", async () => {
    const { t, all } = await specimenFor(createNoneProvider(), inline);
    try {
      const prose = all.find((n) => n.$ref === "Prose");
      // Plain elements with no styling of their own: how they look is the typeset's doing.
      expect(
        prose?.children?.map((child) => (isComponentNode(child) ? child.props : null)),
      ).toEqual(
        expect.arrayContaining([{ as: "h1", children: "A first-level heading sets the voice" }]),
      );
      expect(all.some((n) => n.$ref === "Heading")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  test("a library with no prose region gets a labelled ladder of its own Heading and Text", async () => {
    const { t, all } = await specimenFor(without("Prose"), inline);
    try {
      expect(all.some((n) => n.$ref === "Prose")).toBe(false);
      expect(all.filter((n) => n.$ref === "Heading").map((n) => n.props?.level)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(all.filter((n) => n.$ref === "Text").map((n) => n.props?.variant)).toEqual([
        "lead",
        "default",
        "small",
      ]);
      // Each rung is named, so a size can be read off against the scale.
      const labels = all.map((n) => n.props?.children).filter((c) => typeof c === "string");
      expect(labels).toEqual(expect.arrayContaining(["h1", "h4", "lead", "body", "small"]));
    } finally {
      await t.cleanup();
    }
  });

  test("and one with neither helper still gets real heading elements, in whatever its CSS gives them", async () => {
    const { t, all } = await specimenFor(without("Prose", "Heading", "Text"), inline);
    try {
      expect(all.some((n) => n.$ref === "Heading" || n.$ref === "Text")).toBe(false);
      const sampled = all
        .filter((n) => String(n.props?.children).startsWith("The quick brown fox"))
        .map((n) => n.props?.as);
      expect(sampled).toEqual(["h1", "h2", "h3", "h4", "p", "p", "p"]);
    } finally {
      await t.cleanup();
    }
  });

  test("a colour role the design added is drawn beside the semantic ones", async () => {
    const t = await testContext({
      label: "specimen-roles",
      theme: { palette: { success: "#15803d" } },
    });
    try {
      const all = nodes((await specimenScreen(t.ctx)).tree);
      expect(all.some((n) => String(n.props?.className).split(" ").includes("bg-success"))).toBe(
        true,
      );
      expect(all.some((n) => n.props?.children === "success")).toBe(true);
      // A slot the theme leaves undefined gets no swatch to be wrong about.
      expect(all.some((n) => n.props?.children === "destructive")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  test("it is a view, not a design: nothing is written to the folder", async () => {
    const { t } = await specimenFor();
    try {
      expect(t.ctx.folder.screens.size).toBe(0);
      expect(t.ctx.folder.boards.size).toBe(0);
      expect(t.events).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});

describe("the app's components on the specimen", () => {
  const panel: RepoCatalogEntry = {
    id: "Panel",
    name: "Panel",
    identity: { importPath: "@/components/panel", exportName: "Panel" },
    key: "repo::@/components/panel#Panel",
    source: "local",
    family: "Panel",
    props: [],
    acceptsChildren: false,
    states: [{ name: "a", props: { cap: "acid" }, source: "usage" }],
    provenance: ["app/page.tsx:1"],
    styleProps: [],
  };

  async function specimenWith(opts: {
    wrappers: number;
    preview: "none" | "file";
    seen?: string;
  }): Promise<string> {
    const t = await testContext({ label: "specimen-app", config: designConfig() });
    try {
      const wrapper = {
        name: "ThemeProvider",
        identity: panel.identity,
        at: "a:1",
        props: {},
        expressions: [],
      };
      t.ctx.repo = {
        catalog: async () => ({
          entries: [panel],
          byId: new Map(),
          byKey: new Map(),
          warnings: [],
          apps: [
            {
              hostRoot: "/app",
              recipes: [],
              preview: { kind: opts.preview, label: "" },
              wrappers: Array.from({ length: opts.wrappers }, () => wrapper),
              globalStyles: [],
              entries: [],
              skipped: [],
            },
          ],
        }),
        preview: () => ({ kind: opts.preview, label: "", path: "preview.tsx" }),
      } as unknown as NonNullable<typeof t.ctx.repo>;
      if (opts.seen) {
        t.ctx.canvasBundler = {
          runtimeForComponents: () => [{ id: panel.key, status: opts.seen }],
        } as unknown as NonNullable<typeof t.ctx.canvasBundler>;
      }
      return JSON.stringify((await specimenScreen(t.ctx)).tree);
    } finally {
      await t.cleanup();
    }
  }

  test("an app that wraps its components in providers waits for a preview entry, and says so", async () => {
    const tree = await specimenWith({ wrappers: 2, preview: "none" });
    expect(tree).not.toContain('"$repo"');
    expect(tree).toContain("Ask your agent to set Velloo up for this app");
  });

  test("with the entry in place, or no providers to wait for, they are drawn", async () => {
    expect(await specimenWith({ wrappers: 2, preview: "file" })).toContain('"$repo"');
    expect(await specimenWith({ wrappers: 0, preview: "none" })).toContain('"$repo"');
  });

  test("a component a mount has already seen fail is left off", async () => {
    const tree = await specimenWith({ wrappers: 0, preview: "none", seen: "unavailable" });
    expect(tree).not.toContain('"$repo"');
    expect(tree).not.toContain("Ask your agent");
  });
});

describe("appSpecimenNodes", () => {
  const block = (name: string, extra: Partial<RepoCatalogEntry> = {}): RepoCatalogEntry => ({
    id: name,
    name,
    identity: { importPath: `@/components/${name}`, exportName: name },
    key: `repo::@/components/${name}#${name}`,
    source: "local",
    family: name,
    props: [],
    acceptsChildren: false,
    states: [{ name: "As used at app/page.tsx:1", props: { cap: "acid" }, source: "usage" }],
    provenance: ["app/page.tsx:1"],
    styleProps: [],
    ...extra,
  });

  test("the app's most used components, each as a call site draws it", () => {
    const nodes = appSpecimenNodes([
      block("Readout"),
      block("Panel", { provenance: ["app/page.tsx:1", "app/queue/page.tsx:4"] }),
    ]);
    expect(nodes).toEqual([
      { $ref: "Panel", $repo: block("Panel").identity, props: { cap: "acid" } },
      { $ref: "Readout", $repo: block("Readout").identity, props: { cap: "acid" } },
    ]);
  });

  test("a page shell and a component only ever given code are left out", () => {
    const nodes = appSpecimenNodes([
      block("AppShell"),
      block("Chart", {
        states: [{ name: "a", props: {}, source: "usage", dropped: ["data"] }],
      }),
      block("Unused", { states: [], provenance: [] }),
    ]);
    expect(nodes).toEqual([]);
  });
});
