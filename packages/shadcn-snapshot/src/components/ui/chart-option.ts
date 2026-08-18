// echarts → SVG string for the design-mode Chart preview.
//
// Why echarts (and not recharts): the renderer SSRs components with
// `renderToString` — static HTML, no client JS to hydrate or measure. A
// measurement-based lib (recharts' ResponsiveContainer) renders an empty
// shell under SSR; echarts' headless SSR mode produces a complete SVG
// synchronously from one declarative options object, across every chart type.
//
// Colors are CSS variables (`var(--color-*)`) — the same tokens themeToCss
// emits — so the SVG theme-flips under `.dark` with no re-render (Chromium
// resolves var() in SVG presentation attributes). The tree-shakeable `core`
// API keeps only the chart types we register.
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent } from "echarts/components";
import type { EChartsCoreOption } from "echarts/core";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  SVGRenderer,
]);

export type ChartKind = "bar" | "line" | "area" | "pie" | "scatter";
export type ChartColor = "primary" | "accent" | "muted";
export type TickFormat = "number" | "compact" | "currency" | "percent";

export interface ChartSpec {
  kind?: ChartKind;
  /** Single-series convenience: a list of `{ x label, y value }` points. */
  data?: { x: string | number; y: number }[];
  /** Multi-series: shared categories + named series. Takes precedence over `data`. */
  categories?: (string | number)[];
  series?: { name?: string; data: number[] }[];
  /** Axis titles. */
  xLabel?: string;
  yLabel?: string;
  /** Y-axis tick formatting. */
  tickFormat?: TickFormat;
  /** Accent for single-series charts; multi-series cycles a fixed palette. */
  color?: ChartColor;
  /** Force the legend on/off; defaults on for multi-series, off otherwise. */
  legend?: boolean;
}

const AXIS = "var(--color-muted-foreground)";
const GRID = "var(--color-border)";
const SINGLE: Record<ChartColor, string> = {
  primary: "var(--color-primary)",
  accent: "var(--color-accent)",
  muted: "var(--color-muted-foreground)",
};
// Distinct, theme-flipping hues for multi-series — all tokens themeToCss emits.
const PALETTE = [
  "var(--color-primary)",
  "var(--color-accent)",
  "var(--color-destructive)",
  "var(--color-muted-foreground)",
  "var(--color-foreground)",
];

const FORMATTERS: Record<TickFormat, ((v: number) => string) | undefined> = {
  number: undefined,
  compact: (v) => new Intl.NumberFormat("en", { notation: "compact" }).format(v),
  currency: (v) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: "USD",
      notation: "compact",
    }).format(v),
  percent: (v) => `${v}%`,
};

function normalize(spec: ChartSpec): {
  categories: (string | number)[];
  series: { name?: string; data: number[] }[];
} {
  if (spec.series && spec.series.length > 0) {
    const first = spec.series[0];
    const categories = spec.categories ?? (first ? first.data.map((_, i) => i + 1) : []);
    return { categories, series: spec.series };
  }
  const data = spec.data ?? [];
  return { categories: data.map((d) => d.x), series: [{ data: data.map((d) => d.y) }] };
}

export function buildChartOption(spec: ChartSpec): EChartsCoreOption {
  const kind = spec.kind ?? "bar";
  const { categories, series } = normalize(spec);
  const multi = series.length > 1;
  const showLegend = spec.legend ?? multi;
  const formatter = spec.tickFormat ? FORMATTERS[spec.tickFormat] : undefined;

  const base: Record<string, unknown> = {
    animation: false,
    color: PALETTE,
    ...(showLegend
      ? {
          legend: {
            top: 0,
            icon: "roundRect",
            itemHeight: 8,
            itemWidth: 8,
            textStyle: { color: AXIS, fontSize: 10 },
          },
        }
      : {}),
  };

  if (kind === "pie") {
    const points = spec.data ?? categories.map((c, i) => ({ x: c, y: series[0]?.data[i] ?? 0 }));
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          data: points.map((p) => ({ name: String(p.x), value: p.y })),
          label: { color: AXIS, fontSize: 10 },
          itemStyle: { borderColor: "var(--color-background)", borderWidth: 2 },
        },
      ],
    } as EChartsCoreOption;
  }

  const isScatter = kind === "scatter";
  const cartesianSeries = series.map((s, i) => {
    const tint = multi ? PALETTE[i % PALETTE.length] : SINGLE[spec.color ?? "primary"];
    if (kind === "line" || kind === "area") {
      return {
        type: "line",
        name: s.name,
        data: s.data,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: tint, width: 2 },
        itemStyle: { color: tint },
        ...(kind === "area" ? { areaStyle: { color: tint, opacity: 0.18 } } : {}),
      };
    }
    if (isScatter) {
      return {
        type: "scatter",
        name: s.name,
        symbolSize: 8,
        itemStyle: { color: tint },
        data: s.data.map((y, j) => [categories[j] ?? j, y]),
      };
    }
    return {
      type: "bar",
      name: s.name,
      data: s.data,
      itemStyle: { color: tint, borderRadius: [3, 3, 0, 0] },
    };
  });

  return {
    ...base,
    grid: {
      left: spec.yLabel ? 52 : 44,
      right: 14,
      top: showLegend ? 30 : 16,
      bottom: spec.xLabel ? 38 : 24,
    },
    xAxis: {
      type: isScatter ? "value" : "category",
      ...(isScatter ? {} : { data: categories }),
      ...(spec.xLabel ? { name: spec.xLabel, nameLocation: "middle", nameGap: 22 } : {}),
      nameTextStyle: { color: AXIS, fontSize: 10 },
      axisLabel: { color: AXIS, fontSize: 10 },
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      ...(spec.yLabel ? { name: spec.yLabel } : {}),
      nameTextStyle: { color: AXIS, fontSize: 10 },
      axisLabel: { color: AXIS, fontSize: 10, ...(formatter ? { formatter } : {}) },
      splitLine: { lineStyle: { color: GRID, opacity: 0.5 } },
    },
    series: cartesianSeries,
  } as EChartsCoreOption;
}

const DEFAULT_W = 480;
const DEFAULT_H = 270;

/** Render a chart spec to a self-contained, responsive SVG string. */
export function renderChartSvg(
  spec: ChartSpec,
  size?: { width?: number; height?: number },
): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: size?.width ?? DEFAULT_W,
    height: size?.height ?? DEFAULT_H,
  });
  chart.setOption(buildChartOption(spec));
  const svg = chart.renderToSVGString();
  chart.dispose();
  // Drop the fixed pixel size so the SVG scales to its container (viewBox kept).
  return svg.replace(
    /<svg([^>]*?)\swidth="\d+"\sheight="\d+"/,
    '<svg$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet"',
  );
}
