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
