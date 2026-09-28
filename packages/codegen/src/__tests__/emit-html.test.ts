import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider } from "@velloo/provider-html";
import type { Screen, Snippet, Theme } from "@velloo/schema";
import { emitHtml, emitHtmlSnippet } from "../emit-html/index.ts";
import { emitCssVariables } from "../emit-theme/css-variables.ts";

const registry = createProvider().registry;

const screen: Screen = {
  id: "contacts",
  name: "Contacts",
  tree: {
    $ref: "Html",
    props: { as: "main", className: "page page--wide" },
    children: [
      {
        $ref: "Html",
        props: {
          as: "form",
          "hx-get": "/contacts/search",
          "hx-target": "#rows",
          action: "/contacts",
          className: "search",
        },
        children: [{ $ref: "Html", props: { as: "input", name: "q", type: "search" } }],
      },
      { $ref: "HtmlFragment", props: { src: "/contacts/rows", as: "div" } },
      {
        $ref: "Box",
        props: { style: { color: "var(--color-primary)" }, title: 'data-node-path="1"' },
      },
    ],
  },
};

describe("emitHtml", () => {
  test("returns native markup without canvas bookkeeping, plus what it depends on", async () => {
    const result = await emitHtml(screen, { registry });
    expect(result.format).toBe("html");
    expect(result.html).toContain('hx-get="/contacts/search"');
    expect(result.html).toContain('hx-get="/contacts/rows"');
    expect(result.html).not.toMatch(/\sdata-node-path=/);
    expect(result.html).not.toContain("data-velloo");
    // Attribute text that merely looks like a marker is content, and stays.
    expect(result.html).toContain('title="data-node-path=&quot;1&quot;"');
    expect(result.classesUsed).toEqual(["page", "page--wide", "search"]);
    expect(result.hostRoutes).toEqual(["/contacts", "/contacts/rows", "/contacts/search"]);
    expect(result.warnings.join(" ")).toContain("emit_theme");
    expect("jsx" in result).toBe(false);
  });
});

test("writes HTML attribute names as a template would, and leaves SVG's case alone", async () => {
  const result = await emitHtml(
    {
      id: "form",
      name: "Form",
      tree: {
        $ref: "Html",
        props: { as: "form" },
        children: [
          { $ref: "Html", props: { as: "input", autocomplete: "off", maxlength: 4 } },
          { $ref: "Html", props: { as: "svg", viewBox: "0 0 10 10" } },
        ],
      },
    },
    { registry },
  );
  expect(result.html).toContain('<input autocomplete="off" maxlength="4" />');
  expect(result.html).toContain('<svg viewBox="0 0 10 10">');
});

describe("emitHtmlSnippet", () => {
  const snippet: Snippet = {
    id: "contact-row",
    name: "Contact row",
    params: [
      { name: "name", type: "string", default: "Alex" },
      { name: "count", type: "number", default: 3 },
      { name: "archived", type: "boolean" },
      { name: "actions", type: "node", optional: true },
    ],
    tree: {
      $ref: "Html",
      props: { as: "li", "data-count": { $param: "count" } },
      children: [
        { $ref: "Html", props: { as: "span", children: { $param: "name" } } },
        {
          $ref: "Html",
          props: {
            as: "em",
            children: { $if: "archived", then: "Archived", else: "Active" },
          },
        },
        { $param: "actions" },
      ],
    },
  };

  test("marks every param instead of baking defaults, and reports the defaults", async () => {
    const result = await emitHtmlSnippet(snippet, { registry });
    expect(result.html).toContain("<span>$name</span>");
    expect(result.html).toContain('data-count="$count"');
    expect(result.html).toContain("$actions");
    expect(result.html).not.toContain("Alex");
    expect(result.html).not.toContain("<span data-velloo-param");
    expect(result.params).toContainEqual({ name: "name", type: "string", default: '"Alex"' });
    expect(result.warnings.join(" ")).toContain("archived");
  });
});

describe("emitCssVariables", () => {
  test("writes the canvas's CSS custom properties, not Tailwind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-css-vars-"));
    try {
      const theme = {
        name: "t",
        colors: { primary: { DEFAULT: "#123456", foreground: "#ffffff" }, background: "#fff" },
        typography: { fontFamily: { sans: "Inter, sans-serif" } },
        spacing: {},
        radius: { md: 6 },
      } as unknown as Theme;
      const result = await emitCssVariables(theme, { outputDir: dir, apply: true });
      const css = await readFile(join(dir, "velloo-theme.css"), "utf8");
      expect(css).toContain("--color-primary: #123456");
      expect(css).toContain("--radius: 6px");
      expect(css).not.toContain("@theme");
      expect(result.files.map((file) => file.path.slice(dir.length + 1))).toEqual([
        "velloo-theme.css",
        "tokens.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("leaves out the image preload hints React's SSR adds", async () => {
  const result = await emitHtml(
    {
      id: "gallery",
      name: "Gallery",
      tree: {
        $ref: "Html",
        props: { as: "div" },
        children: [{ $ref: "Html", props: { as: "img", src: "/static/a.jpg", alt: "" } }],
      },
    },
    { registry },
  );
  expect(result.html).not.toContain("<link");
  expect(result.html.startsWith("<div")).toBe(true);
  expect(result.html).toContain('src="/static/a.jpg"');
});
