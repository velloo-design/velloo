// Velloo-owned absolute-positioning escape hatch. The default mental
// model is flex / grid; Layer is for hero compositions where neither
// makes sense (overlapping decoration, parallax-feel stacks, deliberate
// off-grid placement).
//
// Marked with data-slot="layer" so the canvas can flag heavy usage in
// inspect_design_quality later — Layer is a "use sparingly" tool.
import type * as React from "react";
import { cn } from "./cn.ts";

export interface LayerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Pixel offset from the parent's top edge. Accepts numbers (treated
   * as px) or any valid CSS length string ("8rem", "12%").
   */
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  /** Stacking order. Default 1. */
  z?: number;
  /**
   * Whether the layer captures pointer events. Default `true`. Set to
   * `false` for decorative-only layers that shouldn't block clicks.
   */
  pointerEvents?: boolean;
}

function asLength(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}

export function Layer({
  top,
  right,
  bottom,
  left,
  z = 1,
  pointerEvents = true,
  className,
  style,
  ...rest
}: LayerProps) {
  return (
    <div
      data-slot="layer"
      className={cn("absolute", className)}
      style={{
        top: asLength(top),
        right: asLength(right),
        bottom: asLength(bottom),
        left: asLength(left),
        zIndex: z,
        pointerEvents: pointerEvents ? undefined : "none",
        ...style,
      }}
      {...rest}
    />
  );
}
