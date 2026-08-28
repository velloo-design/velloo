import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "../icon.tsx";
import { ICON_ALIASES, ICON_NODES } from "../icon-data.ts";

describe("Icon — inline svg from generated lucide data", () => {
  test("renders a known icon with lucide's svg attributes and path data", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "ArrowRight" }));
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain('stroke-width="2"');
    // arrow-right's actual path data.
    expect(html).toContain('d="M5 12h14"');
    expect(html).toContain('d="m12 5 7 7-7 7"');
  });

  test("PascalCase and kebab-case resolve identically", () => {
    const pascal = renderToStaticMarkup(createElement(Icon, { name: "ArrowRight" }));
    const kebab = renderToStaticMarkup(createElement(Icon, { name: "arrow-right" }));
    expect(kebab).toBe(pascal);
  });

  test("size and strokeWidth props flow onto the svg", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "Heart", size: 24, strokeWidth: 1.5 }),
    );
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).toContain('stroke-width="1.5"');
  });

  test("unknown name falls back to help-circle with the muted tint", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "NotARealIcon", className: "size-4" }),
    );
    expect(html).toContain("text-[var(--color-fg-muted)]");
    expect(html).toContain("size-4");
    const helpCircleKebab = ICON_ALIASES.HelpCircle;
    expect(helpCircleKebab).toBeDefined();
    const node = ICON_NODES[helpCircleKebab ?? ""];
    expect(node).toBeDefined();
    for (const [, attrs] of node ?? []) {
      if (typeof attrs.d === "string") expect(html).toContain(`d="${attrs.d}"`);
    }
  });

  test("known name keeps className untouched (no muted tint)", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "Heart", className: "text-primary" }),
    );
    expect(html).toContain('class="text-primary"');
    expect(html).not.toContain("fg-muted");
  });
});
