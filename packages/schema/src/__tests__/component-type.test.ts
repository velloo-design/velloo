import { describe, expect, test } from "bun:test";
import {
  componentTypesIn,
  isComponentType,
  isNode,
  mapComponentTypes,
  NodeSchema,
  nodeShape,
  ScreenSchema,
} from "../index.ts";

const scrollArea = {
  $type: {
    $ref: "ScrollArea",
    $repo: { importPath: "@mantine/core", exportName: "ScrollArea" },
  },
};

describe("component types as prop values", () => {
  test("round-trip through the node schema, wherever a prop value sits", () => {
    const node = {
      $ref: "AppShell.Section",
      $repo: { importPath: "@mantine/core", exportName: "AppShell", member: "Section" },
      props: {
        grow: true,
        component: scrollArea,
        links: [{ label: "Home", icon: { $type: { $ref: "IconHome" } } }],
      },
      children: [{ $ref: "Box", props: { as: { $type: { $ref: "Link" } } } }],
    };
    const parsed = NodeSchema.parse(node);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(node);
    expect(
      NodeSchema.safeParse({ $snippet: "nav", args: { icon: { $type: { $ref: "IconHome" } } } })
        .success,
    ).toBe(true);
  });

  test("a design with no component type parses to exactly what it was", () => {
    const tree = {
      $ref: "Box",
      props: { className: "p-4", sx: { "&:hover": { color: "red" } }, data: [{ type: "x" }] },
      children: [{ $ref: "Text", props: { children: "Hi" } }, { $text: "there" }],
    };
    const screen = { id: "s", name: "S", tree };
    expect(JSON.stringify(ScreenSchema.parse(screen))).toBe(JSON.stringify(screen));
  });

  test("a malformed type is refused where it sits, and its $repo is held to a node's checks", () => {
    const at = (props: Record<string, unknown>) => {
      const parsed = NodeSchema.safeParse({ $ref: "Box", props });
      return parsed.success ? null : parsed.error.issues.map((issue) => issue.path.join("."));
    };
    expect(at({ component: { $type: "ScrollArea" } })).toEqual(["props.component.$type"]);
    expect(at({ items: [{ icon: { $type: { $ref: "velloo:static" } } }] })).toEqual([
      "props.items.0.icon.$type.$ref",
    ]);
    expect(at({ component: { $type: { $ref: "X", props: {} } } })).not.toBeNull();
    expect(
      at({
        component: { $type: { $ref: "X", $repo: { importPath: "../../x", exportName: "X" } } },
      }),
    ).not.toBeNull();
  });

  test("is a value, not a node: no node position takes one", () => {
    expect(isComponentType(scrollArea)).toBe(true);
    expect(isComponentType(null)).toBe(false);
    expect(isComponentType("ScrollArea")).toBe(false);
    expect(isComponentType({ $ref: "ScrollArea" })).toBe(false);
    expect(isNode(scrollArea)).toBe(false);
    expect(nodeShape(scrollArea).kind).toBe("invalid");
    expect(NodeSchema.safeParse({ $ref: "Box", children: [scrollArea] }).success).toBe(false);
    const root = NodeSchema.safeParse(scrollArea);
    expect(root.success).toBe(false);
    if (!root.success) expect(root.error.issues[0]?.message).toContain("is a prop value");
  });

  test("mapComponentTypes reaches nested values but not into nodes, and keeps identity", () => {
    const props = {
      component: scrollArea,
      list: [{ icon: { $type: { $ref: "IconHome" } } }],
      slot: { $ref: "Button", props: { component: { $type: { $ref: "Link" } } } },
      plain: { a: 1 },
    };
    const mapped = mapComponentTypes(props, (type) => type.$ref) as typeof props;
    expect(mapped.component as unknown).toBe("ScrollArea");
    expect(mapped.list[0]?.icon as unknown).toBe("IconHome");
    expect(mapped.slot).toBe(props.slot);
    expect(mapped.plain).toBe(props.plain);
    const untouched = { a: [1, { b: 2 }] };
    expect(mapComponentTypes(untouched, () => null)).toBe(untouched);
    expect(componentTypesIn(props).map((type) => type.$ref)).toEqual(["ScrollArea", "IconHome"]);
  });
});
