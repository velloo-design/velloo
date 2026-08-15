// Velloo-flavored Chart. shadcn's `chart` is a recharts wrapper +
// CSS-vars-based theming. Design mode just needs a styled chart shape
// designers can drop into a dashboard. We render small static SVG bar
// / line / area charts directly so the snapshot stays light (no
// recharts dependency in the embedded snapshot).
//
// The agent's emitted code uses the real shadcn Chart (which imports
// recharts) — this is design-only.
import type * as React from "react";
import { cn } from "../lib/utils.ts";

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

export interface ChartProps {
  className?: string;
  /**
   * Series of `{ x, y }` points. For Bar/Line, `y` drives the value.
   * For Bar charts a label per bar comes from `x`.
   */
  data: { x: string | number; y: number }[];
  kind?: "bar" | "line" | "area";
  /** Color override; defaults to `bg-primary`. Pass `accent` etc. */
  color?: "primary" | "accent" | "muted";
}

const COLOR_BG: Record<NonNullable<ChartProps["color"]>, string> = {
  primary: "fill-primary stroke-primary",
  accent: "fill-accent stroke-accent",
  muted: "fill-muted-foreground stroke-muted-foreground",
};

/**
 * Tiny SVG bar/line/area chart. Width 320 × height 120 by default —
 * the parent wraps it via aspect-video for responsive sizing. The
 * chart auto-fits its data on Y; X is evenly spaced.
 */
export function Chart({ className, data, kind = "bar", color = "primary" }: ChartProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div data-slot="chart" className={cn("h-32 w-full", className)} />;
  }
  const W = 320;
  const H = 120;
  const pad = 12;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const ys = data.map((d) => d.y);
  const max = Math.max(...ys, 1);
  const min = Math.min(...ys, 0);
  const range = Math.max(max - min, 1);
  const step = innerW / Math.max(data.length - 1, 1);
  const colorClass = COLOR_BG[color];

  if (kind === "bar") {
    const barW = innerW / data.length - 4;
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: chart visualisation; designs add their own title alongside
      <svg data-slot="chart" viewBox={`0 0 ${W} ${H}`} className={cn("h-32 w-full", className)}>
        {data.map((d, i) => {
          const h = ((d.y - min) / range) * innerH;
          const x = pad + i * (innerW / data.length) + 2;
          const y = H - pad - h;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: index disambiguates duplicate x values
              key={`${d.x}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={2}
              className={colorClass}
            />
          );
        })}
      </svg>
    );
  }

  const points = data.map((d, i) => {
    const x = pad + i * step;
    const h = ((d.y - min) / range) * innerH;
    const y = H - pad - h;
    return `${x},${y}`;
  });

  if (kind === "area") {
    const polygon = [`${pad},${H - pad}`, ...points, `${W - pad},${H - pad}`].join(" ");
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: chart visualisation; designs add their own title alongside
      <svg data-slot="chart" viewBox={`0 0 ${W} ${H}`} className={cn("h-32 w-full", className)}>
        <polygon points={polygon} className={cn(colorClass, "opacity-25 stroke-none")} />
        <polyline
          points={points.join(" ")}
          className={cn(colorClass, "fill-none")}
          strokeWidth={2}
        />
      </svg>
    );
  }

  // line
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: chart visualisation; designs add their own title alongside
    <svg data-slot="chart" viewBox={`0 0 ${W} ${H}`} className={cn("h-32 w-full", className)}>
      <polyline points={points.join(" ")} className={cn(colorClass, "fill-none")} strokeWidth={2} />
      {data.map((d, i) => {
        const x = pad + i * step;
        const h = ((d.y - min) / range) * innerH;
        const y = H - pad - h;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: index disambiguates duplicate x values
          <circle key={`${d.x}-${i}`} cx={x} cy={y} r={3} className={colorClass} />
        );
      })}
    </svg>
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
