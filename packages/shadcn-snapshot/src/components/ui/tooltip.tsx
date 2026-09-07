// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/tooltip).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx.
"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";

export function TooltipProvider({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

export function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root data-slot="tooltip" {...pinOpenInDesignMode(props)} />
    </TooltipPrimitive.Provider>
  );
}

export function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset: _sideOffset,
  ...props
}: React.ComponentProps<"div"> & { sideOffset?: number }) {
  return (
    <div
      data-slot="tooltip-content"
      {...inlineOpenAttrs()}
      className={cn(
        "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
        className,
      )}
      {...props}
    />
  );
}
