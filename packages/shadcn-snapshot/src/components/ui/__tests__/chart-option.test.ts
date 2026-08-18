import { describe, expect, test } from "bun:test";
import { buildChartOption, renderChartSvg } from "../chart-option.ts";

const single = [
  { x: "Mon", y: 1200 },
  { x: "Tue", y: 1900 },
  { x: "Wed", y: 800 },
];

describe("renderChartSvg", () => {
  test("produces a real SVG (not an empty shell) for every kind", () => {
    for (const kind of ["bar", "line", "area", "pie", "scatter"] as const) {
      const svg = renderChartSvg({ kind, data: single });
      expect(svg).toContain("<svg");
      expect(svg).toContain("<path"); // real geometry, not a blank box
      expect(svg.length).toBeGreaterThan(500);
    }
  });

  test("colors are theme tokens (so charts flip under .dark), not hard-coded hex", () => {
    const svg = renderChartSvg({ kind: "bar", data: single, color: "primary" });
    expect(svg).toContain("var(--color-primary)");
    expect(svg).toContain("var(--color-muted-foreground)"); // axis labels
  });

  test("multi-series renders a legend with the series names", () => {
    const svg = renderChartSvg({
      kind: "bar",
      categories: ["Q1", "Q2"],
      series: [
        { name: "Revenue", data: [10, 20] },
        { name: "Refunds", data: [2, 3] },
      ],
    });
    expect(svg).toContain("Revenue");
    expect(svg).toContain("Refunds");
    expect(svg).toContain("var(--color-accent)"); // second series hue
  });

  test("tickFormat: compact shortens axis ticks", () => {
    const svg = renderChartSvg({ kind: "bar", data: single, tickFormat: "compact" });
    expect(svg).toMatch(/\d(\.\d)?[kK]/); // e.g. 1.2k / 2K
  });

  test("scales responsively (no fixed pixel width/height on the root svg)", () => {
    const svg = renderChartSvg({ kind: "bar", data: single });
    expect(svg).toMatch(/<svg[^>]*width="100%"[^>]*height="100%"/);
    expect(svg).toContain("viewBox=");
  });
});

describe("buildChartOption", () => {
  test("pie has no cartesian axes", () => {
    const opt = buildChartOption({ kind: "pie", data: single }) as Record<string, unknown>;
    expect(opt.xAxis).toBeUndefined();
    expect(opt.yAxis).toBeUndefined();
    expect(opt.series).toBeDefined();
  });

  test("single series defaults to one bar series; multi keeps each", () => {
    const one = buildChartOption({ data: single }) as { series: unknown[] };
    expect(one.series).toHaveLength(1);
    const many = buildChartOption({
      categories: ["a"],
      series: [{ data: [1] }, { data: [2] }],
    }) as { series: unknown[] };
    expect(many.series).toHaveLength(2);
  });
});
