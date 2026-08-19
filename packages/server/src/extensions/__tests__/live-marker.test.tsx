import { describe, expect, test } from "bun:test";
import { renderBody } from "@velloo/renderer";
import type { Extension, Screen } from "@velloo/schema";
import { buildExtensionRegistry } from "../registry.ts";

/**
 * The extension registry emits a static placeholder by default and a
 * live-island marker when `render:"live"`. Both SSR the same placeholder
 * skeleton, so a live node is "no worse than today" until the client
 * mounts the real component. Rendered through the renderer (react-dom
 * lives there) so node-path injection matches production.
 */

function render(extension: Extension, props: Record<string, unknown>): string {
  const registry = buildExtensionRegistry({ PriceChart: extension });
  const screen: Screen = {
    id: "s1",
    name: "S1",
    tree: { $ref: "PriceChart", props },
  };
  return renderBody(screen, registry);
}

const baseExtension: Extension = {
  importPath: "@/components/charts/PriceChart",
  props: [{ name: "period", type: "string", optional: true, control: "string" }],
  description: "A price chart",
};

describe("buildExtensionRegistry live islands", () => {
  test("static extension renders the placeholder, no live marker", () => {
    const html = render(baseExtension, { period: "30d", className: "h-64" });
    expect(html).toContain('data-velloo-extension="PriceChart"');
    expect(html).not.toContain("data-live-node");
  });

  test("live extension emits a marker carrying ref + serialized props + placeholder skeleton", () => {
    const html = render({ ...baseExtension, render: "live" }, { period: "30d", className: "h-64" });
    expect(html).toContain('data-live-node="true"');
    expect(html).toContain('data-live-ref="PriceChart"');
    // Serialized props (HTML-escaped) keep declared props, drop className.
    expect(html).toContain("&quot;period&quot;:&quot;30d&quot;");
    expect(html).not.toContain("className");
    // The placeholder skeleton stays inside as the SSR fallback.
    expect(html).toContain('data-velloo-extension="PriceChart"');
  });

  test("live marker survives non-serializable props without throwing", () => {
    const html = render({ ...baseExtension, render: "live" }, {});
    expect(html).toContain('data-live-node="true"');
    expect(html).toContain('data-live-props="{}"');
  });
});
