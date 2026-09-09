import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderScreen } from "@velloo/renderer";
import type { ComponentNode, Node } from "@velloo/schema";
import { isComponentNode } from "@velloo/schema";
import { designTheme, testContext } from "../../testing/design-folder.ts";
import { buildShowcaseTree, showcaseIds } from "../showcases.ts";

/**
 * The Library's tiles and detail previews render these trees against the
 * folder's default provider. Nothing connects the two: a showcase naming a
 * component the registry no longer has renders the fallback — a tile that
 * looks plausible and is quietly wrong — and a missing `$ref` inside one
 * renders an empty box. Neither fails anything today.
 *
 * That is the same shape as the failure CLAUDE.md warns about, where a
 * registry refresh left new families unreachable in the UI with nothing red.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let known: Set<string>;

beforeEach(async () => {
  folder = await testContext({ label: "showcases" });
  const manifest = await folder.ctx.defaultProvider.loadManifest();
  known = new Set(manifest.map((d) => d.id));
});

afterEach(() => folder.cleanup());

/** Every `$ref` in a tree, root included. */
function refsIn(node: Node, found: string[] = []): string[] {
  if (isComponentNode(node)) {
    found.push(node.$ref);
    for (const child of node.children ?? []) refsIn(child, found);
  }
  return found;
}

describe("the showcase table agrees with the library", () => {
  test("every showcase names a component the library has", () => {
    const orphans = showcaseIds().filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  test("every component a showcase builds with exists too", () => {
    const missing = new Map<string, string[]>();
    for (const id of showcaseIds()) {
      const unknown = refsIn(buildShowcaseTree(id)).filter((ref) => !known.has(ref));
      if (unknown.length > 0) missing.set(id, unknown);
    }
    expect([...missing]).toEqual([]);
  });

  test("every component in the library builds a tree of components it has", () => {
    // Covers the fallback branch too: a component with no hand-built showcase
    // still has to produce something renderable.
    const missing = new Map<string, string[]>();
    for (const id of known) {
      const unknown = refsIn(buildShowcaseTree(id)).filter((ref) => !known.has(ref));
      if (unknown.length > 0) missing.set(id, unknown);
    }
    expect([...missing]).toEqual([]);
  });

  test("every showcase actually contains the component it is showing", () => {
    // Not necessarily at the root — a Label needs the input it labels, an
    // overlay needs its Root around the Content — but a showcase that has
    // drifted off its subject entirely previews the wrong component, which is
    // what the overlays used to do when their tiles were drawn from Card.
    const absent = showcaseIds().filter((id) => !refsIn(buildShowcaseTree(id)).includes(id));
    expect(absent).toEqual([]);
  });
});

describe("showcases render", () => {
  /** SSR one showcase the way the preview route does, and return its body. */
  const html = async (id: string): Promise<string> => {
    const { bodyHtml } = await renderScreen(
      { id: `${id}__preview`, name: id, tree: buildShowcaseTree(id) },
      designTheme(),
      {
        viewport: { w: 320, h: 240 },
        snapshotCss: "",
        registry: folder.ctx.defaultProvider.registry,
        includeRuntime: false,
      },
    );
    return bodyHtml;
  };

  test("every showcase produces markup, not an empty box", async () => {
    const empty: string[] = [];
    for (const id of showcaseIds()) {
      if ((await html(id)).trim().length === 0) empty.push(id);
    }
    expect(empty).toEqual([]);
  });

  test("the overlays render their own family's slots, inline", async () => {
    // The whole reason these can be the real components: the Root pins open in
    // design mode and Content drops the portal, so the family's own markup
    // lands in the page flow where a tile can show it.
    for (const [id, slot] of [
      ["Dialog", "dialog-content"],
      ["AlertDialog", "alert-dialog-content"],
      ["Popover", "popover-content"],
      ["DropdownMenu", "dropdown-menu-content"],
      ["Tooltip", "tooltip-content"],
      ["Sheet", "sheet-content"],
    ] as const) {
      const markup = await html(id);
      expect(markup).toContain(`data-slot="${slot}"`);
      expect(markup).toContain('data-velloo-inline="true"');
      // Inline means in the flow — never a viewport-pinned layer.
      expect(markup).not.toContain("fixed inset-0");
    }
  });

  test("overlay copy survives the move to the real components", async () => {
    expect(await html("Dialog")).toContain("Confirm change");
    expect(await html("AlertDialog")).toContain("Delete file?");
    expect(await html("DropdownMenu")).toContain("Log out");
    expect(await html("Tooltip")).toContain("Helpful hint");
    expect(await html("Sheet")).toContain("Slide-in panel");
    expect(await html("Popover")).toContain("Anchored to a trigger.");
  });
});

describe("buildShowcaseTree", () => {
  test("a component with no entry falls back to a labelled node", () => {
    const tree = buildShowcaseTree("Button") as ComponentNode;
    expect(tree.$ref).toBe("Button");
    const fallback = buildShowcaseTree("SomethingUnknown") as ComponentNode;
    expect(fallback).toEqual({
      $ref: "SomethingUnknown",
      props: { children: "SomethingUnknown" },
    });
  });

  test("prop overrides patch the subject without disturbing its children", () => {
    const plain = buildShowcaseTree("Label") as ComponentNode;
    const patched = buildShowcaseTree("Label", { className: "custom" }) as ComponentNode;
    expect(patched.props?.className).toBe("custom");
    expect(refsIn(patched)).toEqual(refsIn(plain));
  });

  test("overrides reach the fallback too", () => {
    const tree = buildShowcaseTree("Unknown", { variant: "ghost" }) as ComponentNode;
    expect(tree.props).toEqual({ children: "Unknown", variant: "ghost" });
  });

  test("an icon-size button shows an icon instead of clipped text", () => {
    for (const size of ["icon", "icon-sm"]) {
      const tree = buildShowcaseTree("Button", { size }) as ComponentNode;
      expect(tree.props).not.toHaveProperty("children");
      expect(refsIn(tree)).toEqual(["Button", "Icon"]);
    }
  });

  test("the icon swap is Button-only, and off at ordinary sizes", () => {
    const large = buildShowcaseTree("Button", { size: "lg" }) as ComponentNode;
    expect(large.props?.children).toBe("Button");
    const badge = buildShowcaseTree("Badge", { size: "icon" }) as ComponentNode;
    expect(badge.props?.children).toBe("Badge");
  });

  test("each call returns a fresh tree, so a patched preview can't leak", () => {
    const first = buildShowcaseTree("Button", { variant: "ghost" }) as ComponentNode;
    const second = buildShowcaseTree("Button") as ComponentNode;
    expect(first.props?.variant).toBe("ghost");
    expect(second.props).not.toHaveProperty("variant");
  });
});
