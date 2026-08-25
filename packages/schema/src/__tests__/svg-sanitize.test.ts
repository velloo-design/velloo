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
    expect(svgLooksActive("<a href=#/onmouseover=alert(1)><rect/></a>")).toBe(true);
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

  test("leaves legitimate static SVG untouched", () => {
    const clean = '<path d="M0 0h24v24H0z" fill="currentColor"/><circle cx="12" cy="12" r="4"/>';
    expect(sanitizeSvgMarkup(clean)).toBe(clean);
  });
});
