import { describe, expect, test } from "bun:test";
import { buildChartOption, chartSize, renderChartSvg } from "../chart-option.ts";

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

const multi = {
  categories: ["Q1", "Q2"],
  series: [
    { name: "Revenue", data: [10, 20] },
    { name: "Refunds", data: [2, 3] },
  ],
};

describe("stacked", () => {
  test("bar/area multi-series carry stack: total on every series", () => {
    for (const kind of ["bar", "area"] as const) {
      const opt = buildChartOption({ kind, ...multi, stacked: true }) as {
        series: { stack?: string }[];
      };
      expect(opt.series).toHaveLength(2);
      for (const s of opt.series) expect(s.stack).toBe("total");
    }
  });

  test("ignored for line/scatter kinds and for single series", () => {
    for (const kind of ["line", "scatter"] as const) {
      const opt = buildChartOption({ kind, ...multi, stacked: true }) as {
        series: { stack?: string }[];
      };
      for (const s of opt.series) expect(s.stack).toBeUndefined();
    }
    const one = buildChartOption({ kind: "bar", data: single, stacked: true }) as {
      series: { stack?: string }[];
    };
    for (const s of one.series) expect(s.stack).toBeUndefined();
  });
});

describe("aspect sizing", () => {
  test("chartSize maps a width÷height ratio onto the default width, clamped", () => {
    expect(chartSize()).toEqual({ width: 480, height: 270 }); // 16:9 default
    expect(chartSize(4)).toEqual({ width: 480, height: 120 });
    expect(chartSize(1)).toEqual({ width: 480, height: 480 });
    expect(chartSize(1000)).toEqual({ width: 480, height: 24 }); // clamped to 20
    expect(chartSize(0.01)).toEqual({ width: 480, height: 1920 }); // clamped to 0.25
    expect(chartSize(Number.NaN)).toEqual({ width: 480, height: 270 });
  });

  test("renderChartSvg honors the aspect-derived size", () => {
    const svg = renderChartSvg({ kind: "line", data: single }, chartSize(4));
    expect(svg).toContain('viewBox="0 0 480 120"');
  });
});

describe("axes: false (sparkline mode)", () => {
  test("hides both axes and collapses grid padding", () => {
    const opt = buildChartOption({ kind: "line", data: single, axes: false }) as {
      grid: { left: number; right: number; top: number; bottom: number };
      xAxis: { show?: boolean };
      yAxis: { show?: boolean };
    };
    expect(opt.xAxis.show).toBe(false);
    expect(opt.yAxis.show).toBe(false);
    expect(opt.grid.left).toBeLessThanOrEqual(4);
    expect(opt.grid.right).toBeLessThanOrEqual(4);
    expect(opt.grid.top).toBeLessThanOrEqual(4);
    expect(opt.grid.bottom).toBeLessThanOrEqual(4);
  });

  test("rendered svg keeps the marks but drops tick labels and gridlines", () => {
    const svg = renderChartSvg({ kind: "line", data: single, axes: false });
    expect(svg).toContain("<path"); // marks still render
    expect(svg).not.toContain("Mon"); // no x tick labels
    expect(svg).not.toContain("var(--color-border)"); // no axis lines / gridlines
  });
});

describe("palette", () => {
  test("never auto-assigns the destructive hue to a series", () => {
    const svg = renderChartSvg({
      kind: "bar",
      categories: ["a", "b"],
      // Six series cycle the full five-entry palette.
      series: Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, data: [i + 1, i + 2] })),
    });
    expect(svg).not.toContain("var(--color-destructive)");
    expect(svg).toContain("var(--color-secondary)"); // third slot replacement
  });
});
