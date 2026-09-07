// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/sonner).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas-safe: real apps render sonner's <Toaster />, which mounts an
// imperative queue plus a portal at the document root. Nothing calls toast()
// in design mode, so that queue only ever paints an empty region — we render a
// single sample toast pinned to the configured corner instead, so a user who
// drops a <Toaster /> onto a screen sees what it will look like at runtime.
// Upstream reads next-themes to hand sonner a theme; the canvas is already
// themed by the design folder's tokens, so the sample is painted from the same
// CSS vars upstream passes down rather than taking that dependency.
"use client";

import { CircleCheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface ToasterProps extends React.ComponentProps<"div"> {
  position?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  richColors?: boolean;
  expand?: boolean;
  closeButton?: boolean;
  theme?: "light" | "dark" | "system";
}

const POSITION_CLASS: Record<NonNullable<ToasterProps["position"]>, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
};

const TOAST_VARS = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
} as React.CSSProperties;

const TOAST_STYLE = {
  background: "var(--normal-bg)",
  color: "var(--normal-text)",
  borderColor: "var(--normal-border)",
  borderRadius: "var(--border-radius)",
} as React.CSSProperties;

export function Toaster({
  className,
  style,
  position = "bottom-right",
  richColors: _richColors,
  expand: _expand,
  closeButton: _closeButton,
  theme: _theme,
  ...props
}: ToasterProps) {
  return (
    <div
      data-slot="sonner-toaster"
      data-velloo-inline="true"
      className={cn(
        "pointer-events-none fixed z-50 flex flex-col gap-2",
        POSITION_CLASS[position],
        className,
      )}
      style={{ ...TOAST_VARS, ...style }}
      {...props}
    >
      <div
        data-slot="sonner-toast"
        data-state="open"
        className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2 border p-4 text-sm shadow-lg"
        style={TOAST_STYLE}
      >
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-medium">Toast</div>
          <div className="text-muted-foreground">Sample toast preview.</div>
        </div>
      </div>
    </div>
  );
}
