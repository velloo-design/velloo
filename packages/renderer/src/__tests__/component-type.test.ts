import { describe, expect, test } from "bun:test";
import type { ComponentRegistry } from "@velloo/provider";
import type { Node, Screen } from "@velloo/schema";
import { createElement, type ElementType, type ReactNode } from "react";
import { renderBodyGuarded } from "../render-to-html.ts";
import {
  collectSerializedRefs,
  collectSerializedRepoRefs,
  serializeTree,
} from "../serialize-tree.ts";

/** A polymorphic component, as Mantine's and MUI's are: it renders whatever `component` it is given. */
function Section({
  component: Root = "section",
  children,
  ...rest
}: {
  component?: ElementType;
  children?: ReactNode;
}) {
  return createElement(Root, { ...rest, "data-section": "" }, children);
}

function Scroller({ children, ...rest }: { children?: ReactNode }) {
  return createElement("div", { ...rest, "data-scroller": "" }, children);
}

function Nav({ links }: { links: { label: string; icon: ElementType }[] }) {
  return createElement(
    "nav",
    null,
    links.map(({ label, icon: Icon }) => createElement(Icon, { key: label }, label)),
  );
}

const registry: ComponentRegistry = { Section, Scroller, Nav };

const screenOf = (tree: Node): Screen => ({ id: "s", name: "S", tree });

const mantineScrollArea = {
  $ref: "ScrollArea",
  $repo: { importPath: "@mantine/core", exportName: "ScrollArea" },
};

describe("a component type as a prop value", () => {
  test("renders as the component a $ref of that name would, wherever in the prop it sits", () => {
    const { html, failures } = renderBodyGuarded(
      screenOf({
        $ref: "Section",
        props: { component: { $type: { $ref: "Scroller" } }, children: "Body" },
        children: [
          {
            $ref: "Nav",
            props: { links: [{ label: "Home", icon: { $type: { $ref: "Scroller" } } }] },
          },
        ],
      }),
      registry,
    );
    expect(failures).toEqual([]);
    expect(html).toContain('data-scroller=""');
    expect(html).toContain('data-section=""');
    expect(html).not.toContain("<section");
    expect(html).toContain('<div data-scroller="">Home</div>');
  });

  test("the app's own component has no server render, so the component keeps its default", () => {
    const { html, failures } = renderBodyGuarded(
      screenOf({ $ref: "Section", props: { component: { $type: mantineScrollArea } } }),
      registry,
    );
    expect(failures).toEqual([]);
    expect(html).toContain("<section");
  });

  test("a name nothing supplies stands in like an unknown $ref", () => {
    const { failures } = renderBodyGuarded(
      screenOf({ $ref: "Section", props: { component: { $type: { $ref: "Nowhere" } } } }),
      registry,
    );
    expect(failures).toEqual([
      expect.objectContaining({ componentId: "Nowhere", kind: "missing" }),
    ]);
  });
});

describe("a component type in the client mount", () => {
  const tree: Node = {
    $ref: "AppShell.Section",
    $repo: { importPath: "@mantine/core", exportName: "AppShell", member: "Section" },
    props: { grow: true, component: { $type: mantineScrollArea } },
    children: [
      {
        $ref: "Section",
        props: { component: { $type: { $ref: "Scroller" } }, sx: { p: 2 } },
      },
    ],
  };

  test("serializes to the ref the bundle registers it under", () => {
    const out = serializeTree(tree, {});
    expect(out?.props?.component).toEqual({
      $type: {
        ref: "repo::@mantine/core#ScrollArea",
        repo: { ...mantineScrollArea.$repo, name: "ScrollArea" },
      },
    });
    expect(out?.children?.[0]).toEqual({
      ref: "Section",
      props: { component: { $type: { ref: "Scroller" } }, sx: { p: 2 }, "data-node-path": "0" },
    });
  });

  test("brings the component into the bundle though no element of it is on the screen", () => {
    const out = serializeTree(tree, {});
    expect(collectSerializedRefs(out)).toEqual([
      "repo::@mantine/core#AppShell.Section",
      "repo::@mantine/core#ScrollArea",
      "Section",
      "Scroller",
    ]);
    expect([...collectSerializedRepoRefs(out).keys()]).toEqual([
      "repo::@mantine/core#AppShell.Section",
      "repo::@mantine/core#ScrollArea",
    ]);
  });
});
