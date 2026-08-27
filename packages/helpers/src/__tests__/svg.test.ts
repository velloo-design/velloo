import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SVG } from "../svg.tsx";

describe("SVG component — content sanitization (FIX 2, render path)", () => {
  test("strips active content from `content` before dangerouslySetInnerHTML", () => {
    const html = renderToStaticMarkup(
      createElement(SVG, {
        content: '<image href="x" onerror="alert(1)"/><script>alert(2)</script><path d="M0 0"/>',
      }),
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    // The static drawing still renders.
    expect(html).toContain("<path");
  });

  test("renders legitimate static SVG content intact", () => {
    const html = renderToStaticMarkup(createElement(SVG, { content: '<path d="M0 0h24v24H0z"/>' }));
    expect(html).toContain('d="M0 0h24v24H0z"');
  });
});
