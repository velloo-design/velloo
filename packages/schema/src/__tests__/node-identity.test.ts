import { describe, expect, test } from "bun:test";
import {
  isNode,
  isSyntheticRef,
  type NodeShape,
  nodeShape,
  PARAM_TAG_REF,
  STATIC_REF,
} from "../node-identity.ts";

/**
 * What a node's own fields say it is, and in what order. The `$`-key ordering
 * lives here alone: the provider's resolver layers a registry on top of it, and
 * the SSR, canvas-mount and codegen walkers all dispatch on the result.
 */
describe("nodeShape", () => {
  const kindOf = (value: unknown): NodeShape["kind"] => nodeShape(value).kind;

  test("names each node shape from its own key", () => {
    expect(kindOf({ $ref: "Button" })).toBe("named");
    expect(kindOf({ $snippet: "feature-card" })).toBe("snippet");
    expect(kindOf({ $param: "title" })).toBe("param");
  });

  test("a snippet or param key outranks a `$ref` on the same value", () => {
    // The order SSR, the canvas mount and codegen dispatched in before one
    // resolver existed; a malformed node must not change meaning under it.
    expect(kindOf({ $snippet: "feature-card", $ref: "Button" })).toBe("snippet");
    expect(kindOf({ $param: "title", $ref: "Button" })).toBe("param");
    expect(kindOf({ $snippet: "feature-card", $param: "title" })).toBe("snippet");
  });

  test("a repository identity outranks every other component key on the node", () => {
    const shape = nodeShape({
      $ref: "Tabs.List",
      $repo: { importPath: "@mantine/core", exportName: "Tabs", member: "List" },
      $emitAs: { name: "Legacy", importPath: "@/legacy" },
    });
    expect(shape.kind).toBe("repo");
    if (shape.kind !== "repo") throw new Error("unreachable");
    // The JSX name stays on `$ref`; the identity is what decides anything else.
    expect(shape.ref).toBe("Tabs.List");
    expect(shape.repo.exportName).toBe("Tabs");
  });

  test("an emit-as facade outranks the plain name it renders as", () => {
    const shape = nodeShape({
      $ref: "Card",
      $emitAs: { name: "BillingTable", importPath: "@/components/billing-table" },
    });
    expect(shape.kind).toBe("emit-as");
    if (shape.kind !== "emit-as") throw new Error("unreachable");
    expect(shape.emitAs.name).toBe("BillingTable");
    expect(shape.ref).toBe("Card");
  });

  test("a synthetic ref is not a name any registry could hold", () => {
    expect(kindOf({ $ref: PARAM_TAG_REF })).toBe("synthetic");
    expect(kindOf({ $ref: STATIC_REF })).toBe("synthetic");
    expect(isSyntheticRef(PARAM_TAG_REF)).toBe(true);
    expect(isSyntheticRef("Button")).toBe(false);
    // Not every `velloo:` string is one — only the refs the renderer owns.
    expect(kindOf({ $ref: "velloo:not-a-thing" })).toBe("named");
  });

  test("anything that is not a node in a node position is invalid, not a throw", () => {
    for (const value of ["text", 4, null, undefined, [], {}, { ref: "Button" }]) {
      expect(kindOf(value)).toBe("invalid");
    }
  });

  test("isNode accepts every node shape and rejects a plain prop value", () => {
    expect(isNode({ $ref: "Icon", props: { name: "Plus" } })).toBe(true);
    expect(isNode({ $snippet: "row" })).toBe(true);
    expect(isNode({ $param: "label" })).toBe(true);
    expect(isNode("the math right")).toBe(false);
    expect(isNode({ $if: "compact" })).toBe(false);
  });
});
