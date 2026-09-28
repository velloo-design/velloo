import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { styleChannelOf } from "@velloo/provider";
import { renderToStaticMarkup } from "react-dom/server";
import { createProvider, Html, HtmlFragment } from "../index.ts";

describe("Html", () => {
  test("renders semantic tags and static SVG shapes", () => {
    expect(renderToStaticMarkup(Html({ as: "h1", className: "title", children: "Contacts" }))).toBe(
      '<h1 class="title">Contacts</h1>',
    );
    expect(renderToStaticMarkup(Html({ as: "b", children: "Urgent" }))).toBe("<b>Urgent</b>");
    expect(
      renderToStaticMarkup(Html({ as: "svg", children: Html({ as: "path", d: "M0 0" }) })),
    ).toContain('<path d="M0 0"></path>');
  });

  test("refuses executable and embedded tags", () => {
    for (const as of ["script", "iframe", "object", "style", "link", "base"]) {
      expect(() => Html({ as })).toThrow("unsupported HTML tag");
    }
  });

  test("drops handlers, raw inner HTML and script URLs, keeping ordinary attributes", () => {
    // A design's props are data, not React's typed handlers.
    const hostile: Record<string, unknown> = {
      as: "a",
      href: " java\tscript:alert(1)",
      onClick: "alert(1)",
      onmouseover: "alert(1)",
      dangerouslySetInnerHTML: { __html: "<img src=x onerror=alert(1)>" },
      "hx-get": "/contacts",
      title: "Contacts",
      children: "Open",
    };
    const markup = renderToStaticMarkup(Html(hostile as Parameters<typeof Html>[0]));
    expect(markup).toBe('<a hx-get="/contacts" title="Contacts">Open</a>');
    expect(
      renderToStaticMarkup(Html({ as: "form", action: "data:text/html,<script>", method: "get" })),
    ).toBe('<form method="get"></form>');
    expect(renderToStaticMarkup(Html({ as: "a", href: "/contacts/1" }))).toBe(
      '<a href="/contacts/1"></a>',
    );
  });
});

test("accepts HTML attribute names and renders them without React warnings", () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const markup = renderToStaticMarkup(
      Html({
        as: "input",
        class: "form-control",
        autocomplete: "off",
        maxlength: 40,
        readonly: true,
      } as Parameters<typeof Html>[0]),
    );
    expect(markup).toBe(
      '<input class="form-control" autoComplete="off" maxLength="40" readOnly=""/>',
    );
  } finally {
    console.error = original;
  }
  expect(errors).toEqual([]);
});

describe("HtmlFragment", () => {
  test("loads a host route through htmx and marks the fragment for the host runtime", () => {
    const fragment = renderToStaticMarkup(
      HtmlFragment({ src: "/contacts/archive", select: "main", boost: true }),
    );
    expect(fragment).toContain('hx-get="/contacts/archive"');
    expect(fragment).toContain('hx-select="main"');
    expect(fragment).toContain('hx-boost="true"');
    expect(fragment).toContain('data-velloo-host-path="/contacts/archive"');
    expect(renderToStaticMarkup(HtmlFragment({ as: "tbody", src: "/contacts/rows" }))).toContain(
      '<tbody data-velloo-html-fragment=""',
    );
  });

  test("shares the Html sanitizer and rejects non-host sources", () => {
    expect(
      renderToStaticMarkup(
        HtmlFragment({ src: "/rows", onload: "alert(1)", title: "Rows" } as Parameters<
          typeof HtmlFragment
        >[0]),
      ),
    ).not.toContain("alert");
    expect(() => HtmlFragment({ src: "https://example.com/rows" })).toThrow("root-relative");
    expect(() => HtmlFragment({ src: "//example.com/rows" })).toThrow("root-relative");
    expect(() => HtmlFragment({ src: "/rows", as: "script" })).toThrow("unsupported HTML tag");
  });
});

describe("createProvider", () => {
  test("declares its capabilities instead of relying on its id", () => {
    const provider = createProvider();
    expect(provider.codegenFormat).toBe("html");
    expect(provider.hostRuntime?.kind).toBe("htmx");
    expect(existsSync(provider.hostRuntime?.scriptPath ?? "")).toBe(true);
    expect(provider.canvasBundleSpec).toBeUndefined();
    // Inline styles only, whatever the folder's CSS framework says.
    expect(styleChannelOf(provider, "tailwind").kind).toBe("style");
    expect(provider.registryForChannel?.("tailwind-classname")).toBe(provider.registry);
  });

  test("its own descriptors carry browsing metadata", async () => {
    const manifest = await createProvider().loadManifest();
    for (const id of ["Html", "HtmlFragment"]) {
      const descriptor = manifest.find((entry) => entry.id === id);
      expect(descriptor?.group).toBeDefined();
      expect(descriptor?.family).toBe(id);
    }
  });
});
