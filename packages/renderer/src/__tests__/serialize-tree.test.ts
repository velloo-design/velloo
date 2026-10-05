import { describe, expect, test } from "bun:test";
import type { Node, Snippet } from "@velloo/schema";
import { type SerializedNode, serializeTree } from "../serialize-tree.ts";

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

  /**
   * The serialized tree replaces the SSR DOM once the canvas bundle mounts, so
   * a marker missing here is a marker missing from the page. Dropping these two
   * cost snippet editing entirely: double-click found no `data-snippet-id` to
   * enter, and focus mode dimmed the whole visible mount because the only
   * elements it recognised as instances were the hidden SSR copies.
   */
  test("carries the snippet body markers buildTree bakes in", () => {
    const snippets = new Map<string, Snippet>([
      [
        "bar",
        {
          id: "bar",
          name: "Bar",
          params: [],
          tree: {
            $ref: "Box",
            children: [{ $ref: "Text", props: { children: "hi" } }],
          },
        },
      ],
    ]);
    const out = serializeTree(
      { $ref: "Stack", children: [{ $snippet: "bar" } as Node] },
      {
        snippets,
      },
    );
    const root = out?.children?.[0] as SerializedNode;
    expect(root.props).toMatchObject({ "data-snippet-id": "bar", "data-snippet-path": "" });
    // The position *inside the definition*, which the instance path hides.
    const inner = (root.children ?? [])[0] as SerializedNode;
    expect(inner.props).toMatchObject({
      "data-snippet-id": "bar",
      "data-snippet-path": "0",
      "data-node-path": "0",
    });
  });

  test("a node outside a snippet carries no body markers", () => {
    const out = serializeTree({ $ref: "Box", props: {} }, {});
    expect(out?.props).not.toHaveProperty("data-snippet-id");
  });

  test("returns null for a missing snippet (caller falls back to SSR)", () => {
    const tree: Node = { $ref: "Box", children: [{ $snippet: "ghost" } as Node] };
    const out = serializeTree(tree, { snippets: new Map() });
    // The Box resolves, but its missing-snippet child is dropped.
    expect(out?.ref).toBe("Box");
    expect(out?.children ?? []).toHaveLength(0);
  });

  test("a text node is text content, and its parent says where its text children sit", () => {
    const tree: Node = {
      $ref: "Box",
      props: { as: "li" },
      children: [
        { $text: "Remote " },
        { $ref: "Box", props: { as: "a", children: "Apply" } },
        { $text: " today" },
      ],
    };
    // The client passes a string child as text: no element, as in SSR. The
    // attribute is how the canvas finds the DOM text node for a path.
    expect(serializeTree(tree, {})).toEqual({
      ref: "Box",
      props: { as: "li", "data-node-path": "", "data-node-text": "0,2" },
      children: [
        "Remote ",
        { ref: "Box", props: { as: "a", "data-node-path": "1" }, children: ["Apply"] },
        " today",
      ],
    });
  });

  test("text inside a snippet instance is not addressed below the instance", () => {
    const snippets = new Map<string, Snippet>([
      [
        "row",
        {
          id: "row",
          name: "Row",
          params: [],
          tree: { $ref: "Box", children: [{ $text: "Remote " }, { $ref: "Badge" }] },
        },
      ],
    ]);
    const out = serializeTree({ $ref: "Box", children: [{ $snippet: "row" }] }, { snippets });
    const body = out?.children?.[0] as SerializedNode;
    expect(body.children?.[0]).toBe("Remote ");
    expect(body.props).not.toHaveProperty("data-node-text");
  });
});
