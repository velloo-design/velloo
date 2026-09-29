import { describe, expect, test } from "bun:test";
import type { HostFragmentCapture } from "@velloo/provider";
import type { Node } from "@velloo/schema";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registry } from "../registry.ts";
import { liveAgain, staticSnapshot } from "../snapshot.ts";

/** A minimal stand-in for the renderer's buildTree: enough to render Html runs. */
function render(node: Node | string): ReactNode {
  if (typeof node === "string") return node;
  if (!("$ref" in node)) throw new Error("unexpected node");
  const Component = registry[node.$ref] as (props: Record<string, unknown>) => ReactNode;
  const { children, ...props } = node.props ?? {};
  const runs = Array.isArray(children) ? children : children === undefined ? [] : [children];
  const content = [...runs, ...(node.children ?? [])].map((child, i) =>
    typeof child === "object" && child !== null
      ? createElement(Fragment, { key: i }, render(child as Node))
      : (child as ReactNode),
  );
  return createElement(Component, props, ...content);
}

const screenTree: Node = {
  $ref: "Html",
  props: { as: "main" },
  children: [
    { $ref: "Html", props: { as: "h1", children: "Contacts" } },
    {
      $ref: "HtmlFragment",
      $id: "rows",
      props: { src: "/contacts/rows", as: "tbody", className: "rows" },
      children: [{ $ref: "Html", props: { as: "tr", children: "Loading" } }],
    },
  ],
};

const hostile: HostFragmentCapture = {
  path: "1",
  truncated: false,
  content: [
    "\n  ",
    {
      tag: "tr",
      attrs: { class: "row", onclick: "steal()", "hx-get": "/contacts/1" },
      children: [
        "\n    ",
        {
          tag: "td",
          attrs: { style: "color: red; background: url(/static/a.png)" },
          children: [
            "Tom & Jerry",
            { tag: "script", attrs: {}, children: ["alert(1)"] },
            { tag: "img", attrs: { src: "/static/a.png", onerror: "alert(2)" }, children: [] },
          ],
        },
        {
          tag: "td",
          attrs: {},
          children: [
            { tag: "a", attrs: { href: "java\tscript:alert(3)" }, children: ["bad"] },
            { tag: "sl-badge", attrs: { variant: "x" }, children: ["kept text"] },
            { tag: "iframe", attrs: { srcdoc: "<script>alert(4)</script>" }, children: [] },
          ],
        },
        {
          tag: "td",
          attrs: {},
          children: [
            {
              tag: "input",
              attrs: { type: "checkbox", checked: "", disabled: "", value: "1" },
              children: [],
            },
            { tag: "textarea", attrs: { name: "note" }, children: ["hello"] },
            {
              tag: "svg",
              attrs: { viewBox: "0 0 1 1" },
              children: [{ tag: "linearGradient", attrs: { id: "g" }, children: [] }],
            },
          ],
        },
      ],
    },
  ],
};

