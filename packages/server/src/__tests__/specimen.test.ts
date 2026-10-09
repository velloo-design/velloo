import { describe, expect, test } from "bun:test";
import type { ComponentProvider } from "@velloo/provider";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { type ComponentNode, isComponentNode, type Node } from "@velloo/schema";
import { ensureSpecimen, SPECIMEN_ID } from "../specimen.ts";
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
  const result = await ensureSpecimen(t.ctx);
  const screen = t.ctx.folder.screens.get(SPECIMEN_ID);
  return { t, result, all: screen ? nodes(screen.tree) : [] };
}

/**
 * The specimen has to be written in the folder's own idiom. A Tailwind class on
 * an `sx` or inline-style folder renders as nothing at all — the page would
 * look blank rather than wrong, which is the failure this guards.
 */
describe("ensureSpecimen", () => {
  test("shadcn: Tailwind classes, real components, a light and a dark frame", async () => {
    const { t, result, all } = await specimenFor();
    try {
      expect(result).toEqual({
        ok: true,
        value: { boardId: SPECIMEN_ID, screenId: SPECIMEN_ID, built: true },
      });
      expect(typeof all[0]?.props?.className).toBe("string");
      expect(all.every((n) => n.props?.style === undefined && n.props?.sx === undefined)).toBe(
        true,
      );
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
      // A theme-defined role is drawn with the utility that follows the theme.
      expect(all.some((n) => String(n.props?.className).includes("bg-primary"))).toBe(true);
      const frames = t.ctx.folder.boards.get(SPECIMEN_ID)?.frames ?? [];
      expect(frames.map((f) => f.scheme)).toEqual(["light", "dark"]);
      expect(frames.every((f) => f.screen === SPECIMEN_ID)).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  test("no CSS framework: inline styles on theme variables, and no class anywhere", async () => {
    const { t, result, all } = await specimenFor(createNoneProvider(), {
      library: { id: "none" },
      styling: { framework: "none" },
    });
    try {
      expect(result.ok).toBe(true);
      expect(all[0]?.props?.style).toMatchObject({ background: "var(--color-background)" });
      expect(all.every((n) => n.props?.className === undefined)).toBe(true);
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  test("MUI: sx on its own Box", async () => {
    const { t, result, all } = await specimenFor(createMuiProvider(), { library: { id: "mui" } });
    try {
      expect(result.ok).toBe(true);
      expect(all[0]?.$ref).toBe("Box");
      expect(all[0]?.props?.sx).toMatchObject({ background: "var(--color-background)" });
      expect(all.every((n) => n.props?.className === undefined)).toBe(true);
      expect(all.some((n) => n.$ref === "Button")).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  test("an existing specimen is left alone unless a rebuild is asked for", async () => {
    const { t } = await specimenFor();
    try {
      const again = await ensureSpecimen(t.ctx);
      expect(again).toMatchObject({ ok: true, value: { built: false } });
      const rebuilt = await ensureSpecimen(t.ctx, { rebuild: true });
      expect(rebuilt).toMatchObject({ ok: true, value: { built: true } });
      // The board is not duplicated by a rebuild.
      expect(t.ctx.folder.boards.get(SPECIMEN_ID)?.frames).toHaveLength(2);
    } finally {
      await t.cleanup();
    }
  });
});
