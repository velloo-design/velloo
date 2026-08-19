// Velloo-flavored Chart. shadcn's `chart` is a recharts wrapper that needs a
// measured DOM (ResponsiveContainer), so it renders nothing under the
// renderer's static SSR. We render a realistic preview server-side via
// echarts' headless SSR-to-SVG mode (see chart-option.ts) — bar/line/area/
// pie/scatter, multi-series, axis labels + tick formatting — from one
// normalized schema. Colors are theme tokens, so previews theme-flip.
//
// `emit_code` targets the app's actual chart lib (recharts, the app's own
// Chart, …) via a codegen adapter — preview engine and emit target are
// decoupled. This built-in `Chart` always previews via echarts; to preview
// the app's *own* chart component (its exact recharts) pixel-faithfully,
// register it as a `render:"live"` extension (live islands).
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { renderChartSvg } from "./chart-option.ts";

export type { ChartColor, ChartKind, ChartSpec, TickFormat } from "./chart-option.ts";

export interface ChartContainerProps extends React.ComponentProps<"div"> {
  config?: Record<string, { label?: string; color?: string }>;
}

export function ChartContainer({
  className,
  config: _config,
  children,
  ...props
}: ChartContainerProps) {
  return (
    <div
      data-slot="chart-container"
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Declared inline (not `extends ChartSpec`) so build.ts's manifest extraction
// — which reads an interface's *own* members — surfaces every prop to agents.
export interface ChartProps {
  className?: string;
  kind?: "bar" | "line" | "area" | "pie" | "scatter";
  /** Single-series convenience: a list of `{ x label, y value }` points. */
  data?: { x: string | number; y: number }[];
  /** Multi-series: shared categories + named series. Takes precedence over `data`. */
  categories?: (string | number)[];
  series?: { name?: string; data: number[] }[];
  /** Axis titles. */
  xLabel?: string;
  yLabel?: string;
  /** Y-axis tick formatting. */
  tickFormat?: "number" | "compact" | "currency" | "percent";
  /** Accent for single-series charts; multi-series cycles a fixed palette. */
  color?: "primary" | "accent" | "muted";
  /** Force the legend on/off; defaults on for multi-series, off otherwise. */
  legend?: boolean;
}

/**
 * Dashboard-grade chart preview. Renders server-side via echarts SSR→SVG
 * (chart-option.ts) so it shows real geometry + axes in the static render
 * path, and the SVG is injected as-is (no scripts/foreignObject). Empty
 * `data`/`series` degrades to a sized blank slot.
 */
export function Chart({
  className,
  kind,
  data,
  series,
  categories,
  xLabel,
  yLabel,
  tickFormat,
  color,
  legend,
  ...rest
}: ChartProps & React.ComponentProps<"div">) {
  const hasData =
    (Array.isArray(series) && series.length > 0) || (Array.isArray(data) && data.length > 0);
  if (!hasData) {
    return <div data-slot="chart" className={cn("aspect-video w-full", className)} {...rest} />;
  }
  const svg = renderChartSvg({
    kind,
    data,
    series,
    categories,
    xLabel,
    yLabel,
    tickFormat,
    color,
    legend,
  });
  return (
    <div
      data-slot="chart"
      className={cn("aspect-video w-full", className)}
      {...rest}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated static echarts SVG (no scripts/foreignObject); see chart-option.ts
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ChartLegend({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-legend"
      className={cn("flex items-center gap-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function ChartLegendContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-legend-content"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

export function ChartTooltip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-tooltip"
      className={cn("rounded-md border bg-popover px-2 py-1 text-xs shadow-md", className)}
      {...props}
    />
  );
}

export function ChartTooltipContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-tooltip-content"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}
