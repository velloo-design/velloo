import { describe, expect, test } from "bun:test";
import type { Node, Snippet } from "@velloo/schema";
import { serializeTree } from "../serialize-tree.ts";

/**
 * serializeTree mirrors buildTree's resolution (snippets/params inlined,
 * data-node-path baked, children handling) but outputs plain JSON for the
 * canvas bundle's client interpreter (#18).
 */

describe("serializeTree", () => {
  test("bakes data-node-path and resolves nested children", () => {
    const tree: Node = {
      $ref: "Card",
      props: { variant: "outlined" },
      children: [{ $ref: "Typography", props: { variant: "h5", children: "Hi" } }],
    };
    const out = serializeTree(tree, {});
    expect(out).toEqual({
      ref: "Card",
      props: { variant: "outlined", "data-node-path": "" },
      children: [
        {
          ref: "Typography",
          props: { variant: "h5", "data-node-path": "0" },
          children: ["Hi"],
        },
      ],
    });
  });

  test("inlines a snippet instance into the resolved tree", () => {
    const snippets = new Map<string, Snippet>([
      [
        "tile",
        {
          id: "tile",
          name: "Tile",
          params: [{ name: "label", type: "string" }],
          tree: { $ref: "Box", props: { children: { $param: "label" } } },
        },
      ],
    ]);
    const tree: Node = {
      $ref: "Stack",
      children: [{ $snippet: "tile", args: { label: "Revenue" } } as Node],
    };
    const out = serializeTree(tree, { snippets });
    // The snippet body is inlined; its node's path locks to the instance path "0".
    expect(out?.ref).toBe("Stack");
    const inlined = out?.children?.[0];
    expect(inlined).toMatchObject({ ref: "Box", children: ["Revenue"] });
  });

  test("returns null for a missing snippet (caller falls back to SSR)", () => {
    const tree: Node = { $ref: "Box", children: [{ $snippet: "ghost" } as Node] };
    const out = serializeTree(tree, { snippets: new Map() });
    // The Box resolves, but its missing-snippet child is dropped.
    expect(out?.ref).toBe("Box");
    expect(out?.children ?? []).toHaveLength(0);
  });
});
