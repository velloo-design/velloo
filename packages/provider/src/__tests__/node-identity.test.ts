import { describe, expect, test } from "bun:test";
import type { Extension } from "@velloo/schema";
import { PARAM_TAG_REF } from "@velloo/schema";
import {
  type LibraryLookup,
  type NodeIdentity,
  type NodeIdentityContext,
  resolveNodeIdentity,
} from "../node-identity.ts";

const priceChart: Extension = { importPath: "@/components/price-chart", props: [] };
const card: Extension = { importPath: "@/components/card", props: [] };
const Component = () => null;

const kindOf = (
  value: unknown,
  ctx: NodeIdentityContext<unknown> = { library: {} },
): NodeIdentity["kind"] => resolveNodeIdentity(value, ctx).kind;

describe("resolveNodeIdentity precedence", () => {
  test("a repository identity beats a library component of the same name", () => {
    expect(
      kindOf(
        { $ref: "Button", $repo: { importPath: "@mantine/core", exportName: "Button" } },
        { library: { Button: Component } },
      ),
    ).toBe("repo");
  });

  test("a repository identity beats an extension of the same name", () => {
    expect(
      kindOf(
        { $ref: "PriceChart", $repo: { importPath: "@/charts", exportName: "PriceChart" } },
        { extensions: { PriceChart: priceChart }, library: {} },
      ),
    ).toBe("repo");
  });

  test("an extension shadows the library component it collides with", () => {
    const identity = resolveNodeIdentity(
      { $ref: "Card" },
      { extensions: { Card: card }, library: { Card: Component, Button: Component } },
    );
    expect(identity.kind).toBe("extension");
    if (identity.kind !== "extension") throw new Error("unreachable");
    expect(identity.extension.importPath).toBe("@/components/card");
  });

  test("a synthetic ref never reaches the extension or library lookup", () => {
    expect(
      kindOf(
        { $ref: PARAM_TAG_REF },
        { extensions: { [PARAM_TAG_REF]: card }, library: { [PARAM_TAG_REF]: Component } },
      ),
    ).toBe("synthetic");
  });

  test("a name the library supplies is a component, carrying the library's entry", () => {
    const identity = resolveNodeIdentity({ $ref: "Button" }, { library: { Button: Component } });
    expect(identity.kind).toBe("component");
    if (identity.kind !== "component") throw new Error("unreachable");
    expect(identity.entry).toBe(Component);
  });

  test("a name nothing supplies is unresolved", () => {
    expect(kindOf({ $ref: "Carousel3000" }, { library: { Button: Component } })).toBe("unresolved");
  });
});

describe("resolveNodeIdentity library lookup", () => {
  test("a function lookup sees the node, so an entry may depend on its props", () => {
    const library: LibraryLookup<string> = (ref, node) =>
      ref === "Box" ? String(node.props?.as ?? "div") : undefined;
    const identity = resolveNodeIdentity({ $ref: "Box", props: { as: "section" } }, { library });
    if (identity.kind !== "component") throw new Error(`got ${identity.kind}`);
    expect(identity.entry).toBe("section");
    expect(kindOf({ $ref: "Card" }, { library })).toBe("unresolved");
  });

  test("a registry's or extension map's inherited keys are not components", () => {
    // `Object.hasOwn`, not `in`: a design's `$ref` must not resolve to
    // `toString` or `constructor` off the prototype of a plain object.
    expect(kindOf({ $ref: "toString" }, { library: { Button: Component } })).toBe("unresolved");
    expect(
      kindOf({ $ref: "constructor" }, { extensions: { PriceChart: priceChart }, library: {} }),
    ).toBe("unresolved");
  });
});
