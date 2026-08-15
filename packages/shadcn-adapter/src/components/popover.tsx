// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/popover).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx.
"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../lib/canvas-portal.tsx";
import { cn } from "../lib/utils.ts";

export function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...pinOpenInDesignMode(props)} />;
}

export function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export function PopoverContent({
  className,
  align: _align,
  side: _side,
  sideOffset: _sideOffset,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}) {
  return (
    <div
      data-slot="popover-content"
      {...inlineOpenAttrs()}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
        className,
      )}
      {...props}
    />
  );
}
