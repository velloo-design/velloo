// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/tooltip).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas note: in design mode the tooltip never opens (no hover/focus
// gestures route through the static iframe). We expose Provider + Trigger
// for completeness so emitted code matches, but TooltipContent renders
// inline so designers can see its styling. The agent's emitted code keeps
// the proper Radix portal behavior at runtime.
"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function TooltipProvider({
  children,
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} {...props}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Canvas-safe TooltipContent: renders inline (not via portal) so the
 * static design surface can preview it. Real apps using the agent's
 * emitted code still get the portal behavior because the agent reads
 * radix-ui's Tooltip.Content directly — they bypass this helper.
 */
export function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <div
      data-slot="tooltip-content"
      data-side-offset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
        className,
      )}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}
