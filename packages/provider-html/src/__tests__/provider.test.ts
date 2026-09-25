import { expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { createProvider, emitNativeHtml, Html, HtmlFragment } from "../index.ts";

test("native semantic HTML and htmx fragment survive SSR", () => {
  const heading = renderToStaticMarkup(
    Html({ as: "h1", className: "title", children: "Contacts" }),
  );
  const fragment = renderToStaticMarkup(
    HtmlFragment({ src: "/contacts/archive", select: "main", boost: true }),
  );
  expect(heading).toBe('<h1 class="title">Contacts</h1>');
  expect(fragment).toContain('hx-get="/contacts/archive"');
  expect(fragment).toContain('hx-select="main"');
  expect(fragment).toContain('hx-boost="true"');
  expect(renderToStaticMarkup(HtmlFragment({ as: "tbody", src: "/contacts/rows" }))).toContain(
    '<tbody hx-get="/contacts/rows"',
  );
  expect(createProvider().canvasBundleSpec).toBeUndefined();
});

test("common semantic tags and static SVG shapes render without enabling executable tags", () => {
  expect(renderToStaticMarkup(Html({ as: "b", children: "Urgent" }))).toBe("<b>Urgent</b>");
  expect(
    renderToStaticMarkup(Html({ as: "time", dateTime: "2026-09-25", children: "Today" })),
  ).toBe('<time dateTime="2026-09-25">Today</time>');
  expect(
    renderToStaticMarkup(Html({ as: "svg", children: Html({ as: "path", d: "M0 0" }) })),
  ).toContain('<path d="M0 0"></path>');
  expect(() => Html({ as: "script", children: "alert(1)" })).toThrow("unsupported HTML tag");
});

test("HTML emission keeps htmx attributes and removes canvas markers", () => {
  const screen: Screen = {
    id: "archive",
    name: "Archive",
    tree: { $ref: "HtmlFragment", props: { src: "/contacts/archive", select: "main" } },
  };
  const html = emitNativeHtml(screen, createProvider().registry);
  expect(html).toContain('hx-get="/contacts/archive"');
  expect(html).toContain('hx-select="main"');
  expect(html).not.toContain("data-node-path");
  expect(html).not.toContain("data-velloo-html-fragment");
  expect(html).not.toContain("data-velloo-host-path");
});
