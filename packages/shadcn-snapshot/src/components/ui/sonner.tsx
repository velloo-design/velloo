// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/sonner).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas-safe: real apps render <Toaster /> from `sonner` which mounts an
// imperative queue + portal at the document root. In design mode the
// queue is meaningless (nothing dispatches toast()) so we render a static
// sample toast pinned to the bottom-right so a user dropping a <Toaster />
// onto a screen can see what it'll look like at runtime.
"use client";

import { CheckCircle2 } from "lucide-react";
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

export function Toaster({
  className,
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
      {...props}
    >
      <div
        data-slot="sonner-toast"
        data-state="open"
        className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border bg-background p-4 shadow-lg"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
        <div className="flex-1 text-sm">
          <div className="font-medium text-foreground">Toast</div>
          <div className="text-muted-foreground">Sample toast preview.</div>
        </div>
      </div>
    </div>
  );
}
