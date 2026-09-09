import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ComponentNode, Node } from "@velloo/schema";
import { isComponentNode } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
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
    // Not necessarily at the root — a Label needs the input it labels — but a
    // showcase that has drifted off its subject entirely previews the wrong
    // component. The exceptions are the overlays, whose tiles are hand-drawn
    // out of Card and Text rather than the real family: a tile is too small to
    // host one, and the snapshot's overlays render pinned open. That makes
    // their preview an imitation that theme changes won't follow, so the list
    // is pinned here rather than left to grow quietly.
    const IMITATED = ["AlertDialog", "Dialog", "DropdownMenu", "Popover", "Sheet", "Tooltip"];
    const absent = showcaseIds()
      .filter((id) => !refsIn(buildShowcaseTree(id)).includes(id))
      .sort();
    expect(absent).toEqual(IMITATED);
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
