import { describe, expect, test } from "bun:test";
import { sanitizeSvgMarkup, svgLooksActive } from "../svg-sanitize.ts";

describe("svgLooksActive", () => {
  test("flags scripts, handlers, foreignObject, javascript: URLs, and SMIL", () => {
    expect(svgLooksActive("<svg><script>alert(1)</script></svg>")).toBe(true);
    expect(svgLooksActive('<svg onload="alert(1)"><rect/></svg>')).toBe(true);
    expect(svgLooksActive('<svg><image href="x" onerror="alert(1)"/></svg>')).toBe(true);
    expect(svgLooksActive("<svg><foreignObject><body/></foreignObject></svg>")).toBe(true);
    expect(svgLooksActive('<svg><a href="javascript:alert(1)"><rect/></a></svg>')).toBe(true);
    expect(svgLooksActive('<svg><a href=" javascript:alert(1)"><rect/></a></svg>')).toBe(true);
    expect(svgLooksActive('<svg><set attributeName="onload" to="alert(1)"/></svg>')).toBe(true);
    // Handler abutting a preceding attribute's closing quote (no whitespace) or a `/`.
    expect(svgLooksActive('<rect class="x"onclick="alert(1)"/>')).toBe(true);
  });

  test("reads an unquoted value the way HTML does, up to whitespace", () => {
    // `/onmouseover=…` is part of the href value, not a second attribute.
    const markup = "<a href=#/onmouseover=alert(1)><rect/></a>";
    expect(svgLooksActive(markup)).toBe(false);
    expect(sanitizeSvgMarkup(markup)).toBe('<a href="#/onmouseover=alert(1)"><rect/></a>');
  });

  test("passes static drawing content", () => {
    expect(svgLooksActive('<path d="M0 0h24v24H0z" stroke="none"/>')).toBe(false);
    expect(svgLooksActive('<a href="#anchor"><text>only once</text></a>')).toBe(false);
    expect(svgLooksActive('<image href="/assets/logo.png"/>')).toBe(false);
    expect(svgLooksActive('<rect width="10" height="10" fill="currentColor"/>')).toBe(false);
  });
});

describe("sanitizeSvgMarkup", () => {
  test("strips a <script> element wholesale", () => {
    const out = sanitizeSvgMarkup('<path d="M0 0"/><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('<path d="M0 0"/>');
    expect(svgLooksActive(out)).toBe(false);
  });

  test("strips an inline event handler but keeps the element", () => {
    const out = sanitizeSvgMarkup('<image href="/logo.png" onerror="alert(1)"/>');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('href="/logo.png"');
    expect(svgLooksActive(out)).toBe(false);
  });

  test("strips foreignObject + SMIL and neutralizes javascript: URLs", () => {
    const out = sanitizeSvgMarkup(
      "<foreignObject><iframe/></foreignObject>" +
        '<set attributeName="onload" to="x"/>' +
        '<a href="javascript:alert(1)"><rect/></a>',
    );
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("<set");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(svgLooksActive(out)).toBe(false);
  });

  test("strips a handler that abuts a preceding attribute quote", () => {
    const out = sanitizeSvgMarkup('<rect class="x"onclick="alert(1)"/>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
    // The preceding attribute stays terminated (its closing quote survives).
    expect(out).toContain('class="x"');
    expect(svgLooksActive(out)).toBe(false);
  });

  test("a tag spliced together by an earlier removal is removed too", () => {
    const out = sanitizeSvgMarkup("<svg><scr<set>ipt>alert(1)</scr<set>ipt></svg>");
    expect(out).not.toContain("<script");
    expect(svgLooksActive(out)).toBe(false);
  });

  test("leaves legitimate static SVG untouched", () => {
    const clean = '<path d="M0 0h24v24H0z" fill="currentColor"/><circle cx="12" cy="12" r="4"/>';
    expect(sanitizeSvgMarkup(clean)).toBe(clean);
  });

  test.each([
    ["an entity-encoded scheme", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["an entity without its semicolon", '<a href="&#106avascript:alert(1)">x</a>'],
    ["an encoded tab inside the scheme", '<a href="java&#x09;script:alert(1)">x</a>'],
    ["a literal tab inside the scheme", '<a href="java\tscript:alert(1)">x</a>'],
    ["a named colon entity", '<a href="javascript&colon;alert(1)">x</a>'],
    ["an encoded xlink:href", '<a xlink:href="&#x6A;avascript:alert(1)">x</a>'],
    ["an SVG data URL image", '<image href="data:image/svg+xml,<svg onload=alert(1)>"/>'],
  ])("drops a link hidden behind %s", (_label, markup) => {
    expect(svgLooksActive(markup)).toBe(true);
    const out = sanitizeSvgMarkup(markup);
    expect(out).not.toContain("href");
    expect(out.toLowerCase()).not.toContain("script:");
  });

  test("checks an href under any namespace prefix", () => {
    const markup =
      '<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="#a"/><a x:href="&#106;avascript:x">y</a></svg>';
    expect(sanitizeSvgMarkup(markup)).toBe(
      '<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="#a"/><a>y</a></svg>',
    );
  });

  test("keeps fragment, relative, http and raster data links", () => {
    const markup =
      '<use href="#icon"/><image href="/assets/a.png"/><a href="https://velloo.design">x</a>' +
      '<image href="data:image/png;base64,AAAA"/>';
    expect(svgLooksActive(markup)).toBe(false);
    expect(sanitizeSvgMarkup(markup)).toBe(markup);
  });

  test("drops HTML that would break out of the SVG, without eating its siblings", () => {
    const out = sanitizeSvgMarkup(
      '<svg><meta http-equiv="refresh" content="0;url=https://evil.example"><img src=x><path d="M0"/></svg>',
    );
    expect(out).toBe('<svg><path d="M0"/></svg>');
  });

  test("keeps a style sheet but not its imports or remote urls", () => {
    const markup =
      "<style>@import url(//evil.example/x.css); .a{fill:url(#g)} .b{fill:url(http://evil.example)}</style>";
    expect(svgLooksActive(markup)).toBe(true);
    const out = sanitizeSvgMarkup(markup);
    expect(out).not.toContain("@import");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("fill:url(#g)");
  });

  test("a prefixed animation element is dropped, not passed through", () => {
    const out = sanitizeSvgMarkup(
      '<svg:animate attributeName="href" values="javascript:alert(1)"/>',
    );
    expect(out).toBe("");
  });

  test("re-escapes text so nothing new can parse as markup", () => {
    const out = sanitizeSvgMarkup("<text>1 &lt; 2 &amp;&lt;script&gt;</text>");
    expect(out).toBe("<text>1 &lt; 2 &amp;&lt;script&gt;</text>");
  });

  test("drops declarations, DOCTYPE subsets and comments from a file", () => {
    const out = sanitizeSvgMarkup(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><!-- note --><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  });

  test("stays linear on adversarial input", () => {
    const start = performance.now();
    sanitizeSvgMarkup("<".repeat(200_000));
    sanitizeSvgMarkup("<a ".repeat(100_000));
    sanitizeSvgMarkup('<svg a="'.repeat(50_000));
    sanitizeSvgMarkup("<script>".repeat(50_000));
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
