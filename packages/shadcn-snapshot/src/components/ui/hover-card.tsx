// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/hover-card).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. A hover card only mounts while the
// pointer rests on the trigger, which never happens in a static render, so the
// root is pinned open and the content is a plain inline element. Classes track
// upstream minus the ones keyed to Radix's runtime positioning var
// (`--radix-hover-card-content-transform-origin`) or to the open animation,
// which would fire on every render and leave screenshots catching a
// mid-transition frame.
"use client";

import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";

export function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...pinOpenInDesignMode(props)} />;
}

export function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

export function HoverCardContent({
  className,
  align: _align,
  side: _side,
  sideOffset: _sideOffset,
  collisionPadding: _collisionPadding,
  ...props
}: React.ComponentProps<"div"> & {
  align?: string;
  side?: string;
  sideOffset?: number;
  collisionPadding?: number;
}) {
  return (
    <div
      data-slot="hover-card-content"
      {...inlineOpenAttrs()}
      className={cn(
        "z-50 w-64 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
        className,
      )}
      {...props}
    />
  );
}