describe("staticSnapshot", () => {
  test("replaces the fragment with a static element, keeping its id, path and own props", () => {
    const { tree, warnings } = staticSnapshot(screenTree, [hostile]);
    expect(warnings).toEqual([]);
    const fragment = (tree as unknown as { children: Node[] }).children[1] as {
      $ref: string;
      $id?: string;
      props: Record<string, unknown>;
      children?: unknown;
    };
    expect(fragment.$ref).toBe("Html");
    expect(fragment.$id).toBe("rows");
    expect(fragment.props).toMatchObject({ as: "tbody", className: "rows" });
    expect(fragment.props.src).toBeUndefined();
    // The placeholder is gone; the host's markup is the content.
    expect(fragment.children).toBeUndefined();
  });

  test("keeps nothing that runs, embeds, or navigates to script", () => {
    const { tree } = staticSnapshot(screenTree, [hostile]);
    const json = JSON.stringify(tree);
    for (const banned of ["script", "alert", "onclick", "onerror", "iframe", "srcdoc"]) {
      expect(json).not.toContain(banned);
    }
    const markup = renderToStaticMarkup(render(tree) as never);
    expect(markup).not.toMatch(/<script|onerror|onclick|javascript|<iframe/i);
    expect(markup).toContain("Tom &amp; Jerry");
    // An element Html won't render yields its text rather than dropping it.
    expect(markup).toContain("kept text");
  });

  test("renders real markup: styles, booleans, form defaults, SVG case, no stray table text", () => {
    const { tree } = staticSnapshot(screenTree, [hostile]);
    const markup = renderToStaticMarkup(render(tree) as never);
    expect(markup).toContain('style="color:red;background:url(/static/a.png)"');
    expect(markup).toMatch(/<input[^>]*disabled=""/);
    expect(markup).toMatch(/<input[^>]*checked=""/);
    expect(markup).toContain(">hello</textarea>");
    expect(markup).toContain('viewBox="0 0 1 1"');
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain('hx-get="/contacts/1"');
    // Whitespace between rows is formatting, and text in a tbody is invalid DOM.
    const fragment = (tree as unknown as { children: { props: { children: unknown[] } }[] })
      .children[1];
    expect(fragment?.props.children.every((run) => typeof run !== "string")).toBe(true);
  });

  test("an uncaptured fragment keeps its placeholder and says so", () => {
    const { tree, warnings } = staticSnapshot(screenTree, []);
    expect((tree as { children: Node[] }).children[1]).toMatchObject({ $ref: "HtmlFragment" });
    expect(warnings[0]).toContain("/contacts/rows");
  });

  test("a truncated capture is published with a warning", () => {
    const { warnings } = staticSnapshot(screenTree, [{ ...hostile, truncated: true }]);
    expect(warnings[0]).toContain("too large");
  });
});

describe("staticSnapshot for a design (editable)", () => {
  const page: HostFragmentCapture = {
    path: "1",
    truncated: false,
    content: [
      "\n ",
      {
        tag: "tr",
        attrs: { class: "row" },
        children: [
          "\n  ",
          { tag: "td", attrs: {}, children: ["Carson"] },
          {
            tag: "td",
            attrs: {},
            children: ["Mail ", { tag: "a", attrs: { href: "/m" }, children: ["here"] }],
          },
        ],
      },
    ],
  };

  test("structure becomes tree children; mixed text stays inline; the source is kept", () => {
    const { tree } = staticSnapshot(screenTree, [page], { editable: true });
    const frozen = (tree as { children: Node[] }).children[1] as {
      $ref: string;
      $id?: string;
      props: Record<string, unknown>;
      children: {
        props: Record<string, unknown>;
        children?: { props: Record<string, unknown> }[];
      }[];
    };
    expect(frozen).toMatchObject({
      $ref: "Html",
      $id: "rows",
      props: { as: "tbody", snapshotOf: "/contacts/rows" },
    });
    expect(frozen.props.children).toBeUndefined();
    const row = frozen.children[0];
    expect(row?.props).toMatchObject({ as: "tr", className: "row" });
    // Whitespace between cells is formatting, not content.
    expect(row?.children?.map((cell) => cell.props.children)).toEqual([
      "Carson",
      ["Mail ", { $ref: "Html", props: { as: "a", href: "/m", children: "here" } }],
    ]);
  });

  test("snapshot bookkeeping never reaches the markup", () => {
    const { tree } = staticSnapshot(screenTree, [page], { editable: true });
    const markup = renderToStaticMarkup(render(tree) as never);
    expect(markup).not.toMatch(/snapshot/i);
    expect(markup).toContain("Carson");
  });

  test("liveAgain turns a snapshot back into the fragment it came from", () => {
    const { tree } = staticSnapshot(screenTree, [page], { editable: true });
    const live = (liveAgain(tree) as { children: Node[] }).children[1];
    expect(live).toEqual({
      $ref: "HtmlFragment",
      $id: "rows",
      props: { as: "tbody", className: "rows", src: "/contacts/rows" },
    });
  });
});
